"""内置题库导入：把随仓库分发的数据包一次性写入数据库。

数据文件位于 ``app/seed/data/``：

- ``chars_primary.json``：小学常用汉字 2176 个，带拼音、部首、笔画、结构、组词
- ``poems_primary.json``：统编版小学语文课内古诗词 112 首

语文、英语题库不关联年级学期（只有数学按年级学期出题），所以数据包里的
年级/学期字段不再入库；但数据包里的 ``grade`` 会折算成**难度等级**写进 level：

    1、2 年级 → 容易，3 年级 → 较易，4 年级 → 中等，5 年级 → 较难，6 年级 → 困难

出题时按 10% / 40% / 30% / 15% / 5% 的等级比例抽题（见 ``services/level.py``）。

两个数据包都由 ``scripts/`` 下的构建脚本从开放数据生成，详见各脚本头部说明。
导入是幂等的：以汉字、古诗标题为唯一键，已存在的跳过，不会覆盖家长改过的内容。
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from ..extensions import db
from ..models import ChineseChar, Poem
from . import level as level_svc

DATA_DIR = Path(__file__).resolve().parent.parent / "seed" / "data"

CHARS_FILE = "chars_primary.json"
POEMS_FILE = "poems_primary.json"


@lru_cache(maxsize=4)
def load(name: str) -> dict:
    """读取数据包（首次调用后缓存，导入 2000 条不必重复解析）。"""
    path = DATA_DIR / name
    if not path.exists():
        raise FileNotFoundError(f"缺少内置数据文件：{path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _existing_chars() -> set[str]:
    return {row[0] for row in db.session.query(ChineseChar.char).all()}


def _existing_titles() -> set[str]:
    return {row[0] for row in db.session.query(Poem.title).all()}


def _level_counts(items) -> dict:
    """数据包按 grade 折算后的等级分布，后台导入前先让家长看一眼。"""
    counts = {}
    for item in items:
        lv = level_svc.from_grade(item.get("grade"))
        counts[lv] = counts.get(lv, 0) + 1
    return {lv: counts.get(lv, 0) for lv in level_svc.LEVELS}


def preview() -> dict:
    """内置题库概况，用于后台展示「可导入多少条」。"""
    chars = load(CHARS_FILE)["items"]
    poems = load(POEMS_FILE)["items"]
    have_chars = _existing_chars()
    have_titles = _existing_titles()
    return {
        "chars": {
            "total": len(chars),
            "available": sum(1 for c in chars if c["char"] not in have_chars),
            "existing": ChineseChar.query.count(),
            "levels": _level_counts(chars),
        },
        "poems": {
            "total": len(poems),
            "available": sum(1 for p in poems if p["title"] not in have_titles),
            "existing": Poem.query.count(),
            "levels": _level_counts(poems),
        },
    }


def import_chars() -> dict:
    """导入识字库。语文题库不关联年级学期，只写字形信息。"""
    items = load(CHARS_FILE)["items"]
    have = _existing_chars()
    added = skipped = 0
    rows = []
    # 列表按 created_at DESC, id DESC 展示；同一批插入时间相同，倒序写入后
    # id DESC 正好回到「一年级 -> 六年级、课内顺序」，而不是一打开就是六年级的字
    for item in reversed(items):
        if item["char"] in have:
            skipped += 1
            continue
        have.add(item["char"])
        rows.append(ChineseChar(
            char=item["char"],
            pinyin=item.get("pinyin", ""),
            radical=item.get("radical", ""),
            strokes=int(item.get("strokes") or 0),
            structure=item.get("structure", ""),
            words_json=json.dumps(item.get("words") or [], ensure_ascii=False),
            sentence="",
            is_key=False,
            # 数据包里的 grade 是教材年级，折算成 5 档难度
            level=level_svc.from_grade(item.get("grade")),
            audio_url="",
        ))
        added += 1
    if rows:
        db.session.add_all(rows)
        db.session.commit()
    return {"created": added, "skipped": skipped, "total": len(items)}


def import_poems() -> dict:
    """导入古诗库。语文题库不关联年级学期，按教材顺序写入即可。"""
    items = load(POEMS_FILE)["items"]
    have = _existing_titles()
    added = skipped = 0
    rows = []
    for item in reversed(items):  # 同上，倒序写入保证按教材顺序展示
        title = (item.get("title") or "").strip()
        if not title or title in have:
            skipped += 1
            continue
        have.add(title)
        rows.append(Poem(
            title=title,
            author=item.get("author", ""),
            dynasty=item.get("dynasty", ""),
            genre=item.get("genre", "诗"),
            content=item.get("content", ""),
            pinyin_json="[]",
            translation="",
            notes="",
            appreciation="",
            level=level_svc.from_grade(item.get("grade")),
            audio_url="",
        ))
        added += 1
    if rows:
        db.session.add_all(rows)
        db.session.commit()
    return {"created": added, "skipped": skipped, "total": len(items)}
