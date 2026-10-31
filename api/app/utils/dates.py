from datetime import date, datetime, timedelta, timezone


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def today_str() -> str:
    return date.today().isoformat()


def parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def shift_date(value: str, days: int) -> str:
    return (parse_date(value) + timedelta(days=days)).isoformat()


def month_range(month: str):
    """'2026-10' -> ('2026-10-01', '2026-10-31')"""
    first = datetime.strptime(month + "-01", "%Y-%m-%d").date()
    if first.month == 12:
        nxt = first.replace(year=first.year + 1, month=1)
    else:
        nxt = first.replace(month=first.month + 1)
    return first.isoformat(), (nxt - timedelta(days=1)).isoformat()
