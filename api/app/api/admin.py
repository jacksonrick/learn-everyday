import json
import shutil
from datetime import date, datetime, timedelta
from pathlib import Path

from flask import Blueprint, current_app, request, send_file
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import Boolean, Integer, func, or_, text

from ..extensions import db
from ..models import (
    AdminUser,
    AiCallLog,
    TtsCallLog,
    Checkin,
    Child,
    ChineseChar,
    DailyTask,
    EnglishPhoneme,
    EnglishSentence,
    EnglishWord,
    Grade,
    MathQuestion,
    MathRule,
    Poem,
    PointsLedger,
    Recitation,
    Redemption,
    Reward,
    StudyRecord,
    SrsItem,
    TaskAnswer,
    WrongItem,
)
from ..services import ai, bank_import, level as level_svc, mathgen, points, settings as settings_svc, storage
from ..utils.dates import now_iso, shift_date, today_str
from ..utils.responses import fail, ok, paginated, parse_page
from .auth import check_password

bp = Blueprint("admin", __name__)


# ------------------------------------------------------------------ 通用工具

def _coerce(model, data: dict, fields: list[str]) -> dict:
    cols = {c.name: c for c in model.__table__.columns}
    out = {}
    for f in fields:
        if f not in data:
            continue
        value = data[f]
        col = cols.get(f)
        if col is None:
            continue
        ctype = col.type
        if isinstance(ctype, Boolean):
            if isinstance(value, str):
                out[f] = value.strip().lower() in ("1", "true", "yes", "是", "y")
            else:
                out[f] = bool(value)
        elif isinstance(ctype, Integer):
            if value in ("", None):
                out[f] = None
            else:
                try:
                    out[f] = int(float(value))
                except (TypeError, ValueError):
                    out[f] = None
        elif f == "level":
            # 空值 / 认不出的写法统一落到「中等」，别让脏数据进库
            out[f] = level_svc.normalize(value)
        else:
            if f.endswith("_json") and not isinstance(value, str):
                out[f] = json.dumps(value, ensure_ascii=False)
            else:
                out[f] = "" if value is None else str(value)
    return out


# 题库检索的可选过滤列：模型上有这一列、且前端传了值，就按值精确过滤。
# level = 难度等级（音标库没有这一列，所以自动跳过）；pos = 词性；type/category/genre 是各类标签。
_FILTER_COLUMNS = ("level", "pos", "type", "category", "genre")


def _filtered(model, fields, search):
    query = model.query
    for col in _FILTER_COLUMNS:
        if not hasattr(model, col):
            continue
        value = (request.args.get(col) or "").strip()
        if not value or value == "all":
            continue
        column = getattr(model, col)
        if value == "none":
            query = query.filter(db.or_(column == "", column.is_(None)))
        else:
            query = query.filter(column == value)
    grade_id = request.args.get("grade_id")
    if grade_id and grade_id not in ("", "all") and hasattr(model, "grade_id"):
        if grade_id == "none":
            query = query.filter(model.grade_id.is_(None))
        else:
            query = query.filter(model.grade_id == int(grade_id))
    term = request.args.get("term")
    if term and term not in ("", "all") and hasattr(model, "term"):
        if term == "none":
            query = query.filter(db.or_(model.term == "", model.term.is_(None)))
        else:
            query = query.filter(model.term == term)
    if search and fields:
        like = f"%{search}%"
        cond = None
        for f in fields:
            clause = getattr(model, f).like(like)
            cond = clause if cond is None else cond | clause
        if cond is not None:
            query = query.filter(cond)
    return query


def _grade_names(rows) -> dict:
    ids = {r.grade_id for r in rows if getattr(r, "grade_id", None)}
    if not ids:
        return {}
    return {g.id: g.name for g in Grade.query.filter(Grade.id.in_(ids)).all()}


def _to_items(rows) -> list[dict]:
    names = _grade_names(rows)
    items = []
    for r in rows:
        item = r.to_dict()
        if hasattr(r, "grade_id"):
            item["grade_name"] = names.get(r.grade_id, "")
        items.append(item)
    return items


def _duplicate(model, unique, payload, exclude_id=None, case_insensitive=False):
    """唯一性判断（不建索引，只在写入时查一次）。"""
    if not unique:
        return None
    query = model.query
    for f in unique:
        value = payload.get(f)
        col = getattr(model, f)
        if isinstance(value, str):
            value = value.strip()
        if case_insensitive:
            query = query.filter(func.lower(col) == str(value).lower())
        else:
            query = query.filter(col == value)
    if exclude_id:
        query = query.filter(model.id != exclude_id)
    return query.first()


