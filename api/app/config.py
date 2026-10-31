import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(BASE_DIR / ".env")


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "learneveryday-dev-secret-change-me")
    JWT_SECRET_KEY = SECRET_KEY
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(days=7)

    DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR)))
    DB_PATH = Path(os.getenv("DB_PATH", str(DATA_DIR / "db.sqlite")))
    SQLALCHEMY_DATABASE_URI = f"sqlite:///{DB_PATH}"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        "connect_args": {"check_same_thread": False, "timeout": 15},
        "pool_pre_ping": True,
    }

    WEB_DIST = os.getenv("WEB_DIST", str(BASE_DIR / "web" / "dist"))
    BACKUP_DIR = Path(os.getenv("BACKUP_DIR", str(BASE_DIR / "backups")))
    BACKUP_KEEP = int(os.getenv("BACKUP_KEEP", "7"))

    ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")

    JSON_SORT_KEYS = False
