"""每日任务生成。

两个约定：
1. 每道题都带 ``ref_id``（题库主键），复习队列和错题本都靠它定位到具体哪个字 / 哪个词，
   不能用「当天第几题」，否则第二天复习会取到完全无关的内容。
2. 每天先从错题本抽几道没掌握的题插在最前面，答对两次就算掌握。
"""

from __future__ import annotations

import hashlib
import json
import random
import re

from sqlalchemy.exc import IntegrityError

from ..extensions import db
from ..models import (
    ChineseChar,
    DailyTask,
    EnglishPhoneme,
    EnglishSentence,
    EnglishWord,
    MathQuestion,
    MathRule,
    Poem,
    WrongItem,
)
from ..utils.dates import today_str
from . import homophone, level, mathgen, srs
from .settings import get_setting

SUBJECTS = ("chinese", "math", "english")
SUBJECT_LABELS = {"chinese": "语文", "math": "数学", "english": "英语"}

# 古诗走独立的背诵流程，不适合塞回选择题队列
RETRY_SKIP_KINDS = ("poem",)
# 这些题型只记录完成与否（背诗录音、朗读卡），不参与判分，也不进总分
NO_SCORE_KINDS = ("poem",)
NO_SCORE_TYPES = ("word_read", "phoneme_read", "char_read")
# 朗读/认读卡：看见即算完成，客户端点「下一个」时用这个占位答案存档
READ_TYPES = NO_SCORE_TYPES
READ_ANSWER = "__read__"

# 各题型数量全部来自后台「系统设置」，按语/数/英三科分别配置；
# 0 表示当天不出该题型（见 services/settings.py 的 DEFAULTS）。


def _num(key: str) -> int:
    """读一个数量型配置，负数/脏值按 0 处理。"""
    try:
        return max(0, int(get_setting(key) or 0))
    except (TypeError, ValueError):
        return 0


def _json_list(value):
    try:
        data = json.loads(value or "[]")
        return data if isinstance(data, list) else []
    except (TypeError, ValueError):
        return []


def item_key(item) -> int:
    """题目的稳定编号：有题库主键就用主键，数学计算题按知识点聚合。"""
    ref = item.get("ref_id")
    if ref:
        return int(ref)
    seed = f"{item.get('kind')}:{item.get('topic') or item.get('stem')}"
    return int(hashlib.md5(seed.encode("utf-8")).hexdigest()[:12], 16)


def _options(correct, pool, rng, size=4):
    candidates = []
    for value in pool:
        if value and value != correct and value not in candidates:
            candidates.append(value)
    rng.shuffle(candidates)
    options = candidates[: size - 1] + [correct]
    rng.shuffle(options)
    return options


def _pick_unlearned(model, learned: set, n: int, rng, id_attr: str = "id"):
    """从全库挑 N 条还没学过的（语文/英语不跟年级学期走）。

    挑选按等级比例 10/40/30/15/5 分配，见 ``services/level.py``。
    复习题不按比例——该复习的必须复习。
    """
    rows = [r for r in model.query.all() if getattr(r, id_attr) not in learned]
    if not rows or n <= 0:
        return []
    return level.split(rows, n, rng)


def _pick_learned(model, learned: set, used: set, n: int, rng, id_attr: str = "id"):
    """从学过的条目里随机补几条（当前出题不再用「复习池」，保留给以后扩展）。"""
    rows = [r for r in model.query.all() if getattr(r, id_attr) in learned and getattr(r, id_attr) not in used]
    if not rows or n <= 0:
        return []
    return rng.sample(rows, min(n, len(rows)))


def _due_rows(model, child, subject: str, item_type: str, limit: int, today: str) -> list:
    """按遗忘曲线到期记录，取回对应的题库行（最多 limit 条）。

    这些是「以前学过、到了该再见面时间」的内容。出题时优先塞进当天的
    朗读卡 / 选择题，让孩子隔几天能自然刷到旧内容；srs_enabled 关掉时为空。
    """
    if limit <= 0:
        return []
    rows = []
    seen = set()
    for r in srs.due_items(child.id, subject, item_type, limit * 2, today):
        if r.item_id in seen:
            continue
        seen.add(r.item_id)
        row = model.query.get(r.item_id)
        if row is not None:
            rows.append(row)
        if len(rows) >= limit:
            break
    return rows


