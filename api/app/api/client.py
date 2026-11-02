import calendar as cal
import json
from datetime import date, datetime, timedelta

from flask import Blueprint, request

from ..extensions import db
from ..models import (
    Checkin,
    Child,
    DailyTask,
    Poem,
    Recitation,
    Redemption,
    Reward,
    StudyRecord,
    WrongItem,
)
from ..services import grading, points, storage, submit, taskgen, tts as tts_svc
from ..services.settings import get_setting
from ..utils.dates import month_range, shift_date, today_str
from ..utils.responses import fail, ok

# 单个录音文件上限 8MB，够录完整首诗了
MAX_AUDIO_BYTES = 8 * 1024 * 1024

bp = Blueprint("client", __name__)


def _child(required=True):
    raw = request.args.get("child_id") or (request.get_json(silent=True) or {}).get("child_id")
    child = None
    if raw:
        try:
            child = Child.query.get(int(raw))
        except (TypeError, ValueError):
            child = None
    if child is None and required:
        child = Child.query.order_by(Child.id.asc()).first()
    return child


@bp.get("/children")
def children():
    rows = Child.query.order_by(Child.id.asc()).all()
    return ok([c.to_dict() for c in rows])


@bp.get("/bootstrap")
def bootstrap():
    child = _child()
    if child is None:
        return ok({"child": None, "need_setup": True})

    summary = submit.today_summary(child)
    return ok(
        {
            "child": child.to_dict(),
            "need_setup": False,
            **summary,
        }
    )


@bp.get("/prefs")
def prefs():
    """客户端用得到的开关：语音模式、即时对错、可用时间段。不需要孩子档案。"""
    return ok(
        {
            "voice_mode": get_setting("voice_mode") or "browser",
            "instant_feedback": bool(get_setting("instant_feedback")),
            "srs_enabled": bool(get_setting("srs_enabled")),
            # 可用时间段（HH:MM），两者都有值才限制；server_now 供客户端校准本机时间偏差
            "client_time_start": (get_setting("client_time_start") or "").strip(),
            "client_time_end": (get_setting("client_time_end") or "").strip(),
            "server_now": datetime.now().isoformat(timespec="seconds"),
        }
    )


@bp.post("/tts")
def tts():
    """豆包语音合成：一次性输入文本，返回缓存音频地址。

    仅在后台开启 API 模式时可用；相同文本命中缓存不会重复调用远端。
    """
    if (get_setting("voice_mode") or "browser") != "api":
        return fail("TTS_DISABLED", "当前使用浏览器语音，未启用 API 合成", 400)
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    lang = "en" if data.get("lang") == "en" else "zh"
    try:
        return ok(tts_svc.synthesize(text, lang=lang, speed=data.get("speed") or 1.0))
    except tts_svc.TTSError as exc:
        return fail("TTS_ERROR", exc.message, 400)


@bp.get("/tts/audio/<name>")
def tts_audio(name: str):
    """下发已缓存的合成音频（文件名限定 32 位十六进制 + .mp3，防穿越）。"""
    from flask import send_file

    target = tts_svc.resolve_audio(name)
    if target is None:
        return fail("NOT_FOUND", "音频不存在或已失效", 404)
    return send_file(target, mimetype="audio/mpeg")


@bp.get("/today")
def today():
    child = _child()
    if child is None:
        return fail("NOT_FOUND", "还没有孩子档案，请先在后台添加", 404)
    return ok(submit.today_summary(child))


@bp.post("/task/start")
def task_start():
    child = _child()
    if child is None:
        return fail("NOT_FOUND", "还没有孩子档案", 404)
    data = request.get_json(silent=True) or {}
    subject = data.get("subject")
    if subject not in taskgen.SUBJECTS:
        return fail("VALIDATION_ERROR", "科目不正确", 422)

    today_str_ = today_str()
    task = DailyTask.query.filter_by(child_id=child.id, date=today_str_, subject=subject).first()
    if task and task.status == "done":
        return ok({"subject": subject, "status": "done", "score": task.score, "items": []})

    task = taskgen.get_or_create_task(child, subject, today_str_)
    payload = taskgen.public_payload(taskgen.load_payload(task))
    saved = submit.load_progress(task)
    items = payload.get("items", [])
    answered = [saved[int(it["item_id"])] for it in items if int(it["item_id"]) in saved]
    return ok(
        {
            "task_id": task.id,
            "subject": subject,
            "status": task.status,
            "score": task.score,
            "total": task.total,
            # 已经答过的题：客户端据此从下一题接着做
            "answered": answered,
            "answered_count": len(answered),
            **payload,
        }
    )


