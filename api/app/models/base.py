from ..extensions import db
from ..utils.dates import now_iso


class BaseModel(db.Model):
    __abstract__ = True

    id = db.Column(db.Integer, primary_key=True)
    created_at = db.Column(db.String(32), default=now_iso, nullable=False)

    def to_dict(self, exclude=()):
        out = {}
        for col in self.__table__.columns:
            if col.name in exclude:
                continue
            out[col.name] = getattr(self, col.name)
        return out

    def update_from(self, data: dict, fields):
        for f in fields:
            if f in data:
                setattr(self, f, data[f])
