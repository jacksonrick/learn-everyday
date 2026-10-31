"""首次启动时的初始化数据。"""

import json
import re

from flask import current_app
from sqlalchemy import inspect, text

from ..extensions import db
from ..models import (
    AdminUser,
    Child,
    ChineseChar,
    EnglishPhoneme,
    EnglishSentence,
    EnglishWord,
    Grade,
    MathRule,
    Poem,
    StudyRecord,
)
from ..services import level as level_svc

# 年级是内置固定数据：小学 1-6 + 初中 1-3，不提供管理入口，也不需要高中。
# 第三列是学段内的顺序号，只用于把 MATH_RULES 里的「几年级」翻译成年级名。
GRADES = [
    ("一年级", "小学", 1),
    ("二年级", "小学", 2),
    ("三年级", "小学", 3),
    ("四年级", "小学", 4),
    ("五年级", "小学", 5),
    ("六年级", "小学", 6),
    ("初一", "初中", 7),
    ("初二", "初中", 8),
    ("初三", "初中", 9),
]

MATH_RULES = [
    # (年级序号 1-9，对应 GRADES 的顺序, 学期, 知识点名称, 出题器)
    (1, "上", "10 以内加减法", "add_sub_10"),
    (1, "上", "20 以内加法", "add_sub_20"),
    (1, "上", "三个数连加", "add_three_numbers"),
    (1, "下", "20 以内加减法", "add_sub_20"),
    (1, "下", "100 以内不进位加减", "add_sub_100_nocarry"),
    (2, "上", "100 以内进位加法", "add_sub_100_carry"),
    (2, "上", "表内乘法", "mul_table"),
    (2, "上", "乘加混合", "mul_add_mixed"),
    (2, "下", "表内除法", "div_table"),
    (2, "下", "有余数除法", "div_remainder"),
    (2, "下", "100 以内退位减法", "add_sub_100_carry"),
    (3, "上", "万以内加减法", "add_sub_10000"),
    (3, "上", "两位数乘一位数", "mul_2digit_by_1"),
    (3, "上", "多位数乘一位数", "mul_3digit_by_1"),
    (3, "上", "整十整百乘法", "mul_round_tens"),
    (3, "下", "两位数除以一位数", "div_2digit_by_1"),
    (3, "下", "三位数除以一位数", "div_3digit_by_1"),
    (3, "下", "两步混合运算", "two_step_paren"),
    (3, "下", "万以内加减法", "add_sub_10000"),
    (4, "上", "三位数乘两位数", "mul_3digit_by_2digit"),
    (4, "上", "除数是两位数的除法", "div_by_2digit"),
    (4, "上", "大数加减法", "add_sub_large"),
    (4, "下", "运算律简算", "simple_law"),
    (4, "下", "两位数除法有余数", "div_remainder_2digit"),
    (4, "下", "两步混合运算", "two_step_paren"),
    (5, "上", "小数加减法", "decimal_add_sub"),
    (5, "上", "小数乘整数", "decimal_mul_int"),
    (5, "上", "小数除以整数", "decimal_div_int"),
    (5, "下", "同分母分数加法", "fraction_add_same"),
    (5, "下", "简易方程", "simple_equation"),
    (5, "下", "小数加减法", "decimal_add_sub"),
    (6, "上", "分数乘法", "fraction_mul"),
    (6, "上", "分数除法", "fraction_div"),
    (6, "上", "化简比", "ratio_simplify"),
    (6, "下", "小数化百分数", "percent_decimal"),
    (6, "下", "分数化小数", "fraction_decimal"),
    (6, "下", "化简比", "ratio_simplify"),
]

# (汉字, 拼音, 部首, 笔画, 结构, 组词, 例句, 等级)
SAMPLE_CHARS = [
    ("晨", "chén", "日", 11, "上下", ["早晨", "清晨"], "早晨的空气很新鲜。", "较易"),
]

SAMPLE_POEMS = [
    {
        "title": "望天门山",
        "author": "李白",
        "dynasty": "唐",
        "content": "天门中断楚江开，碧水东流至此回。\n两岸青山相对出，孤帆一片日边来。",
        "translation": "天门山被楚江冲开，碧绿的江水东流到这里回旋。两岸青山相对而出，一片孤帆从日边驶来。",
    },
]