@bp.post("/task/answer")
def task_answer():
    """单题即时判定，用于作答时的对错反馈（不写记录，最终以 submit 为准）。"""
    child = _child()
    if child is None:
        return fail("NOT_FOUND", "还没有孩子档案", 404)
    data = request.get_json(silent=True) or {}
    subject = data.get("subject")
    if subject not in taskgen.SUBJECTS:
        return fail("VALIDATION_ERROR", "科目不正确", 422)

    task = DailyTask.query.filter_by(child_id=child.id, date=today_str(), subject=subject).first()
    if task is None:
        return fail("NOT_FOUND", "任务尚未开始", 404)

    payload = taskgen.load_payload(task)
    try:
        item_id = int(data.get("item_id"))
    except (TypeError, ValueError):
        return fail("VALIDATION_ERROR", "题目编号不正确", 422)

    item = next((it for it in payload.get("items", []) if int(it["item_id"]) == item_id), None)
    if item is None:
        return fail("NOT_FOUND", "题目不存在", 404)

    # 不管有没有开即时反馈，都先把这一题存下来：中途退出还能接着往下做
    submit.save_progress(
        task,
        child.id,
        subject,
        item_id,
        str(data.get("answer", "")),
        int(data.get("duration_ms") or 0),
    )
    db.session.commit()

    if not get_setting("instant_feedback"):
        return ok({"correct": None, "answer": "", "deferred": True})

    correct = grading.is_correct(item.get("answer"), data.get("answer", ""))
    return ok({"correct": correct, "answer": str(item.get("answer", ""))})


@bp.post("/poem/recite")
def poem_recite():
    """上传背诵录音。

    不走判分也不发积分，只负责「留证据」：一条录音文件 + 一条学习流水 + 一条答题存档。
    """
    child = _child()
    if child is None:
        return fail("NOT_FOUND", "还没有孩子档案", 404)

    audio = request.files.get("audio")
    if audio is None:
        return fail("VALIDATION_ERROR", "没有收到录音文件", 422)

    data = request.form
    subject = data.get("subject") or "chinese"
    today = today_str()
    item_id = int(data.get("item_id") or 0)
    poem_id = int(data.get("poem_id") or 0) or None
    duration_ms = int(data.get("duration_ms") or 0)

    blob = audio.read()
    if not blob:
        return fail("VALIDATION_ERROR", "录音是空的，再试一次吧", 422)
    if len(blob) > MAX_AUDIO_BYTES:
        return fail("VALIDATION_ERROR", "录音太长了，最多 8MB", 413)

    poem = Poem.query.get(poem_id) if poem_id else None
    task = DailyTask.query.filter_by(child_id=child.id, date=today, subject=subject).first()
    rel = storage.save_recite(
        blob, audio.mimetype or "", today[:7], storage.suffix_of(audio.filename or "", audio.mimetype or "")
    )

    row = Recitation(
        child_id=child.id,
        task_id=task.id if task else None,
        date=today,
        subject=subject,
        item_id=item_id,
        poem_id=poem.id if poem else None,
        title=(poem.title if poem else "") or (data.get("title") or ""),
        file_path=rel,
        mime=audio.mimetype or "audio/webm",
        size=len(blob),
        duration_ms=duration_ms,
    )
    db.session.add(row)

    # 背过了就算这道题完成了，但记的不是答案而是「已背诵」
    if task and item_id:
        submit.save_progress(task, child.id, subject, item_id, submit.POEM_RECITED, duration_ms)
    db.session.commit()

    return ok(
        {
            "id": row.id,
            "title": row.title,
            "duration_ms": row.duration_ms,
            "size": row.size,
        }
    )


