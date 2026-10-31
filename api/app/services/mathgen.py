"""数学出题规则引擎。

每个生成器签名：fn(params: dict, rng: random.Random) -> {"stem": str, "answer": str, "unit": str}
题目答案一律为字符串，判分时统一按数值/分数比较。

params 由后台「出题规则」维护，GENERATOR_SPECS 声明了每个出题器可调的参数，
前端据此渲染参数表单、AI 据此推荐配置，新增出题器只要写函数 + 注册 spec。
"""

from __future__ import annotations

import random
from decimal import Decimal

GENERATORS: dict[str, callable] = {}


def register(key: str):
    def deco(fn):
        GENERATORS[key] = fn
        return fn

    return deco


def _fmt(value) -> str:
    if isinstance(value, Decimal):
        return format(value.normalize(), "f")
    return str(value)


def _dec(rng: random.Random, lo, hi, places: int) -> Decimal:
    factor = 10**places
    lo_i, hi_i = int(Decimal(str(lo)) * factor), int(Decimal(str(hi)) * factor)
    if lo_i > hi_i:
        lo_i, hi_i = hi_i, lo_i
    return Decimal(rng.randint(lo_i, hi_i)) / factor


def _p(params: dict, key: str, default):
    value = params.get(key, default)
    return default if value is None else value


def _ri(p: dict, rng: random.Random, prefix: str, lo: int, hi: int, floor: int | None = None) -> int:
    """读取 {prefix}_min / {prefix}_max；也允许用单个 {prefix} 直接定值。"""
    single = p.get(prefix)
    if single not in (None, ""):
        try:
            value = int(float(single))
            return max(floor, value) if floor is not None else value
        except (TypeError, ValueError):
            pass
    try:
        a = int(float(_p(p, f"{prefix}_min", lo)))
        b = int(float(_p(p, f"{prefix}_max", hi)))
    except (TypeError, ValueError):
        a, b = lo, hi
    if a > b:
        a, b = b, a
    if floor is not None:
        a, b = max(floor, a), max(floor, b)
    return rng.randint(a, b)


def _rd(p: dict, rng: random.Random, prefix: str, lo, hi, places: int = 2) -> Decimal:
    try:
        a = float(_p(p, f"{prefix}_min", lo))
        b = float(_p(p, f"{prefix}_max", hi))
    except (TypeError, ValueError):
        a, b = lo, hi
    return _dec(rng, a, b, places)


# ---------------------------------------------------------------- 一年级

@register("add_sub_10")
def _add_sub_10(p, rng):
    limit = _ri(p, rng, "limit", 10, 10, floor=5)
    if rng.random() < 0.5:
        a = rng.randint(1, max(1, limit - 1))
        b = rng.randint(1, max(1, limit - a))
        return {"stem": f"{a} + {b} =", "answer": _fmt(a + b)}
    a = rng.randint(2, limit)
    b = rng.randint(1, a)
    return {"stem": f"{a} - {b} =", "answer": _fmt(a - b)}