# (单词, 音标, 词性, 释义, 例句, 例句翻译, 等级)
SAMPLE_WORDS = [
    ("school", "/skuːl/", "n.", "学校", "I go to school by bus.", "我坐公交车去学校。", "容易"),
    ("teacher", "/ˈtiːtʃə/", "n.", "老师", "Miss Li is my teacher.", "李老师是我的老师。", "容易"),
    ("student", "/ˈstjuːdnt/", "n.", "学生", "I am a student.", "我是一名学生。", "较易"),
]

# (英文, 中文, 重点词, 等级)
SAMPLE_SENTENCES = [
    ("This is my book.", "这是我的书。", "this,is,my,book", "容易"),
    ("I have a new ruler.", "我有一把新尺子。", "have,new,ruler", "容易"),
    ("Open your book, please.", "请打开你的书。", "open,your,book", "较易"),
]

SAMPLE_PHONEMES = [
    # 元音 20 个：单元音 12 + 双元音 8
    ("/iː/", "vowel", "长元音", ["see", "tree", "meet"], "嘴角向两边拉开，发长长的“衣”音。"),
    ("/ɪ/", "vowel", "短元音", ["sit", "big", "pig"], "短促的“衣”，嘴角放松。"),
    ("/e/", "vowel", "短元音", ["bed", "pen", "red"], "嘴巴半开，舌尖抵下齿。"),
    ("/æ/", "vowel", "短元音", ["cat", "bag", "hand"], "嘴巴张大，介于“啊”和“哎”之间。"),
    ("/ɑː/", "vowel", "长元音", ["car", "star", "park"], "嘴巴张大，声音拉长。"),
    ("/ɒ/", "vowel", "短元音", ["dog", "hot", "box"], "嘴巴张开略圆，短促的“喔”。"),
    ("/ɔː/", "vowel", "长元音", ["door", "four", "wall"], "嘴唇收圆前突，声音拉长。"),
    ("/ʊ/", "vowel", "短元音", ["book", "look", "good"], "嘴唇稍圆，短促的“乌”。"),
    ("/uː/", "vowel", "长元音", ["zoo", "food", "moon"], "嘴唇收得很圆，声音拉长。"),
    ("/ʌ/", "vowel", "短元音", ["cup", "bus", "sun"], "嘴巴自然半开，短促的“啊”。"),
    ("/ɜː/", "vowel", "长元音", ["bird", "girl", "nurse"], "舌位居中，嘴唇放松拉长。"),
    ("/ə/", "vowel", "短元音", ["about", "sofa", "teacher"], "最轻的弱读音，一带而过。"),
    ("/eɪ/", "vowel", "双元音", ["day", "play", "name"], "从 /e/ 滑向 /ɪ/，前重后轻。"),
    ("/aɪ/", "vowel", "双元音", ["my", "bike", "five"], "从 /a/ 滑向 /ɪ/，像“爱”。"),
    ("/ɔɪ/", "vowel", "双元音", ["boy", "toy", "enjoy"], "从 /ɔ/ 滑向 /ɪ/，像“奥衣”。"),
    ("/aʊ/", "vowel", "双元音", ["now", "house", "mouth"], "从 /a/ 滑向 /ʊ/，像“傲”。"),
    ("/əʊ/", "vowel", "双元音", ["go", "home", "no"], "从 /ə/ 滑向 /ʊ/，像“欧”。"),
    ("/ɪə/", "vowel", "双元音", ["ear", "near", "idea"], "从 /ɪ/ 滑向 /ə/，像“衣额”。"),
    ("/eə/", "vowel", "双元音", ["air", "hair", "bear"], "从 /e/ 滑向 /ə/，像“哎额”。"),
    ("/ʊə/", "vowel", "双元音", ["tour", "poor", "sure"], "从 /ʊ/ 滑向 /ə/，像“乌额”。"),
    # 辅音 28 个：爆破 6 + 摩擦 9 + 破擦 6 + 鼻音 3 + 舌侧 1 + 半元音 3
    ("/p/", "consonant", "爆破音", ["pen", "apple", "map"], "双唇闭合再突然放开，不振动声带。"),
    ("/b/", "consonant", "爆破音", ["bag", "boy", "big"], "同 /p/，但声带要振动。"),
    ("/t/", "consonant", "爆破音", ["ten", "cat", "sit"], "舌尖抵上齿龈后弹开，不振动声带。"),
    ("/d/", "consonant", "爆破音", ["dog", "dad", "bed"], "同 /t/，但声带振动。"),
    ("/k/", "consonant", "爆破音", ["cat", "key", "book"], "舌根抵软腭后弹开，不振动声带。"),
    ("/g/", "consonant", "爆破音", ["go", "bag", "girl"], "同 /k/，但声带振动。"),
    ("/f/", "consonant", "摩擦音", ["fish", "five", "coffee"], "上齿轻触下唇送气，不振动声带。"),
    ("/v/", "consonant", "摩擦音", ["very", "love", "seven"], "同 /f/，但声带振动。"),
    ("/θ/", "consonant", "摩擦音", ["think", "three", "mouth"], "舌尖轻放齿间送气，不振动声带。"),
    ("/ð/", "consonant", "摩擦音", ["this", "that", "mother"], "同 /θ/，但声带振动。"),
    ("/s/", "consonant", "摩擦音", ["sun", "six", "bus"], "舌尖靠近齿龈，像“丝”，不振动。"),
    ("/z/", "consonant", "摩擦音", ["zoo", "zero", "is"], "同 /s/，但声带振动。"),
    ("/ʃ/", "consonant", "摩擦音", ["she", "fish", "shoe"], "嘴唇稍前突，像“嘘”，不振动。"),
    ("/ʒ/", "consonant", "摩擦音", ["measure", "pleasure", "usually"], "同 /ʃ/，但声带振动。"),
    ("/h/", "consonant", "摩擦音", ["he", "hat", "hot"], "气流从喉咙轻轻呼出。"),
    ("/tʃ/", "consonant", "破擦音", ["chair", "teacher", "watch"], "像“吃”，先堵后摩擦，不振动。"),
    ("/dʒ/", "consonant", "破擦音", ["job", "orange", "bridge"], "像“知”，同 /tʃ/ 但声带振动。"),
    ("/tr/", "consonant", "破擦音", ["tree", "train", "try"], "像“戳”，/t/ 快速滑向 /r/。"),
    ("/dr/", "consonant", "破擦音", ["dress", "driver", "dream"], "同 /tr/，但声带振动。"),
    ("/ts/", "consonant", "破擦音", ["cats", "hats", "students"], "像“次”，多在词尾。"),
    ("/dz/", "consonant", "破擦音", ["beds", "hands", "friends"], "同 /ts/，但声带振动。"),
    ("/m/", "consonant", "鼻音", ["man", "mum", "come"], "双唇闭合，气流从鼻腔出。"),
    ("/n/", "consonant", "鼻音", ["no", "nine", "sun"], "舌尖抵齿龈，气流从鼻腔出。"),
    ("/ŋ/", "consonant", "鼻音", ["sing", "going", "long"], "舌根抵软腭，气流从鼻腔出。"),
    ("/l/", "consonant", "舌侧音", ["leg", "like", "school"], "舌尖抵齿龈，气流从舌两侧出。"),
    ("/r/", "consonant", "半元音", ["red", "run", "car"], "舌尖卷起不碰上腭，声带振动。"),
    ("/j/", "consonant", "半元音", ["yes", "you", "boy"], "像“耶”的开头，很快滑向元音。"),
    ("/w/", "consonant", "半元音", ["we", "water", "what"], "双唇收圆，像“乌”的开头。"),
]