@bp.post("/task/submit")
def task_submit():
    child = _child()
    if child is None:
        return fail("NOT_FOUND", "还没有孩子档案", 404)
    data = request.get_json(silent=True) or {}
    subject = data.get("subject")
    if subject not in taskgen.SUBJECTS:
        return fail("VALIDATION_ERROR", "科目不正确", 422)
    answers = data.get("answers") or []
    if not isinstance(answers, list):
        return fail("VALIDATION_ERROR", "answers 必须是数组", 422)

    result = submit.submit(child, subject, answers)
    result["subject"] = subject
    return ok(result)


@bp.get("/calendar")
def calendar_view():
    child = _child()
    if child is None:
        return fail("NOT_FOUND", "还没有孩子档案", 404)
    month = request.args.get("month") or today_str()[:7]
    try:
        start, end = month_range(month)
    except ValueError:
        return fail("VALIDATION_ERROR", "月份格式应为 YYYY-MM", 422)

    rows = Checkin.query.filter(
        Checkin.child_id == child.id,
        Checkin.date >= start,
        Checkin.date <= end,
    ).all()
    by_date = {r.date: r for r in rows}

    year, mon = int(month[:4]), int(month[5:7])
    total_days = cal.monthrange(year, mon)[1]
    today_s = today_str()
    days = []
    full_days = 0
    for day in range(1, total_days + 1):
        ds = f"{month}-{day:02d}"
        row = by_date.get(ds)
        status = row.status if row else "none"
        if status == "full":
            full_days += 1
        days.append(
            {
                "date": ds,
                "day": day,
                "status": status,
                "subjects": json.loads(row.subjects_json) if row else [],
                "points": row.points if row else 0,
                "streak": row.streak if row else 0,
                "is_makeup": bool(row.is_makeup) if row else False,
                "is_future": ds > today_s,
                "is_today": ds == today_s,
            }
        )

    elapsed = sum(1 for d in days if d["date"] <= today_s)
    return ok(
        {
            "month": month,
            "days": days,
            "stats": {
                "full_days": full_days,
                "elapsed_days": elapsed,
                "rate": round(full_days / elapsed * 100) if elapsed else 0,
                "points": sum(d["points"] for d in days),
            },
        }
    )


@bp.get("/records")
def records():
    child = _child()
    if child is None:
        return fail("NOT_FOUND", "还没有孩子档案", 404)
    days = min(90, max(1, int(request.args.get("days", 7))))

    start = shift_date(today_str(), -(days - 1))
    rows = (
        StudyRecord.query.filter(
            StudyRecord.child_id == child.id, StudyRecord.date >= start
        )
        .order_by(StudyRecord.date.desc(), StudyRecord.id.desc())
        .all()
    )

    grouped = {}
    for r in rows:
        key = (r.date, r.subject)
        g = grouped.setdefault(
            key, {"date": r.date, "subject": r.subject, "total": 0, "correct": 0, "duration_ms": 0}
        )
        g["total"] += 1
        g["correct"] += 1 if r.is_correct else 0
        g["duration_ms"] += r.duration_ms or 0

    by_day = {}
    for g in grouped.values():
        d = by_day.setdefault(g["date"], {"date": g["date"], "total": 0, "correct": 0, "duration_ms": 0})
        d["total"] += g["total"]
        d["correct"] += g["correct"]
        d["duration_ms"] += g["duration_ms"]

    trend = []
    for i in range(days - 1, -1, -1):
        ds = shift_date(today_str(), -i)
        row = by_day.get(ds, {"total": 0, "correct": 0})
        trend.append(
            {
                "date": ds,
                "total": row["total"],
                "correct": row["correct"],
                "accuracy": round(row["correct"] / row["total"] * 100) if row["total"] else 0,
            }
        )

    recent = [
        {
            "date": r.date,
            "subject": r.subject,
            "stem": r.stem,
            "user_answer": r.user_answer,
            "correct_answer": r.correct_answer,
            "is_correct": bool(r.is_correct),
        }
        for r in rows[:60]
    ]

    return ok(
        {
            "days": days,
            "summary": sorted(grouped.values(), key=lambda x: (x["date"], x["subject"]), reverse=True),
            "trend": trend,
            "recent": recent,
        }
    )


