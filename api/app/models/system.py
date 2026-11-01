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


class TtsCallLog(BaseModel):
    """语音合成调用流水：只记时间、文本、字数与音频时长，供「调用详情」展示。"""

    __tablename__ = "tts_call_log"

    text = db.Column(db.Text, default="")
    char_count = db.Column(db.Integer, default=0)
    duration_ms = db.Column(db.Integer, default=0)
    ok = db.Column(db.Boolean, default=True)
    message = db.Column(db.String(200), default="")
