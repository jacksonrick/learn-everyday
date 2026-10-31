"""大模型服务（当前支持 DeepSeek，兼容 OpenAI Chat Completions 协议）。

所有调用都走 JSON 模式，返回结构化 dict，供题库编辑页直接回填。
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Any

from ..extensions import db
from . import level as level_svc, mathgen
from .settings import get_setting

PROVIDERS = {
    "deepseek": {
        "label": "DeepSeek",
        "base_url": "https://api.deepseek.com/v1",
        "model": "deepseek-flash",
    },
}


class AIError(Exception):
    def __init__(self, message: str, code: str = "AI_ERROR"):
        super().__init__(message)
        self.message = message
        self.code = code


def _bool(value) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on", "是")
    return bool(value)


def config() -> dict:
    provider = get_setting("ai_provider") or "deepseek"
    preset = PROVIDERS.get(provider, PROVIDERS["deepseek"])
    return {
        "enabled": _bool(get_setting("ai_enabled")),
        "provider": provider,
        "base_url": (get_setting("ai_base_url") or preset["base_url"]).strip().rstrip("/"),
        "api_key": (get_setting("ai_api_key") or "").strip(),
        "model": (get_setting("ai_model") or preset["model"]).strip(),
        "temperature": float(get_setting("ai_temperature") or 0.7),
        # DeepSeek 默认开启思考，这里按开关显式下发 enabled / disabled
        "thinking": _bool(get_setting("ai_thinking")),
    }


def status() -> dict:
    cfg = config()
    return {
        "enabled": cfg["enabled"],
        "provider": cfg["provider"],
        "provider_label": PROVIDERS.get(cfg["provider"], {}).get("label", cfg["provider"]),
        "base_url": cfg["base_url"],
        "model": cfg["model"],
        "configured": bool(cfg["api_key"]),
        "thinking": cfg["thinking"],
    }


def _endpoint(base_url: str) -> str:
    if base_url.endswith("/chat/completions"):
        return base_url
    return f"{base_url}/chat/completions"


def _extract_json(text: str) -> Any:
    text = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*(.+?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        pass
    for opener, closer in (("{", "}"), ("[", "]")):
        start, end = text.find(opener), text.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except (TypeError, ValueError):
                continue
    raise AIError("模型返回的内容不是合法 JSON，请重试", "AI_BAD_JSON")


def chat_json(system: str, user: str, max_tokens: int = 2000) -> Any:
    cfg = config()
    if not cfg["api_key"]:
        raise AIError("还没有配置大模型 API Key，请先到「系统设置 → AI 智能助手」填写", "AI_NOT_CONFIGURED")

    body = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": cfg["temperature"],
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    if cfg["provider"] == "deepseek":
        body["thinking"] = {"type": "enabled" if cfg["thinking"] else "disabled"}
    req = urllib.request.Request(
        _endpoint(cfg["base_url"]),
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {cfg['api_key']}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = ""
        try:
            raw = exc.read().decode("utf-8")
        except Exception:  # noqa: BLE001
            pass
        _log_call(cfg["model"], user, None, ok=False)
        message = _http_message(exc.code, raw)
        raise AIError(message, "AI_HTTP_ERROR") from exc
    except urllib.error.URLError as exc:
        _log_call(cfg["model"], user, None, ok=False)
        raise AIError(f"连不上大模型服务：{exc.reason}", "AI_NETWORK_ERROR") from exc
    except TimeoutError as exc:
        _log_call(cfg["model"], user, None, ok=False)
        raise AIError("大模型响应超时，请稍后重试或减少生成数量", "AI_TIMEOUT") from exc

    _log_call(cfg["model"], user, payload.get("usage"), ok=True)
    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise AIError("大模型返回结构异常，请检查 API 地址与模型名", "AI_BAD_RESPONSE") from exc
    return _extract_json(content)


def _log_call(model: str, prompt: str, usage, ok: bool = True):
    """记录一次调用，用于「调用详情」；任何异常都不影响主流程。"""
    from ..models import AiCallLog

    usage = usage or {}
    try:
        db.session.add(
            AiCallLog(
                model=(model or "")[:60],
                prompt=(prompt or "")[:20000],
                input_tokens=int(usage.get("prompt_tokens") or 0),
                output_tokens=int(usage.get("completion_tokens") or 0),
                ok=bool(ok),
            )
        )
        db.session.commit()
    except Exception:  # noqa: BLE001
        db.session.rollback()


def _http_message(code: int, raw: str) -> str:
    detail = ""
    try:
        detail = json.loads(raw).get("error", {}).get("message", "")
    except Exception:  # noqa: BLE001
        detail = (raw or "")[:160]
    hints = {
        400: "请求参数有误",
        401: "API Key 无效或已失效",
        402: "账户余额不足",
        403: "没有访问该模型的权限",
        404: "API 地址或模型名不存在",
        422: "请求参数有误",
        429: "请求过于频繁，稍后再试",
        500: "大模型服务内部错误",
        503: "大模型服务繁忙，稍后再试",
    }
    base = hints.get(code, f"大模型接口返回 {code}")
    return f"{base}{('：' + detail) if detail else ''}"


def test_connection() -> dict:
    data = chat_json(
        "你是一个 JSON 接口。只输出 JSON，不要解释。",
        '请输出 {"ok": true, "echo": "连接成功"}，不要输出其它内容。',
        max_tokens=60,
    )
    return {"ok": bool(data.get("ok", True)), "reply": data}


# ------------------------------------------------------------------ 各题库的生成器

SYSTEM_PROMPT = (
    "你是一位资深的小学教研老师，熟悉《义务教育课程标准》和人教版教材，"
    "擅长为小学生准备识字、古诗、英语和数学练习材料。"
    "你只输出合法 JSON，不输出任何解释性文字、不使用 Markdown 代码块。"
    "内容必须适合小学生，用词准确、例句简短、不出现不适合儿童的内容。"
)

# 题库等级：5 档，按人教版教材年级折算难度，出题时按 10/40/30/15/5 取
_LEVEL_GUIDE = (
    "每条内容都要给出 level 字段，取值只能是：容易、较易、中等、较难、困难。"
    "按人教版教材的年级难度判断：容易≈一二年级、较易≈三年级、中等≈四年级、"
    "较难≈五年级、困难≈六年级。"
)


def _level_quota_line(count: int) -> str:
    """把这一批的等级配额写进提示词，让模型按 10/40/30/15/5 铺开。"""
    quotas = level_svc.allocate(count)
    detail = "、".join(f"{lv} {n} 条" for lv, n in quotas.items() if n)
    return f"这一批的 level 分布按：{detail}，尽量凑满。" if detail else ""


def _norm_level(value) -> str:
    return level_svc.normalize(value)


_KIND_LABEL = {
    "char": "识字",
    "poem": "古诗",
    "word": "英语单词",
    "sentence": "英语句子",
    "math_rule": "数学出题规则",
    "math_question": "数学应用题",
}


def _count(value, default: int = 5, maximum: int = 20) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = default
    return max(1, min(maximum, n))


def _grade_label(context: dict) -> str:
    grade = (context.get("grade_name") or "").strip()
    term = (context.get("term") or "").strip()
    if grade and term:
        return f"{grade}{term}学期"
    if grade:
        return grade
    return "小学"


def _join(values, limit: int = 80) -> str:
    if not values:
        return "（暂无）"
    cleaned = [str(v).strip() for v in values if str(v).strip()]
    return "、".join(cleaned[:limit])


def _extra_line(context: dict) -> str:
    """把家长填的「补充要求」拼进提示词。没有就返回空串，不占位置。"""
    text = str(context.get("requirement") or "").strip()
    if not text:
        return ""
    return (
        "\n家长的补充要求（在不违反下面 JSON 格式与条数要求的前提下优先满足）："
        f"{text[:300]}\n"
    )


def _norm_pos(value: str) -> str:
    raw = (value or "").strip()
    # 模型常给 "n./v." 这类多词性，下拉框只认单个缩写，统一取第一个
    if "/" in raw or "／" in raw:
        raw = re.split(r"[/／]", raw)[0].strip()
    mapping = {
        "n": "n.", "noun": "n.", "名词": "n.",
        "v": "v.", "verb": "v.", "动词": "v.",
        "adj": "adj.", "adjective": "adj.", "形容词": "adj.",
        "adv": "adv.", "adverb": "adv.", "副词": "adv.",
        "pron": "pron.", "pronoun": "pron.", "代词": "pron.",
        "prep": "prep.", "preposition": "prep.", "介词": "prep.",
        "conj": "conj.", "conjunction": "conj.", "连词": "conj.",
        "num": "num.", "numeral": "num.", "数词": "num.",
        "art": "art.", "article": "art.", "冠词": "art.",
        "int": "int.", "interjection": "int.", "感叹词": "int.",
        "phr": "phr.", "phrase": "phr.", "短语": "phr.",
    }
    return mapping.get(raw.lower(), mapping.get(raw, raw[:12]))


def generate(kind: str, context: dict) -> list[dict]:
    """按题库类型生成数据，返回可直接落库的 dict 列表。"""
    context = context or {}
    grade = _grade_label(context)
    exclude = context.get("exclude") or []
    extra = _extra_line(context)
    if kind == "char":
        return [_gen_char(context, extra)]
    if kind == "poem":
        return _gen_poems(grade, _count(context.get("count"), 5), exclude, extra)
    if kind == "word":
        # 填了具体单词就是「补全」，没填才是批量生成
        if (context.get("word") or "").strip():
            return [_gen_word(context, extra)]
        return _gen_words(grade, _count(context.get("count"), 8), exclude, extra)
    if kind == "sentence":
        if (context.get("sentence") or "").strip():
            return [_gen_sentence(context, extra)]
        return _gen_sentences(grade, _count(context.get("count"), 5), exclude, extra)
    if kind == "math_rule":
        return _gen_math_rules(grade, context)
    if kind == "math_question":
        return _gen_math_questions(grade, _count(context.get("count"), 5), context, extra)
    raise AIError(f"不支持生成「{kind}」类型的数据", "AI_BAD_KIND")


# ---- 语文：识字

def _gen_char(context: dict, extra: str = "") -> dict:
    char = (context.get("char") or "").strip()
    if len(char) != 1:
        raise AIError("请先在「汉字」一栏填写一个汉字，再用 AI 补全", "AI_MISSING_CHAR")
    data = chat_json(
        SYSTEM_PROMPT,
        f"""给出汉字「{char}」的小学语文字形信息，用于孩子的识字卡。
{_LEVEL_GUIDE}
{extra}输出 JSON：
{{"pinyin":"带声调的拼音；多音字按常用读音，最多 2 个，用 / 分隔",
 "radical":"部首，1 个字",
 "strokes":笔画数整数,
 "structure":"结构，只能是：独体、上下、左右、左中右、上中下、半包围、全包围、品字",
 "words":["组词 3 个，每个 2 字","",""],
 "sentence":"用其中一个组词造的例句，不超过 25 字，孩子能听懂",
 "level":"这个字在教材里出现的年级对应的难度"}}