@bp.get("/points")
def points_view():
    child = _child()
    if child is None:
        return fail("NOT_FOUND", "还没有孩子档案", 404)
    ledger = points.history(child.id, 100)
    return ok(
        {
            "balance": points.balance(child.id),
            "today_earned": points.earned_today(child.id),
            "items": [row.to_dict() for row in ledger],
        }
    )


@bp.get("/rewards")
def rewards():
    child = _child()
    if child is None:
        return fail("NOT_FOUND", "还没有孩子档案", 404)
    balance = points.balance(child.id)
    rows = (
        Reward.query.filter((Reward.child_id.is_(None)) | (Reward.child_id == child.id))
        .order_by(Reward.cost.asc(), Reward.id.asc())
        .all()
    )
    items = []
    for r in rows:
        data = r.to_dict()
        data["affordable"] = balance >= r.cost
        data["gap"] = max(0, r.cost - balance)
        items.append(data)

    pending = (
        Redemption.query.filter_by(child_id=child.id, status="pending")
        .order_by(Redemption.id.desc())
        .all()
    )
    lock = _redeem_lock(child.id)
    return ok(
        {
            "balance": balance,
            "items": items,
            "pending": [r.to_dict() for r in pending],
            # 兑换间隔锁：早于该日期时按钮置灰并提示，服务端在 redeem() 里强校验
            "redeem_lock_until": lock[0] if lock and lock[0] > today_str() else None,
        }
    )


def _redeem_lock(child_id: int) -> tuple[str, int] | None:
    """兑换间隔锁：返回 (下次可兑换日期, 间隔天数)，None 表示现在就能兑。

    以最近一次「兑换成功」（approved）的时间为基准；0 天或不曾兑过 = 不限制。
    """
    try:
        interval = max(0, int(get_setting("redeem_interval_days") or 0))
    except (TypeError, ValueError):
        interval = 0
    if interval <= 0:
        return None
    last = (
        Redemption.query.filter_by(child_id=child_id, status="approved")
        .order_by(Redemption.id.desc())
        .first()
    )
    if last is None:
        return None
    base = (last.handled_at or last.created_at or "")[:10]
    if not base:
        return None
    return shift_date(base, interval), interval


@bp.post("/redemptions")
def redeem():
    child = _child()
    if child is None:
        return fail("NOT_FOUND", "还没有孩子档案", 404)
    data = request.get_json(silent=True) or {}
    reward = Reward.query.get(int(data.get("reward_id") or 0))
    if reward is None:
        return fail("NOT_FOUND", "奖励不存在", 404)

    lock = _redeem_lock(child.id)
    if lock is not None and today_str() < lock[0]:
        _, _, day = lock[0].split("-")
        return fail(
            "CONFLICT",
            f"上次兑换后要休息 {lock[1]} 天，{int(day)} 日后才能再兑换",
            409,
        )

    pending_row = Redemption.query.filter_by(child_id=child.id, status="pending").first()
    if pending_row is not None:
        return fail(
            "CONFLICT",
            f"上一次兑换「{pending_row.reward_name}」还在等家长审批，审批完成后再来兑换吧",
            409,
        )

    balance = points.balance(child.id)
    if balance < reward.cost:
        return fail("VALIDATION_ERROR", f"积分不足，还差 {reward.cost - balance} 分", 400)

    row = Redemption(
        child_id=child.id,
        reward_id=reward.id,
        reward_name=reward.name,
        reward_icon=reward.icon or "🎁",
        cost=reward.cost,
        status="pending",
    )
    db.session.add(row)
    db.session.commit()
    return ok({"id": row.id, "status": row.status, "cost": row.cost})


