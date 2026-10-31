from ..extensions import db
from .base import BaseModel


class ChineseChar(BaseModel):
    __tablename__ = "chinese_char"

    char = db.Column(db.String(4), nullable=False)
    pinyin = db.Column(db.String(40), nullable=False, default="")
    radical = db.Column(db.String(8), default="")
    strokes = db.Column(db.Integer, default=0)
    structure = db.Column(db.String(10), default="")
    words_json = db.Column(db.Text, default="[]")
    sentence = db.Column(db.String(200), default="")
    is_key = db.Column(db.Boolean, default=False)
    # 难度：容易 / 较易 / 中等 / 较难 / 困难，出题按比例筛选
    level = db.Column(db.String(8), default="中等")
    audio_url = db.Column(db.String(200), default="")


class Poem(BaseModel):
    __tablename__ = "poem"

    title = db.Column(db.String(100), nullable=False)
    author = db.Column(db.String(40), default="")
    dynasty = db.Column(db.String(20), default="")
    genre = db.Column(db.String(10), default="诗")
    content = db.Column(db.Text, nullable=False, default="")
    pinyin_json = db.Column(db.Text, default="[]")
    translation = db.Column(db.Text, default="")
    notes = db.Column(db.Text, default="")
    appreciation = db.Column(db.Text, default="")
    level = db.Column(db.String(8), default="中等")
    audio_url = db.Column(db.String(200), default="")

    @property
    def lines(self):
        return [ln for ln in (self.content or "").split("\n") if ln.strip()]


class EnglishWord(BaseModel):
    __tablename__ = "english_word"

    word = db.Column(db.String(60), nullable=False)
    phonetic = db.Column(db.String(80), default="")
    pos = db.Column(db.String(20), default="")
    meaning = db.Column(db.String(120), default="")
    example = db.Column(db.String(200), default="")
    example_cn = db.Column(db.String(200), default="")
    kind = db.Column(db.String(10), default="单词")
    level = db.Column(db.String(8), default="中等")
    audio_url = db.Column(db.String(200), default="")


class EnglishSentence(BaseModel):
    __tablename__ = "english_sentence"

    en = db.Column(db.String(200), nullable=False)
    cn = db.Column(db.String(200), default="")
    key_words = db.Column(db.String(200), default="")
    phonetic_tip = db.Column(db.String(200), default="")
    level = db.Column(db.String(8), default="中等")
    audio_url = db.Column(db.String(200), default="")


class EnglishPhoneme(BaseModel):
    __tablename__ = "english_phoneme"

    symbol = db.Column(db.String(20), nullable=False)
    type = db.Column(db.String(10), default="vowel")
    category = db.Column(db.String(20), default="")
    examples_json = db.Column(db.Text, default="[]")
    mouth_tip = db.Column(db.String(200), default="")
    audio_url = db.Column(db.String(200), default="")


class MathRule(BaseModel):
    __tablename__ = "math_rule"

    name = db.Column(db.String(60), nullable=False)
    generator = db.Column(db.String(60), nullable=False)
    grade_id = db.Column(db.Integer, db.ForeignKey("grade.id"))
    term = db.Column(db.String(4), default="上")
    topic = db.Column(db.String(40), default="")
    params_json = db.Column(db.Text, default="{}")
    # 规则也有难度档，用于「20 题按 10/40/30/15/5 分配」时挑规则
    level = db.Column(db.String(8), default="中等")


class MathQuestion(BaseModel):
    __tablename__ = "math_question"

    grade_id = db.Column(db.Integer, db.ForeignKey("grade.id"))
    term = db.Column(db.String(4), default="上")
    topic = db.Column(db.String(40), default="")
    type = db.Column(db.String(20), default="application")
    stem = db.Column(db.Text, nullable=False)
    answer = db.Column(db.String(60), nullable=False)
    unit = db.Column(db.String(10), default="")
    options_json = db.Column(db.Text, default="[]")
    solution = db.Column(db.Text, default="")
    level = db.Column(db.String(8), default="中等")