只输出这个 JSON。""",
        max_tokens=500,
    )
    if not isinstance(data, dict):
        raise AIError("模型返回格式异常，请重试", "AI_BAD_RESPONSE")
    words = data.get("words") or []
    if isinstance(words, str):
        words = [w for w in re.split(r"[,，、/]", words) if w.strip()]
    try:
        strokes = int(data.get("strokes") or 0)
    except (TypeError, ValueError):
        strokes = 0
    return {
        "char": char,
        "pinyin": str(data.get("pinyin") or "").strip()[:40],
        "radical": str(data.get("radical") or "").strip()[:8],
        "strokes": strokes,
        "structure": str(data.get("structure") or "").strip()[:10],
        "words_json": json.dumps([str(w).strip() for w in words if str(w).strip()][:6], ensure_ascii=False),
        "sentence": str(data.get("sentence") or "").strip()[:200],
        "level": _norm_level(data.get("level")),
    }


# ---- 语文：古诗

def _gen_poems(grade: str, count: int, exclude: list, extra: str = "") -> list[dict]:
    data = chat_json(
        SYSTEM_PROMPT,
        f"""请生成 {count} 首适合{grade}孩子诵读的中国古诗词（唐诗宋词为主，也可以是课标推荐篇目）。
{_LEVEL_GUIDE}
{_level_quota_line(count)}
{extra}要求：
1. 必须输出恰好 {count} 首，一首都不能少；各首标题互不相同。
2. 下面这些篇目库里已经有了，绝对不能再用（标题相同即视为重复）：{_join(exclude, 300)}
   如果想到的常见篇目都在上面，请改选其它篇目，不要重复输出，也不要只给几首。