@bp.get("/wrong-items")
def wrong_items():
    child = _child()
    if child is None:
        return fail("NOT_FOUND", "还没有孩子档案", 404)
    subject = request.args.get("subject")
    query = WrongItem.query.filter_by(child_id=child.id, mastered=False)
    if subject:
        query = query.filter_by(subject=subject)
    rows = query.order_by(WrongItem.wrong_count.desc(), WrongItem.id.desc()).limit(100).all()
    return ok([r.to_dict() for r in rows])


@bp.get("/wrong-practice")
def wrong_practice_list():
    """错题本的可做题：用当时存下的快照原样还原，交给孩子重做。"""
    child = _child()
    if child is None:
        return fail("NOT_FOUND", "还没有孩子档案", 404)
    subject = request.args.get("subject")
    query = WrongItem.query.filter_by(child_id=child.id, mastered=False)
    if subject:
        query = query.filter_by(subject=subject)
    rows = query.order_by(WrongItem.wrong_count.desc(), WrongItem.id.asc()).limit(60).all()

    items = []
    for row in rows:
        try:
            snap = json.loads(row.snapshot_json or "{}")
        except (TypeError, ValueError):
            snap = {}
        if not snap.get("stem") or "answer" not in snap:
            # 快照残缺（早期数据或题型改造），没法重做，只能靠再做一次原题补上
            continue
        options = snap.get("options") or []
        # 句子排序（type=order）没有选项，但带词块，重做时要点词成句而不是填空
        tokens = snap.get("tokens") or []
        items.append(
            {
                "wrong_id": row.id,
                "subject": row.subject,
                "item_type": row.item_type,
                "kind": snap.get("kind") or row.item_type,
                "type": snap.get("type") or "",
                "ref_text": row.ref_text,
                "stem": snap.get("stem"),
                "options": options,
                "tokens": tokens,
                "input": not options and not tokens,
                "wrong_count": row.wrong_count or 1,
                "correct_streak": row.correct_streak or 0,
                "last_wrong_at": row.last_wrong_at,
            }
        )
    return ok({"items": items})


@bp.post("/wrong-practice/check")
def wrong_practice_check():
    """单题订正判分：答对才算订正完成，答错必须重做，不提供直接「已掌握」的入口。"""
    child = _child()
    if child is None:
        return fail("NOT_FOUND", "还没有孩子档案", 404)
    data = request.get_json(silent=True) or {}
    row = WrongItem.query.get(int(data.get("wrong_id") or 0))
    if row is None or row.child_id != child.id:
        return fail("NOT_FOUND", "错题不存在", 404)

    try:
        snap = json.loads(row.snapshot_json or "{}")
    except (TypeError, ValueError):
        snap = {}
    user_answer = str(data.get("answer") or "")
    is_ok = grading.is_correct(snap.get("answer"), user_answer)
    today = today_str()

    awarded = 0
    if is_ok:
        row.correct_streak = (row.correct_streak or 0) + 1
        # 专门回来重做并且做对了，这道题就算订正完成
        row.mastered = True
        fix = int(get_setting("point_wrong_fix") or 0)
        if fix > 0:
            room = fix
            delta = min(fix, room)
            if delta > 0:
                awarded = points.add(
                    child.id, delta, "wrong_fix", "wrong_item", row.id, today=today
                )
    else:
        row.correct_streak = 0
        row.mastered = False

    db.session.add(
        StudyRecord(
            child_id=child.id,
            date=today,
            subject=row.subject,
            item_type=row.item_type,
            item_id=row.item_id,
            stem=str(snap.get("stem") or row.ref_text or ""),
            user_answer=user_answer[:180],
            correct_answer=str(snap.get("answer", ""))[:180],
            is_correct=is_ok,
            duration_ms=int(data.get("duration_ms") or 0),
        )
    )
    db.session.commit()

    return ok(
        {
            "correct": bool(is_ok),
            "correct_answer": str(snap.get("answer", "")),
            "mastered": bool(row.mastered),
            "correct_streak": row.correct_streak or 0,
            "points_earned": awarded,
        }
    )


@bp.get("/health")
def health():
    return ok({"status": "ok", "date": today_str()})
