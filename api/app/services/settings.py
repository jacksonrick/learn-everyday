import json

from ..extensions import db
from ..models import Setting

DEFAULTS = {
    # 每日题量：语文固定 认读 5 / 组词 5 / 古诗 1，英语固定 音标朗读 2 /
    # 音标选词 2 / 组句 1，这里只留真正需要家长调的项
    "english_word_read": 10,
    # 数学题量默认 20，与 taskgen 的兜底值和设置页提示保持一致
    "math_count": 20,
    "english_phoneme": True,
    "english_sentence": True,
    "daily_point_cap": 100,
    "instant_feedback": True,
    "srs_enabled": True,
    "audio_enabled": True,
    "point_per_subject": 10,
    "point_per_excellent": 5,
    "point_checkin": 20,
    "point_wrong_fix": 1,
    "point_wrong_fix_cap": 20,
    "streak_milestones": {"3": 10, "7": 30, "14": 60, "30": 150, "100": 500},
    # 大模型（当前仅 DeepSeek，兼容 OpenAI 协议）
    "ai_enabled": False,
    "ai_provider": "deepseek",
    "ai_base_url": "https://api.deepseek.com/v1",
    "ai_api_key": "",
    "ai_model": "deepseek-flash",
    "ai_temperature": 0.7,
    "ai_thinking": False,
}

SECRET_KEYS = ("ai_api_key",)

_cache = {}


def get_setting(key: str):
    if key in _cache:
        return _cache[key]
    row = Setting.query.filter_by(key=key).first()
    if row is None:
        return DEFAULTS.get(key)
    try:
        value = json.loads(row.value)
    except (TypeError, ValueError):
        value = row.value
    _cache[key] = value
    return value


def all_settings() -> dict:
    """只认 DEFAULTS 里声明过的键：早年删掉的配置（每日新字/新词等）即使
    还躺在 setting 表里也不再下发给前端，免得设置页冒出几个没用的输入框。"""
    data = dict(DEFAULTS)
    for row in Setting.query.all():
        if row.key not in DEFAULTS:
            continue
        try:
            data[row.key] = json.loads(row.value)
        except (TypeError, ValueError):
            data[row.key] = row.value
    return data


def set_setting(key: str, value):
    _cache.pop(key, None)
    row = Setting.query.filter_by(key=key).first()
    if row is None:
        row = Setting(key=key, value=json.dumps(value, ensure_ascii=False))
        db.session.add(row)
    else:
        row.value = json.dumps(value, ensure_ascii=False)
    db.session.commit()
    return value


def mask_secret(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    if len(value) <= 8:
        return "•" * len(value)
    return f"{value[:4]}{'•' * 8}{value[-4:]}"


def public_settings() -> dict:
    """给前端的配置：密钥一律脱敏，只告诉前端「是否已配置」。"""
    data = all_settings()
    for key in SECRET_KEYS:
        raw = str(data.pop(key, "") or "")
        data[f"{key}_set"] = bool(raw)
        data[f"{key}_masked"] = mask_secret(raw)
    return data