@register("add_sub_20")
def _add_sub_20(p, rng):
    limit = _ri(p, rng, "limit", 20, 20, floor=10)
    if rng.random() < 0.5:
        a = rng.randint(2, max(2, limit - 2))
        b = rng.randint(2, max(2, limit - a))
        return {"stem": f"{a} + {b} =", "answer": _fmt(a + b)}
    a = rng.randint(max(3, limit // 2), limit)
    b = rng.randint(2, max(2, a - 1))
    return {"stem": f"{a} - {b} =", "answer": _fmt(a - b)}


@register("add_sub_100_nocarry")
def _add_sub_100_nocarry(p, rng):
    limit = _ri(p, rng, "limit", 100, 100, floor=20)
    if rng.random() < 0.5:
        a = rng.randint(10, max(10, limit - 20))
        b = rng.randint(10, max(10, limit - a))
        return {"stem": f"{a} + {b} =", "answer": _fmt(a + b)}
    a = rng.randint(max(20, limit // 3), limit)
    b = rng.randint(10, max(10, a - 10))
    return {"stem": f"{a} - {b} =", "answer": _fmt(a - b)}


@register("add_three_numbers")
def _add_three_numbers(p, rng):
    limit = _ri(p, rng, "limit", 20, 20, floor=10)
    a = rng.randint(1, max(1, limit // 2))
    b = rng.randint(1, max(1, limit // 2))
    c = rng.randint(1, max(1, limit - a - b))
    return {"stem": f"{a} + {b} + {c} =", "answer": _fmt(a + b + c)}


# ---------------------------------------------------------------- 二年级

@register("mul_table")
def _mul_table(p, rng):
    a = _ri(p, rng, "a", 2, 9, floor=1)
    b = _ri(p, rng, "b", 2, 9, floor=1)
    return {"stem": f"{a} × {b} =", "answer": _fmt(a * b)}


@register("div_table")
def _div_table(p, rng):
    b = _ri(p, rng, "b", 2, 9, floor=2)
    q = _ri(p, rng, "q", 2, 9, floor=1)
    return {"stem": f"{b * q} ÷ {b} =", "answer": _fmt(q)}


@register("add_sub_100_carry")
def _add_sub_100_carry(p, rng):
    limit = _ri(p, rng, "limit", 100, 100, floor=20)
    if rng.random() < 0.5:
        a = rng.randint(15, max(16, limit - 15))
        b = rng.randint(15, max(15, limit - a))
        return {"stem": f"{a} + {b} =", "answer": _fmt(a + b)}
    a = rng.randint(max(30, limit // 2), limit)
    b = rng.randint(11, max(11, a - 10))
    return {"stem": f"{a} - {b} =", "answer": _fmt(a - b)}


@register("div_remainder")
def _div_remainder(p, rng):
    b = _ri(p, rng, "b", 3, 9, floor=3)
    q = _ri(p, rng, "q", 2, 9, floor=1)
    r = rng.randint(1, b - 1)
    return {"stem": f"{b * q + r} ÷ {b} = … 余", "answer": _fmt(r), "unit": ""}


@register("mul_add_mixed")
def _mul_add_mixed(p, rng):
    a = _ri(p, rng, "a", 2, 9, floor=1)
    b = _ri(p, rng, "b", 2, 9, floor=1)
    c = _ri(p, rng, "c", 2, 20, floor=1)
    return {"stem": f"{a} × {b} + {c} =", "answer": _fmt(a * b + c)}


# ---------------------------------------------------------------- 三年级

@register("add_sub_10000")
def _add_sub_10000(p, rng):
    if rng.random() < 0.5:
        a = _ri(p, rng, "a", 120, 6800, floor=10)
        b = _ri(p, rng, "b", 120, 2000, floor=10)
        return {"stem": f"{a} + {b} =", "answer": _fmt(a + b)}
    a = _ri(p, rng, "a", 1200, 9800, floor=100)
    b = _ri(p, rng, "b", 120, 1100, floor=10)
    if b > a:
        a, b = b, a
    return {"stem": f"{a} - {b} =", "answer": _fmt(a - b)}


@register("mul_2digit_by_1")
def _mul_2digit_by_1(p, rng):
    a = _ri(p, rng, "a", 11, 99, floor=1)
    b = _ri(p, rng, "b", 2, 9, floor=1)
    return {"stem": f"{a} × {b} =", "answer": _fmt(a * b)}


@register("mul_3digit_by_1")
def _mul_3digit_by_1(p, rng):
    a = _ri(p, rng, "a", 102, 989, floor=1)
    b = _ri(p, rng, "b", 2, 9, floor=1)
    if _p(p, "no_zero", True) and a % 10 == 0:
        a = a - 1 if a > 10 else a + 1
    return {"stem": f"{a} × {b} =", "answer": _fmt(a * b)}


@register("div_2digit_by_1")
def _div_2digit_by_1(p, rng):
    b = _ri(p, rng, "b", 2, 9, floor=2)
    q = _ri(p, rng, "q", 11, 49, floor=1)
    return {"stem": f"{b * q} ÷ {b} =", "answer": _fmt(q)}


@register("div_3digit_by_1")
def _div_3digit_by_1(p, rng):
    b = _ri(p, rng, "b", 3, 9, floor=2)
    q = _ri(p, rng, "q", 52, 190, floor=1)
    return {"stem": f"{b * q} ÷ {b} =", "answer": _fmt(q)}


@register("mul_round_tens")
def _mul_round_tens(p, rng):
    a = _ri(p, rng, "a", 2, 9, floor=1) * rng.choice([10, 100])
    b = _ri(p, rng, "b", 2, 9, floor=1)
    return {"stem": f"{a} × {b} =", "answer": _fmt(a * b)}


@register("two_step_paren")
def _two_step_paren(p, rng):
    a = _ri(p, rng, "a", 10, 90, floor=1)
    b = _ri(p, rng, "b", 2, 9, floor=1)
    c = _ri(p, rng, "c", 2, 9, floor=1)
    return {"stem": f"({a} + {b}) × {c} =", "answer": _fmt((a + b) * c)}


# ---------------------------------------------------------------- 四年级

@register("mul_3digit_by_2digit")
def _mul_3digit_by_2digit(p, rng):
    a = _ri(p, rng, "a", 102, 899, floor=1)
    b = _ri(p, rng, "b", 12, 89, floor=1)
    return {"stem": f"{a} × {b} =", "answer": _fmt(a * b)}


@register("div_by_2digit")
def _div_by_2digit(p, rng):
    b = _ri(p, rng, "b", 12, 89, floor=2)
    q = _ri(p, rng, "q", 11, 90, floor=1)
    return {"stem": f"{b * q} ÷ {b} =", "answer": _fmt(q)}


@register("add_sub_large")
def _add_sub_large(p, rng):
    if rng.random() < 0.5:
        a = _ri(p, rng, "a", 1000, 90000, floor=10)
        b = _ri(p, rng, "b", 1000, 9000, floor=10)
        return {"stem": f"{a} + {b} =", "answer": _fmt(a + b)}
    a = _ri(p, rng, "a", 20000, 99000, floor=100)
    b = _ri(p, rng, "b", 1000, 9000, floor=10)
    if b > a:
        a, b = b, a
    return {"stem": f"{a} - {b} =", "answer": _fmt(a - b)}


@register("simple_law")
def _simple_law(p, rng):
    a = rng.choice([25, 125, 25, 125])
    b = 4 if a == 25 else 8
    c = _ri(p, rng, "c", 2, 9, floor=1)
    return {"stem": f"{a} × {b} × {c} =", "answer": _fmt(a * b * c)}


@register("div_remainder_2digit")
def _div_remainder_2digit(p, rng):
    b = _ri(p, rng, "b", 12, 39, floor=3)
    q = _ri(p, rng, "q", 6, 40, floor=1)
    r = rng.randint(1, b - 1)
    return {"stem": f"{b * q + r} ÷ {b} = … 余", "answer": _fmt(r)}


# ---------------------------------------------------------------- 五年级

@register("decimal_add_sub")
def _decimal_add_sub(p, rng):
    places = 2
    a = _rd(p, rng, "a", 1.2, 89.9, places)
    b = _rd(p, rng, "b", 0.5, 9.9, places)
    if rng.random() < 0.5:
        return {"stem": f"{_fmt(a)} + {_fmt(b)} =", "answer": _fmt(a + b)}
    if b > a:
        a, b = b, a
    return {"stem": f"{_fmt(a)} - {_fmt(b)} =", "answer": _fmt(a - b)}


@register("decimal_mul_int")
def _decimal_mul_int(p, rng):
    a = _rd(p, rng, "a", 1.1, 9.9, 1)
    b = _ri(p, rng, "b", 2, 9, floor=1)
    return {"stem": f"{_fmt(a)} × {b} =", "answer": _fmt(a * b)}


@register("decimal_div_int")
def _decimal_div_int(p, rng):
    b = _ri(p, rng, "b", 2, 8, floor=2)
    q = _rd(p, rng, "q", 1.1, 9.9, 1)
    return {"stem": f"{_fmt(q * b)} ÷ {b} =", "answer": _fmt(q)}


@register("fraction_add_same")
def _fraction_add_same(p, rng):
    from fractions import Fraction

    d = _ri(p, rng, "d", 4, 12, floor=3)
    a = rng.randint(1, max(1, d - 2))
    b = rng.randint(1, max(1, d - a - 1)) if d - a - 1 >= 1 else 1
    fr = Fraction(a + b, d)
    ans = str(fr.numerator) if fr.denominator == 1 else f"{fr.numerator}/{fr.denominator}"
    return {"stem": f"{a}/{d} + {b}/{d} =", "answer": ans}


@register("simple_equation")
def _simple_equation(p, rng):
    x = _ri(p, rng, "x", 5, 90, floor=1)
    a = _ri(p, rng, "a", 5, 60, floor=1)
    if rng.random() < 0.5:
        return {"stem": f"x + {a} = {x + a}", "answer": _fmt(x)}
    return {"stem": f"x - {a} = {max(0, x - a)}", "answer": _fmt(x)}


# ---------------------------------------------------------------- 六年级

@register("fraction_mul")
def _fraction_mul(p, rng):
    from fractions import Fraction

    a, b = rng.randint(1, 5), rng.randint(2, 9)
    c, d = rng.randint(1, 5), rng.randint(2, 9)
    fr = Fraction(a, b) * Fraction(c, d)
    ans = str(fr.numerator) if fr.denominator == 1 else f"{fr.numerator}/{fr.denominator}"
    return {"stem": f"{a}/{b} × {c}/{d} =", "answer": ans}


@register("fraction_div")
def _fraction_div(p, rng):
    from fractions import Fraction

    a, b = rng.randint(1, 5), rng.randint(2, 9)
    c, d = rng.randint(1, 5), rng.randint(2, 9)
    fr = Fraction(a, b) / Fraction(c, d)
    ans = str(fr.numerator) if fr.denominator == 1 else f"{fr.numerator}/{fr.denominator}"
    return {"stem": f"{a}/{b} ÷ {c}/{d} =", "answer": ans}


@register("percent_decimal")
def _percent_decimal(p, rng):
    d = _rd(p, rng, "a", 0.05, 0.95, 2)
    return {"stem": f"把 {_fmt(d)} 化成百分数 =", "answer": _fmt(d * 100), "unit": "%"}


@register("fraction_decimal")
def _fraction_decimal(p, rng):
    from fractions import Fraction

    d = rng.choice([2, 4, 5, 8, 10, 20, 25])
    n = rng.randint(1, d - 1)
    fr = Fraction(n, d)
    val = Decimal(fr.numerator) / Decimal(fr.denominator)
    return {"stem": f"{n}/{d} 化成小数 =", "answer": _fmt(val)}


@register("ratio_simplify")
def _ratio_simplify(p, rng):
    from math import gcd

    a = rng.randint(2, 9)
    b = rng.randint(2, 9)
    k = rng.randint(2, 6)
    x, y = a * k, b * k
    g = gcd(x, y)
    return {"stem": f"{x} : {y} 化成最简整数比 =", "answer": f"{x // g}:{y // g}"}


GENERATOR_TOPICS = {
    "add_sub_10": "10以内加减法",
    "add_sub_20": "20以内加减法",
    "add_sub_100_nocarry": "100以内加减法",
    "add_three_numbers": "连加",
    "mul_table": "表内乘法",
    "div_table": "表内除法",
    "add_sub_100_carry": "100以内进退位加减",
    "div_remainder": "有余数除法",
    "mul_add_mixed": "乘加混合",
    "add_sub_10000": "万以内加减法",
    "mul_2digit_by_1": "两位数乘一位数",
    "mul_3digit_by_1": "多位数乘一位数",
    "div_2digit_by_1": "两位数除以一位数",
    "div_3digit_by_1": "三位数除以一位数",
    "mul_round_tens": "整十整百乘法",
    "two_step_paren": "两步混合运算",
    "mul_3digit_by_2digit": "三位数乘两位数",
    "div_by_2digit": "除数是两位数的除法",
    "add_sub_large": "大数加减法",
    "simple_law": "运算律简算",
    "div_remainder_2digit": "两位数除法有余数",
    "decimal_add_sub": "小数加减法",
    "decimal_mul_int": "小数乘整数",
    "decimal_div_int": "小数除以整数",
    "fraction_add_same": "同分母分数加法",
    "simple_equation": "简易方程",
    "fraction_mul": "分数乘法",
    "fraction_div": "分数除法",
    "percent_decimal": "小数化百分数",
    "fraction_decimal": "分数化小数",
    "ratio_simplify": "化简比",
}

# 每个出题器可调的参数，前端据此渲染表单，AI 据此推荐配置
GENERATOR_SPECS: dict[str, dict] = {
    "add_sub_10": {"grade": "一年级上", "params": [{"key": "limit", "label": "和的最大值", "default": 10, "min": 5, "max": 100}]},
    "add_sub_20": {"grade": "一年级下", "params": [{"key": "limit", "label": "和的最大值", "default": 20, "min": 10, "max": 200}]},
    "add_sub_100_nocarry": {"grade": "一年级下", "params": [{"key": "limit", "label": "和的最大值", "default": 100, "min": 20, "max": 1000}]},
    "add_three_numbers": {"grade": "一年级上", "params": [{"key": "limit", "label": "和的最大值", "default": 20, "min": 10, "max": 200}]},
    "mul_table": {
        "grade": "二年级上",
        "params": [
            {"key": "a_min", "label": "第一个因数最小", "default": 2, "min": 1, "max": 12},
            {"key": "a_max", "label": "第一个因数最大", "default": 9, "min": 1, "max": 12},
            {"key": "b_min", "label": "第二个因数最小", "default": 2, "min": 1, "max": 12},
            {"key": "b_max", "label": "第二个因数最大", "default": 9, "min": 1, "max": 12},
        ],
    },
    "div_table": {
        "grade": "二年级下",
        "params": [
            {"key": "b_min", "label": "除数最小", "default": 2, "min": 2, "max": 12},
            {"key": "b_max", "label": "除数最大", "default": 9, "min": 2, "max": 12},
            {"key": "q_min", "label": "商最小", "default": 2, "min": 1, "max": 12},
            {"key": "q_max", "label": "商最大", "default": 9, "min": 1, "max": 12},
        ],
    },
    "add_sub_100_carry": {"grade": "二年级上", "params": [{"key": "limit", "label": "和的最大值", "default": 100, "min": 20, "max": 1000}]},
    "div_remainder": {
        "grade": "二年级下",
        "params": [
            {"key": "b_min", "label": "除数最小", "default": 3, "min": 2, "max": 12},
            {"key": "b_max", "label": "除数最大", "default": 9, "min": 2, "max": 12},
        ],
    },
    "mul_add_mixed": {
        "grade": "二年级上",
        "params": [
            {"key": "a_min", "label": "因数最小", "default": 2, "min": 1, "max": 12},
            {"key": "a_max", "label": "因数最大", "default": 9, "min": 1, "max": 12},
        ],
    },
    "add_sub_10000": {
        "grade": "三年级上",
        "params": [
            {"key": "a_min", "label": "第一个数最小", "default": 120, "min": 10, "max": 99999},
            {"key": "a_max", "label": "第一个数最大", "default": 6800, "min": 10, "max": 99999},
            {"key": "b_min", "label": "第二个数最小", "default": 120, "min": 10, "max": 99999},
            {"key": "b_max", "label": "第二个数最大", "default": 2000, "min": 10, "max": 99999},
        ],
    },
    "mul_2digit_by_1": {
        "grade": "三年级上",
        "params": [
            {"key": "a_min", "label": "被乘数最小", "default": 11, "min": 1, "max": 9999},
            {"key": "a_max", "label": "被乘数最大", "default": 99, "min": 1, "max": 9999},
            {"key": "b_min", "label": "乘数最小", "default": 2, "min": 1, "max": 19},
            {"key": "b_max", "label": "乘数最大", "default": 9, "min": 1, "max": 19},
        ],
    },
    "mul_3digit_by_1": {
        "grade": "三年级上",
        "params": [
            {"key": "a_min", "label": "被乘数最小", "default": 102, "min": 1, "max": 9999},
            {"key": "a_max", "label": "被乘数最大", "default": 989, "min": 1, "max": 9999},
            {"key": "b_min", "label": "乘数最小", "default": 2, "min": 1, "max": 19},
            {"key": "b_max", "label": "乘数最大", "default": 9, "min": 1, "max": 19},
            {"key": "no_zero", "label": "避开整十数", "default": True, "type": "bool"},
        ],
    },
    "div_2digit_by_1": {
        "grade": "三年级下",
        "params": [
            {"key": "b_min", "label": "除数最小", "default": 2, "min": 2, "max": 19},
            {"key": "b_max", "label": "除数最大", "default": 9, "min": 2, "max": 19},
            {"key": "q_min", "label": "商最小", "default": 11, "min": 1, "max": 999},
            {"key": "q_max", "label": "商最大", "default": 49, "min": 1, "max": 999},
        ],
    },
    "div_3digit_by_1": {
        "grade": "三年级下",
        "params": [
            {"key": "b_min", "label": "除数最小", "default": 3, "min": 2, "max": 19},
            {"key": "b_max", "label": "除数最大", "default": 9, "min": 2, "max": 19},
            {"key": "q_min", "label": "商最小", "default": 52, "min": 1, "max": 999},
            {"key": "q_max", "label": "商最大", "default": 190, "min": 1, "max": 999},
        ],
    },
    "mul_round_tens": {
        "grade": "三年级上",
        "params": [
            {"key": "a_min", "label": "一位数因数最小", "default": 2, "min": 1, "max": 9},
            {"key": "a_max", "label": "一位数因数最大", "default": 9, "min": 1, "max": 9},
        ],
    },
    "two_step_paren": {
        "grade": "三年级下",
        "params": [
            {"key": "a_min", "label": "括号内加数最小", "default": 10, "min": 1, "max": 999},
            {"key": "a_max", "label": "括号内加数最大", "default": 90, "min": 1, "max": 999},
        ],
    },
    "mul_3digit_by_2digit": {
        "grade": "四年级上",
        "params": [
            {"key": "a_min", "label": "被乘数最小", "default": 102, "min": 1, "max": 9999},
            {"key": "a_max", "label": "被乘数最大", "default": 899, "min": 1, "max": 9999},
            {"key": "b_min", "label": "乘数最小", "default": 12, "min": 1, "max": 999},
            {"key": "b_max", "label": "乘数最大", "default": 89, "min": 1, "max": 999},
        ],
    },
    "div_by_2digit": {
        "grade": "四年级上",
        "params": [
            {"key": "b_min", "label": "除数最小", "default": 12, "min": 2, "max": 999},
            {"key": "b_max", "label": "除数最大", "default": 89, "min": 2, "max": 999},
            {"key": "q_min", "label": "商最小", "default": 11, "min": 1, "max": 999},
            {"key": "q_max", "label": "商最大", "default": 90, "min": 1, "max": 999},
        ],
    },
    "add_sub_large": {
        "grade": "四年级上",
        "params": [
            {"key": "a_min", "label": "第一个数最小", "default": 1000, "min": 10, "max": 999999},
            {"key": "a_max", "label": "第一个数最大", "default": 90000, "min": 10, "max": 999999},
        ],
    },
    "simple_law": {
        "grade": "四年级下",
        "params": [
            {"key": "c_min", "label": "第三个因数最小", "default": 2, "min": 1, "max": 9},
            {"key": "c_max", "label": "第三个因数最大", "default": 9, "min": 1, "max": 9},
        ],
    },
    "div_remainder_2digit": {
        "grade": "四年级下",
        "params": [
            {"key": "b_min", "label": "除数最小", "default": 12, "min": 2, "max": 999},
            {"key": "b_max", "label": "除数最大", "default": 39, "min": 2, "max": 999},
        ],
    },
    "decimal_add_sub": {
        "grade": "五年级上",
        "params": [
            {"key": "a_min", "label": "第一个数最小", "default": 1.2, "min": 0, "max": 999, "step": 0.1},
            {"key": "a_max", "label": "第一个数最大", "default": 89.9, "min": 0, "max": 999, "step": 0.1},
            {"key": "b_min", "label": "第二个数最小", "default": 0.5, "min": 0, "max": 999, "step": 0.1},
            {"key": "b_max", "label": "第二个数最大", "default": 9.9, "min": 0, "max": 999, "step": 0.1},
        ],
    },
    "decimal_mul_int": {
        "grade": "五年级上",
        "params": [
            {"key": "a_min", "label": "小数最小", "default": 1.1, "min": 0, "max": 999, "step": 0.1},
            {"key": "a_max", "label": "小数最大", "default": 9.9, "min": 0, "max": 999, "step": 0.1},
        ],
    },
    "decimal_div_int": {
        "grade": "五年级上",
        "params": [
            {"key": "b_min", "label": "除数最小", "default": 2, "min": 2, "max": 99},
            {"key": "b_max", "label": "除数最大", "default": 8, "min": 2, "max": 99},
        ],
    },
    "fraction_add_same": {
        "grade": "五年级下",
        "params": [
            {"key": "d_min", "label": "分母最小", "default": 4, "min": 3, "max": 99},
            {"key": "d_max", "label": "分母最大", "default": 12, "min": 3, "max": 99},
        ],
    },
    "simple_equation": {
        "grade": "五年级上",
        "params": [
            {"key": "x_min", "label": "未知数最小", "default": 5, "min": 1, "max": 9999},
            {"key": "x_max", "label": "未知数最大", "default": 90, "min": 1, "max": 9999},
        ],
    },
    "fraction_mul": {"grade": "六年级上", "params": []},
    "fraction_div": {"grade": "六年级上", "params": []},
    "percent_decimal": {
        "grade": "六年级上",
        "params": [
            {"key": "a_min", "label": "小数最小", "default": 0.05, "min": 0.01, "max": 0.99, "step": 0.01},
            {"key": "a_max", "label": "小数最大", "default": 0.95, "min": 0.01, "max": 0.99, "step": 0.01},
        ],
    },
    "fraction_decimal": {"grade": "六年级下", "params": []},
    "ratio_simplify": {"grade": "六年级上", "params": []},
}


def spec(key: str) -> dict:
    base = {"key": key, "topic": GENERATOR_TOPICS.get(key, key)}
    base.update(GENERATOR_SPECS.get(key, {}))
    base.setdefault("params", [])
    return base


def all_specs() -> list[dict]:
    return [spec(key) for key in GENERATORS]


def generate_one(generator: str, params: dict | None = None, seed: int | None = None) -> dict:
    fn = GENERATORS.get(generator)
    if fn is None:
        raise KeyError(f"未知出题器: {generator}")
    rng = random.Random(seed)
    params = params or {}
    result = fn(params, rng)
    result.setdefault("unit", "")
    result["topic"] = result.get("topic") or GENERATOR_TOPICS.get(generator, "")
    return result


def preview(generator: str, params: dict | None = None, count: int = 5) -> list[dict]:
    return [generate_one(generator, params) for _ in range(count)]
