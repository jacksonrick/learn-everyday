"""提交判分、积分结算、打卡。"""

from __future__ import annotations

import json

from ..extensions import db
from ..models import Checkin, DailyTask, StudyRecord, TaskAnswer, WrongItem
from ..utils.dates import now_iso, today_str
from . import grading, points, srs, taskgen
from .settings import get_setting

# 古诗背得好不好留给家长听录音，这里只确认「背过了」
POEM_RECITED = "__recited__"
NO_SCORE_KINDS = taskgen.NO_SCORE_KINDS
# 朗读/认读卡的学习记录文案（按 kind 区分是读字还是读词）
READ_LABELS = {"char": "已认读", "word": "已朗读", "phoneme": "已朗读"}


def _upsert_wrong(child_id, subject, kind, item_id, ref_text, ok, snapshot):
    """错题按「题库主键」归并：同一道题反复错只会累加次数，不会跨天串题。"""
    row = WrongItem.query.filter_by(
        child_id=child_id, subject=subject, item_type=kind, item_id=item_id
    ).first()
    if not ok:
        try:
            snap_json = json.dumps(snapshot, ensure_ascii=False)
        except (TypeError, ValueError):
            snap_json = "{}"
        if row is None:
            row = WrongItem(
                child_id=child_id,
                subject=subject,
                item_type=kind,
                item_id=item_id,
                ref_text=ref_text,
                snapshot_json=snap_json,
                wrong_count=1,
                last_wrong_at=now_iso(),
            )
            db.session.add(row)
        else:
            row.wrong_count = (row.wrong_count or 0) + 1
            row.correct_streak = 0
            row.mastered = False
            row.last_wrong_at = now_iso()
            row.ref_text = ref_text
            row.snapshot_json = snap_json
    elif row is not None and not row.mastered:
        row.correct_streak = (row.correct_streak or 0) + 1
        if row.correct_streak >= 2:
            row.mastered = True
    return row


def save_progress(task: DailyTask, child_id: int, subject: str, item_id: int, answer: str,
                  duration_ms: int, today: str | None = None) -> None:
    """每答一题就存一次，退出再进来才能接着往下做。

    同一道题重复答以最后一次为准（重练／点了下一个选项），所以是 upsert 而不是追加。
    """
    today = today or today_str()
    row = TaskAnswer.query.filter_by(task_id=task.id, item_id=item_id).first()
    if row is None:
        row = TaskAnswer(task_id=task.id, item_id=item_id)
        db.session.add(row)
    row.child_id = child_id
    row.date = today
    row.subject = subject
    row.answer = str(answer or "")[:200]
    row.duration_ms = int(duration_ms or 0)
    row.updated_at = now_iso()


def load_progress(task: DailyTask) -> dict[int, dict]:
    """已答存档，key 是题目编号。"""
    rows = TaskAnswer.query.filter_by(task_id=task.id).all()
    return {
        int(r.item_id): {
            "item_id": int(r.item_id),
            "answer": r.answer or "",
            "duration_ms": r.duration_ms or 0,
        }
        for r in rows
    }


def _snapshot(item) -> dict:
    """留一份精简快照，重练时直接还原这道题。"""
    keys = (
        "kind", "type", "stem", "answer", "options", "tokens", "unit", "topic", "level",
        "char", "pinyin", "radical", "strokes", "structure", "words", "sentence",
        # blank 决定补全题的空框在题字左边还是右边，漏了它重练时词序会反过来
        "blank",
        "word", "phonetic", "pos", "meaning", "example", "example_cn",
        "symbol", "category", "mouth_tip", "en", "cn", "key_words", "line",
        "masked", "blanks", "solution",
    )
    snap = {k: item[k] for k in keys if k in item}
    snap["ref_id"] = taskgen.item_key(item)
    return snap