def ensure_seed():
    _drop_legacy_enabled_columns()
    _seed_grades()
    # 表结构迁移必须先做：后面的 seed 会读写新列（如 v8 的 level）
    _run_migrations()
    _seed_admin()
    _seed_math_rules()
    _seed_samples()
    _seed_phonemes()
    _seed_child()
    _seed_rewards()


SAMPLE_REWARDS = [
    ("周末多看 30 分钟动画", 100, "📺"),
    ("选一个想吃的晚餐", 150, "🍜"),
    ("周末去公园玩半天", 200, "🌳"),
    ("买一本新绘本", 300, "📚"),
]


def _seed_rewards():
    from ..models import Reward

    if Reward.query.count() > 0:
        return
    for name, cost, icon in SAMPLE_REWARDS:
        db.session.add(Reward(name=name, cost=cost, icon=icon, stock=-1))
    db.session.commit()


def _seed_grades():
    """年级内置且固定：缺的补上，多出来的（如旧库的高中）连带引用一起清掉。

    年级不再是可维护的数据，所以这里每次都做一遍同步，保证下拉框永远是
    「一年级…六年级、初一…初三」，不会因为旧库残留而出现高中。
    """
    from ..models import MathQuestion

    keep = {name for name, _stage, _order in GRADES}
    existing = {g.name: g for g in Grade.query.all()}

    for name, stage, _order in GRADES:
        row = existing.get(name)
        if row is None:
            db.session.add(Grade(name=name, stage=stage))
        elif row.stage != stage:
            row.stage = stage

    for row in existing.values():
        if row.name in keep:
            continue
        # 先摘引用，再删年级，避免留下指向不存在年级的数据
        Child.query.filter_by(grade_id=row.id).update({"grade_id": None})
        MathRule.query.filter_by(grade_id=row.id).delete()
        MathQuestion.query.filter_by(grade_id=row.id).delete()
        db.session.delete(row)
    db.session.commit()


