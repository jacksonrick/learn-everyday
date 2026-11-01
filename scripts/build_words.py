"""生成 ·api/app/seed/data/words_primary.json·（小学英语 1-6 年级词汇数据包）。

数据来自人教 PEP（三年级起点）与人教新起点（一年级起点）教材词汇，按年级整理为
``scripts/words/g1.py`` … ``g6.py``，每个文件一个年级，改哪个年级就看哪个文件。

用法：

    python scripts/build_words.py

脚本会做这些校验，任何一条不通过就报错退出（数据包进仓库前先自检）：

- 单词不能重复（忽略大小写，与后台新增的唯一性校验一致）
- 音标必须用斜杠包裹
- 词性必须在后台下拉的取值范围内
- 释义、例句、例句翻译不能为空

输出格式与 ``poems_primary.json`` 一致：``meta`` + ``items``，items 里保留 ``grade``，
导入时由 ``level.from_grade()`` 折算成难度等级。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "api" / "app" / "seed" / "data"
OUT_FILE = DATA_DIR / "words_primary.json"

sys.path.insert(0, str(Path(__file__).resolve().parent / "words"))

import g1  # noqa: E402
import g2  # noqa: E402
import g3  # noqa: E402
import g4  # noqa: E402
import g5  # noqa: E402
import g6  # noqa: E402

GRADE_WORDS = {1: g1.WORDS, 2: g2.WORDS, 3: g3.WORDS, 4: g4.WORDS, 5: g5.WORDS, 6: g6.WORDS}

POS_ALLOWED = {"n.", "v.", "adj.", "adv.", "pron.", "prep.", "conj.", "num.", "art.", "int.", "phr."}

META = {
    "name": "人教 PEP / 新起点小学英语词汇",
    "count": 0,  # 生成时回填
    "source": "人民教育出版社 PEP（三年级起点）与新起点（一年级起点）教材 1-6 年级词汇",
}


def main() -> int:
    items: list[dict] = []
    seen: dict[str, int] = {}
    errors: list[str] = []
    dupes: list[str] = []

    for grade in sorted(GRADE_WORDS):
        for row in GRADE_WORDS[grade]:
            if len(row) != 6:
                errors.append(f"g{grade} 元组字段数不是 6：{row}")
                continue
            word, phonetic, pos, meaning, example, example_cn = row
            word = word.strip()
            key = word.lower()
            if key in seen:
                dupes.append(f"{word}（{seen[key]} 年级已有）")
                continue
            if not phonetic.startswith("/") or not phonetic.endswith("/") or len(phonetic) < 3:
                errors.append(f"{word} 音标没用斜杠包裹：{phonetic}")
            if pos not in POS_ALLOWED:
                errors.append(f"{word} 词性不在允许范围：{pos}")
            if not meaning.strip() or not example.strip() or not example_cn.strip():
                errors.append(f"{word} 释义 / 例句 / 翻译有空值")
            seen[key] = grade
            items.append(
                {
                    "grade": grade,
                    "word": word,
                    "phonetic": phonetic,
                    "pos": pos,
                    "meaning": meaning,
                    "example": example,
                    "example_cn": example_cn,
                }
            )

    if errors:
        print("数据校验失败：")
        for e in errors:
            print("  -", e)
        return 1

    if dupes:
        print(f"跳过多年级重复出现的词 {len(dupes)} 条（保留最先出现的年级）：")
        print("  " + "、".join(dupes))

    meta = dict(META, count=len(items))
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(
        json.dumps({"meta": meta, "items": items}, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )

    by_grade = {}
    for item in items:
        by_grade[item["grade"]] = by_grade.get(item["grade"], 0) + 1
    print(f"已生成 {OUT_FILE.relative_to(ROOT)}：{len(items)} 个单词")
    print("  " + "  ".join(f"{g} 年级 {n}" for g, n in sorted(by_grade.items())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