# ---------------------------------------------------------------- 语文

def _fill_word(row, by_char):
    """给一个汉字挑一条能出「补全词语」题的组词。

    只收二字词，且另一个字也得在字库里（不然没法给它算同音干扰项）。
    组词列表本身按常用度排（斤 → 斤两 / 公斤 / 台斤），顺序遍历就能先命中常用词，
    不至于拿「台斤」这种长尾词去考孩子。
    """
    for word in _json_list(row.words_json):
        if len(word) != 2 or row.char not in word:
            continue
        rest = [x for x in word if x != row.char]
        if len(rest) == 1 and rest[0] in by_char:
            return word, rest[0]
    return None


def _fill_pairs(all_chars, learned, read_ids, by_char, rng, n=5, due_ids=frozenset()):
    """选出 n 个（字, 目标词, 答案字）。

    题字优先取「学过的字」——认读卡负责新字，补全题负责复习，孩子才有抓手；
    其中遗忘曲线到期的字排最前面（组词是判分题，复习效果比认读卡更好）；
    学过的字不够（刚开始打卡、字库被清过）再从全库补，兜底时仍排除当天认读的字。
    """
    def collect(rows):
        rng.shuffle(rows)
        got = []
        for row in rows:
            pair = _fill_word(row, by_char)
            if pair:
                got.append((row, pair[0], pair[1]))
        return got

    known = [c for c in all_chars if c.id in learned and c.id not in read_ids]
    due = [c for c in known if c.id in due_ids]
    rest = [c for c in known if c.id not in due_ids]
    picked = collect(due + rest)[:n]
    if len(picked) < n:
        used = {p[0].id for p in picked}
        extra = [c for c in all_chars if c.id not in used and c.id not in read_ids]
        picked += collect(extra)[: n - len(picked)]
    return picked


def _fill_options(answer, char, word, by_char, char_tuple, word_set, rng, size=4):
    """补全题选项：同音字优先（同调 → 异调），不够补同部首，最后随便挑。

    关键约束：凡是能和题字拼成词的候选都得踢掉。比如题字「花」、干扰项「园」，
    「花园」本身是词，照着选也说得通，题就变成两个答案。
    """
    def usable(ch):
        if not ch or ch in (answer, char):
            return False
        return (char + ch) not in word_set and (ch + char) not in word_set

    same, loose = homophone.candidates(answer, word, char_tuple)
    rng.shuffle(same)
    rng.shuffle(loose)
    picks = [d for d in same + loose if usable(d)][: size - 1]

    if len(picks) < size - 1:
        radical = getattr(by_char.get(answer), "radical", "") or ""
        near = [c for c in char_tuple
                if c not in picks and usable(c) and (by_char[c].radical or "") == radical]
        rng.shuffle(near)
        picks += near[: size - 1 - len(picks)]

    if len(picks) < size - 1:
        # 最后兜底：只要有组词就算常用字，别再让某道题只剩三个选项
        rest = [c for c in char_tuple
                if c not in picks and usable(c) and _json_list(by_char[c].words_json)]
        rng.shuffle(rest)
        picks += rest[: size - 1 - len(picks)]

    options = picks + [answer]
    rng.shuffle(options)
    return options


