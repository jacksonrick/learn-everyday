"""判分：统一比较数值/分数/文本。"""

from fractions import Fraction


def normalize(text) -> str:
    if text is None:
        return ""
    s = str(text).strip().lower()
    s = s.replace(" ", "").replace("\u3000", "")
    s = s.replace("＝", "=").replace("×", "x").replace("÷", "/")
    s = s.replace("，", ",").replace("。", "").replace("、", "")
    return s


def to_fraction(text):
    if text is None:
        return None
    s = normalize(text)
    if "=" in s:
        s = s.rsplit("=", 1)[-1]
    s = s.replace("%", "").replace(",", "").replace("余", "")
    if not s or len(s) > 40:
        return None
    try:
        return Fraction(s)
    except (ValueError, ZeroDivisionError):
        return None


def is_correct(correct_answer, user_answer) -> bool:
    a = to_fraction(correct_answer)
    b = to_fraction(user_answer)
    if a is not None and b is not None:
        return a == b
    return normalize(correct_answer) == normalize(user_answer)


def score_of(correct: int, total: int) -> int:
    if total <= 0:
        return 0
    return round(correct * 100 / total)