3. 每首必须是完整原文，不得截断或改写；体裁只写「诗」或「词」。
4. 正文按句分行，用 \\n 分隔（如 "床前明月光，疑是地上霜。\\n举头望明月，低头思故乡。"）。
5. 译文用现代汉语，1-2 句话。
6. level 按这首诗在教材里出现的年级判断。
输出 JSON：
{{"items":[{{"title":"","author":"","dynasty":"唐/宋/…","genre":"诗",
  "content":"第一句，第二句。\\n第三句，第四句。","translation":"",
  "notes":"重点字词注释，1-3 条，用分号分隔","appreciation":"一句话赏析，30 字内","level":"容易"}}]}}
items 里必须有 {count} 个元素。只输出这个 JSON。""",
        max_tokens=max(3000, 400 * count),
    )
    items = data.get("items") if isinstance(data, dict) else data
    return _clean_poems(items, exclude)


def _clean_poems(items, exclude: list) -> list[dict]:
    if not isinstance(items, list):
        raise AIError("模型没有返回古诗列表，请重试", "AI_BAD_RESPONSE")
    seen = {str(t).strip() for t in exclude}
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        title = str(it.get("title") or "").strip()[:100]
        content = str(it.get("content") or "").strip()
        if not title or not content or title in seen:
            continue
        content = "\n".join(ln.strip() for ln in content.split("\n") if ln.strip())
        seen.add(title)
        out.append(
            {
                "title": title,
                "author": str(it.get("author") or "").strip()[:40],
                "dynasty": str(it.get("dynasty") or "").strip()[:20],
                "genre": str(it.get("genre") or "诗").strip()[:10],
                "content": content,
                "translation": str(it.get("translation") or "").strip(),
                "notes": str(it.get("notes") or "").strip(),
                "appreciation": str(it.get("appreciation") or "").strip(),
                "level": _norm_level(it.get("level")),
            }
        )
    return out


# ---- 英语：单词

def _clean_word(it: dict) -> dict | None:
    word = str(it.get("word") or "").strip()
    if not word:
        return None
    phonetic = str(it.get("phonetic") or "").strip()
    if phonetic and not phonetic.startswith("/"):
        phonetic = f"/{phonetic.strip('/')}/"
    kind = str(it.get("kind") or "单词").strip()
    return {
        "word": word[:60],
        "phonetic": phonetic[:80],
        "pos": _norm_pos(it.get("pos")),
        "meaning": str(it.get("meaning") or "").strip()[:120],
        "example": str(it.get("example") or "").strip()[:200],
        "example_cn": str(it.get("example_cn") or "").strip()[:200],
        "kind": "短语" if kind in ("短语", "phrase") else "单词",
        "level": _norm_level(it.get("level")),
    }


def _gen_word(context: dict, extra: str = "") -> dict:
    """按家长已经填好的单词，补全音标、词性、释义与例句。"""
    word = (context.get("word") or "").strip()
    if not word:
        raise AIError("请先在「单词」一栏填写一个单词，再用 AI 补全", "AI_MISSING_WORD")
    data = chat_json(
        SYSTEM_PROMPT,
        f"""给出英语单词「{word}」的小学英语单词卡信息，供孩子背单词使用。
{_LEVEL_GUIDE}
{extra}要求：
1. 音标用英式 IPA 并用斜杠包裹，例如 /ˈruːlə/。
2. 词性只填一个缩写：n. v. adj. adv. pron. prep. conj. num. art. int. phr.；
   如果有多个词性，选最常见的那一个。
