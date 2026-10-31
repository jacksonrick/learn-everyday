from flask import jsonify


def ok(data=None, **extra):
    payload = {"ok": True, "data": data}
    payload.update(extra)
    return jsonify(payload)


def fail(code: str, message: str, status: int = 400):
    resp = jsonify({"ok": False, "error": {"code": code, "message": message}})
    resp.status_code = status
    return resp


def paginated(items, total, page, page_size, extra=None):
    data = {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }
    if extra:
        data.update(extra)
    return ok(data)


def parse_page(args):
    try:
        page = max(1, int(args.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = min(200, max(1, int(args.get("page_size", 20))))
    except (TypeError, ValueError):
        page_size = 20
    return page, page_size