def _register_bank(prefix, model, fields, search_fields, unique=None,
                   allow_create=True, allow_delete=True, unique_ci=False):
    def list_view():
        page, page_size = parse_page(request.args)
        query = _filtered(model, search_fields, request.args.get("q", "").strip())
        # 没有排序字段了：一律按创建时间倒排，最新录入的在最上面；同一秒的用 id 兜底
        query = query.order_by(model.created_at.desc(), model.id.desc())
        total = query.count()
        rows = query.offset((page - 1) * page_size).limit(page_size).all()
        return paginated(_to_items(rows), total, page, page_size)

    def create_view():
        if not allow_create:
            return fail("FORBIDDEN", "该题库为系统内置，不支持新增", 403)
        data = request.get_json(silent=True) or {}
        payload = _coerce(model, data, fields)
        missing = [f for f in ("char", "title", "word", "en", "symbol", "name", "stem") if f in fields and not payload.get(f)]
        if missing:
            return fail("VALIDATION_ERROR", f"缺少必填字段: {', '.join(missing)}", 422)
        dup = _duplicate(model, unique, payload, case_insensitive=unique_ci)
        if dup is not None:
            key = "、".join(str(payload.get(f) or "") for f in unique)
            return fail("CONFLICT", f"「{key}」已存在，不能重复添加", 409)
        row = model(**payload)
        db.session.add(row)
        db.session.commit()
        return ok(row.to_dict())

    def update_view(item_id: int):
        row = model.query.get(item_id)
        if row is None:
            return fail("NOT_FOUND", "记录不存在", 404)
        data = request.get_json(silent=True) or {}
        payload = _coerce(model, data, fields)
        dup = _duplicate(model, unique, payload, exclude_id=row.id, case_insensitive=unique_ci)
        if dup is not None:
            key = "、".join(str(payload.get(f) or "") for f in unique)
            return fail("CONFLICT", f"「{key}」已存在，不能重复", 409)
        for key, value in payload.items():
            setattr(row, key, value)
        db.session.commit()
        return ok(row.to_dict())

    def delete_view(item_id: int):
        if not allow_delete:
            return fail("FORBIDDEN", "该题库为系统内置，不支持删除", 403)
        row = model.query.get(item_id)
        if row is None:
            return fail("NOT_FOUND", "记录不存在", 404)
        db.session.delete(row)
        db.session.commit()
        return ok({"deleted": True})

    def batch_delete_view():
        if not allow_delete:
            return fail("FORBIDDEN", "该题库为系统内置，不支持删除", 403)
        data = request.get_json(silent=True) or {}
        ids = data.get("ids") or []
        if not ids:
            return fail("VALIDATION_ERROR", "请选择要删除的记录", 422)
        model.query.filter(model.id.in_(ids)).delete(synchronize_session=False)
        db.session.commit()
        return ok({"deleted": len(ids)})

    bp.add_url_rule(f"/{prefix}", f"{prefix}_list", jwt_required()(list_view), methods=["GET"])
    bp.add_url_rule(f"/{prefix}", f"{prefix}_create", jwt_required()(create_view), methods=["POST"])
    bp.add_url_rule(f"/{prefix}/batch-delete", f"{prefix}_batch_delete", jwt_required()(batch_delete_view), methods=["POST"])
    bp.add_url_rule(f"/{prefix}/<int:item_id>", f"{prefix}_update", jwt_required()(update_view), methods=["PUT"])
    bp.add_url_rule(f"/{prefix}/<int:item_id>", f"{prefix}_delete", jwt_required()(delete_view), methods=["DELETE"])


# ------------------------------------------------------------------ 孩子 / 年级

@bp.get("/children")
@jwt_required()
def children_list():
    rows = Child.query.order_by(Child.id.asc()).all()
    return ok([r.to_dict() for r in rows])


@bp.post("/children")
@jwt_required()
def children_create():
    data = request.get_json(silent=True) or {}
    if not (data.get("name") or "").strip():
        return fail("VALIDATION_ERROR", "请填写姓名", 422)
    child = Child(
        name=data["name"].strip(),
        gender=data.get("gender", "male"),
        birthday=data.get("birthday") or None,
        grade_id=data.get("grade_id"),
        term=data.get("term", "上"),
        avatar=data.get("avatar", "🐣"),
    )
    db.session.add(child)
    db.session.commit()
    return ok(child.to_dict())