3. 释义 2-8 个中文字，有多个义项时用分号分隔。
4. 例句不超过 8 个单词，必须包含「{word}」，并配中文翻译。
5. kind 只能是「单词」或「短语」；「{word}」是多词组成时填「短语」。
6. level 按这个词在教材里出现的年级判断。
输出 JSON：
{{"word":"{word}","phonetic":"/…/","pos":"n.","meaning":"","example":"","example_cn":"","kind":"单词","level":"容易"}}
只输出这个 JSON。""",
        max_tokens=600,
    )
    if not isinstance(data, dict):
        raise AIError("模型返回格式异常，请重试", "AI_BAD_RESPONSE")
    # 单词以家长填的为准，模型只补其它字段
    data["word"] = word
    item = _clean_word(data)
    if not item:
        raise AIError("模型没有返回可用的内容，请重试", "AI_BAD_RESPONSE")
    return item


def _gen_words(grade: str, count: int, exclude: list, extra: str = "") -> list[dict]:
    data = chat_json(
        SYSTEM_PROMPT,
        f"""请生成 {count} 个适合{grade}学生的 PEP 人教版小学英语单词。
{_LEVEL_GUIDE}
{_level_quota_line(count)}
{extra}要求：
1. 必须输出恰好 {count} 个，且各不相同的单词。
2. 不能与下面已有单词重复：{_join(exclude, 300)}
3. 音标用英式 IPA 并用斜杠包裹，例如 /ˈruːlə/。
4. 词性只能用这些缩写：n. v. adj. adv. pron. prep. conj. num. art. int. phr.
5. 例句不超过 8 个单词，配套中文翻译。
输出 JSON：
{{"items":[{{"word":"","phonetic":"/…/","pos":"n.","meaning":"中文释义，2-6 字",
  "example":"","example_cn":"","kind":"单词","level":"容易"}}]}}