def _seed_admin():
    if AdminUser.query.count() > 0:
        return
    from ..api.auth import hash_password

    db.session.add(
        AdminUser(
            username=current_app.config["ADMIN_USERNAME"],
            password_hash=hash_password(current_app.config["ADMIN_PASSWORD"]),
        )
    )
    db.session.commit()


def _default_params(generator: str) -> str:
    from ..services import mathgen

    params = {}
    for item in mathgen.GENERATOR_SPECS.get(generator, {}).get("params", []):
        params[item["key"]] = item.get("default")
    return json.dumps(params, ensure_ascii=False)


def _seed_math_rules():
    if MathRule.query.count() > 0:
        return
    grades = {g.name: g for g in Grade.query.all()}
    names = {order: name for name, _stage, order in GRADES}
    for order, term, name, generator in MATH_RULES:
        grade = grades.get(names.get(order, ""))
        if grade is None:
            continue
        db.session.add(
            MathRule(
                name=name,
                generator=generator,
                grade_id=grade.id,
                term=term,
                topic=name,
                params_json=_default_params(generator),
                # 规则难度跟着年级走：一二年级容易 … 六年级困难
                level=level_svc.from_grade(order),
            )
        )
    db.session.commit()


def _seed_phonemes():
    """48 个国际音标内置；已存在的按 symbol 保留家长改过的内容。"""
    existing = {p.symbol for p in EnglishPhoneme.query.all()}
    added = 0
    for symbol, ptype, category, examples, tip in SAMPLE_PHONEMES:
        if symbol in existing:
            continue
        db.session.add(
            EnglishPhoneme(
                symbol=symbol,
                type=ptype,
                category=category,
                examples_json=json.dumps(examples, ensure_ascii=False),
                mouth_tip=tip,
            )
        )
        added += 1
    if added:
        db.session.commit()


DATA_VERSION_KEY = "data_version"


def _data_version() -> int:
    from ..models import Setting

    row = Setting.query.filter_by(key=DATA_VERSION_KEY).first()
    if row is None:
        return 1
    try:
        return int(json.loads(row.value))
    except (TypeError, ValueError):
        return 1


def _set_data_version(version: int):
    from ..models import Setting

    row = Setting.query.filter_by(key=DATA_VERSION_KEY).first()
    if row is None:
        db.session.add(Setting(key=DATA_VERSION_KEY, value=json.dumps(version)))
    else:
        row.value = json.dumps(version)
    db.session.commit()


LEGACY_ENABLED_TABLES = (
    "grade",
    "child",
    "reward",
    "chinese_char",
    "poem",
    "english_word",
    "english_sentence",
    "english_phoneme",
    "math_rule",
    "math_question",
)


