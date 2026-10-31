import shutil
from datetime import date
from pathlib import Path

from flask import Flask, send_from_directory

from .config import Config
from .extensions import cors, db, jwt
from .utils.dates import today_str
from .utils.responses import fail


def create_app(config_class=Config) -> Flask:
    app = Flask(__name__, static_folder=None)
    app.config.from_object(config_class)
    app.json.ensure_ascii = False
    app.json.sort_keys = False

    db.init_app(app)
    jwt.init_app(app)
    cors.init_app(app, resources={r"/api/*": {"origins": "*"}})

    from .api import register_blueprints

    register_blueprints(app)
    _register_jwt_handlers(app)
    _register_error_handlers(app)
    _register_spa(app)

    with app.app_context():
        db.create_all()
        from .seed.seed import ensure_seed

        ensure_seed()
        _daily_backup(app)

    return app


def _register_jwt_handlers(app: Flask):
    @jwt.unauthorized_loader
    def _missing(reason):
        return fail("AUTH_REQUIRED", "请先登录", 401)

    @jwt.invalid_token_loader
    def _invalid(reason):
        return fail("AUTH_REQUIRED", "登录状态无效，请重新登录", 401)

    @jwt.expired_token_loader
    def _expired(header, payload):
        return fail("AUTH_REQUIRED", "登录已过期，请重新登录", 401)


def _register_error_handlers(app: Flask):
    @app.errorhandler(404)
    def _nf(e):
        return fail("NOT_FOUND", "接口不存在", 404)

    @app.errorhandler(405)
    def _na(e):
        return fail("VALIDATION_ERROR", "请求方法不支持", 405)

    @app.errorhandler(Exception)
    def _err(e):
        app.logger.exception("unhandled error")
        return fail("INTERNAL", f"服务端异常: {e}", 500)


def _register_spa(app: Flask):
    dist = Path(app.config["WEB_DIST"])

    @app.get("/")
    @app.get("/<path:path>")
    def spa(path: str = ""):
        if path.startswith("api/"):
            return fail("NOT_FOUND", "接口不存在", 404)
        target = (dist / path).resolve()
        if path and target.is_file() and str(target).startswith(str(dist.resolve())):
            return send_from_directory(dist, path)
        index = dist / "index.html"
        if index.exists():
            return send_from_directory(dist, "index.html")
        return (
            "<meta charset='utf-8'><h2>前端尚未构建</h2>"
            "<p>请先在 web 目录执行 <code>npm install && npm run build</code>，"
            "或用 <code>npm run dev</code> 访问 5173 端口。</p>",
            200,
        )


def _daily_backup(app: Flask):
    db_path: Path = Path(app.config["DB_PATH"])
    if not db_path.exists():
        return
    backup_dir: Path = Path(app.config["BACKUP_DIR"])
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / f"db-{today_str()}.sqlite"
    if target.exists():
        return
    try:
        shutil.copy2(db_path, target)
        olds = sorted(backup_dir.glob("db-*.sqlite"))
        keep = int(app.config["BACKUP_KEEP"])
        for old in olds[:-keep]:
            old.unlink(missing_ok=True)
    except OSError as exc:  # noqa: BLE001
        app.logger.warning("备份失败: %s", exc)
