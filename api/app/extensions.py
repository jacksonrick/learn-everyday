from flask_cors import CORS
from flask_jwt_extended import JWTManager
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import event
from sqlalchemy.engine import Engine

db = SQLAlchemy()
jwt = JWTManager()
cors = CORS()


@event.listens_for(Engine, "connect")
def _sqlite_pragma(dbapi_connection, connection_record):
    """开启 WAL 与外键，提升并发读写的稳定性。"""
    try:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()
    except Exception:
        pass
