"""艾宾浩斯复习调度（简化 SRS）。

item_id 一律存**题库主键**（汉字 / 单词 / 古诗的 id），不是当天题目序号。
否则第二天复习会把 id=1、2、3 的字当成学过的内容取回来。
"""

from ..extensions import db
from ..models import SrsItem
from ..utils.dates import shift_date, today_str
from .settings import get_setting

INTERVALS = [1, 2, 4, 7, 15, 30]
MAX_STAGE = len(INTERVALS) - 1

# 数学题每天现生成，没有稳定主键，进复习队列没有意义；只记语文和英语
SRS_KINDS = ("char", "word", "poem")


def enabled() -> bool:
    return bool(get_setting("srs_enabled"))


def record(child_id: int, subject: str, item_type: str, item_id: int, is_correct: bool, today: str | None = None):
    if not enabled() or not item_id:
        return None
    today = today or today_str()
    item = SrsItem.query.filter_by(
        child_id=child_id, subject=subject, item_type=item_type, item_id=item_id
    ).first()
    if item is None:
        item = SrsItem(
            child_id=child_id,
            subject=subject,
            item_type=item_type,
            item_id=item_id,
            stage=0,
        )
        db.session.add(item)

    if is_correct:
        item.stage = min(MAX_STAGE, (item.stage or 0) + 1)
    else:
        item.stage = max(0, (item.stage or 0) - 1)
        item.wrong_count = (item.wrong_count or 0) + 1

    interval = INTERVALS[item.stage]
    item.next_date = shift_date(today, interval)
    return item


def due_items(child_id: int, subject: str, item_type: str, limit: int, today: str | None = None):
    if not enabled() or limit <= 0:
        return []
    today = today or today_str()
    return (
        SrsItem.query.filter(
            SrsItem.child_id == child_id,
            SrsItem.subject == subject,
            SrsItem.item_type == item_type,
            SrsItem.next_date <= today,
        )
        .order_by(SrsItem.next_date.asc(), SrsItem.id.asc())
        .limit(limit)
        .all()
    )


def learned_ids(child_id: int, subject: str, item_type: str):
    """学过的题库主键集合。关掉复习调度后返回空，出题退回全库随机。"""
    if not enabled():
        return set()
    rows = SrsItem.query.filter_by(
        child_id=child_id, subject=subject, item_type=item_type
    ).all()
    return {r.item_id for r in rows}


def stage_of(child_id: int, subject: str, item_type: str, item_id: int):
    return SrsItem.query.filter_by(
        child_id=child_id, subject=subject, item_type=item_type, item_id=item_id
    ).first()