kind 只能是「单词」或「短语」。items 里必须有 {count} 个元素。只输出这个 JSON。""",
        max_tokens=max(2500, 250 * count),
    )
    items = data.get("items") if isinstance(data, dict) else data
    if not isinstance(items, list):
        raise AIError("模型没有返回单词列表，请重试", "AI_BAD_RESPONSE")
    seen = {str(w).strip().lower() for w in exclude}
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        item = _clean_word(it)
        if not item or item["word"].lower() in seen:
            continue
        seen.add(item["word"].lower())
        out.append(item)
    return out


# ---- 英语：句子

def _clean_sentence(it: dict) -> dict | None:
    en = str(it.get("en") or "").strip()
    if not en:
        return None
    key_words = it.get("key_words") or ""
    if isinstance(key_words, list):
        key_words = ",".join(str(k).strip() for k in key_words if str(k).strip())
    key_words = str(key_words).strip()
    # 中文逗号 / 顿号统一成英文逗号，前端与出题都按英文逗号切
    key_words = re.sub(r"[,，、;；\s]+", ",", key_words).strip(",")
    return {
        "en": en[:200],
        "cn": str(it.get("cn") or "").strip()[:200],
        "key_words": key_words[:200],
        "phonetic_tip": str(it.get("phonetic_tip") or "").strip()[:200],
        "level": _norm_level(it.get("level")),
    }


def _gen_sentence(context: dict, extra: str = "") -> dict:
    """按家长已经填好的英文句子，补全翻译、重点词与朗读提示。"""
    en = (context.get("sentence") or "").strip()
    if not en:
        raise AIError("请先在「英文句子」一栏填写句子，再用 AI 补全", "AI_MISSING_SENTENCE")
    data = chat_json(
        SYSTEM_PROMPT,
        f"""给出英语句子「{en}」的小学英语学习卡信息，供孩子做听读和排序练习。
{_LEVEL_GUIDE}
{extra}要求：
1. cn 是准确、通顺的中文翻译，不要逐词直译。
2. key_words 是句中需要掌握的 2-4 个重点单词，只用英文逗号分隔，不要加空格以外的符号。
3. phonetic_tip 是一句中文朗读提示（连读、重音、语调），不超过 20 个字。
4. level 按句型在教材里出现的年级判断，句子越长、结构越复杂，等级越高。
输出 JSON：
{{"en":"{en}","cn":"","key_words":"this,is,my","phonetic_tip":"","level":"容易"}}
只输出这个 JSON。""",
        max_tokens=600,
    )
    if not isinstance(data, dict):
        raise AIError("模型返回格式异常，请重试", "AI_BAD_RESPONSE")
    # 句子以家长填的为准，模型只补其它字段
    data["en"] = en
    item = _clean_sentence(data)
    if not item:
        raise AIError("模型没有返回可用的内容，请重试", "AI_BAD_RESPONSE")
    return item


def _gen_sentences(grade: str, count: int, exclude: list, extra: str = "") -> list[dict]:
    data = chat_json(
        SYSTEM_PROMPT,
        f"""请生成 {count} 个适合{grade}学生的 PEP 人教版小学英语常用句型句子。
{_LEVEL_GUIDE}
{_level_quota_line(count)}
{extra}要求：
1. 必须输出恰好 {count} 个，且各不相同的句子。
2. 句子 4-10 个单词，语法正确，贴近日常对话。
3. 重点词是句中需要掌握的 2-4 个词，用英文逗号分隔。
4. level 按句型在教材里出现的年级判断，句子越长、结构越复杂，等级越高。
输出 JSON：
{{"items":[{{"en":"","cn":"","key_words":"this,is,my","phonetic_tip":"一句话朗读提示，20 字内","level":"容易"}}]}}
items 里必须有 {count} 个元素。只输出这个 JSON。""",
        max_tokens=max(2000, 200 * count),
    )
    items = data.get("items") if isinstance(data, dict) else data
    if not isinstance(items, list):
        raise AIError("模型没有返回句子列表，请重试", "AI_BAD_RESPONSE")
    seen = {str(s).strip().lower() for s in exclude}
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        item = _clean_sentence(it)
        if not item or item["en"].lower() in seen:
            continue
        seen.add(item["en"].lower())
        out.append(item)
    return out


# ---- 数学：出题规则

def _gen_math_rules(grade: str, context: dict) -> list[dict]:
    generators = [
        {"key": key, "topic": mathgen.GENERATOR_TOPICS.get(key, key)}
        for key in mathgen.GENERATORS
    ]
    want = (context.get("requirement") or "").strip()
    data = chat_json(
        SYSTEM_PROMPT,
        f"""你是小学数学教研员，要为{grade}配置"每日口算"的出题规则。
