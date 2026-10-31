from ..extensions import db
from .base import BaseModel


class AdminUser(BaseModel):
    __tablename__ = "admin_user"

    username = db.Column(db.String(40), unique=True, nullable=False)
    password_hash = db.Column(db.String(120), nullable=False)
    last_login_at = db.Column(db.String(32))


class Setting(BaseModel):
    __tablename__ = "setting"

    key = db.Column(db.String(60), unique=True, nullable=False)
    value = db.Column(db.Text, nullable=False, default="")


class AiCallLog(BaseModel):
    """大模型调用流水：只记时间、模型、输入提示词与双向 token。"""

    __tablename__ = "ai_call_log"

    model = db.Column(db.String(60), default="")
    prompt = db.Column(db.Text, default="")
    input_tokens = db.Column(db.Integer, default=0)
    output_tokens = db.Column(db.Integer, default=0)
    ok = db.Column(db.Boolean, default=True)
