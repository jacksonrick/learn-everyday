from ..extensions import db
from .base import BaseModel


class DailyTask(BaseModel):
    __tablename__ = "daily_task"
    __table_args__ = (
        db.UniqueConstraint("child_id", "date", "subject", name="uq_task_child_date_subject"),
        db.Index("ix_task_child_date", "child_id", "date"),
    )

    child_id = db.Column(db.Integer, db.ForeignKey("child.id"), nullable=False)
    date = db.Column(db.String(10), nullable=False)
    subject = db.Column(db.String(10), nullable=False)
    status = db.Column(db.String(10), nullable=False, default="pending")
    payload_json = db.Column(db.Text, default="{}")
    score = db.Column(db.Integer, default=0)
    total = db.Column(db.Integer, default=0)
    correct = db.Column(db.Integer, default=0)
    duration_sec = db.Column(db.Integer, default=0)
    completed_at = db.Column(db.String(32))


class StudyRecord(BaseModel):
    __tablename__ = "study_record"
    __table_args__ = (db.Index("ix_record_child_date", "child_id", "date"),)

    child_id = db.Column(db.Integer, db.ForeignKey("child.id"), nullable=False)
    date = db.Column(db.String(10), nullable=False)
    subject = db.Column(db.String(10), nullable=False)
    task_id = db.Column(db.Integer, db.ForeignKey("daily_task.id"))
    item_type = db.Column(db.String(20), default="")
    item_id = db.Column(db.Integer)
    stem = db.Column(db.Text, default="")
    user_answer = db.Column(db.String(200), default="")
    correct_answer = db.Column(db.String(200), default="")
    is_correct = db.Column(db.Boolean, default=False)
    duration_ms = db.Column(db.Integer, default=0)


class Checkin(BaseModel):
    __tablename__ = "checkin"
    __table_args__ = (db.UniqueConstraint("child_id", "date", name="uq_checkin_child_date"),)

    child_id = db.Column(db.Integer, db.ForeignKey("child.id"), nullable=False)
    date = db.Column(db.String(10), nullable=False)
    status = db.Column(db.String(10), default="partial")
    subjects_json = db.Column(db.Text, default="[]")
    points = db.Column(db.Integer, default=0)
    streak = db.Column(db.Integer, default=0)
    is_makeup = db.Column(db.Boolean, default=False)


class SrsItem(BaseModel):
    __tablename__ = "srs_item"
    __table_args__ = (
        db.UniqueConstraint("child_id", "subject", "item_type", "item_id", name="uq_srs_item"),
        db.Index("ix_srs_due", "child_id", "next_date"),
    )

    child_id = db.Column(db.Integer, db.ForeignKey("child.id"), nullable=False)
    subject = db.Column(db.String(10), nullable=False)
    item_type = db.Column(db.String(20), nullable=False)
    item_id = db.Column(db.Integer, nullable=False)
    stage = db.Column(db.Integer, default=0)
    next_date = db.Column(db.String(10))
    wrong_count = db.Column(db.Integer, default=0)


class TaskAnswer(BaseModel):
    """每日任务的答题存档。

    孩子做到一半退出（平板息屏、切走问家长一道题）时，之前答过的题要有地方放，
    回来才能从第 11 题接着做，而不是重头再来。最后提交时以这些存档为准，
    客户端传上来的答案只是覆盖关系。
    """

    __tablename__ = "task_answer"
    __table_args__ = (
        db.UniqueConstraint("task_id", "item_id", name="uq_task_answer_item"),
        db.Index("ix_task_answer_task", "task_id"),
    )

    task_id = db.Column(db.Integer, db.ForeignKey("daily_task.id"), nullable=False)
    child_id = db.Column(db.Integer, db.ForeignKey("child.id"), nullable=False)
    date = db.Column(db.String(10), nullable=False)
    subject = db.Column(db.String(10), nullable=False)
    item_id = db.Column(db.Integer, nullable=False)
    answer = db.Column(db.String(200), default="")
    duration_ms = db.Column(db.Integer, default=0)
    updated_at = db.Column(db.String(32))


class Recitation(BaseModel):
    """古诗背诵录音：只留记录，不判对错也不给分，家长后台可以试听。"""

    __tablename__ = "recitation"
    __table_args__ = (db.Index("ix_recitation_child_date", "child_id", "date"),)

    child_id = db.Column(db.Integer, db.ForeignKey("child.id"), nullable=False)
    task_id = db.Column(db.Integer, db.ForeignKey("daily_task.id"))
    date = db.Column(db.String(10), nullable=False)
    subject = db.Column(db.String(10), default="chinese")
    item_id = db.Column(db.Integer, default=0)
    poem_id = db.Column(db.Integer, db.ForeignKey("poem.id"))
    title = db.Column(db.String(120), default="")
    # 相对 uploads/recite 目录的文件名（月份目录 + 随机名），不存绝对路径
    file_path = db.Column(db.String(200), default="")
    mime = db.Column(db.String(60), default="audio/webm")
    size = db.Column(db.Integer, default=0)
    duration_ms = db.Column(db.Integer, default=0)


class WrongItem(BaseModel):
    __tablename__ = "wrong_item"
    __table_args__ = (
        db.UniqueConstraint("child_id", "subject", "item_type", "item_id", name="uq_wrong_item"),
    )

    child_id = db.Column(db.Integer, db.ForeignKey("child.id"), nullable=False)
    subject = db.Column(db.String(10), nullable=False)
    item_type = db.Column(db.String(20), nullable=False)
    # 题库主键（汉字/单词/古诗/应用题），数学计算题按知识点聚合成一个稳定编号
    item_id = db.Column(db.Integer, nullable=False)
    ref_text = db.Column(db.String(200), default="")
    # 整道题的快照，重练时直接还原，不用回题库拼装
    snapshot_json = db.Column(db.Text, default="{}")
    wrong_count = db.Column(db.Integer, default=1)
    correct_streak = db.Column(db.Integer, default=0)
    mastered = db.Column(db.Boolean, default=False)
    last_wrong_at = db.Column(db.String(32))
