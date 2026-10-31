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
from . import level, mathgen, srs
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

# 语文每天固定：认读 5 字 + 组词 5 题 + 古诗 1 首
CHINESE_READ_N = 5
CHINESE_WORD_N = 5
# 英语固定：音标朗读 2 + 音标选词 2 + 词义选择各 2 + 组句 1（单词朗读数量由后台配）
ENGLISH_PHONEME_READ_N = 2
ENGLISH_PHONEME_PICK_N = 2
ENGLISH_WORD_CHOICE_N = 2
ENGLISH_MEANING_CHOICE_N = 2
# 错题重练固定 2 道，不再开放配置
RETRY_LIMIT = 2


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


# ---------------------------------------------------------------- 语文

def _build_chinese(child, today, rng):
    """语文每天固定：认读 5 字 + 组词 5 题 + 古诗 1 首。

    认读卡（char_read）只展示字形/拼音/部首/笔画/结构/组词/例句，支持发音，
    点「下一个」即可，不计分；组词题（word_choice）才是要判分的客观题。
    """
    all_chars = ChineseChar.query.all()
    if not all_chars:
        return {"subject": "chinese", "items": []}

    learned = srs.learned_ids(child.id, "chinese", "char")
    read_chars = _pick_unlearned(ChineseChar, learned, CHINESE_READ_N, rng)
    if len(read_chars) < CHINESE_READ_N:
        used = {c.id for c in read_chars}
        read_chars += _pick_learned(ChineseChar, learned, used, CHINESE_READ_N - len(read_chars), rng)
    read_ids = {c.id for c in read_chars}

    word_pool = [w for c in all_chars for w in _json_list(c.words_json)]

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

    # 组词题：全库随机，跳过今天刚认读过的字，免得「刚看完就考」
    pool = [c for c in all_chars if c.id not in read_ids and _json_list(c.words_json)]
    rng.shuffle(pool)
    for c in pool[:CHINESE_WORD_N]:
        correct = rng.choice(_json_list(c.words_json))
        items.append(
            {
                "item_id": len(items) + 1,
                "ref_id": c.id,
                "kind": "char",
                "type": "word_choice",
                "is_new": False,
                "char": c.char,
                "pinyin": c.pinyin,
                "radical": c.radical,
                "strokes": c.strokes,
                "structure": c.structure,
                "words": _json_list(c.words_json),
                "sentence": c.sentence,
                "level": level.normalize(c.level),
                "stem": f"「{c.char}」可以组成下面哪个词？",
                "options": _options(correct, word_pool, rng),
                "answer": correct,
            }
        )

    poem_item = _build_poem(child, today, rng)
    if poem_item:
        poem_item["item_id"] = len(items) + 1
        items.append(poem_item)

    return {"subject": "chinese", "items": items}


def _build_poem(child, today, rng):
    # 每天固定 1 首，不再开放配置
    learned = srs.learned_ids(child.id, "chinese", "poem")
    pool = Poem.query.all()
    if not pool:
        return None

    due = srs.due_items(child.id, "chinese", "poem", 1, today)
    poem = None
    if due:
        poem = Poem.query.get(due[0].item_id)
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
    total = int(get_setting("math_count") or 20)

    # 应用题：从同年级同学期的题库里按等级比例抽，最多占 1/5
    app_pool = MathQuestion.query.filter_by(grade_id=child.grade_id, term=child.term).all()
    app_n = min(len(app_pool), max(0, total // 5))
    apps = level.split(app_pool, app_n, rng)

    # 数学严格按「年级 + 学期」出题：只取同年级同学期的规则，不会串到其他年级。
    # 唯一例外是该学期一条规则都没配（比如刚升级还没配好），此时退到本年级
    # 其他学期的规则，避免孩子当天一道口算题都没有。
    rules = MathRule.query.filter_by(grade_id=child.grade_id, term=child.term).all()
    if not rules:
        rules = MathRule.query.filter_by(grade_id=child.grade_id).all()

    gen_total = total - len(apps)
    items = []
    emitted = set()
    if rules and gen_total > 0:
        # 计算题也按 10/40/30/15/5 分配：每个等级挑对应数量的规则来出题。
        # 某档没配规则时，缺口统一从全部规则里补，保证 20 道凑齐。
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
    """英语每天：单词朗读 N + 音标朗读 2 + 词义选择 2+2 + 音标选词 2 + 组句 1。

    朗读卡（word_read / phoneme_read）支持发音、展示全部信息，点「下一个」即可，
    不计分；词义选择与音标选词才判分。当天朗读过的单词不再拿去出选择题，避免
    刚看完释义就考同一个词。
    """
    read_n = max(0, int(get_setting("english_word_read") or 0))

    # 英语题库同样不关联年级学期：全库随机
    all_words = EnglishWord.query.all()
    if not all_words:
        return {"subject": "english", "items": []}

    # 题库太小的时候先给选择题留出 4 个词，否则朗读卡会把整个库读光、后面没题可考
    choice_slots = ENGLISH_WORD_CHOICE_N + ENGLISH_MEANING_CHOICE_N
    read_n = min(read_n, max(0, len(all_words) - choice_slots))

    learned = srs.learned_ids(child.id, "english", "word")
    read_words = _pick_unlearned(EnglishWord, learned, read_n, rng)
    if len(read_words) < read_n:
        # 没学过的词不够（题库还小）时，用学过的词补满朗读卡，别让孩子某天只有两三张卡
        used = {w.id for w in read_words}
        read_words += _pick_learned(EnglishWord, learned, used, read_n - len(read_words), rng)
    read_ids = {w.id for w in read_words}

    meaning_pool = list({w.meaning for w in all_words if w.meaning})
    word_pool = [w.word for w in all_words]

    items = []

    # 1) 单词朗读：认读卡，点「下一个」即完成，不计分但要记「学过」，明天才会进复习
    for w in read_words:
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

    # 2) 音标朗读：固定 2 个，展示音标/类型/发音要点/例词
    phonemes = EnglishPhoneme.query.all() if get_setting("english_phoneme") else []
    read_phoneme_ids = set()
    if phonemes:
        for p in rng.sample(phonemes, min(ENGLISH_PHONEME_READ_N, len(phonemes))):
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

    # 3) 词义选择：看中文选英文 2 道 + 看英文选中文 2 道
    pool = [w for w in all_words if w.id not in read_ids and w.meaning]
    rng.shuffle(pool)
    plan = ["word_choice", "meaning_choice", "word_choice", "meaning_choice"][:choice_slots]
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

    # 4) 音标选词：固定 2 道，跳过刚朗读过的音标
    if phonemes:
        used = set(read_phoneme_ids)
        for _ in range(ENGLISH_PHONEME_PICK_N):
            phoneme = _build_phoneme(rng, exclude=used)
            if not phoneme:
                break
            used.add(phoneme["ref_id"])
            phoneme["item_id"] = len(items) + 1
            items.append(phoneme)

    # 5) 单词组句：固定 1 道
    if get_setting("english_sentence"):
        sentence = _build_sentence(rng)
        if sentence:
            sentence["item_id"] = len(items) + 1
            items.append(sentence)

    return {"subject": "english", "items": items}


def _build_sentence(rng):
    pool = EnglishSentence.query.all()
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

    数量固定 2 道（``RETRY_LIMIT``），不再做成后台配置。
    """
    limit = RETRY_LIMIT
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