def submit(child, subject: str, answers: list[dict], today: str | None = None) -> dict:
    today = today or today_str()
    task = DailyTask.query.filter_by(child_id=child.id, date=today, subject=subject).first()
    if task is None:
        task = taskgen.get_or_create_task(child, subject, today)

    if task.status == "done":
        return {
            "already_done": True,
            "score": task.score,
            "correct": task.correct,
            "total": task.total,
            "points": {"earned": 0, "detail": []},
            "checkin": {"done": True, "streak": points.current_streak(child.id, today)},
        }

    payload = taskgen.load_payload(task)
    items = payload.get("items", [])

    # 以服务端存档为准，客户端这次传上来的答案覆盖同编号的旧值。
    # 这样即使孩子中途退出、换了标签页重新进来，前半段答过的题也不会丢。
    answer_map = load_progress(task)
    for a in answers or []:
        try:
            answer_map[int(a.get("item_id"))] = {
                "item_id": int(a.get("item_id")),
                "answer": str(a.get("answer", "")),
                "duration_ms": int(a.get("duration_ms") or 0),
            }
        except (TypeError, ValueError):
            continue

    correct_count = 0
    total_ms = 0
    wrong_list = []
    retry_ok = 0
    handled = set()

    for item in items:
        item_id = int(item["item_id"])
        kind = item.get("kind", "item")
        submitted = answer_map.get(item_id)
        if submitted is None:
            continue
        user_answer = str(submitted.get("answer", ""))
        duration = int(submitted.get("duration_ms") or 0)
        total_ms += duration

        # 古诗不判分：背得好不好留给家长听录音，这里只确认「背过了」
        if kind in NO_SCORE_KINDS:
            recited = user_answer == POEM_RECITED
            db.session.add(
                StudyRecord(
                    child_id=child.id,
                    date=today,
                    subject=subject,
                    task_id=task.id,
                    item_type=kind,
                    item_id=item_id,
                    stem=item.get("stem", ""),
                    user_answer="背诵录音" if recited else "未背诵",
                    correct_answer="",
                    # 背得好不好交给家长听录音判断；只要交了录音就记「对」，
                    # 没交才记「错」——学习记录里不该出现既不完成也不算错的灰状态
                    is_correct=recited,
                    duration_ms=duration,
                )
            )
            key = taskgen.item_key(item)
            mark = (kind, key)
            if recited and mark not in handled:
                handled.add(mark)
                if kind in srs.SRS_KINDS:
                    srs.record(child.id, subject, kind, key, True, today)
            continue

        # 朗读/认读卡：不计分、不进错题本，只记「读过了」。但必须写 SRS，
        # 否则这些字词第二天又被当成新词重新发一遍（朗读是它们唯一的「学过」入口）。
        if item.get("type") in taskgen.READ_TYPES:
            db.session.add(
                StudyRecord(
                    child_id=child.id,
                    date=today,
                    subject=subject,
                    task_id=task.id,
                    item_type=kind,
                    item_id=item_id,
                    stem=item.get("stem", ""),
                    user_answer=READ_LABELS.get(kind, "已朗读"),
                    correct_answer="",
                    is_correct=True,
                    duration_ms=duration,
                )
            )
            key = taskgen.item_key(item)
            if kind in srs.SRS_KINDS:
                srs.record(child.id, subject, kind, key, True, today)
            continue

        is_ok = grading.is_correct(item.get("answer"), user_answer)
        if is_ok:
            correct_count += 1
            if item.get("retry"):
                retry_ok += 1

        db.session.add(
            StudyRecord(
                child_id=child.id,
                date=today,
                subject=subject,
                task_id=task.id,
                item_type=item.get("kind", ""),
                item_id=item_id,
                stem=item.get("stem", ""),
                user_answer=user_answer[:180],
                correct_answer=str(item.get("answer", ""))[:180],
                is_correct=is_ok,
                duration_ms=duration,
            )
        )

        kind = item.get("kind", "item")
        key = taskgen.item_key(item)
        # 同一天同一知识点可能出好几道（数学尤其明显），错题本只记一次，
        # 否则「错 10 次」其实只是同一张卷子里错了 10 道同类题
        mark = (kind, key)
        if mark not in handled:
            handled.add(mark)
            # 数学每天现出题，没有稳定身份，只有语文英语进复习队列
            if kind in srs.SRS_KINDS:
                srs.record(child.id, subject, kind, key, is_ok, today)
            _upsert_wrong(child.id, subject, kind, key, item.get("stem", ""), is_ok, _snapshot(item))

        if not is_ok:
            wrong_list.append(
                {
                    "item_id": item_id,
                    "stem": item.get("stem", ""),
                    "user_answer": user_answer,
                    "correct_answer": str(item.get("answer", "")),
                    "kind": kind,
                }
            )

    total = taskgen.count_scored({"items": items})
    score = grading.score_of(correct_count, total)
    task.status = "done"
    task.score = score
    task.correct = correct_count
    task.total = total
    task.duration_sec = round(total_ms / 1000)
    task.completed_at = now_iso()
    db.session.flush()

    detail = []
    earned = 0
    if score >= 60:
        got = points.add(
            child.id,
            int(get_setting("point_per_subject") or 0),
            f"subject_{subject}",
            "task",
            task.id,
            today=today,
        )
        earned += got
        if got:
            detail.append({"reason": f"{taskgen.SUBJECT_LABELS.get(subject, subject)}完成", "points": got})
    if score >= 90:
        got = points.add(
            child.id,
            int(get_setting("point_per_excellent") or 0),
            f"excellent_{subject}",
            "task",
            task.id,
            today=today,
        )
        earned += got
        if got:
            detail.append({"reason": "正确率优秀", "points": got})

    # 错题订正：重练答对才给分，每天有上限，防止靠刷错题攒积分
    fix_points = int(get_setting("point_wrong_fix") or 0)
    if retry_ok and fix_points > 0:
        room = retry_ok * fix_points
        delta = min(retry_ok * fix_points, room)
        if delta > 0:
            got = points.add(child.id, delta, "wrong_fix", "task", task.id, today=today)
            earned += got
            if got:
                detail.append({"reason": f"错题订正 {retry_ok} 道", "points": got})

    done_subjects = [
        t.subject
        for t in DailyTask.query.filter_by(child_id=child.id, date=today, status="done").all()
    ]
    checkin_row, newly_done = points.upcert_checkin(child.id, today, done_subjects)
    checkin_info = {
        "done": checkin_row.status == "full",
        "newly_done": newly_done,
        "streak": checkin_row.streak or 0,
        "subjects": json.loads(checkin_row.subjects_json or "[]"),
    }
    if newly_done:
        award = points.award_checkin(child.id, today, checkin_row, already_awarded=False)
        earned += award["earned"]
        detail.extend(award["detail"])

    db.session.commit()

    return {
        "already_done": False,
        "score": score,
        "correct": correct_count,
        "total": total,
        "duration_sec": task.duration_sec,
        "wrong": wrong_list,
        "retry_correct": retry_ok,
        "points": {"earned": earned, "detail": detail, "balance": points.balance(child.id)},
        "checkin": checkin_info,
    }


def today_summary(child, today: str | None = None) -> dict:
    today = today or today_str()
    tasks = {t.subject: t for t in DailyTask.query.filter_by(child_id=child.id, date=today).all()}
    subjects = []
    for subject in taskgen.SUBJECTS:
        t = tasks.get(subject)
        subjects.append(
            {
                "subject": subject,
                "label": taskgen.SUBJECT_LABELS[subject],
                "status": t.status if t else "pending",
                "score": t.score if t else 0,
                "total": t.total if t else 0,
                "correct": t.correct if t else 0,
                "duration_sec": t.duration_sec if t else 0,
            }
        )

    checkin = Checkin.query.filter_by(child_id=child.id, date=today).first()
    done_count = sum(1 for s in subjects if s["status"] == "done")
    return {
        "subjects": subjects,
        "done_count": done_count,
        "checkin": {
            "done": bool(checkin and checkin.status == "full"),
            "status": checkin.status if checkin else "none",
            "streak": (checkin.streak if checkin else 0) or points.current_streak(child.id, today),
            "points": checkin.points if checkin else 0,
        },
        "points_balance": points.balance(child.id),
    }