@bp.put("/children/<int:child_id>")
@jwt_required()
def children_update(child_id: int):
    child = Child.query.get(child_id)
    if child is None:
        return fail("NOT_FOUND", "孩子不存在", 404)
    data = request.get_json(silent=True) or {}
    for field in ("name", "gender", "birthday", "grade_id", "term", "avatar"):
        if field in data:
            setattr(child, field, data[field])
    db.session.commit()
    return ok(child.to_dict())


@bp.delete("/children/<int:child_id>")
@jwt_required()
def children_delete(child_id: int):
    child = Child.query.get(child_id)
    if child is None:
        return fail("NOT_FOUND", "孩子不存在", 404)
    # 删孩子前把所有引用他的记录清干净，顺序按外键依赖来：
    # 答题卡/学习记录/背诵都挂在 daily_task 上，兑换记录引用奖励，先清子表再删主表
    task_ids = [t.id for t in DailyTask.query.filter_by(child_id=child_id).all()]
    if task_ids:
        TaskAnswer.query.filter(TaskAnswer.task_id.in_(task_ids)).delete(synchronize_session=False)
    TaskAnswer.query.filter_by(child_id=child_id).delete(synchronize_session=False)
    for rec in Recitation.query.filter_by(child_id=child_id).all():
        storage.delete_recite(rec.file_path)
        db.session.delete(rec)
    Redemption.query.filter_by(child_id=child_id).delete(synchronize_session=False)
    for model in (StudyRecord, Checkin, SrsItem, DailyTask, PointsLedger, WrongItem):
        model.query.filter_by(child_id=child_id).delete(synchronize_session=False)
    Reward.query.filter_by(child_id=child_id).delete(synchronize_session=False)
    db.session.delete(child)
    db.session.commit()
    return ok({"deleted": True})


@bp.get("/grades")
@jwt_required()
def grades_list():
    """年级是内置固定数据（小学 1-6、初一至初三），只读，不提供增删改。"""
    rows = Grade.query.order_by(Grade.id.asc()).all()
    return ok([r.to_dict() for r in rows])


# ------------------------------------------------------------------ 题库注册

_register_bank(
    "chars",
    ChineseChar,
    ["char", "pinyin", "radical", "strokes", "structure", "words_json", "sentence",
     "is_key", "level", "audio_url"],
    ["char", "pinyin", "words_json"],
    unique=["char"],
)

_register_bank(
    "poems",
    Poem,
    ["title", "author", "dynasty", "genre", "content", "pinyin_json", "translation", "notes",
     "appreciation", "level", "audio_url"],
    ["title", "author", "content"],
    unique=["title"],
)

_register_bank(
    "words",
    EnglishWord,
    ["word", "phonetic", "pos", "meaning", "example", "example_cn", "level", "audio_url"],
    ["word", "meaning", "phonetic"],
    unique=["word"],
    unique_ci=True,
)

_register_bank(
    "sentences",
    EnglishSentence,
    ["en", "cn", "key_words", "phonetic_tip", "level", "audio_url"],
    ["en", "cn"],
)

_register_bank(
    "phonemes",
    EnglishPhoneme,
    ["symbol", "type", "category", "examples_json", "mouth_tip", "audio_url"],
    ["symbol", "category"],
    allow_create=False,
    allow_delete=False,
)

_register_bank(
    "math/rules",
    MathRule,
    ["name", "generator", "grade_id", "term", "topic", "params_json", "level"],
    ["name", "generator", "topic"],
)

_register_bank(
    "math/questions",
    MathQuestion,
    ["grade_id", "term", "topic", "type", "stem", "answer", "unit", "options_json",
     "solution", "level"],
    ["stem", "topic"],
)


# ------------------------------------------------------------------ 数学规则调试

@bp.get("/math/generators")
@jwt_required()
def math_generators():
    return ok(mathgen.all_specs())


@bp.post("/math/rules/test")
@jwt_required()
def math_rule_test():
    data = request.get_json(silent=True) or {}
    generator = data.get("generator") or ""
    params = data.get("params") or {}
    if isinstance(params, str):
        try:
            params = json.loads(params)
        except (TypeError, ValueError):
            params = {}
    try:
        return ok(mathgen.preview(generator, params, 5))
    except KeyError as exc:
        return fail("VALIDATION_ERROR", str(exc), 422)


# ------------------------------------------------------------------ AI 智能生成

def _grade_name(grade_id) -> str:
    if not grade_id:
        return ""
    try:
        grade = Grade.query.get(int(grade_id))
    except (TypeError, ValueError):
        return ""
    return grade.name if grade else ""