def _drop_legacy_enabled_columns():
    """v3 起取消「启用/停用」，物理删除即真删除；旧库直接丢掉 enabled 列。"""
    inspector = inspect(db.engine)
    tables = set(inspector.get_table_names())
    dropped = []
    for table in LEGACY_ENABLED_TABLES:
        if table not in tables:
            continue
        if "enabled" not in {c["name"] for c in inspector.get_columns(table)}:
            continue
        db.session.execute(text(f'ALTER TABLE "{table}" DROP COLUMN enabled'))
        dropped.append(table)
    if dropped:
        db.session.commit()
        current_app.logger.info("已移除启停用字段: %s", ", ".join(dropped))


def _drop_legacy_unit_columns():
    """v4 起题库不再按「单元」组织；旧库直接丢掉语文/英语三张表的 unit 列。

    数学题的 unit 是答案单位（元、个…），保留不动。
    """
    inspector = inspect(db.engine)
    tables = set(inspector.get_table_names())
    dropped = []
    for table in ("chinese_char", "english_word", "english_sentence"):
        if table not in tables:
            continue
        if "unit" not in {c["name"] for c in inspector.get_columns(table)}:
            continue
        db.session.execute(text(f'ALTER TABLE "{table}" DROP COLUMN unit'))
        dropped.append(table)
    if dropped:
        db.session.commit()
        current_app.logger.info("已移除单元字段: %s", ", ".join(dropped))


LEGACY_SORT_TABLES = (
    "chinese_char",
    "poem",
    "english_word",
    "english_sentence",
    "english_phoneme",
    "math_rule",
    "math_question",
    "grade",
    "reward",
)


def _drop_legacy_sort_columns():
    """v5 起不再有「排序」字段：列表按创建时间倒排，不用手工填序号。"""
    inspector = inspect(db.engine)
    tables = set(inspector.get_table_names())
    dropped = []
    for table in LEGACY_SORT_TABLES:
        if table not in tables:
            continue
        if "sort_order" not in {c["name"] for c in inspector.get_columns(table)}:
            continue
        db.session.execute(text(f'ALTER TABLE "{table}" DROP COLUMN sort_order'))
        dropped.append(table)
    if dropped:
        db.session.commit()
        current_app.logger.info("已移除排序字段: %s", ", ".join(dropped))


LEGACY_BANK_GRADE_TABLES = ("chinese_char", "poem", "english_word", "english_sentence")


def _rebuild_table_without(table: str, drop_cols):
    """SQLite 的 DROP COLUMN 不允许删外键列（grade_id 就是），只能重建表。

    做法：先改名为 ``<table>__old``，按原 DDL 去掉要删的列后建新表，
    拷回数据，再删旧表。四张题库表没有被别的表外键引用，改名不影响其它表。
    """
    row = db.session.execute(
        text("select sql from sqlite_master where type='table' and name=:name"),
        {"name": table},
    ).fetchone()
    if row is None or not row[0]:
        return False
    ddl = row[0]
    markers = tuple(f'"{c}"' for c in drop_cols) + tuple(drop_cols)
    lines = []
    for line in ddl.split("\n"):
        stripped = line.strip()
        # 列定义行：以列名开头；外键约束行：FOREIGN KEY(grade_id)
        lowered = stripped.lower()
        is_col = any(lowered.startswith(m.lower()) for m in markers)
        is_fk = lowered.startswith("foreign key") and any(f"({c.lower()})" in lowered for c in drop_cols)
        if is_col or is_fk:
            continue
        lines.append(line)
    # 删掉最后一条约束后，前一行会留下多余的逗号，语法上不合法
    new_ddl = re.sub(r",\s*\)\s*$", "\n)", "\n".join(lines))

    existing = [c["name"] for c in inspect(db.engine).get_columns(table)]
    keep = [c for c in existing if c not in drop_cols]
    quoted = ", ".join(f'"{c}"' for c in keep)

    old_name = f"{table}__old"
    db.session.execute(text(f'ALTER TABLE "{table}" RENAME TO "{old_name}"'))
    db.session.execute(text(new_ddl))
    db.session.execute(
        text(f'INSERT INTO "{table}" ({quoted}) SELECT {quoted} FROM "{old_name}"')
    )
    db.session.execute(text(f'DROP TABLE "{old_name}"'))
    return True


