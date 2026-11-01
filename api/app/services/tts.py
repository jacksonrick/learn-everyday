"""语音合成：火山引擎豆包语音合成（HTTP 一次性合成 V1 接口）。

浏览器 speechSynthesis 效果不好，家长可以在后台切到 API 模式。这里只做
「一次性输入文本 → 一次性拿回整段 mp3」：相同文本（含音色/语速）直接读本地
缓存文件，不再调用远端，节省费用；超过 200 字截断只读前 200 字。

接口约定（https://openspeech.bytedance.com/api/v1/tts）：
- 鉴权头是「Bearer;token」，Bearer 和 token 之间是分号；
- 成功响应 code == 3000，音频在 data 字段（base64），时长在 addition.duration（ms）。
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from flask import current_app

from ..extensions import db
from ..models import TtsCallLog
from .settings import get_setting

API_URL = "https://openspeech.bytedance.com/api/v1/tts"
DEFAULT_VOICE_ZH = "zh_female_cancan_mars_bigtts"
DEFAULT_VOICE_EN = "en_female_amanda_mars_bigtts"
MAX_CHARS = 200

# 缓存文件名：32 位十六进制 + .mp3，统一放在 uploads/tts/ 下不再分年月
_FILE_RE = re.compile(r"^[0-9a-f]{32}\.mp3$")

_VOICES = {"zh": ("tts_voice_zh", DEFAULT_VOICE_ZH), "en": ("tts_voice_en", DEFAULT_VOICE_EN)}


class TTSError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def cache_dir() -> Path:
    return Path(current_app.config["DATA_DIR"]) / "uploads" / "tts"


def resolve_audio(name: str) -> Path | None:
    """把客户端传来的文件名还原成缓存文件绝对路径，挡掉路径穿越。"""
    if not _FILE_RE.match(name or ""):
        return None
    target = cache_dir() / name
    return target if target.is_file() else None


def configured() -> bool:
    return bool(
        (get_setting("tts_app_id") or "").strip()
        and (get_setting("tts_access_token") or "").strip()
    )


def synthesize(text: str, lang: str = "zh", speed: float = 1.0) -> dict:
    """合成语音并落盘缓存，返回 {url, cached, duration_ms}。

    缓存键 = 音色 + 语速 + 文本；同一份文本重复播放不会产生新的 API 调用。
    """
    text = (text or "").strip()[:MAX_CHARS]
    if not text:
        raise TTSError("没有可合成的文本")

    app_id = (get_setting("tts_app_id") or "").strip()
    token = (get_setting("tts_access_token") or "").strip()
    if not app_id or not token:
        raise TTSError("还没有配置豆包语音的 AppID / Access Token，请先到「系统设置 → 语音配置」填写")

    key = _VOICES.get(lang, _VOICES["zh"])
    voice = (get_setting(key[0]) or key[1]).strip()
    try:
        speed = round(min(max(float(speed or 1.0), 0.1), 2.0), 2)
    except (TypeError, ValueError):
        speed = 1.0

    digest = hashlib.md5(f"{voice}|{speed}|{text}".encode("utf-8")).hexdigest()
    filename = f"{digest}.mp3"
    path = cache_dir() / filename

    if path.exists() and path.stat().st_size > 0:
        return {"url": f"/api/v1/client/tts/audio/{filename}", "cached": True, "duration_ms": 0}

    body = {
        "app": {"appid": app_id, "token": "access_token", "cluster": (get_setting("tts_cluster") or "volcano_tts").strip()},
        "user": {"uid": "learneveryday"},
        "audio": {"voice_type": voice, "encoding": "mp3", "speed_ratio": speed},
        "request": {"reqid": uuid.uuid4().hex, "text": text, "operation": "query"},
    }
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer;{token}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = ""
        try:
            raw = exc.read().decode("utf-8")
        except Exception:  # noqa: BLE001
            pass
        message = _remote_message(exc.code, raw)
        _log_call(text, 0, ok=False, message=message)
        raise TTSError(message) from exc
    except urllib.error.URLError as exc:
        _log_call(text, 0, ok=False, message=f"网络异常：{exc.reason}")
        raise TTSError(f"连不上语音合成服务：{exc.reason}") from exc
    except TimeoutError as exc:
        _log_call(text, 0, ok=False, message="语音合成响应超时")
        raise TTSError("语音合成响应超时，请稍后再试") from exc

    # 业务错误也是 HTTP 200，靠 code 字段区分（3000 才是成功）
    if payload.get("code") != 3000:
        message = f"语音合成失败（{payload.get('code')}）：{payload.get('message') or '未知错误'}"
        _log_call(text, 0, ok=False, message=message[:200])
        raise TTSError(message)

    try:
        audio = base64.b64decode(payload["data"])
        duration_ms = int((payload.get("addition") or {}).get("duration") or 0)
    except (KeyError, TypeError, ValueError) as exc:
        _log_call(text, 0, ok=False, message="响应里没有音频数据")
        raise TTSError("语音合成返回结构异常，没有拿到音频数据") from exc

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(audio)
    _log_call(text, duration_ms, ok=True)
    return {"url": f"/api/v1/client/tts/audio/{filename}", "cached": False, "duration_ms": duration_ms}


def _remote_message(code: int, raw: str) -> str:
    detail = ""
    try:
        detail = json.loads(raw).get("message", "")
    except Exception:  # noqa: BLE001
        detail = (raw or "")[:160]
    hints = {
        401: "鉴权失败，请检查 AppID 与 Access Token",
        403: "没有该音色的访问权限，需要在火山引擎控制台开通",
    }
    base = hints.get(code, f"语音合成接口返回 {code}")
    return f"{base}{('：' + detail) if detail else ''}"[:200]


def _log_call(text: str, duration_ms: int, ok: bool = True, message: str = ""):
    """记录一次调用，用于「调用详情」；任何异常都不影响主流程。"""
    try:
        db.session.add(
            TtsCallLog(
                text=text[:MAX_CHARS],
                char_count=len(text),
                duration_ms=int(duration_ms or 0),
                ok=bool(ok),
                message=(message or "")[:200],
            )
        )
        db.session.commit()
    except Exception:  # noqa: BLE001
        db.session.rollback()