def _existing_for_ai(kind: str, context: dict) -> list[str]:
    """把已有数据传给模型，避免生成重复内容。

    注意：古诗/单词/句子的唯一性判断是「全库」级别（不区分年级学期），
    所以这里也必须把全库数据都给模型，否则模型会生成另一年级已有、但当前
    年级查不到的篇目，最后入库时被 409 拒绝。
    """
    def _limit(rows, n):
        return [r for r in rows if r][:n]

    if kind == "poem":
        return _limit([p.title for p in Poem.query.all()], 300)
    if kind == "word":
        return _limit([w.word for w in EnglishWord.query.all()], 500)
    if kind == "sentence":
        return _limit([s.en for s in EnglishSentence.query.all()], 200)
    if kind == "math_question":
        return _limit([q.stem for q in MathQuestion.query.all()], 60)
    return []


@bp.get("/ai/status")
@jwt_required()
def ai_status():
    return ok(ai.status())


@bp.post("/ai/test")
@jwt_required()
def ai_test():
    try:
        return ok(ai.test_connection())
    except ai.AIError as exc:
        return fail(exc.code, exc.message, 400)


@bp.post("/ai/suggest")
@jwt_required()
def ai_suggest():
    data = request.get_json(silent=True) or {}
    kind = (data.get("kind") or "").strip()
    context = dict(data.get("context") or {})
    if not kind:
        return fail("VALIDATION_ERROR", "缺少生成类型", 422)

    grade_name = _grade_name(context.get("grade_id"))
    if grade_name:
        context["grade_name"] = grade_name
    if not context.get("exclude"):
        context["exclude"] = _existing_for_ai(kind, context)

    try:
        items = ai.generate(kind, context)
    except ai.AIError as exc:
        return fail(exc.code, exc.message, 400)
    return ok({"items": items, "count": len(items), "kind": kind})


@bp.get("/ai/calls")
@jwt_required()
def ai_calls():
    """调用历史：只保留时间、模型、输入提示词与 token，并给出累计用量。"""
    page, page_size = parse_page(request.args)
    query = AiCallLog.query.order_by(AiCallLog.id.desc())
    total = query.count()
    rows = query.offset((page - 1) * page_size).limit(page_size).all()
    sums = db.session.query(
        func.sum(AiCallLog.input_tokens),
        func.sum(AiCallLog.output_tokens),
        func.count(AiCallLog.id),
    ).one()
    return paginated(
        [r.to_dict() for r in rows],
        total,
        page,
        page_size,
        {
            "total_input_tokens": int(sums[0] or 0),
            "total_output_tokens": int(sums[1] or 0),
            "total_calls": int(sums[2] or 0),
        },
    )


@bp.delete("/ai/calls")
@jwt_required()
def ai_calls_clear():
    deleted = AiCallLog.query.delete(synchronize_session=False)
    db.session.commit()
    return ok({"deleted": deleted})


@bp.get("/tts/calls")
@jwt_required()
def tts_calls():
    """语音合成调用历史：时间、文本、字数与音频时长，并给出累计用量。"""
    page, page_size = parse_page(request.args)
    query = TtsCallLog.query.order_by(TtsCallLog.id.desc())
    total = query.count()
    rows = query.offset((page - 1) * page_size).limit(page_size).all()
    sums = db.session.query(
        func.count(TtsCallLog.id),
        func.sum(TtsCallLog.char_count),
        func.sum(TtsCallLog.duration_ms),
    ).one()
    return paginated(
        [r.to_dict() for r in rows],
        total,
        page,
        page_size,
        {
            "total_calls": int(sums[0] or 0),
            "total_chars": int(sums[1] or 0),
            "total_duration_ms": int(sums[2] or 0),
        },
    )


@bp.delete("/tts/calls")
@jwt_required()
def tts_calls_clear():
    deleted = TtsCallLog.query.delete(synchronize_session=False)
    db.session.commit()
    return ok({"deleted": deleted})


# ------------------------------------------------------------------ 学习记录 / 打卡 / 积分