def _build_chinese(child, today, rng):
    """语文：认读 N 字 + 补全词语 N 题 + 古诗 N 首（数量由后台配置，0 可关闭）。

    认读卡（char_read）只展示字形/拼音/部首/笔画/结构/组词/例句，支持发音，
    点「下一个」即可，不计分；补全题（fill_char）才是要判分的客观题。
    新字由认读卡负责；复习优先——遗忘曲线到期的字先占认读卡约四成名额，
    并在组词题里优先出现。
    """
    read_n = _num("chinese_read")
    word_n = _num("chinese_word")
    poem_n = _num("chinese_poem")
    if read_n <= 0 and word_n <= 0 and poem_n <= 0:
        return {"subject": "chinese", "items": []}

    all_chars = ChineseChar.query.all()
    if not all_chars:
        return {"subject": "chinese", "items": []}

    learned = srs.learned_ids(child.id, "chinese", "char")
    due_chars = _due_rows(ChineseChar, child, "chinese", "char", max(read_n, 1), today)
    due_ids = {c.id for c in due_chars}

    read_chars = []
    if read_n > 0:
        # 到期复习的字最多占认读卡约四成，剩下的出全新字，控制每天的重复率
        rev_cap = max(1, read_n * 2 // 5)
        read_chars = due_chars[: min(rev_cap, read_n)]
        used = {c.id for c in read_chars} | learned
        if len(read_chars) < read_n:
            read_chars += _pick_unlearned(ChineseChar, used, read_n - len(read_chars), rng)
        if len(read_chars) < read_n:
            used = {c.id for c in read_chars}
            read_chars += _pick_learned(ChineseChar, learned, used, read_n - len(read_chars), rng)
    read_ids = {c.id for c in read_chars}

    by_char = {c.char: c for c in all_chars}
    char_tuple = tuple(sorted(by_char))
    word_set = {w for c in all_chars for w in _json_list(c.words_json)}

    items = []
    for c in read_chars:
        items.append(
            {
                "item_id": len(items) + 1,
                "ref_id": c.id,
                "kind": "char",
                "type": "char_read",
                "is_new": c.id not in learned,
                "char": c.char,
                "pinyin": c.pinyin,
                "radical": c.radical,
                "strokes": c.strokes,
                "structure": c.structure,
                "words": _json_list(c.words_json),
                "sentence": c.sentence,
                "level": level.normalize(c.level),
                "stem": f"认一认：{c.char}",
                "answer": READ_ANSWER,
            }
        )

    # 补全词语：题字照常给出来，答案换成词里的另一个字。
    # 「花 ＿」选“朵”，四个选项都是同音字，光对字形对不出来，必须知道这个词怎么组。
    for c, word, answer in _fill_pairs(all_chars, learned, read_ids, by_char, rng, n=word_n, due_ids=due_ids):
        items.append(
            {
                "item_id": len(items) + 1,
                "ref_id": c.id,
                "kind": "char",
                "type": "fill_char",
                "is_new": False,
                # 只下发字形，不下发组词/例句——words 里就写着答案
                "char": c.char,
                # 空框在题字的哪一边：组「不算」要显示「＿ 算」，不能反过来
                "blank": "right" if word.index(c.char) == 0 else "left",
                "level": level.normalize(c.level),
                "stem": f"补一个字，和「{c.char}」组成词语",
                "options": _fill_options(answer, c.char, word, by_char, char_tuple, word_set, rng),
                "answer": answer,
            }
        )

    # 古诗：数量可配，0 表示当天不背诗；多首时互不重复
    seen_poems = set()
    for _ in range(poem_n):
        poem_item = _build_poem(child, today, rng, exclude=seen_poems)
        if not poem_item:
            break
        seen_poems.add(poem_item["poem_id"])
        poem_item["item_id"] = len(items) + 1
        items.append(poem_item)

    return {"subject": "chinese", "items": items}


def _build_poem(child, today, rng, exclude=()):
    learned = srs.learned_ids(child.id, "chinese", "poem")
    pool = [p for p in Poem.query.all() if p.id not in exclude]
    if not pool:
        return None

    due = [
        d
        for d in srs.due_items(child.id, "chinese", "poem", len(exclude) + 1, today)
        if d.item_id not in exclude
    ]
    poem = None
    if due:
        candidate = Poem.query.get(due[0].item_id)
        if candidate is not None and candidate.id not in exclude:
            poem = candidate
    if poem is None:
        # 全库随机，优先挑还没背过的；难度按 10/40/30/15/5 加权选档
        fresh = [p for p in pool if p.id not in learned]
        poem = level.pick_one(fresh or pool, rng)

    lines = [ln.strip() for ln in (poem.content or "").split("\n") if ln.strip()]
    if not lines:
        return None

    base = {
        "kind": "poem",
        "ref_id": poem.id,
        "poem_id": poem.id,
        "title": poem.title,
        "author": poem.author,
        "dynasty": poem.dynasty,
        "genre": poem.genre,
        "content": poem.content,
        "translation": poem.translation,
        "audio_url": poem.audio_url or "",
        "level": level.normalize(poem.level),
        "lines": lines,
    }

    # 古诗只走「听读 + 背诵录音」，不再拆成选一句 / 填空这种题——整首诗
    # 就在上面摆着，问其中一句等于白给。这里留下完整信息供前端渲染。
    return {
        **base,
        "type": "recite",
        "stem": f"背一背《{poem.title}》",
        "answer": "__recited__",
    }


# ---------------------------------------------------------------- 数学

def _build_math(child, today, rng):
    """数学：计算题 N 道 + 应用题 N 道，数量由后台分别配置，0 可关闭。"""
    calc_n = _num("math_calc")
    app_n = _num("math_app")

    # 应用题：从同年级同学期的题库里按等级比例抽
    app_pool = MathQuestion.query.filter_by(grade_id=child.grade_id, term=child.term).all()
    apps = level.split(app_pool, min(len(app_pool), app_n), rng)

    # 数学严格按「年级 + 学期」出题：只取同年级同学期的规则，不会串到其他年级。
    # 唯一例外是该学期一条规则都没配（比如刚升级还没配好），此时退到本年级
    # 其他学期的规则，避免孩子当天一道口算题都没有。
    rules = MathRule.query.filter_by(grade_id=child.grade_id, term=child.term).all()
    if not rules:
        rules = MathRule.query.filter_by(grade_id=child.grade_id).all()

    gen_total = calc_n
    items = []
    emitted = set()
    if rules and gen_total > 0:
        # 计算题也按 10/40/30/15/5 分配：每个等级挑对应数量的规则来出题。
        # 某档没配规则时，缺口统一从全部规则里补，保证凑齐。
        buckets = {lv: [] for lv in level.LEVELS}
        for rule in rules:
            buckets[level.normalize(rule.level)].append(rule)
        quotas = level.allocate(gen_total)
        short = 0
        for lv in level.LEVELS:
            got = _gen_rule_items(buckets[lv], quotas[lv], rng, emitted, len(items))
            items.extend(got)
            short += quotas[lv] - len(got)
        if short > 0:
            items.extend(_gen_rule_items(rules, short, rng, emitted, len(items)))

    for q in apps:
        items.append(
            {
                "item_id": len(items) + 1,
                "ref_id": q.id,
                "kind": "math",
                "type": "fill",
                "stem": q.stem,
                "unit": q.unit or "",
                "topic": q.topic,
                "answer": q.answer,
                "solution": q.solution or "",
                "level": level.normalize(q.level),
            }
        )

    rng.shuffle(items)
    for i, item in enumerate(items, start=1):
        item["item_id"] = i
    return {"subject": "math", "items": items}


def _gen_rule_items(candidates, count: int, rng, emitted: set, offset: int) -> list:
    """从 candidates 里等概率出 count 道计算题，题干重复的跳过。

    不再有权重：一道题出多少由「等级配额」决定，同一档内的规则均分。
    """
    candidates = list(candidates or [])
    if not candidates or count <= 0:
        return []

    out = []
    guard = 0
    while len(out) < count and guard < count * 30 + 60:
        guard += 1
        rule = candidates[rng.randrange(len(candidates))]
        try:
            params = json.loads(rule.params_json or "{}")
        except (TypeError, ValueError):
            params = {}
        try:
            q = mathgen.generate_one(rule.generator, params)
        except KeyError:
            continue
        if q["stem"] in emitted:
            continue
        emitted.add(q["stem"])
        out.append(
            {
                "item_id": offset + len(out) + 1,
                # 程序现算的题没有稳定主键，错题按知识点聚合，复习队列不入数学
                "ref_id": None,
                "kind": "math",
                "type": "fill",
                "stem": q["stem"],
                "unit": q.get("unit", ""),
                "topic": q.get("topic") or rule.topic,
                "answer": str(q["answer"]),
                "level": level.normalize(rule.level),
            }
        )
    return out


# ---------------------------------------------------------------- 英语

def _build_english(child, today, rng):
    """英语：单词朗读 N + 音标朗读 N + 音标选词 N + 看中文选英文 N +
    看英文选中文 N + 组句 N，数量全部由后台配置，0 可关闭对应题型。

    朗读卡（word_read / phoneme_read）支持发音、展示全部信息，点「下一个」即可，
    不计分；其余题型判分。当天朗读过的单词不再拿去出选择题，避免刚看完释义
    就考同一个词。新词由朗读卡负责；遗忘曲线到期的词优先占朗读卡约四成名额，
    剩下的到期词在选择题里优先出现（选择题判分，复习效果更好）。
    """
    read_n = _num("english_word_read")
    phoneme_read_n = _num("english_phoneme_read")
    phoneme_pick_n = _num("english_phoneme_pick")
    word_choice_n = _num("english_word_choice")
    meaning_choice_n = _num("english_meaning_choice")
    sentence_n = _num("english_sentence_count")

    all_words = EnglishWord.query.all()
    learned = srs.learned_ids(child.id, "english", "word") if all_words else set()

    items = []

    # 1) 单词朗读：认读卡，点「下一个」即完成，不计分但要记「学过」，明天才会进复习
    read_ids = set()
    if all_words and read_n > 0:
        # 题库太小的时候先给选择题留出空位，否则朗读卡会把整个库读光、后面没题可考
        choice_slots = word_choice_n + meaning_choice_n
        read_limit = min(read_n, max(0, len(all_words) - choice_slots))
        read_words = []
        if read_limit > 0:
            # 到期复习的词最多占朗读卡约四成，剩下的出全新词，控制每天的重复率
            rev_cap = max(1, read_limit * 2 // 5)
            due_rows = _due_rows(EnglishWord, child, "english", "word", min(rev_cap, read_limit), today)
            read_words = list(due_rows)
            used = {w.id for w in read_words} | learned
            if len(read_words) < read_limit:
                read_words += _pick_unlearned(EnglishWord, used, read_limit - len(read_words), rng)
            if len(read_words) < read_limit:
                used = {w.id for w in read_words}
                read_words += _pick_learned(EnglishWord, learned, used, read_limit - len(read_words), rng)

        for w in read_words:
            read_ids.add(w.id)
            items.append(
                {
                    "item_id": len(items) + 1,
                    "ref_id": w.id,
                    "kind": "word",
                    "type": "word_read",
                    "is_new": w.id not in learned,
                    "word": w.word,
                    "phonetic": w.phonetic,
                    "pos": w.pos,
                    "meaning": w.meaning,
                    "example": w.example,
                    "example_cn": w.example_cn,
                    "audio_url": w.audio_url or "",
                    "level": level.normalize(w.level),
                    "stem": f"读一读：{w.word}",
                    "answer": READ_ANSWER,
                }
            )

    # 2) 音标朗读：数量可配，0 关闭；展示音标/类型/发音要点/例词
    phonemes = EnglishPhoneme.query.all() if phoneme_read_n + phoneme_pick_n > 0 else []
    read_phoneme_ids = set()
    if phonemes and phoneme_read_n > 0:
        for p in rng.sample(phonemes, min(phoneme_read_n, len(phonemes))):
            read_phoneme_ids.add(p.id)
            items.append(
                {
                    "item_id": len(items) + 1,
                    "ref_id": p.id,
                    "kind": "phoneme",
                    "type": "phoneme_read",
                    "symbol": p.symbol,
                    "category": p.category,
                    "mouth_tip": p.mouth_tip,
                    "examples": _json_list(p.examples_json),
                    "audio_url": p.audio_url or "",
                    "stem": f"读一读：{p.symbol}",
                    "answer": READ_ANSWER,
                }
            )

    # 3) 词义选择：看中文选英文 N 道 + 看英文选中文 N 道，题型顺序打乱；
    # 到期该复习的词排最前面（这里判分，复习效果比朗读卡好）
    if all_words and word_choice_n + meaning_choice_n > 0:
        pool = [w for w in all_words if w.id not in read_ids and w.meaning]
        due_word_ids = {r.id for r in _due_rows(EnglishWord, child, "english", "word", word_choice_n + meaning_choice_n, today)}
        due_pool = [w for w in pool if w.id in due_word_ids]
        rest_pool = [w for w in pool if w.id not in due_word_ids]
        rng.shuffle(due_pool)
        rng.shuffle(rest_pool)
        pool = due_pool + rest_pool

        meaning_pool = list({w.meaning for w in all_words if w.meaning})
        word_pool = [w.word for w in all_words]

        plan = ["word_choice"] * word_choice_n + ["meaning_choice"] * meaning_choice_n
        rng.shuffle(plan)
        for w, mode in zip(pool[: len(plan)], plan):
            if mode == "word_choice":
                # 看中文选英文：题目问的就是这个单词，所以任何「含单词本身」的字段都不能下发
                # （word / phonetic / audio_url / example 里都有答案），否则题目上直接把答案印出来。
                items.append(
                    {
                        "item_id": len(items) + 1,
                        "ref_id": w.id,
                        "kind": "word",
                        "type": "word_choice",
                        "is_new": w.id not in learned,
                        "pos": w.pos,
                        "meaning": w.meaning,
                        "level": level.normalize(w.level),
                        "stem": f"「{w.meaning}」的英文是？",
                        "options": _options(w.word, word_pool, rng),
                        "answer": w.word,
                    }
                )
            else:
                items.append(
                    {
                        "item_id": len(items) + 1,
                        "ref_id": w.id,
                        "kind": "word",
                        "type": "meaning_choice",
                        "is_new": w.id not in learned,
                        "word": w.word,
                        "phonetic": w.phonetic,
                        "pos": w.pos,
                        "meaning": w.meaning,
                        "example": w.example,
                        "example_cn": w.example_cn,
                        "audio_url": w.audio_url or "",
                        "level": level.normalize(w.level),
                        "stem": f"「{w.word}」的意思是？",
                        "options": _options(w.meaning, meaning_pool, rng),
                        "answer": w.meaning,
                    }
                )

    # 4) 音标选词：数量可配，跳过刚朗读过的音标
    if phonemes and phoneme_pick_n > 0:
        used = set(read_phoneme_ids)
        for _ in range(phoneme_pick_n):
            phoneme = _build_phoneme(rng, exclude=used)
            if not phoneme:
                break
            used.add(phoneme["ref_id"])
            phoneme["item_id"] = len(items) + 1
            items.append(phoneme)

    # 5) 单词组句：数量可配，0 关闭；多道时互不重复
    seen_sentences = set()
    for _ in range(sentence_n):
        sentence = _build_sentence(rng, exclude=seen_sentences)
        if not sentence:
            break
        seen_sentences.add(sentence["ref_id"])
        sentence["item_id"] = len(items) + 1
        items.append(sentence)

    return {"subject": "english", "items": items}


def _build_sentence(rng, exclude=()):
    pool = [s for s in EnglishSentence.query.all() if s.id not in exclude]
    if not pool:
        return None
    sentence = level.pick_one(pool, rng)
    tokens = [t for t in re.split(r"\s+", sentence.en.strip()) if t]
    if len(tokens) < 3:
        return None
    shuffled = tokens[:]
    rng.shuffle(shuffled)
    return {
        "kind": "sentence",
        "ref_id": sentence.id,
        "type": "order",
        # 不下发 en：它就是答案，word_choice 踩过同样的坑
        "cn": sentence.cn,
        "key_words": sentence.key_words,
        "audio_url": sentence.audio_url or "",
        "level": level.normalize(sentence.level),
        "stem": f"把单词排成正确的句子：{sentence.cn}",
        "tokens": shuffled,
        "answer": sentence.en,
    }


def _build_phoneme(rng, exclude=()):
    skip = set(exclude)
    pool = [p for p in EnglishPhoneme.query.all() if p.id not in skip]
    if not pool:
        return None
    target = rng.choice(pool)
    examples = _json_list(target.examples_json)
    if not examples:
        return None
    correct = rng.choice(examples)
    others = []
    for p in EnglishPhoneme.query.all():
        if p.id != target.id:
            others.extend(_json_list(p.examples_json))
    return {
        "kind": "phoneme",
        "ref_id": target.id,
        "type": "choice",
        "symbol": target.symbol,
        "category": target.category,
        "mouth_tip": target.mouth_tip,
        "audio_url": target.audio_url or "",
        "stem": f"下面哪个单词含有音标 {target.symbol} ？",
        "options": _options(correct, others, rng),
        "answer": correct,
    }


# ---------------------------------------------------------------- 错题重练

def _retry_items(child, subject: str, rng, limit: int):
    """从错题本抽几道没掌握的题，用当时的快照原样还原。"""
    if limit <= 0:
        return []
    rows = (
        WrongItem.query.filter_by(child_id=child.id, subject=subject, mastered=False)
        .order_by(WrongItem.wrong_count.desc(), WrongItem.id.desc())
        .limit(limit * 3)
        .all()
    )
    if not rows:
        return []
    rng.shuffle(rows)  # 错得最多的里面随机，避免天天同两道

    out = []
    for row in rows:
        if row.item_type in RETRY_SKIP_KINDS:
            continue
        try:
            snap = json.loads(row.snapshot_json or "{}")
        except (TypeError, ValueError):
            snap = {}
        if not snap.get("stem") or "answer" not in snap:
            continue
        item = dict(snap)
        item.pop("item_id", None)
        item.update(
            {
                "kind": snap.get("kind") or row.item_type,
                "ref_id": row.item_id,
                "retry": True,
                "wrong_id": row.id,
                "is_new": False,
            }
        )
        out.append(item)
        if len(out) >= limit:
            break
    return out


def _dedupe_key(item):
    """判断「今天重练的题」和「今天本来要出的题」是不是同一道。

    语文/英语的 ref_id 就是题库主键，直接比；数学计算题的 ref_id 是按知识点
    聚合出来的哈希（同一知识点的题共用一个编号），只能比题干——否则会把当天
    这个知识点的题全部当成重复删掉，20 题会缩水成 10 题。
    """
    if item.get("kind") == "math":
        return ("math", str(item.get("stem") or ""))
    return (item.get("kind"), item_key(item))


def _prepend_retries(child, subject: str, payload: dict, rng):
    """错题重练排在当天最前面；同一天本来要复习到的同一道题，用重练版本替换掉。

    数量由后台配置（``retry_count``，默认 2，0 表示当天不重练）。
    """
    limit = _num("retry_count")
    items = payload.get("items", [])
    retries = _retry_items(child, subject, rng, limit)
    if not retries:
        return payload
    retry_keys = {_dedupe_key(r) for r in retries}
    rest = [it for it in items if _dedupe_key(it) not in retry_keys]
    payload["items"] = retries + rest
    payload["retry_count"] = len(retries)
    return payload


# ---------------------------------------------------------------- 对外

BUILDERS = {"chinese": _build_chinese, "math": _build_math, "english": _build_english}


def build_payload(child, subject: str, today: str | None = None) -> dict:
    today = today or today_str()
    rng = random.Random(f"{child.id}-{today}-{subject}")
    payload = BUILDERS[subject](child, today, rng)
    payload = _prepend_retries(child, subject, payload, rng)
    for i, item in enumerate(payload.get("items", []), start=1):
        item["item_id"] = i
    return payload


def count_scored(payload: dict) -> int:
    """用于计分的题数：背诗、朗读/认读卡只记录完成与否，不进总分。"""
    return sum(
        1
        for it in payload.get("items", [])
        if it.get("kind") not in NO_SCORE_KINDS and it.get("type") not in NO_SCORE_TYPES
    )


def public_payload(payload: dict) -> dict:
    """去掉答案后的题目，下发给客户端。"""
    def strip(obj):
        if isinstance(obj, dict):
            return {k: strip(v) for k, v in obj.items() if k != "answer"}
        if isinstance(obj, list):
            return [strip(x) for x in obj]
        return obj

    return strip(payload)


def get_or_create_task(child, subject: str, today: str | None = None) -> DailyTask:
    """取当天该科目的任务，没有就生成一条。

    这里必须是「并发安全」的：客户端第一次进科目页时可能同时发两个 start
    （React StrictMode 双挂载、两个标签页、手抖双击都会这样），两条都查到
    「没有任务」然后各自 INSERT，第二条会撞 daily_task(child_id,date,subject)
    的唯一约束。所以插入失败时回滚，改取另一条请求刚插进去的那条，不能 500。
    """
    today = today or today_str()
    child_id = child.id
    task = _find_task(child_id, subject, today)
    if task:
        return task

    payload = build_payload(child, subject, today)
    task = DailyTask(
        child_id=child_id,
        date=today,
        subject=subject,
        status="doing",
        payload_json=json.dumps(payload, ensure_ascii=False),
        total=count_scored(payload),
    )
    db.session.add(task)
    try:
        db.session.commit()
        return task
    except IntegrityError:
        db.session.rollback()
        existed = _find_task(child_id, subject, today)
        if existed is None:
            raise
        return existed


def _find_task(child_id: int, subject: str, today: str) -> DailyTask | None:
    return DailyTask.query.filter_by(child_id=child_id, date=today, subject=subject).first()


def load_payload(task: DailyTask) -> dict:
    try:
        return json.loads(task.payload_json or "{}")
    except (TypeError, ValueError):
        return {"subject": task.subject, "items": []}
