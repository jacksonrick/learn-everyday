"""构建内置识字库数据包。

从开放数据生成 ``app/seed/data/chars_primary.json``，供「一键导入」使用。
脚本只在开发期跑，产物已提交到仓库，正常使用项目时无需联网。

数据来源（均可公开获取）：
- 汉字表与年级：烙馍网小学常用汉字生字表（按一至六年级归类）
- 拼音 / 笔画 / 部首：Unicode 官方 Unihan 数据库（kMandarin / kTotalStrokes / kRSUnicode）
- 结构：CJKVI IDS 数据库（汉字构形分解，⿰ 左右、⿱ 上下、⿴ 全包围…）
- 组词：统编版教材词语表 + 12 册课文语料优先，CC-CEDICT 兜底

用法::

    cd api
    python scripts/build_chars.py                # 自动下载缺失的原始数据
    python scripts/build_chars.py --raw-dir /tmp/bank-raw
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "app" / "seed" / "data"

# 原始数据：文件名 -> 下载地址（GitHub 直连不稳定，走 ghproxy 镜像）
SOURCES = {
    "scb.html": "https://ghproxy.net/https://raw.githubusercontent.com/luomor-web/zt/main/scb.html",
    "Unihan.zip": "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip",
    "ids.txt": "https://ghproxy.net/https://raw.githubusercontent.com/cjkvi/cjkvi-ids/master/ids.txt",
    "cedict.zip": "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.zip",
    "textbook_words.json": "https://ghproxy.net/https://raw.githubusercontent.com/7jul/yuwen_words/main/%E5%B0%8F%E5%AD%A6%E7%BB%9F%E7%BC%96%E8%AF%AD%E6%96%87%E6%95%99%E6%9D%90%E8%AF%8D%E8%AF%AD%E8%A1%A8.json",
}
TEXTBOOK_VOLUMES = [f"{g}年级{t}" for g in "一二三四五六" for t in ("上册", "下册")]
TEXTBOOK_URL = "https://ghproxy.net/https://raw.githubusercontent.com/7jul/yuwen_text/main/{}.json"

# 释义里出现这些词的多为专名、音译或异体字，不适合当组词
NOISE_DEFS = ("surname ", "place name", "abbr.", "variant of", "old variant",
              "transliteration", "used in ", "see also")
# 纯笔画字，IDS 能拆但小学按独体字教
STROKE_CHARS = set("一丨丿丶乙亅乚乛十丁厂匚刂")

# 康熙部首里的繁体形，归一到简体后才能和本字比较
RADICAL_SIMP = {
    "馬": "马", "鳥": "鸟", "魚": "鱼", "門": "门", "車": "车", "貝": "贝", "見": "见",
    "頁": "页", "風": "风", "飛": "飞", "長": "长", "韋": "韦", "齒": "齿", "龜": "龟",
    "龍": "龙", "黽": "黾", "鹵": "卤", "麥": "麦", "黃": "黄", "齊": "齐", "斉": "齐",
    # 生僻的楷书部首写法，换成课本上的偏旁形
    "艸": "艹", "辵": "辶", "攴": "攵",
}

# 不是部首、但小学归为独体字的指事/象形字
SOLO_CHARS = set(
    "天夫末本未禾米年更事求重平中上下内乃九了力刀又卜入八儿几干于才寸丈与万丸久"
    "之已己巳弓也飞乡义半头必永民书肃秉生失曲州羊亚亦亡亢交亨享京亭亮"
    "四五六七百万西南习叉太尤"
)


def download(raw: Path) -> None:
    raw.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        target = raw / name
        if target.exists() and target.stat().st_size > 1024:
            continue
        print(f"  下载 {name} …")
        req = urllib.request.Request(url, headers={"User-Agent": "LearnEveryday/1.0"})
        with urllib.request.urlopen(req, timeout=120) as resp, target.open("wb") as fh:
            fh.write(resp.read())
            print(f"    {target.stat().st_size / 1024:.0f} KB")
    for vol in TEXTBOOK_VOLUMES:
        target = raw / "textbook" / f"{vol}.json"
        if target.exists() and target.stat().st_size > 512:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        url = TEXTBOOK_URL.format(urllib.parse.quote(f"{vol}.json"))
        print(f"  下载课文 {vol} …")
        req = urllib.request.Request(url, headers={"User-Agent": "LearnEveryday/1.0"})
        with urllib.request.urlopen(req, timeout=120) as resp, target.open("wb") as fh:
            fh.write(resp.read())


def unzip_to(zip_path: Path, names: list[str], out_dir: Path) -> None:
    import zipfile

    with zipfile.ZipFile(zip_path) as zf:
        for name in names:
            if not (out_dir / name).exists():
                zf.extract(name, out_dir)


def load_char_table(raw: Path) -> dict[int, list[str]]:
    """生字表：一年级是静态 HTML，其余年级在 JS 变量里。"""
    html = (raw / "scb.html").read_text(encoding="utf-8")
    table: dict[int, list[str]] = {}

    start = html.find('grade-section grade-1')
    end = html.find('grade-section grade-2')
    if start > 0 and end > start:
        items = re.findall(r'<div class="char-item"[^>]*>([^<]+)</div>', html[start:end])
        table[1] = [c.strip() for c in items if len(c.strip()) == 1]

    for m in re.finditer(r'const\s+grade(\d)Chars\s*=\s*"([^"]+)"', html):
        table[int(m.group(1))] = [c.strip() for c in m.group(2).split("、") if len(c.strip()) == 1]
    return dict(sorted(table.items()))


def load_unihan(raw: Path) -> dict[str, dict]:
    props: dict[str, dict] = {}
    for fname, keys in (
        ("Unihan_Readings.txt", {"kMandarin"}),
        ("Unihan_IRGSources.txt", {"kTotalStrokes", "kRSUnicode"}),
    ):
        path = raw / "unihan" / fname
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) != 3:
                continue
            cp, key, value = parts
            if key in keys:
                props.setdefault(cp, {})[key] = value
    return props


def radical_char(code: str) -> str:
    """部首编号 1-214 映射成可展示的汉字。

    Kangxi Radicals 区块（U+2F00 起）是部首专用码位，NFKC 归一后即为对应汉字，
    例如 U+2F55「⽕」-> 「火」。展示和「部首就是本字」的判断都要用归一后的结果。
    """
    try:
        rad = unicodedata.normalize("NFKC", chr(0x2F00 + int(code) - 1))
    except (ValueError, OverflowError):
        return ""
    return RADICAL_SIMP.get(rad, rad)


def load_ids(raw: Path) -> dict[str, str]:
    ids: dict[str, str] = {}
    for line in (raw / "ids.txt").read_text(encoding="utf-8").splitlines():
        if line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) >= 3 and parts[0].startswith("U+"):
            ids[parts[0]] = parts[2]
    return ids


def _leaves(expr: str, ids: dict[str, str], depth: int = 0) -> set[str]:
    """递归取构形分解的末级部件。"""
    if depth > 6 or not expr:
        return set()
    head = expr[0]
    if head in "⿰⿱⿴⿵⿶⿷⿸⿹⿺⿻⿼⿽":
        out: set[str] = set()
        for part in expr[1:]:
            sub = ids.get(f"U+{ord(part):04X}", part)
            out |= _leaves(sub, ids, depth + 1) if sub != part else {part}
        return out
    return {expr}


def structure_of(ch: str, ids: dict[str, str], radical: str = "", strokes: int = 0) -> str:
    # 214 个部首字本身都是独体字（火、水、木、日…），IDS 会把它拆成部件，
    # 直接按「部首就是本字」判定，避免出现「火是上下结构」这种明显错误
    if radical and radical == ch:
        return "独体"
    if ch in SOLO_CHARS:
        return "独体"
    expr = ids.get(f"U+{ord(ch):04X}")
    if not expr or expr == ch:
        return "独体"
    head = expr[0]
    if head in "⿰⿲":
        kind = "左右"
    elif head in "⿱⿳":
        kind = "上下"
    elif head == "⿴":
        kind = "全包围"
    elif head in "⿵⿶⿷⿸⿹⿺":
        kind = "半包围"
    elif head == "⿻":
        kind = "上下"
    else:
        return "独体"
    # 「二」「三」「王」这类能拆成纯笔画的字，小学按独体字教
    if _leaves(expr, ids) <= STROKE_CHARS:
        return "独体"
    # 4 画以内没有真正的上下 / 全包围结构字（少、云、公、个、叉…），
    # IDS 不过是把笔画拼起来，小学一律按独体字认
    if strokes and strokes <= 4 and kind in ("上下", "全包围"):
        return "独体"
    return kind


def load_cedict(raw: Path) -> dict[str, list[tuple[str, str]]]:
    """CC-CEDICT：按单字建立 2-3 字词的倒排索引。"""
    index: dict[str, list[tuple[str, str]]] = {}
    pattern = re.compile(r"^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+/(.+)/$")
    for line in (raw / "cedict_ts.u8").read_text(encoding="utf-8").splitlines():
        if line.startswith("#"):
            continue
        m = pattern.match(line)
        if not m:
            continue
        simp, defs = m.group(2), m.group(4)
        if not (2 <= len(simp) <= 3):
            continue
        low = defs.lower()
        if any(bad in low for bad in NOISE_DEFS):
            continue
        # 释义只有一个首字母大写的英文词（Japan / Wang Wei），多为国名、人名
        if re.fullmatch(r"[A-Z][A-Za-z'\- ]*", defs.strip()):
            continue
        # 「吃的」「看了」这类以虚词收尾的组合不是词
        if simp[-1] in "的了着过地得是吗呢吧啊呀":
            continue
        for ch in set(simp):
            index.setdefault(ch, []).append((simp, defs))
    return index


def load_textbook(raw: Path) -> tuple[list[str], str]:
    """教材词语表 + 12 册课文正文（课文用于给组词排优先级）。"""
    words: list[str] = []
    word_path = raw / "textbook_words.json"
    if word_path.exists():
        data = json.loads(word_path.read_text(encoding="utf-8"))
        for vol_words in data.values():
            words += [w for w in vol_words if isinstance(w, str)]

    corpus: list[str] = []
    for vol in TEXTBOOK_VOLUMES:
        path = raw / "textbook" / f"{vol}.json"
        if not path.exists():
            continue
        for item in json.loads(path.read_text(encoding="utf-8")):
            corpus.append(str(item.get("content", "")))
    return words, "\n".join(corpus)


def build(raw: Path) -> dict:
    table = load_char_table(raw)
    props = load_unihan(raw)
    ids = load_ids(raw)
    cedict = load_cedict(raw)
    textbook_words, corpus = load_textbook(raw)

    textbook_set = {w for w in textbook_words if 2 <= len(w) <= 4}
    # 语料里出现的 2-3 字片段及次数，用于判断一个词是否「教材里出现过」
    freq: Counter[str] = Counter()
    for chunk in re.split(r"[^\u4e00-\u9fff]+", corpus):
        for size in (2, 3):
            for i in range(len(chunk) - size + 1):
                freq[chunk[i:i + size]] += 1
    corpus_chars = {c for c in corpus if "\u4e00" <= c <= "\u9fff"}
    common_chars = corpus_chars | {c for v in table.values() for c in v}

    def pick_words(ch: str) -> list[str]:
        scored: list[tuple[float, str]] = []
        seen: set[str] = set()
        for word, _defs in cedict.get(ch, []):
            if word in seen or not set(word) <= common_chars:
                continue
            seen.add(word)
            score = 0.0
            if word in textbook_set:
                score += 200
            hits = freq.get(word, 0)
            if hits:
                score += 100 + min(hits, 20) * 5
            score += 30 if len(word) == 2 else 10
            if word[0] == ch:
                score += 8  # 该字打头的词更像「组词」示例
            if score:
                scored.append((score, word))
        # 教材词语表里漏在 CEDICT 之外的词也补上
        for word in textbook_set:
            if ch in word and word not in seen and set(word) <= common_chars:
                seen.add(word)
                scored.append((200.0, word))
        scored.sort(key=lambda x: (-x[0], len(x[1]), x[1]))
        picked: list[str] = []
        for _score, word in scored:
            if word in picked:
                continue
            # 避免选出「霜霜」这种同字重复或互相包含的词
            if any(word in p or p in word for p in picked):
                continue
            picked.append(word)
            if len(picked) == 3:
                break
        return picked

    items = []
    seen_chars: set[str] = set()
    for grade, chars in table.items():
        for ch in chars:
            if ch in seen_chars:
                continue  # 同一字出现在多个年级时，归到最早年级
            seen_chars.add(ch)
            cp = f"U+{ord(ch):04X}"
            prop = props.get(cp, {})
            rs = (prop.get("kRSUnicode") or "").split()
            strokes = (prop.get("kTotalStrokes") or "").split()
            items.append({
                "char": ch,
                "pinyin": prop.get("kMandarin", ""),
                "radical": radical_char(re.sub(r"[^0-9]", "", rs[0].split(".")[0])) if rs else "",
                "strokes": int(strokes[0]) if strokes and strokes[0].isdigit() else 0,
                "structure": structure_of(
                    ch, ids,
                    radical_char(re.sub(r"[^0-9]", "", rs[0].split(".")[0])) if rs else "",
                    int(strokes[0]) if strokes and strokes[0].isdigit() else 0,
                ),
                "words": pick_words(ch),
                "grade": grade,
            })

    missing = [it["char"] for it in items if not it["pinyin"] or not it["strokes"]]
    if missing:
        print(f"  ! {len(missing)} 个字缺拼音或笔画：{''.join(missing[:20])}")
    no_words = [it["char"] for it in items if not it["words"]]
    if no_words:
        print(f"  ! {len(no_words)} 个字没找到组词：{''.join(no_words[:20])}")

    return {
        "meta": {
            "name": "小学识字库（统编版常用字）",
            "count": len(items),
            "source": "烙馍网小学常用汉字生字表 + Unihan + CJKVI IDS + 统编教材词语表 + CC-CEDICT",
        },
        "items": items,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="构建内置识字库数据包")
    parser.add_argument("--raw-dir", default="/tmp/bank-raw", help="原始数据缓存目录")
    parser.add_argument("--no-download", action="store_true", help="只用本地缓存，不联网")
    args = parser.parse_args()

    raw = Path(args.raw_dir)
    if not args.no_download:
        print("准备原始数据 …")
        download(raw)
        unzip_to(raw / "Unihan.zip", ["Unihan_Readings.txt", "Unihan_IRGSources.txt"], raw / "unihan")
        unzip_to(raw / "cedict.zip", ["cedict_ts.u8"], raw)

    if not (raw / "unihan" / "Unihan_Readings.txt").exists():
        print("缺少 Unihan 数据，请先运行不带 --no-download 的命令", file=sys.stderr)
        return 1

    print("生成识字库 …")
    data = build(raw)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    target = OUT_DIR / "chars_primary.json"
    target.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")

    total = len(data["items"])
    with_words = sum(1 for it in data["items"] if it["words"])
    print(f"完成：{total} 字，其中 {with_words} 字带组词 -> {target}")
    print(f"  文件大小 {target.stat().st_size / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
