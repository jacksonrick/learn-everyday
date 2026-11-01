"""字音工具：按「词里的真实读音」找同音字。

`chinese_char.pinyin` 只存了一个读音（重 zhòng、朝 cháo、载 zài），多音字在
具体词里读什么它不知道。「重复」的“重”读 chóng，若拿字段里的 zhòng 去找
同音字，干扰项会变成 众/中/种，跟这个词的读音完全对不上，题目就假了。

pypinyin 自带词组词典，`pinyin("重复")` 给的是 chong2 fù，正好补上这一块。
已在 requirements.txt 里（pypinyin>=0.51），不引入新依赖。

对外只暴露：
- readings(char)               单字全部读音，TONE3 风格（zhong4 / chong2）
- word_reading(word, char)     某个字在某个词里的读音
- candidates(char, word, chars) 同音字候选，同调在前、异调在后
"""

from functools import lru_cache

from pypinyin import Style, pinyin


@lru_cache(maxsize=None)
def readings(char: str) -> tuple[str, ...]:
    """单字的主读音（TONE3：zhong4 / chong2）。

    特意不传 heteronym：它把古籍异读一并列出来（「湛」除 zhan4 外还有
    chen2 / dan1 / tan2 / jin4…），拿这些读音凑同音字，干扰项里就会冒出
    「填」「枕」这种跟词毫不相干的字。多音字的第二个读音由 `word_reading`
    按词现算，够用了。
    """
    return tuple(group[0] for group in pinyin(char, style=Style.TONE3, errors="ignore") if group)


def _plain(reading: str) -> str:
    """去掉声调数字：li4 -> li，zhe -> zhe。"""
    return reading.rstrip("012345")


def word_reading(word: str, char: str) -> str:
    """某个字在这个词里的读音；拿不到就退回该字的第一读音。"""
    if not word or not char:
        return ""
    syllables = pinyin(word, style=Style.TONE3, errors="ignore")
    for current, group in zip(word, syllables):
        # zip 的 current 是词里的字符，group 是它对应的读音列表
        if current == char and group and group[0]:
            return group[0]
    pool = readings(char)
    return pool[0] if pool else ""


@lru_cache(maxsize=8)
def _index(chars: tuple[str, ...]):
    """按读音建倒排索引。chars 必须是排好序的 tuple，好让缓存命中。"""
    by_tone: dict[str, set] = {}
    by_plain: dict[str, set] = {}
    for char in chars:
        for reading in readings(char):
            by_tone.setdefault(reading, set()).add(char)
            by_plain.setdefault(_plain(reading), set()).add(char)
    return by_tone, by_plain


def candidates(char: str, word: str, chars: tuple[str, ...]) -> tuple[list[str], list[str]]:
    """返回 (同调同音, 同音异调) 两组候选，都已去掉 char 本身。

    `chars` 必须是排好序的 tuple（同一份字表只建一次索引）。
    多音字按 `word` 里的实际读音取，所以「银行」的“行”走 hang2 而不是 xing2。
    """
    by_tone, by_plain = _index(chars)
    real = word_reading(word, char)
    same = set(by_tone.get(real, ()))
    same.discard(char)
    loose = set(by_plain.get(_plain(real), ()))
    loose.discard(char)
    loose -= same
    return sorted(same), sorted(loose)
