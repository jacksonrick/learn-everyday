from ..extensions import db
from .base import BaseModel


class Grade(BaseModel):
    """年级：小学 1-6、初中 1-3、高中 1-3，可自行增删。"""

    __tablename__ = "grade"

    name = db.Column(db.String(20), nullable=False)
    stage = db.Column(db.String(10), nullable=False, default="小学")

    def to_dict(self, exclude=()):
        return super().to_dict(exclude)


class Child(BaseModel):
    __tablename__ = "child"

    name = db.Column(db.String(30), nullable=False)
    gender = db.Column(db.String(10), default="male")
    birthday = db.Column(db.String(10))
    grade_id = db.Column(db.Integer, db.ForeignKey("grade.id"))
    term = db.Column(db.String(4), default="上")
    avatar = db.Column(db.String(16), default="🐣")

    grade = db.relationship("Grade", lazy="joined")

    @property
    def grade_name(self):
        return self.grade.name if self.grade else ""

    @property
    def age(self):
        if not self.birthday:
            return None
        from datetime import date

        try:
            y, m, d = (int(x) for x in self.birthday.split("-"))
            today = date.today()
            return today.year - y - ((today.month, today.day) < (m, d))
        except Exception:
            return None

    def to_dict(self, exclude=()):
        data = super().to_dict(exclude)
        data["grade_name"] = self.grade_name
        data["age"] = self.age
        return data
