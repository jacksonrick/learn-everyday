from ..extensions import db
from .base import BaseModel


class PointsLedger(BaseModel):
    __tablename__ = "points_ledger"
    __table_args__ = (db.Index("ix_points_child", "child_id", "created_at"),)

    child_id = db.Column(db.Integer, db.ForeignKey("child.id"), nullable=False)
    date = db.Column(db.String(10), nullable=False, index=True)
    delta = db.Column(db.Integer, nullable=False)
    reason = db.Column(db.String(40), nullable=False)
    ref_type = db.Column(db.String(20), default="")
    ref_id = db.Column(db.Integer)
    balance_after = db.Column(db.Integer, default=0)
    note = db.Column(db.String(200), default="")


class Reward(BaseModel):
    __tablename__ = "reward"

    name = db.Column(db.String(60), nullable=False)
    cost = db.Column(db.Integer, nullable=False, default=100)
    icon = db.Column(db.String(16), default="🎁")
    stock = db.Column(db.Integer, default=-1)
    child_id = db.Column(db.Integer, db.ForeignKey("child.id"))


class Redemption(BaseModel):
    __tablename__ = "redemption"

    child_id = db.Column(db.Integer, db.ForeignKey("child.id"), nullable=False)
    reward_id = db.Column(db.Integer, db.ForeignKey("reward.id"), nullable=False)
    cost = db.Column(db.Integer, nullable=False)
    status = db.Column(db.String(10), default="pending")
    note = db.Column(db.String(200), default="")
    handled_at = db.Column(db.String(32))

    reward = db.relationship("Reward", lazy="joined")
