import bcrypt
from flask import Blueprint, request
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required

from ..extensions import db
from ..models import AdminUser
from ..utils.dates import now_iso
from ..utils.responses import fail, ok

bp = Blueprint("auth", __name__)


def hash_password(raw: str) -> str:
    return bcrypt.hashpw(raw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def check_password(raw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(raw.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


@bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        return fail("VALIDATION_ERROR", "请输入账号和密码", 422)

    user = AdminUser.query.filter_by(username=username).first()
    if user is None or not check_password(password, user.password_hash):
        return fail("AUTH_FAILED", "账号或密码不正确", 401)

    token = create_access_token(identity=str(user.id))
    user.last_login_at = now_iso()
    db.session.commit()
    return ok({"token": token, "username": user.username})


@bp.get("/me")
@jwt_required()
def me():
    user = AdminUser.query.get(int(get_jwt_identity()))
    if user is None:
        return fail("AUTH_FAILED", "账号不存在", 401)
    return ok({"username": user.username, "last_login_at": user.last_login_at})


@bp.post("/password")
@jwt_required()
def change_password():
    data = request.get_json(silent=True) or {}
    old = data.get("old_password") or ""
    new = data.get("new_password") or ""
    if len(new) < 6:
        return fail("VALIDATION_ERROR", "新密码至少 6 位", 422)

    user = AdminUser.query.get(int(get_jwt_identity()))
    if user is None or not check_password(old, user.password_hash):
        return fail("AUTH_FAILED", "原密码不正确", 400)
    user.password_hash = hash_password(new)
    db.session.commit()
    return ok({"changed": True})