@bp.get("/records")
@jwt_required()
def records_list():
    page, page_size = parse_page(request.args)
    query = StudyRecord.query
    child_id = request.args.get("child_id")
    if child_id and child_id != "all":
        query = query.filter(StudyRecord.child_id == int(child_id))
    subject = request.args.get("subject")
    if subject and subject != "all":
        query = query.filter(StudyRecord.subject == subject)
    start = request.args.get("start")
    if start:
        query = query.filter(StudyRecord.date >= start)
    end = request.args.get("end")
    if end:
        query = query.filter(StudyRecord.date <= end)
    total = query.count()
    rows = (
        query.order_by(StudyRecord.date.desc(), StudyRecord.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return paginated([r.to_dict() for r in rows], total, page, page_size)


# ------------------------------------------------------------------ 背诵录音

@bp.get("/recitations")
@jwt_required()
def recitation_list():
    page, page_size = parse_page(request.args)
    query = Recitation.query
    child_id = request.args.get("child_id")
    if child_id and child_id != "all":
        query = query.filter(Recitation.child_id == int(child_id))
    start = request.args.get("start")
    if start:
        query = query.filter(Recitation.date >= start)
    end = request.args.get("end")
    if end:
        query = query.filter(Recitation.date <= end)
    total = query.count()
    rows = (
        query.order_by(Recitation.date.desc(), Recitation.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    items = []
    for r in rows:
        data = r.to_dict(exclude=("file_path",))
        data["child_name"] = Child.query.get(r.child_id).name if Child.query.get(r.child_id) else ""
        data["has_audio"] = storage.resolve_recite(r.file_path) is not None
        data["url"] = f"/api/v1/admin/recitations/{r.id}/audio"
        items.append(data)
    return paginated(items, total, page, page_size)


@bp.get("/recitations/<int:recitation_id>/audio")
@jwt_required()
def recitation_audio(recitation_id: int):
    """家长后台试听。<audio> 标签带不上请求头，所以这里单独鉴权后直接吐文件流。"""
    row = Recitation.query.get(recitation_id)
    if row is None:
        return fail("NOT_FOUND", "录音不存在", 404)
    target = storage.resolve_recite(row.file_path)
    if target is None:
        return fail("NOT_FOUND", "录音文件已经找不到了", 404)
    return send_file(target, mimetype=row.mime or "audio/webm", download_name=f"{row.title or 'recite'}.webm")


@bp.delete("/recitations/<int:recitation_id>")
@jwt_required()
def recitation_delete(recitation_id: int):
    row = Recitation.query.get(recitation_id)
    if row is None:
        return fail("NOT_FOUND", "录音不存在", 404)
    storage.delete_recite(row.file_path)
    db.session.delete(row)
    db.session.commit()
    return ok({"deleted": True})


@bp.get("/checkins")
@jwt_required()
def checkins_list():
    child_id = request.args.get("child_id")
    month = request.args.get("month") or today_str()[:7]
    query = Checkin.query.filter(Checkin.date.like(f"{month}%"))
    if child_id and child_id != "all":
        query = query.filter(Checkin.child_id == int(child_id))
    rows = query.order_by(Checkin.date.asc()).all()
    return ok([r.to_dict() for r in rows])


@bp.post("/checkins/makeup")
@jwt_required()
def checkin_makeup():
    data = request.get_json(silent=True) or {}
    child = Child.query.get(int(data.get("child_id") or 0))
    target = data.get("date") or today_str()
    if child is None:
        return fail("NOT_FOUND", "孩子不存在", 404)
    if target > today_str():
        return fail("VALIDATION_ERROR", "不能补未来的日期", 422)

    row, _newly = points.upcert_checkin(
        child.id, target, ["chinese", "math", "english"], is_makeup=True
    )
    row.status = "full"
    row.streak = 0
    db.session.commit()
    return ok(row.to_dict())


@bp.delete("/checkins/<int:checkin_id>")
@jwt_required()
def checkin_void(checkin_id: int):
    """作废这一天的打卡：打卡本身、当天的任务和做题记录、这天挣的积分一起清掉。
    孩子端会回到「这一天什么都没做」的状态，可以重做一遍。
    积分流水是滚动余额的账本，删完要把后面的余额重算一遍，不能只删行。
    """
    row = Checkin.query.get(checkin_id)
    if row is None:
        return fail("NOT_FOUND", "记录不存在", 404)
    void_date = row.date
    child_id = row.child_id

    # 当天任务删掉后，这些任务的答题存档会变成孤儿，必须一起清掉，
    # 否则孩子重新进来会「接着做」到一半，看到的还是作废前的进度
    task_ids = [
        t.id for t in DailyTask.query.filter_by(child_id=child_id, date=void_date).all()
    ]
    if task_ids:
        TaskAnswer.query.filter(TaskAnswer.task_id.in_(task_ids)).delete(
            synchronize_session=False
        )
    for rec in Recitation.query.filter_by(child_id=child_id, date=void_date).all():
        storage.delete_recite(rec.file_path)
        db.session.delete(rec)

    StudyRecord.query.filter_by(child_id=child_id, date=void_date).delete(
        synchronize_session=False
    )
    DailyTask.query.filter_by(child_id=child_id, date=void_date).delete(
        synchronize_session=False
    )
    PointsLedger.query.filter(
        PointsLedger.child_id == child_id,
        PointsLedger.date == void_date,
        PointsLedger.ref_type.in_(("task", "checkin", "wrong_item")),
    ).delete(synchronize_session=False)
    db.session.delete(row)
    db.session.flush()

    # 重算余额：从最早的一条流水重新滚一遍
    balance = 0
    for ledger in (
        PointsLedger.query.filter_by(child_id=child_id)
        .order_by(PointsLedger.id.asc())
        .all()
    ):
        balance += ledger.delta
        if ledger.balance_after != balance:
            ledger.balance_after = balance
    db.session.commit()

    return ok(
        {
            "voided": True,
            "date": void_date,
            "deleted_records": True,
            "points_balance": balance,
        }
    )


@bp.get("/points")
@jwt_required()
def points_list():
    page, page_size = parse_page(request.args)
    query = PointsLedger.query
    child_id = request.args.get("child_id")
    if child_id and child_id != "all":
        query = query.filter(PointsLedger.child_id == int(child_id))
    total = query.count()
    rows = (
        query.order_by(PointsLedger.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    )
    balances = {c.id: points.balance(c.id) for c in Child.query.all()}
    names = {c.id: c.name for c in Child.query.all()}
    items = []
    for r in rows:
        item = r.to_dict()
        item["reason_label"] = points.reason_label(r.reason)
        item["child_name"] = names.get(r.child_id, "")
        items.append(item)
    return paginated(items, total, page, page_size, {"balances": balances})


@bp.post("/points/adjust")
@jwt_required()
def points_adjust():
    data = request.get_json(silent=True) or {}
    child_id = int(data.get("child_id") or 0)
    delta = int(data.get("delta") or 0)
    note = data.get("note") or ""
    if not delta:
        return fail("VALIDATION_ERROR", "分值不能为 0", 422)
    child = Child.query.get(child_id)
    if child is None:
        return fail("NOT_FOUND", "孩子不存在", 404)
    points.add(child_id, delta, "manual", "manual", None, note=note, apply_cap=False)
    db.session.commit()
    return ok({"balance": points.balance(child_id)})


# ------------------------------------------------------------------ 奖励 / 兑换

@bp.get("/rewards")
@jwt_required()
def rewards_list():
    rows = Reward.query.order_by(Reward.id.asc()).all()
    return ok([r.to_dict() for r in rows])


@bp.post("/rewards")
@jwt_required()
def rewards_create():
    data = request.get_json(silent=True) or {}
    if not (data.get("name") or "").strip():
        return fail("VALIDATION_ERROR", "请填写奖励名称", 422)
    row = Reward(
        name=data["name"].strip(),
        cost=int(data.get("cost") or 0),
        icon=data.get("icon") or "🎁",
        stock=int(data.get("stock", -1)),
        child_id=data.get("child_id") or None,
    )
    db.session.add(row)
    db.session.commit()
    return ok(row.to_dict())


@bp.put("/rewards/<int:reward_id>")
@jwt_required()
def rewards_update(reward_id: int):
    row = Reward.query.get(reward_id)
    if row is None:
        return fail("NOT_FOUND", "奖励不存在", 404)
    data = request.get_json(silent=True) or {}
    for field in ("name", "cost", "icon", "stock", "child_id"):
        if field in data:
            setattr(row, field, data[field])
    db.session.commit()
    return ok(row.to_dict())


@bp.delete("/rewards/<int:reward_id>")
@jwt_required()
def rewards_delete(reward_id: int):
    row = Reward.query.get(reward_id)
    if row is None:
        return fail("NOT_FOUND", "奖励不存在", 404)
    pending = Redemption.query.filter_by(reward_id=reward_id, status="pending").count()
    if pending:
        return fail("CONFLICT", f"还有 {pending} 条待审批的兑换申请，先通过或驳回再删除", 409)
    # 历史兑换记录不能跟着删（已扣的积分流水指向它），只断开关联、补上名称快照
    Redemption.query.filter(
        Redemption.reward_id == reward_id,
        or_(Redemption.reward_name.is_(None), Redemption.reward_name == ""),
    ).update({"reward_name": row.name, "reward_icon": row.icon or "🎁"}, synchronize_session=False)
    Redemption.query.filter_by(reward_id=reward_id).update(
        {"reward_id": None}, synchronize_session=False
    )
    db.session.delete(row)
    db.session.commit()
    return ok({"deleted": True})


@bp.get("/redemptions")
@jwt_required()
def redemptions_list():
    status = request.args.get("status")
    query = Redemption.query
    if status and status != "all":
        query = query.filter(Redemption.status == status)
    rows = query.order_by(Redemption.id.desc()).limit(100).all()
    data = []
    for r in rows:
        item = r.to_dict()
        # 奖励被删掉后关系为空，用下单时记下的快照兜底
        item["reward_name"] = r.reward.name if r.reward else (r.reward_name or "已删除的奖励")
        item["reward_icon"] = r.reward.icon if r.reward else (r.reward_icon or "🎁")
        data.append(item)
    return ok(data)


@bp.post("/redemptions/<int:redemption_id>/<string:action>")
@jwt_required()
def redemption_handle(redemption_id: int, action: str):
    row = Redemption.query.get(redemption_id)
    if row is None:
        return fail("NOT_FOUND", "申请不存在", 404)
    if row.status != "pending":
        return fail("CONFLICT", "该申请已处理", 409)

    if action == "approve":
        if points.balance(row.child_id) < row.cost:
            return fail("VALIDATION_ERROR", "积分不足，无法通过", 400)
        points.add(row.child_id, -row.cost, "redeem", "redemption", row.id, apply_cap=False)
        row.status = "approved"
        if row.reward and row.reward.stock > 0:
            row.reward.stock -= 1
    elif action == "reject":
        row.status = "rejected"
    else:
        return fail("VALIDATION_ERROR", "未知操作", 422)

    row.handled_at = now_iso()
    db.session.commit()
    return ok(row.to_dict())


# ------------------------------------------------------------------ 统计

@bp.get("/stats/overview")
@jwt_required()
def stats_overview():
    today = today_str()
    children = Child.query.order_by(Child.id.asc()).all()
    today_rows = []
    for child in children:
        tasks = {t.subject: t for t in DailyTask.query.filter_by(child_id=child.id, date=today).all()}
        checkin = Checkin.query.filter_by(child_id=child.id, date=today).first()
        today_rows.append(
            {
                "child_id": child.id,
                "name": child.name,
                "avatar": child.avatar,
                "grade_name": child.grade_name,
                "done_subjects": [s for s, t in tasks.items() if t.status == "done"],
                "checkin": bool(checkin and checkin.status == "full"),
                "points": points.balance(child.id),
                "today_points": points.earned_today(child.id),
            }
        )

    start_7 = shift_date(today, -6)
    week_checkins = Checkin.query.filter(Checkin.date >= start_7).all()
    week_full = sum(1 for c in week_checkins if c.status == "full")

    start_30 = shift_date(today, -29)
    records = StudyRecord.query.filter(StudyRecord.date >= start_30).all()
    total_q = len(records)
    correct_q = sum(1 for r in records if r.is_correct)

    wrong_rows = (
        db.session.query(WrongItem.subject, func.count(WrongItem.id))
        .filter(WrongItem.mastered.is_(False))
        .group_by(WrongItem.subject)
        .all()
    )

    pending_redemptions = Redemption.query.filter_by(status="pending").count()

    return ok(
        {
            "today": today_rows,
            "week": {"full_days": week_full, "children": len(children), "rate": round(week_full / max(1, len(children) * 7) * 100)},
            "month": {
                "questions": total_q,
                "correct": correct_q,
                "accuracy": round(correct_q / total_q * 100) if total_q else 0,
            },
            "wrong_distribution": [{"subject": s, "count": c} for s, c in wrong_rows],
            "pending_redemptions": pending_redemptions,
        }
    )


@bp.get("/stats/trend")
@jwt_required()
def stats_trend():
    days = min(90, max(7, int(request.args.get("days", 30))))
    child_id = request.args.get("child_id")
    start = shift_date(today_str(), -(days - 1))

    query = StudyRecord.query.filter(StudyRecord.date >= start)
    if child_id and child_id != "all":
        query = query.filter(StudyRecord.child_id == int(child_id))
    rows = query.all()

    buckets = {}
    for r in rows:
        b = buckets.setdefault(r.date, {"total": 0, "correct": 0})
        b["total"] += 1
        b["correct"] += 1 if r.is_correct else 0

    result = []
    for i in range(days):
        ds = shift_date(start, i)
        b = buckets.get(ds, {"total": 0, "correct": 0})
        result.append(
            {
                "date": ds,
                "total": b["total"],
                "correct": b["correct"],
                "accuracy": round(b["correct"] / b["total"] * 100) if b["total"] else 0,
            }
        )
    return ok(result)


# ------------------------------------------------------------------ 设置 / 备份

@bp.get("/settings")
@jwt_required()
def settings_get():
    return ok(settings_svc.public_settings())


@bp.put("/settings")
@jwt_required()
def settings_put():
    data = request.get_json(silent=True) or {}
    for key, value in data.items():
        # 只认 DEFAULTS 里声明过的键，已下线的配置项（每日新字/复习字等）直接忽略
        if key not in settings_svc.DEFAULTS:
            continue
        if key.endswith("_masked") or key.endswith("_set"):
            continue
        if key in settings_svc.SECRET_KEYS:
            text = str(value or "").strip()
            # 留空或原样提交掩码时视为「不修改」
            if not text or "•" in text or set(text) <= {"*"}:
                continue
            settings_svc.set_setting(key, text)
            continue
        settings_svc.set_setting(key, value)
    return ok(settings_svc.public_settings())


@bp.get("/backup/download")
@jwt_required()
def backup_download():
    from flask import current_app, send_file
    from pathlib import Path

    db_path = Path(current_app.config["DB_PATH"])
    if not db_path.exists():
        return fail("NOT_FOUND", "数据库文件不存在", 404)
    return send_file(
        db_path,
        as_attachment=True,
        download_name=f"db-{today_str()}.sqlite",
        mimetype="application/octet-stream",
    )


# ------------------------------------------------------------------ 数据重置

# 重置范围：题库以外的所有运营数据。题库（汉字/古诗/单词/音标/组句/数学规则与题）、
# 孩子、年级、奖品配置、系统设置、管理员账号与大模型调用日志都保留。
_RESET_MODELS = (
    TaskAnswer,
    StudyRecord,
    Recitation,
    DailyTask,
    SrsItem,
    WrongItem,
    Checkin,
    PointsLedger,
    Redemption,
)


@bp.post("/reset")
@jwt_required()
def reset_data():
    """重置题库以外的全部数据：学习记录、录音、打卡、积分、错题、兑换记录。

    必须携带管理员密码二次确认；执行前会先把当前数据库备份一份到 backups/ 目录。
    """
    data = request.get_json(silent=True) or {}
    password = data.get("password") or ""
    user = AdminUser.query.get(int(get_jwt_identity()))
    if user is None or not check_password(password, user.password_hash):
        return fail("AUTH_FAILED", "管理员密码不正确", 400)

    # 重置前先落一份备份，给家长留反悔的余地
    db_path = Path(current_app.config["DB_PATH"])
    if db_path.exists():
        backup_dir = Path(current_app.config["BACKUP_DIR"])
        backup_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        try:
            # WAL 模式下先落盘，避免备份缺最近的数据
            db.session.execute(text("PRAGMA wal_checkpoint(TRUNCATE)"))
            db.session.commit()
            shutil.copy2(db_path, backup_dir / f"db-before-reset-{stamp}.sqlite")
        except OSError as exc:
            db.session.rollback()
            return fail("BACKUP_FAILED", f"重置前备份失败，已中止：{exc}", 500)

    # 先删录音文件，再清表
    for row in Recitation.query.all():
        storage.delete_recite(row.file_path)

    deleted = {}
    for model in _RESET_MODELS:
        deleted[model.__tablename__] = model.query.delete(synchronize_session=False)
    db.session.commit()
    return ok({"deleted": deleted, "backup": f"db-before-reset-{stamp}.sqlite"})


@bp.get("/stats/summary")
@jwt_required()
def stats_summary():
    return ok(
        {
            "children": Child.query.count(),
            "chars": ChineseChar.query.count(),
            "poems": Poem.query.count(),
            "words": EnglishWord.query.count(),
            "rules": MathRule.query.count(),
        }
    )


# ------------------------------------------------------------------ 内置题库导入

@bp.get("/bank/builtin")
@jwt_required()
def bank_builtin():
    """内置题库概况：总共多少条、还能导入多少条。"""
    return ok(bank_import.preview())


@bp.post("/bank/import")
@jwt_required()
def bank_import_run():
    """一键导入内置题库。已存在的按唯一键跳过，不覆盖家长改过的内容。"""
    data = request.get_json(silent=True) or {}
    kinds = data.get("kinds") or ["chars", "poems", "words"]
    if isinstance(kinds, str):
        kinds = [kinds]
    allowed = {"chars", "poems", "words"}
    unknown = [k for k in kinds if k not in allowed]
    if unknown:
        return fail("BAD_KIND", f"不支持导入的类型：{'、'.join(unknown)}", 400)

    result = {}
    if "chars" in kinds:
        result["chars"] = bank_import.import_chars()
    if "poems" in kinds:
        result["poems"] = bank_import.import_poems()
    if "words" in kinds:
        result["words"] = bank_import.import_words()
    return ok(result)
