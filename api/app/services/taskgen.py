"""每日任务生成。

三个约定：
1. 每道题都带 ``ref_id``（题库主键），复习队列和错题本都靠它定位到具体哪个字 / 哪个词，
   不能用「当天第几题」，否则第二天复习会取到完全无关的内容。
2. 每天先从错题本抽几道没掌握的题插在最前面，答对两次就算掌握。
3. 新内容给复习让位：到期没复习的条目超过阈值时，读卡里的新字新词自动减少
   （见 ``_review_cap``），否则固定「四成复习」永远消化不完积压。
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
from ..utils.dates import shift_date, today_str
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


def _pick_unlearned(model, learned: set, n: int, rng, weights=None, id_attr: str = "id"):
    """从全库挑 N 条还没学过的（语文/英语不跟年级学期走）。

    挑选按等级权重分配：默认全库固定 10/40/30/15/5，按孩子年级取题时传 ``weights``。
    复习题不按比例——该复习的必须复习。
    """
    rows = [r for r in model.query.all() if getattr(r, id_attr) not in learned]
    if not rows or n <= 0:
        return []
    return level.split(rows, n, rng, weights=weights)


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


def _center(child) -> str:
    """孩子年级折算出的难度中心（三年级 = 较易）。语文英语全库取题时以它为峰值。"""
    return level.from_grade(getattr(child, "grade_id", None))


def _recent_accuracy(child, subject: str, today: str, days: int = 3):
    """最近几天的平均分；不足两天不判断（样本太少容易来回跳）。"""
    rows = (
        DailyTask.query.filter(
            DailyTask.child_id == child.id,
            DailyTask.subject == subject,
            DailyTask.date < today,
            DailyTask.status == "done",
        )
        .order_by(DailyTask.date.desc())
        .limit(days)
        .all()
    )
    if len(rows) < 2:
        return None
    return sum((row.score or 0) for row in rows) / len(rows)


def _math_center(child, today: str) -> str:
    """数学按最近正确率把难度中心上下挪一档：连续高分抬一档，连续低分降一档。"""
    avg = _recent_accuracy(child, "math", today)
    if avg is None:
        return _center(child)
    if avg >= 92:
        return level.shift(_center(child), 1)
    if avg <= 65:
        return level.shift(_center(child), -1)
    return _center(child)


def _review_cap(total: int, backlog: int) -> int:
    """当天这批卡里留给「到期复习」的名额。

    - 没有积压：到期复习最多占四成（新内容为主）；
    - 积压达到阈值：复习抬到六成；
    - 积压达到两倍阈值：只保留 ``srs_new_floor`` 个新内容，其余全给复习。
    """
    if total <= 0:
        return 0
    base = max(1, total * 2 // 5)
    threshold = _num("srs_backlog_threshold")
    floor_new = min(_num("srs_new_floor"), total)
    if threshold <= 0 or backlog < threshold:
        return min(base, total)
    if backlog >= threshold * 2:
        return max(0, total - floor_new)
    return max(base, total - max(floor_new, total * 2 // 5))


def _recent_items(child_id: int, subject: str, today: str, days: int = 3) -> list:
    """最近几天出过的题目（跨天去重用），只回看几天，代价可控。"""
    start = shift_date(today, -days)
    rows = DailyTask.query.filter(
        DailyTask.child_id == child_id,
        DailyTask.subject == subject,
        DailyTask.date >= start,
        DailyTask.date < today,
    ).all()
    items = []
    for row in rows:
        items.extend(load_payload(row).get("items", []))
    return items


def _interleave(items: list) -> list:
    """把朗读/认读卡和判分题交错排开：连着看十张卡最容易走神。"""
    reads = [it for it in items if it.get("type") in READ_TYPES]
    others = [it for it in items if it.get("type") not in READ_TYPES]
    if len(reads) < 2 or not others:
        return items
    out = []
    i = j = 0
    while i < len(reads) or j < len(others):
        for _ in range(2):
            if i < len(reads):
                out.append(reads[i])
                i += 1
        if j < len(others):
            out.append(others[j])
            j += 1
    return out


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

    名额分三段：前半给「今天刚认过的字」（先教后练，刚看完字形就用来组词），
    接着给「到期该复习的字」，最后才是其它学过的字；都不够才兜底全库。
    已学字太少时（刚起步）把名额全给今天的认读字——那时候也没什么可复习的。
    """
    def collect(rows):
        rng.shuffle(rows)
        got = []
        for row in rows:
            pair = _fill_word(row, by_char)
            if pair:
                got.append((row, pair[0], pair[1]))
        return got

    taught = [c for c in all_chars if c.id in read_ids]
    known = [c for c in all_chars if c.id in learned and c.id not in read_ids]
    due = [c for c in known if c.id in due_ids]
    rest = [c for c in known if c.id not in due_ids]

    # 已学字不够多的时候，先保证今天的认读字都能练到
    taught_cap = n if len(known) < n else max(1, n // 2)
    picked = collect(taught)[:taught_cap]
    if len(picked) < n:
        picked += collect(due)[: n - len(picked)]
    if len(picked) < n:
        picked += collect(rest)[: n - len(picked)]
    if len(picked) < n:
        used = {p[0].id for p in picked}
        extra = [c for c in all_chars if c.id not in used and c.id not in read_ids]
        budget = max(1, n // 2)
        picked += collect(extra)[: min(budget, n - len(picked))]
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


def _plain_reading(char: str) -> str:
    """字的无声调读音（hua），用来挑「同音异调」的干扰项。"""
    pool = homophone.readings(char)
    return pool[0].rstrip("012345") if pool else ""


def _pinyin_pairs(pool, all_chars, rng, n):
    """看拼音选字：正确答案是字，干扰项排除同音字（否则有两个正确答案）。

    同音异调的字（huā / huá）优先当干扰项——考的就是声调分辨，
    比随便抓几个字更难也更有意义。
    """
    if n <= 0:
        return []
    chars = [c for c in all_chars if (c.pinyin or "").strip()]
    out = []
    for target in pool:
        if len(out) >= n:
            break
        reading = (target.pinyin or "").strip()
        if not reading:
            continue
        sound = _plain_reading(target.char)
        same_reading = {c.char for c in chars if (c.pinyin or "").strip() == reading}
        near, far = [], []
        for c in chars:
            if c.char == target.char or c.char in same_reading:
                continue
            if sound and _plain_reading(c.char) == sound:
                near.append(c)
            else:
                far.append(c)
        rng.shuffle(near)
        rng.shuffle(far)
        chosen = near[:2]
        for c in far:
            if len(chosen) >= 3:
                break
            if c.char not in {x.char for x in chosen}:
                chosen.append(c)
        if len(chosen) < 3:
            continue
        options = [target.char] + [c.char for c in chosen]
        rng.shuffle(options)
        out.append((target, options))
    return out


def _build_chinese(child, today, rng):
    """语文：认读 N 字 + 补全词语 N 题 + 看拼音选字 N 题 + 古诗 N 首（数量后台配置）。

    认读卡（char_read）只展示字形/拼音/部首/笔画/结构/组词/例句，支持发音，
    点「下一个」即可，不计分；补全词语（fill_char）和看拼音选字（pinyin_choice）
    才是要判分的客观题。
    新字由认读卡负责；复习优先——遗忘曲线到期的字先占认读卡名额（积压越多占得越多），
    再按「当天认读 → 到期 → 已学 → 全库」的顺序喂给组词和拼音题。
    """
    read_n = _num("chinese_read")
    word_n = _num("chinese_word")
    pinyin_n = _num("chinese_pinyin")
    poem_n = _num("chinese_poem")
    if read_n <= 0 and word_n <= 0 and pinyin_n <= 0 and poem_n <= 0:
        return {"subject": "chinese", "items": []}

    all_chars = ChineseChar.query.all()
    if not all_chars:
        return {"subject": "chinese", "items": []}

    weights = level.ratios_for(_center(child))
    learned = srs.learned_ids(child.id, "chinese", "char")
    backlog = srs.backlog(child.id, "chinese", "char", today)
    rev_cap = _review_cap(read_n, backlog)
    due_chars = _due_rows(ChineseChar, child, "chinese", "char", max(rev_cap, 1), today) if read_n > 0 else []
    due_ids = {c.id for c in due_chars}

    read_chars = []
    if read_n > 0:
        read_chars = due_chars[:rev_cap]
        used = {c.id for c in read_chars} | learned
        if len(read_chars) < read_n:
            read_chars += _pick_unlearned(ChineseChar, used, read_n - len(read_chars), rng, weights)
        if len(read_chars) < read_n:
            used = {c.id for c in read_chars}
            read_chars += _pick_learned(ChineseChar, learned, used, read_n - len(read_chars), rng)
    read_ids = {c.id for c in read_chars}

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

    by_char = {c.char: c for c in all_chars}
    char_tuple = tuple(sorted(by_char))
    word_set = {w for c in all_chars for w in _json_list(c.words_json)}

    # 补全词语：题字照常给出来，答案换成词里的另一个字。
    # 「花 ＿」选“朵”，四个选项都是同音字，光对字形对不出来，必须知道这个词怎么组。
    fill_pairs = _fill_pairs(all_chars, learned, read_ids, by_char, rng, n=word_n, due_ids=due_ids)
    for c, word, answer in fill_pairs:
        items.append(
            {
                "item_id": len(items) + 1,
                "ref_id": c.id,
                "kind": "char",
                "type": "fill_char",
                "is_new": c.id not in learned,
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

    # 看拼音选字：拼音是题干，四选一；同音字不进选项，声调不同的字优先当干扰项
    if pinyin_n > 0:
        fill_ids = {c.id for c, _, _ in fill_pairs}
        taught = [c for c in all_chars if c.id in read_ids]
        known = [c for c in all_chars if c.id in learned and c.id not in read_ids]
        due_known = [c for c in known if c.id in due_ids]
        rest_known = [c for c in known if c.id not in due_ids]
        candidates = [c for c in taught + due_known + rest_known if c.id not in fill_ids]
        rng.shuffle(candidates)
        if len(candidates) < pinyin_n:
            spare = [c for c in all_chars if c.id not in read_ids and c.id not in fill_ids and c not in candidates]
            rng.shuffle(spare)
            candidates += spare
        for c, options in _pinyin_pairs(candidates, all_chars, rng, pinyin_n):
            items.append(
                {
                    "item_id": len(items) + 1,
                    "ref_id": c.id,
                    "kind": "char",
                    "type": "pinyin_choice",
                    "is_new": c.id not in learned,
                    "pinyin": c.pinyin,
                    "level": level.normalize(c.level),
                    "stem": f"「{c.pinyin}」是下面哪个字？",
                    "options": options,
                    "answer": c.char,
                }
            )

    items = _interleave(items)

    # 古诗：数量可配，0 表示当天不背诗；多首时互不重复，排在最后单独走背诵流程
    seen_poems = set()
    for _ in range(poem_n):
        poem_item = _build_poem(child, today, rng, exclude=seen_poems, weights=weights)
        if not poem_item:
            break
        seen_poems.add(poem_item["poem_id"])
        poem_item["item_id"] = len(items) + 1
        items.append(poem_item)

    return {"subject": "chinese", "items": items}


def _build_poem(child, today, rng, exclude=(), weights=None):
    """挑一首诗：**一轮之内不重复**，全部背过之后再从头来。

    所以这里不再让「到期复习」插队——那会让孩子连着几天背同一首。
    背过没背过由 SRS 记录判断（背诵提交时写），一轮背完之后按首次进入队列的
    先后顺序（``srs_item.id`` 升序）重来一遍，谁最久没见就先背谁。
    """
    learned = srs.learned_ids(child.id, "chinese", "poem")
    pool = [p for p in Poem.query.all() if p.id not in exclude]
    if not pool:
        return None

    fresh = [p for p in pool if p.id not in learned]
    if fresh:
        poem = level.pick_one(fresh, rng, weights=weights)
    else:
        order = srs.learned_order(child.id, "chinese", "poem")
        cycled = sorted((p for p in pool if p.id in order), key=lambda p: order[p.id])
        poem = cycled[0] if cycled else level.pick_one(pool, rng, weights=weights)
    if poem is None:
        return None

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
    weights = level.ratios_for(_math_center(child, today))

    # 最近三天出过的题不再出：数学题每天现算，不挡一下会天天撞同一道
    recent = _recent_items(child.id, "math", today, 3)
    recent_stems = {str(it.get("stem") or "") for it in recent if it.get("kind") == "math"}
    recent_refs = {it.get("ref_id") for it in recent if it.get("kind") == "math" and it.get("ref_id")}

    # 应用题：按年级取，学期优先精确匹配；内置题目的 term 允许留空（空 = 通用学期），
    # 不能因为 term 是空串就把整个年级的应用题都筛掉——那会静默变成 0 道。
    term = (child.term or "").strip()
    grade_apps = MathQuestion.query.filter_by(grade_id=child.grade_id).all()
    app_pool = [q for q in grade_apps if (q.term or "").strip() == term] or grade_apps
    fresh_apps = [q for q in app_pool if q.id not in recent_refs] or app_pool
    apps = level.split(fresh_apps, min(len(fresh_apps), app_n), rng, weights=weights)

    # 计算题同样只取同年级同学期的规则；该学期一条都没配时退到本年级其他学期，
    # 避免孩子当天一道口算题都没有。
    grade_rules = MathRule.query.filter_by(grade_id=child.grade_id).all()
    rules = [r for r in grade_rules if (r.term or "").strip() == term] or grade_rules

    gen_total = calc_n
    items = []
    emitted = set()
    if rules and gen_total > 0:
        # 计算题按等级配额分配：每档挑对应数量的规则来出题，
        # 某档没配规则时缺口从全部规则里补，保证凑齐。
        buckets = {lv: [] for lv in level.LEVELS}
        for rule in rules:
            buckets[level.normalize(rule.level)].append(rule)
        quotas = level.allocate(gen_total, weights)
        short = 0
        for lv in level.LEVELS:
            got = _gen_rule_items(buckets[lv], quotas[lv], rng, emitted, len(items), avoid=recent_stems)
            items.extend(got)
            short += quotas[lv] - len(got)
        if short > 0:
            # 题库太窄、凑不出足够的新题干时，允许和前几天重复，题量优先
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


def _gen_rule_items(candidates, count: int, rng, emitted: set, offset: int, avoid=frozenset()) -> list:
    """从 candidates 里等概率出 count 道计算题，题干重复的跳过。

    ``avoid`` 是前几天的题干，先按「不撞旧题」出；凑不齐时调用方会再来一次
    不带 avoid 的补足。同一档内的规则均分，不再有权重。
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
        if q["stem"] in emitted or q["stem"] in avoid:
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

def _meanings_clash(a: str, b: str) -> bool:
    """两个中文释义是不是「同一个意思」，是的话不能同时出现在一道选择题里。

    「跳舞」和「跳舞；舞蹈」都能对应 dance，选项里再放 dancing 就有两个答案了。
    """
    def clean(text):
        return re.sub(r"[\s（）()；;，,、/]+", "", (text or ""))

    a, b = clean(a), clean(b)
    if not a or not b:
        return False
    return a == b or a in b or b in a


def _word_options(correct: str, meaning: str, all_words, rng, size=4) -> list:
    """看中文选英文的选项：排除同义/近义词，同词性的优先当干扰项。"""
    target = next((w for w in all_words if w.word == correct), None)
    pos = (getattr(target, "pos", "") or "").strip()
    same, other = [], []
    for w in all_words:
        if not w.word or w.word == correct:
            continue
        if _meanings_clash(meaning, w.meaning):
            continue
        (same if (w.pos or "").strip() == pos else other).append(w.word)
    rng.shuffle(same)
    rng.shuffle(other)
    picks = []
    for word in same + other:
        if word not in picks:
            picks.append(word)
        if len(picks) >= size - 1:
            break
    options = picks + [correct]
    rng.shuffle(options)
    return options


def _meaning_options(correct: str, all_words, rng, size=4) -> list:
    """看英文选中文的选项：释义本身不能撞车，也不能是包含关系。"""
    candidates = []
    for w in all_words:
        value = (w.meaning or "").strip()
        if not value or value in candidates:
            continue
        if _meanings_clash(correct, value):
            continue
        candidates.append(value)
    rng.shuffle(candidates)
    options = candidates[: size - 1] + [correct]
    rng.shuffle(options)
    return options


def _phoneme_index(phonemes) -> dict:
    """单词 → 出现在哪些音标的例词里。用来给音标选词题挑干净干扰项。

    book 同时是 /b/ 和 /ʊ/ 的例词；问「哪个词含 /b/」时把 book 放进干扰项，
    题目就有两个正确答案了。所以只拿「只登记在本音标下」的词当正确答案，
    干扰项也排除含目标音素的词。
    """
    index: dict[str, set] = {}
    for p in phonemes:
        for word in _json_list(p.examples_json):
            index.setdefault(str(word).strip().lower(), set()).add(p.symbol)
    return index


def _build_phoneme(child, today, rng, exclude=(), due_ids=None, index=None):
    """音标选词：优先考到期的音标，选项全部来自「干净」的例词。"""
    phonemes = EnglishPhoneme.query.all()
    index = index if index is not None else _phoneme_index(phonemes)
    skip = set(exclude)
    pool = [p for p in phonemes if p.id not in skip]
    if not pool:
        return None

    due_pool = [p for p in pool if p.id in (due_ids or set())]
    target = rng.choice(due_pool) if due_pool else rng.choice(pool)

    def symbols_of(word):
        return index.get(str(word).strip().lower(), set())

    examples = [w for w in _json_list(target.examples_json) if symbols_of(w) == {target.symbol}]
    if not examples:
        examples = _json_list(target.examples_json)
    if not examples:
        return None
    correct = rng.choice(examples)

    others = []
    for p in phonemes:
        if p.id == target.id:
            continue
        for word in _json_list(p.examples_json):
            # 含目标音素的词不能当干扰项，否则两个都对
            if target.symbol in symbols_of(word):
                continue
            others.append(word)

    options = _options(correct, others, rng)
    if len(options) < 2:
        return None
    return {
        "kind": "phoneme",
        "ref_id": target.id,
        "type": "choice",
        "symbol": target.symbol,
        "category": target.category,
        "mouth_tip": target.mouth_tip,
        "audio_url": target.audio_url or "",
        "stem": f"下面哪个单词含有音标 {target.symbol} ？",
        "options": options,
        "answer": correct,
    }


def _build_english(child, today, rng):
    """英语：单词朗读 N + 音标朗读 N + 音标选词 N + 看中文选英文 N +
    看英文选中文 N + 组句 N，数量全部由后台配置，0 可关闭对应题型。

    朗读卡（word_read / phoneme_read）支持发音、展示全部信息，点「下一个」即可，
    不计分；其余题型判分。当天朗读过的单词不再拿去出选择题，避免刚看完释义
    就考同一个词。
    选择题**先考学过的词**（到期的最先），不够才用没学过的补位——没教过就考，
    孩子只能瞎蒙。
    """
    read_n = _num("english_word_read")
    phoneme_read_n = _num("english_phoneme_read")
    phoneme_pick_n = _num("english_phoneme_pick")
    word_choice_n = _num("english_word_choice")
    meaning_choice_n = _num("english_meaning_choice")
    sentence_n = _num("english_sentence_count")

    weights = level.ratios_for(_center(child))
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
            # 到期复习占几个名额看积压：积压多时新词让位（见 _review_cap）
            backlog = srs.backlog(child.id, "english", "word", today)
            rev_cap = _review_cap(read_limit, backlog)
            due_rows = _due_rows(EnglishWord, child, "english", "word", max(rev_cap, 1), today)
            read_words = list(due_rows[:rev_cap])
            used = {w.id for w in read_words} | learned
            if len(read_words) < read_limit:
                read_words += _pick_unlearned(EnglishWord, used, read_limit - len(read_words), rng, weights)
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

    # 2) 音标朗读：优先读到期的音标（48 个也会按遗忘曲线轮一遍），不足再从没学过的补
    phonemes = EnglishPhoneme.query.all() if phoneme_read_n + phoneme_pick_n > 0 else []
    phoneme_index = _phoneme_index(phonemes) if phonemes else {}
    learned_phonemes = srs.learned_ids(child.id, "english", "phoneme") if phonemes else set()
    due_phoneme_ids = set()
    read_phoneme_ids = set()
    if phonemes and phoneme_read_n > 0:
        due_phoneme_ids = {p.id for p in _due_rows(EnglishPhoneme, child, "english", "phoneme", phoneme_read_n * 2, today)}
        due_list = [p for p in phonemes if p.id in due_phoneme_ids]
        rng.shuffle(due_list)
        picks = due_list[:phoneme_read_n]
        used_p = {p.id for p in picks}
        fresh = [p for p in phonemes if p.id not in learned_phonemes and p.id not in used_p]
        rng.shuffle(fresh)
        picks += fresh[: max(0, phoneme_read_n - len(picks))]
        if len(picks) < phoneme_read_n:
            rest = [p for p in phonemes if p.id not in used_p]
            rng.shuffle(rest)
            picks += rest[: phoneme_read_n - len(picks)]

        for p in picks:
            read_phoneme_ids.add(p.id)
            items.append(
                {
                    "item_id": len(items) + 1,
                    "ref_id": p.id,
                    "kind": "phoneme",
                    "type": "phoneme_read",
                    "is_new": p.id not in learned_phonemes,
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
    # 学过的词优先（到期的排最前），没学过的只在题量不够时补位
    if all_words and word_choice_n + meaning_choice_n > 0:
        pool = [w for w in all_words if w.id not in read_ids and w.meaning]
        due_word_ids = {r.id for r in _due_rows(EnglishWord, child, "english", "word", word_choice_n + meaning_choice_n, today)}
        due_pool = [w for w in pool if w.id in due_word_ids]
        known_pool = [w for w in pool if w.id in learned and w.id not in due_word_ids]
        new_pool = [w for w in pool if w.id not in learned]
        rng.shuffle(due_pool)
        rng.shuffle(known_pool)
        rng.shuffle(new_pool)
        pool = due_pool + known_pool + new_pool

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
                        "options": _word_options(w.word, w.meaning, all_words, rng),
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
                        "options": _meaning_options(w.meaning, all_words, rng),
                        "answer": w.meaning,
                    }
                )

    # 4) 音标选词：数量可配，跳过刚朗读过的音标
    if phonemes and phoneme_pick_n > 0:
        used = set(read_phoneme_ids)
        for _ in range(phoneme_pick_n):
            phoneme = _build_phoneme(child, today, rng, exclude=used, due_ids=due_phoneme_ids, index=phoneme_index)
            if not phoneme:
                break
            used.add(phoneme["ref_id"])
            phoneme["item_id"] = len(items) + 1
            items.append(phoneme)

    # 5) 单词组句：数量可配，0 关闭；多道时互不重复，最近出过的排后面
    recent_sentences = {
        it.get("ref_id") for it in _recent_items(child.id, "english", today, 7) if it.get("kind") == "sentence"
    }
    seen_sentences = set()
    for _ in range(sentence_n):
        sentence = _build_sentence(rng, exclude=seen_sentences, avoid=recent_sentences, weights=weights)
        if not sentence:
            break
        seen_sentences.add(sentence["ref_id"])
        sentence["item_id"] = len(items) + 1
        items.append(sentence)

    return {"subject": "english", "items": _interleave(items)}


def _build_sentence(rng, exclude=(), avoid=(), weights=None):
    pool = [s for s in EnglishSentence.query.all() if s.id not in exclude]
    if not pool:
        return None
    fresh = [s for s in pool if s.id not in avoid]
    sentence = level.pick_one(fresh or pool, rng, weights=weights)
    if sentence is None:
        return None
    tokens = [t for t in re.split(r"\s+", sentence.en.strip()) if t]
    if len(tokens) < 3:
        return None
    shuffled = tokens[:]
    rng.shuffle(shuffled)
    # 打乱后正好还是正确顺序的话，再换一次位置（小概率，但看起来像白给）
    if shuffled == tokens:
        shuffled = shuffled[1:] + shuffled[:1]
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
    # 朗读/认读卡是「教」的通道，和判分题不是一回事：同一个字今天既上卡又重练
    # 很正常，不能因为重练撞了 ref_id 就把卡删掉，否则当天新字凭空少几张。
    rest = [
        it
        for it in items
        if it.get("type") in READ_TYPES or it.get("type") == "recite" or _dedupe_key(it) not in retry_keys
    ]
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
