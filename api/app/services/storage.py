"""录音文件落地。

浏览器录出来的是 webm（少数设备是 mp4/ogg），直接二进制写盘就够了，
不需要额外的对象存储。文件统一放在 DATA_DIR/uploads/recite 下按月份分目录，
库里只存「月份/文件名」，换台机器拷 DATA_DIR 就能整体搬家。
"""

from __future__ import annotations

import uuid
from pathlib import Path

from flask import current_app

RECITE_DIR = "uploads/recite"

# 后缀统一限定，避免上传方塞进来别的东西
SUFFIXES = {".webm", ".mp4", ".ogg", ".m4a", ".mp3", ".wav"}


def root_dir() -> Path:
    return Path(current_app.config["DATA_DIR"]) / RECITE_DIR


def save_recite(data: bytes, mime: str, month: str, suffix: str = ".webm") -> str:
    """写盘并返回相对路径（月份/文件名）。"""
    if suffix not in SUFFIXES:
        suffix = ".webm"
    folder = root_dir() / month
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{suffix}"
    (folder / name).write_bytes(data)
    return f"{month}/{name}"


def resolve_recite(rel: str) -> Path | None:
    """把库里的相对路径还原成绝对路径，顺便挡掉 ../ 这类越权路径。"""
    if not rel or ".." in Path(rel).parts:
        return None
    target = root_dir() / rel
    if not target.is_file():
        return None
    return target


def delete_recite(rel: str) -> None:
    target = resolve_recite(rel)
    if target:
        try:
            target.unlink()
        except OSError:
            pass


def suffix_of(filename: str, mime: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix in SUFFIXES:
        return suffix
    if "mp4" in (mime or ""):
        return ".mp4"
    if "ogg" in (mime or ""):
        return ".ogg"
    if "mpeg" in (mime or "") or "mp3" in (mime or ""):
        return ".mp3"
    if "wav" in (mime or ""):
        return ".wav"
    return ".webm"