def _drop_legacy_bank_grade_columns():
    """v6 起语文、英语题库不再关联年级学期：只有数学按年级学期出题。

    四张表去掉 grade_id / term；数学的 math_rule / math_question 保留。
    """
    inspector = inspect(db.engine)
    tables = set(inspector.get_table_names())
    dropped = []
    for table in LEGACY_BANK_GRADE_TABLES:
        if table not in tables:
            continue
        cols = {c["name"] for c in inspector.get_columns(table)}
        drop = [c for c in ("grade_id", "term") if c in cols]
        if not drop:
            continue
        _rebuild_table_without(table, drop)
        dropped.append(f"{table}.{'/'.join(drop)}")
    if dropped:
        db.session.commit()
        current_app.logger.info("已移除题库的年级学期字段: %s", ", ".join(dropped))


def _add_wrong_snapshot_column():
    """v7 起错题保存整道题快照，第二天能原题重练。

    同时清空旧的复习队列与错题本：v6 之前这两张表存的是「当天第几题」，
    和题库主键对不上，留着只会让复习取到别的字。
    """
    inspector = inspect(db.engine)
    tables = set(inspector.get_table_names())
    if "wrong_item" in tables:
        cols = {c["name"] for c in inspector.get_columns("wrong_item")}
        if "snapshot_json" not in cols:
            db.session.execute(
                text("ALTER TABLE wrong_item ADD COLUMN snapshot_json TEXT DEFAULT '{}'")
            )
            current_app.logger.info("已为错题本增加题目快照字段")
    for table in ("srs_item", "wrong_item"):
        if table in tables:
            db.session.execute(text(f'DELETE FROM "{table}"'))
    # 迁移前生成的题目没有 ref_id，提交时会记到错误的编号上，未完成的直接作废重出
    if "daily_task" in tables:
        db.session.execute(text("DELETE FROM daily_task WHERE status <> 'done'"))
    db.session.commit()


LEVEL_TABLES = (
    "chinese_char",
    "poem",
    "english_word",
    "english_sentence",
    "math_rule",
    "math_question",
)

_GRADE_LEVEL_SQL = (
    ("一年级", "容易"),
    ("二年级", "容易"),
    ("三年级", "较易"),
    ("四年级", "中等"),
    ("五年级", "较难"),
    ("六年级", "困难"),
)


def _add_level_columns():
    """v8 起题库有「等级」：旧库补列，数学规则按所属年级把难度回填。"""
    inspector = inspect(db.engine)
    tables = set(inspector.get_table_names())
    added = []
    for table in LEVEL_TABLES:
        if table not in tables:
            continue
        if "level" in {c["name"] for c in inspector.get_columns(table)}:
            continue
        db.session.execute(
            text(f'ALTER TABLE "{table}" ADD COLUMN level VARCHAR(8) DEFAULT \'中等\'')
        )
        added.append(table)
    if "math_rule" in tables and "grade" in tables:
        for grade_name, lv in _GRADE_LEVEL_SQL:
            db.session.execute(
                text(
                    "UPDATE math_rule SET level = :lv "
                    "WHERE grade_id IN (SELECT id FROM grade WHERE name = :name)"
                ),
                {"lv": lv, "name": grade_name},
            )
    if added:
        db.session.commit()
        current_app.logger.info("已为题库增加等级字段: %s", ", ".join(added))


def _drop_math_rule_weight():
    """v9 起出题规则不再有权重：一道题出多少由「等级配额」决定。"""
    inspector = inspect(db.engine)
    if "math_rule" not in set(inspector.get_table_names()):
        return
    if "weight" not in {c["name"] for c in inspector.get_columns("math_rule")}:
        return
    _rebuild_table_without("math_rule", ["weight"])
    db.session.commit()
    current_app.logger.info("已移除出题规则的权重字段（改由等级决定出题比例）")


