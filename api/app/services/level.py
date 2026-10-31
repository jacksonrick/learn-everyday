"""题目等级（难度）定义与「按比例取题」的通用工具。

5 档：容易 / 较易 / 中等 / 较难 / 困难，出题占比 10% / 40% / 30% / 15% / 5%。

比例只作用在**新题**上：每天的新字、新词、古诗、英语句子、数学题按这个分布出；
复习题和错题重练不受限制（该复习的必须复习，不能因为「今天配额用完了」就跳过）。

某个档的题库空了（比如只导入了低年级的字），配额自动让给其它档，不会少题。
"""

from __future__ import annotations

LEVELS = ("容易", "较易", "中等", "较难", "困难")
RATIOS = (0.10, 0.40, 0.30, 0.15, 0.05)
DEFAULT_LEVEL = "中等"

# 教材年级 → 等级。数据包里的 grade 原本是「几年级」，导入时按这张表折算难度。
GRADE_LEVEL = {1: "容易", 2: "容易", 3: "较易", 4: "中等", 5: "较难", 6: "困难"}


def normalize(value) -> str:
    """把任意输入收敛到 5 档之一，认不出来就当「中等」。"""
    text = str(value or "").strip()
    return text if text in LEVELS else DEFAULT_LEVEL


def from_grade(grade) -> str:
    try:
        return GRADE_LEVEL.get(int(grade), DEFAULT_LEVEL)
    except (TypeError, ValueError):
        return DEFAULT_LEVEL


def allocate(n: int) -> dict[str, int]:
    """把 n 道题按比例拆到 5 档；最大余数法保证合计正好是 n。"""
    n = int(n or 0)
    if n <= 0:
        return {lv: 0 for lv in LEVELS}
    raw = [n * r for r in RATIOS]
    counts = [int(x) for x in raw]
    rest = n - sum(counts)
    # 余数大的先补；余数相同按档位靠前的先补
    order = sorted(range(len(LEVELS)), key=lambda i: (raw[i] - counts[i], -i), reverse=True)
    for i in order[:rest]:
        counts[i] += 1
    return {lv: counts[i] for i, lv in enumerate(LEVELS)}


def split(pool, n: int, rng, attr: str = "level") -> list:
    """按比例从 pool 里挑 n 条。

    某一个档不够时，用剩下的（含认不出等级的）补足，保证挑出来的条数不变。
    """
    pool = list(pool or [])
    n = int(n or 0)
    if n <= 0 or not pool:
        return []

    buckets: dict[str, list] = {lv: [] for lv in LEVELS}
    for row in pool:
        buckets[normalize(getattr(row, attr, ""))].append(row)

    picked: list = []
    used: set[int] = set()
    quotas = allocate(n)
    for lv in LEVELS:
        rows = buckets[lv][:]
        rng.shuffle(rows)
        for row in rows[: quotas[lv]]:
            picked.append(row)
            used.add(id(row))

    if len(picked) < n:
        rest = [r for r in pool if id(r) not in used]
        rng.shuffle(rest)
        picked.extend(rest[: n - len(picked)])
    return picked[:n]


def choose(rng) -> str:
    """按 10/40/30/15/5 随机选一个等级，用于每天只出 1 道的题（古诗、句子）。"""
    return rng.choices(LEVELS, weights=RATIOS, k=1)[0]


def pick_one(pool, rng, attr: str = "level"):
    """先按比例定档，再从该档里随机挑一条；该档为空就全池随机。"""
    pool = list(pool or [])
    if not pool:
        return None
    want = choose(rng)
    rows = [r for r in pool if normalize(getattr(r, attr, "")) == want]
    return rng.choice(rows or pool)
