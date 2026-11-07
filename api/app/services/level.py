"""题目等级（难度）定义与「按比例取题」的通用工具。

5 档：容易 / 较易 / 中等 / 较难 / 困难。

比例有两种取法，都只作用在**新题**上（复习题、错题重练不受限制——该复习的必须复习）：

- ``RATIOS`` = 10/40/30/15/5：全库固定分布，用于没有年级参照的场景；
- ``ratios_for(center)``：以某一档为峰值的钟形分布，语文英语按孩子年级折算的档位取中心，
  三年级的孩子就不会有一大截五、六年级的字词混进来。

某个档的题库空了（比如只导入了低年级的字），配额自动让给其它档，不会少题。
"""

from __future__ import annotations

LEVELS = ("容易", "较易", "中等", "较难", "困难")
RATIOS = (0.10, 0.40, 0.30, 0.15, 0.05)
DEFAULT_LEVEL = "中等"

# 以中心档为 1.0，往外逐级衰减；用于「按孩子年级取题」，归一化后当权重用。
# 中心档拿最多，下一档次之，越远越少——既要复习巩固，也要有一点点挑战。
CENTER_WEIGHTS = (1.0, 0.75, 0.40, 0.18, 0.07)

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


def shift(value, delta: int) -> str:
    """把档位上下挪几档（自适应难度用），越界就贴边。"""
    index = LEVELS.index(normalize(value))
    try:
        step = int(delta or 0)
    except (TypeError, ValueError):
        step = 0
    return LEVELS[max(0, min(len(LEVELS) - 1, index + step))]


def ratios_for(center) -> tuple[float, ...]:
    """以 ``center`` 档为峰值的权重（和为 1），越远离中心越少。

    三年级孩子（center=较易）拿到的大致是 24/33/24/13/6：
    一半以上是本年级及以下，往上探的只占三成不到。
    """
    pos = LEVELS.index(normalize(center))
    raw = [CENTER_WEIGHTS[abs(i - pos)] for i in range(len(LEVELS))]
    total = sum(raw) or 1.0
    return tuple(x / total for x in raw)


def allocate(n: int, weights=None) -> dict[str, int]:
    """把 n 道题按权重拆到 5 档；最大余数法保证合计正好是 n。"""
    n = int(n or 0)
    if n <= 0:
        return {lv: 0 for lv in LEVELS}
    weights = tuple(weights or RATIOS)
    raw = [n * r for r in weights]
    counts = [int(x) for x in raw]
    rest = n - sum(counts)
    # 余数大的先补；余数相同按档位靠前的先补
    order = sorted(range(len(LEVELS)), key=lambda i: (raw[i] - counts[i], -i), reverse=True)
    for i in order[:rest]:
        counts[i] += 1
    return {lv: counts[i] for i, lv in enumerate(LEVELS)}


def split(pool, n: int, rng, attr: str = "level", weights=None) -> list:
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
    quotas = allocate(n, weights)
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


def choose(rng, weights=None) -> str:
    """按权重随机选一个等级，用于每天只出 1 道的题（古诗、句子）。"""
    return rng.choices(LEVELS, weights=tuple(weights or RATIOS), k=1)[0]


def pick_one(pool, rng, attr: str = "level", weights=None):
    """先按比例定档，再从该档里随机挑一条；该档为空就全池随机。"""
    pool = list(pool or [])
    if not pool:
        return None
    want = choose(rng, weights)
    rows = [r for r in pool if normalize(getattr(r, attr, "")) == want]
    return rng.choice(rows or pool)