def _run_migrations():
    version = _data_version()
    if version < 2:
        _migrate_math_rules_by_term()
        _set_data_version(2)
    if version < 3:
        _set_data_version(3)
    if version < 4:
        _drop_legacy_unit_columns()
        _set_data_version(4)
    if version < 5:
        _drop_legacy_sort_columns()
        _set_data_version(5)
    if version < 6:
        _drop_legacy_bank_grade_columns()
        _set_data_version(6)
    if version < 7:
        _add_wrong_snapshot_column()
        _set_data_version(7)
    if version < 8:
        _add_level_columns()
        _set_data_version(8)
    if version < 9:
        _drop_math_rule_weight()
        _set_data_version(9)
    if version < 10:
        _fix_poem_record_result()
        _set_data_version(10)


def _fix_poem_record_result():
    """古诗背诵记录的结果回填：交了录音就是「对」，没交才是「错」。

    早期版本把 `is_correct` 写成 NULL（`sqlalchemy.null()`），学习记录页
    `r.is_correct ? '对' : '错'` 会把 NULL 显示成「错」，孩子背了反而背个错误指标。
    现在统一：已经上传录音 → 1（对），没上传 → 0（错）。
    """
    from ..services.submit import NO_SCORE_KINDS

    kinds = tuple(NO_SCORE_KINDS)
    if not kinds:
        return
    rows = StudyRecord.query.filter(StudyRecord.item_type.in_(kinds)).all()
    for r in rows:
        if r.is_correct:
            continue
        # 只有「未背诵」才算没完成。study_record 里存的是中文文案，
        # 不能用 POEM_RECITED 比对（那是 task_answer 里的标记值）
        r.is_correct = (r.user_answer or "").strip() != "未背诵"
    db.session.commit()


def _migrate_math_rules_by_term():
    """v1 的出题规则都是「全学年」，v2 起改为按上/下学期配置。"""
    from ..services import mathgen

    rows = MathRule.query.all()
    if not rows:
        return
    legacy = [
        r for r in rows
        if (r.term or "") == "" and r.generator in mathgen.GENERATORS
    ]
    if len(legacy) != len(rows):
        return  # 家长自己建过规则，不覆盖
    for r in rows:
        db.session.delete(r)
    db.session.commit()
    _seed_math_rules()


def _seed_samples():
    if ChineseChar.query.count() == 0:
        for i, row in enumerate(SAMPLE_CHARS, 1):
            char, pinyin, radical, strokes, structure, words, sentence, lv = row
            db.session.add(
                ChineseChar(
                    char=char,
                    pinyin=pinyin,
                    radical=radical,
                    strokes=strokes,
                    structure=structure,
                    words_json=json.dumps(words, ensure_ascii=False),
                    sentence=sentence,
                    is_key=i <= 10,
                    level=lv,
                )
            )

    if Poem.query.count() == 0:
        for i, poem in enumerate(SAMPLE_POEMS, 1):
            db.session.add(
                Poem(
                    title=poem["title"],
                    author=poem["author"],
                    dynasty=poem["dynasty"],
                    genre="诗",
                    content=poem["content"],
                    translation=poem["translation"],
                    level=poem.get("level", "较易"),
                )
            )

    if EnglishWord.query.count() == 0:
        for i, row in enumerate(SAMPLE_WORDS, 1):
            word, phonetic, pos, meaning, example, example_cn, lv = row
            db.session.add(
                EnglishWord(
                    word=word,
                    phonetic=phonetic,
                    pos=pos,
                    meaning=meaning,
                    example=example,
                    example_cn=example_cn,
                    kind="单词",
                    level=lv,
                )
            )

    if EnglishSentence.query.count() == 0:
        for i, (en, cn, keys, lv) in enumerate(SAMPLE_SENTENCES, 1):
            db.session.add(
                EnglishSentence(
                    en=en,
                    cn=cn,
                    key_words=keys,
                    level=lv,
                )
            )

    db.session.commit()


def _seed_child():
    if Child.query.count() > 0:
        return
    g3 = Grade.query.filter_by(name="三年级").first()
    db.session.add(
        Child(
            name="小明",
            gender="male",
            grade_id=g3.id if g3 else None,
            term="上",
            avatar="🐣",
        )
    )
    db.session.commit()
