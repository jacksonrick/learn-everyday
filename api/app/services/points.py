"""积分、连击与打卡。"""

import json

from sqlalchemy import func

from ..extensions import db
from ..models import Checkin, PointsLedger
from ..utils.dates import now_iso, shift_date, today_str
from .settings import get_setting

_SUBJECT_LABELS = {"chinese": "语文", "math": "数学", "english": "英语"}

REASON_LABELS = {
    "checkin": "今日打卡",
    "redeem": "兑换奖励",
    "manual": "家长手动调整",
    "wrong_fix": "错题订正",
}


def reason_label(reason: str) -> str:
    """把流水里的英文编码翻成家长看得懂的中文。"""
    key = (reason or "").strip()
    if not key:
        return "—"
    if key in REASON_LABELS:
        return REASON_LABELS[key]
    if key.startswith("subject_"):
        return f"完成{_SUBJECT_LABELS.get(key[8:], key[8:])}学习"
    if key.startswith("excellent_"):
        return f"{_SUBJECT_LABELS.get(key[10:], key[10:])}正确率优秀"
    if key.startswith("streak_"):
        return f"连续打卡 {key[7:]} 天"
    return key


def balance(child_id: int) -> int:
    last = (
        PointsLedger.query.filter_by(child_id=child_id)
        .order_by(PointsLedger.id.desc())
        .first()
    )
    return last.balance_after if last else 0


def earned_today(child_id: int, today: str | None = None) -> int:
    today = today or today_str()
    total = (
        db.session.query(func.coalesce(func.sum(PointsLedger.delta), 0))
        .filter(
            PointsLedger.child_id == child_id,
            PointsLedger.date == today,
            PointsLedger.delta > 0,
        )
        .scalar()
    )
    return int(total or 0)


def earned_by_reason(child_id: int, reason: str, today: str | None = None) -> int:
    """当天某个来源已经拿了多少分，用于「错题订正」这类单项日上限。"""
    today = today or today_str()
    total = (
        db.session.query(func.coalesce(func.sum(PointsLedger.delta), 0))
        .filter(
            PointsLedger.child_id == child_id,
            PointsLedger.date == today,
            PointsLedger.reason == reason,
            PointsLedger.delta > 0,
        )
        .scalar()
    )
    return int(total or 0)


def add(child_id: int, delta: int, reason: str, ref_type: str = "", ref_id: int | None = None,
        note: str = "", apply_cap: bool = True, today: str | None = None) -> int:
    """写入一条积分流水，返回实际生效的分值（可能被日上限裁剪）。"""
    if delta == 0:
        return 0
    today = today or today_str()

    if delta == 0:
        return 0

    ledger = PointsLedger(
        child_id=child_id,
        date=today,
        delta=delta,
        reason=reason,
        ref_type=ref_type,
        ref_id=ref_id,
        balance_after=balance(child_id) + delta,
        note=note,
    )
    db.session.add(ledger)
    return delta


def current_streak(child_id: int, today: str | None = None) -> int:
    today = today or today_str()
    row = Checkin.query.filter_by(child_id=child_id, date=today).first()
    if row and row.status == "full":
        return row.streak or 1
    yesterday = Checkin.query.filter_by(child_id=child_id, date=shift_date(today, -1)).first()
    if yesterday and yesterday.status == "full":
        return yesterday.streak or 1
    return 0


def upcert_checkin(child_id: int, date: str, subjects: list[str], is_makeup: bool = False):
    """按当天完成的科目刷新打卡状态，返回 (checkin, 是否本次新达成打卡)。"""
    required = {"chinese", "math", "english"}
    done = set(subjects)
    status = "full" if required.issubset(done) else "partial"

    row = Checkin.query.filter_by(child_id=child_id, date=date).first()
    was_full = bool(row and row.status == "full")
    newly = status == "full" and not was_full

    if row is None:
        row = Checkin(child_id=child_id, date=date, status=status)
        db.session.add(row)

    row.status = status
    row.subjects_json = json.dumps(sorted(done), ensure_ascii=False)
    if is_makeup:
        row.is_makeup = True

    if status == "full":
        if is_makeup:
            row.streak = 0
        elif not was_full:
            prev = Checkin.query.filter_by(
                child_id=child_id, date=shift_date(date, -1)
            ).first()
            row.streak = (prev.streak if prev and prev.status == "full" else 0) + 1
    else:
        row.streak = 0

    db.session.flush()
    return row, newly


def award_checkin(child_id: int, date: str, row: Checkin, already_awarded: bool) -> dict:
    """打卡奖励 + 连击里程碑，返回明细。"""
    detail = []
    if already_awarded:
        return {"earned": 0, "detail": detail}

    base = int(get_setting("point_checkin") or 0)
    got = add(child_id, base, "checkin", "checkin", row.id, today=date)
    if got:
        detail.append({"reason": "今日打卡", "points": got})

    milestones = get_setting("streak_milestones") or {}
    streak = row.streak or 0
    bonus = int(milestones.get(str(streak), 0)) if milestones else 0
    if bonus:
        got = add(child_id, bonus, f"streak_{streak}", "checkin", row.id, today=date)
        if got:
            detail.append({"reason": f"连续打卡 {streak} 天", "points": got})

    row.points = sum(d["points"] for d in detail)
    return {"earned": row.points, "detail": detail}


def history(child_id: int, limit: int = 50):
    return (
        PointsLedger.query.filter_by(child_id=child_id)
        .order_by(PointsLedger.id.desc())
        .limit(limit)
        .all()
    )


def today_iso() -> str:
    return now_iso()