可用的出题器如下（只能从中选择，不能发明新的）：
{json.dumps(generators, ensure_ascii=False)}

{"家长的具体要求：" + want if want else "请按教材进度挑选 3-5 个核心知识点，覆盖本学期主要计算能力。"}

要求：
1. params 只填需要调整的数值区间，例如 {{"a_min":100,"a_max":999,"b_min":2,"b_max":9}}；
   该出题器不需要参数时给 {{}}。不要编造不存在的键。
2. name 用家长看得懂的中文知识点名称，topic 与 name 一致。
3. level 按这个知识点在教材里出现的年级判断（容易≈一二年级 … 困难≈六年级），
   同一批里尽量覆盖 2-3 个不同等级——出题比例由等级决定，不再有权重。
输出 JSON：
{{"items":[{{"name":"","generator":"必须是上面列表里的 key","topic":"","params":{{}},
  "level":"容易","reason":"一句话说明为什么这样配，20 字内"}}]}}
只输出这个 JSON。""",
        max_tokens=1800,
    )
    items = data.get("items") if isinstance(data, dict) else data
    if not isinstance(items, list):
        raise AIError("模型没有返回规则列表，请重试", "AI_BAD_RESPONSE")
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        generator = str(it.get("generator") or "").strip()
        if generator not in mathgen.GENERATORS:
            continue
        params = it.get("params") or {}
        if not isinstance(params, dict):
            params = {}
        name = str(it.get("name") or "").strip() or mathgen.GENERATOR_TOPICS.get(generator, generator)
        out.append(
            {
                "name": name[:60],
                "generator": generator,
                "topic": str(it.get("topic") or name)[:40],
                "params_json": json.dumps(params, ensure_ascii=False),
                "level": _norm_level(it.get("level")),
                "reason": str(it.get("reason") or "").strip()[:60],
            }
        )
    return out


# ---- 数学：应用题

def _gen_math_questions(grade: str, count: int, context: dict, extra: str = "") -> list[dict]:
    topic = (context.get("topic") or "").strip()
    data = chat_json(
        SYSTEM_PROMPT,
        f"""请生成 {count} 道{grade}数学应用题{"（知识点：" + topic + "）" if topic else ""}。
{_LEVEL_GUIDE}
{_level_quota_line(count)}
{extra}要求：
1. 题干是完整的中文情境，1-3 句话，数据合理，总量不超过 10000。
2. answer 只能填纯数字（或最简分数如 3/4），绝对不能带单位、文字或算式；
   单位放在 unit 字段（如 元、个、米、千克），没有单位就填空字符串。
3. 每道题的计算步骤唯一、答案确定，不能是需要主观判断的开放题。
4. solution 写 1-2 步算式和结果，便于孩子看解析。
5. level 按解题步骤数判断：一步直答=容易，两步=较易/中等，三步及以上=较难/困难。
输出 JSON：
{{"items":[{{"stem":"","answer":"","unit":"","topic":"","level":"容易","solution":""}}]}}
items 里必须有 {count} 个元素。只输出这个 JSON。""",
        max_tokens=max(3000, 400 * count),
    )
    items = data.get("items") if isinstance(data, dict) else data
    if not isinstance(items, list):
        raise AIError("模型没有返回应用题列表，请重试", "AI_BAD_RESPONSE")
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        stem = str(it.get("stem") or "").strip()
        answer = str(it.get("answer") or "").strip()
        if not stem or not answer:
            continue
        answer = re.sub(r"[^\d./]", "", answer.replace("／", "/"))
        if not answer:
            continue
        out.append(
            {
                "stem": stem[:1000],
                "answer": answer[:60],
                "unit": str(it.get("unit") or "").strip()[:10],
                "topic": str(it.get("topic") or topic).strip()[:40],
                "level": _norm_level(it.get("level")),
                "solution": str(it.get("solution") or "").strip(),
            }
        )
    return out
