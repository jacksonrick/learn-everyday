import json

from ..extensions import db
from ..models import Setting

DEFAULTS = {
    # —— 每日任务量：按科目分别配置，0 表示当天不出该题型 ——
    # 语文
    "chinese_read": 5,  # 认读字数（认读卡，不计分）
    "chinese_word": 5,  # 补全词语题数
    "chinese_pinyin": 3,  # 看拼音选字（判分）
    "chinese_poem": 1,  # 古诗背诵首数（不计分）
    # 数学
    "math_calc": 15,  # 计算题（按出题规则现算）
    "math_app": 2,  # 应用题（从同年级学期题库抽取）
    # 英语
    "english_word_read": 10,  # 单词朗读（朗读卡，不计分）
    "english_phoneme_read": 2,  # 音标朗读（不计分）
    "english_phoneme_pick": 2,  # 音标选词
    "english_word_choice": 2,  # 看中文选英文
    "english_meaning_choice": 2,  # 看英文选中文
    "english_sentence_count": 1,  # 单词组句
    # 其它
    "retry_count": 2,  # 每天插在最前面的错题重练条数
    "redeem_interval_days": 0,  # 兑换间隔（天）：距上次兑换成功需隔几天才能再兑，0 不限制
    "client_time_start": "",  # 客户端可用时间段开始（HH:MM），与结束同时填写才生效
    "client_time_end": "",  # 客户端可用时间段结束（HH:MM）；留空 = 全天可用
    "instant_feedback": True,
    "srs_enabled": True,
    # 复习积压闸门：某科到期没复习的条目超过这个数，当天新内容自动让位给复习；
    # 达到两倍时新内容压到「每天至少保留」的条数。0 表示不让位（不推荐）。
    "srs_backlog_threshold": 20,
    "srs_new_floor": 2,
    "point_per_subject": 10,
    "point_per_excellent": 5,
    "point_checkin": 20,
    "point_wrong_fix": 2,
    # 连续完整打卡奖励：每连续打满 N 天，第 N 天打卡入账时额外加 M 分；N 填 0 关闭
    "streak_bonus_days": 7,
    "streak_bonus_points": 100,
    # 大模型（当前仅 DeepSeek，兼容 OpenAI 协议）：配好参数即可用，没有单独开关
    "ai_provider": "deepseek",
    "ai_base_url": "https://api.deepseek.com/v1",
    "ai_api_key": "",
    "ai_model": "deepseek-flash",
    "ai_temperature": 0.7,
    "ai_thinking": False,
    # 语音配置：browser=浏览器 speechSynthesis，api=火山引擎豆包语音合成（HTTP 一次性合成 V1）
    "voice_mode": "browser",
    "tts_app_id": "",
    "tts_access_token": "",
    "tts_cluster": "volcano_tts",
    "tts_voice_zh": "zh_female_cancan_mars_bigtts",
    "tts_voice_en": "en_female_amanda_mars_bigtts",
}

SECRET_KEYS = ("ai_api_key", "tts_access_token")

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
