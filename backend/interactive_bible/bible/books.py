"""Canonical Bible book table (66-book Protestant canon, USFM codes).

Canonical verse ids are translation independent: ``ROM.8.28`` <-> ordinal ``45008028``.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

VERSIFICATION_PATH = Path(__file__).with_name("versification.json")


@dataclass(frozen=True)
class Book:
    ordinal: int
    code: str  # USFM
    osis: str
    bw: str  # BibleWorks code used by eBible VPL files
    name: str
    testament: str
    genre: str
    attribution: str | None
    aliases: tuple[str, ...] = field(default_factory=tuple)
    # True when the bare name is also a common English word / personal name, so
    # chapter-only mentions ("John 3", "Job 1") need corroboration.
    ambiguous: bool = False
    single_chapter: bool = False


_B = Book
BOOKS: tuple[Book, ...] = (
    _B(1, "GEN", "Gen", "GEN", "Genesis", "OT", "Law", "Traditionally attributed to Moses", ("gen", "gn", "ge", "genesis", "genisis", "gensis")),
    _B(2, "EXO", "Exod", "EXO", "Exodus", "OT", "Law", "Traditionally attributed to Moses", ("exod", "exo", "ex", "exodus")),
    _B(3, "LEV", "Lev", "LEV", "Leviticus", "OT", "Law", "Traditionally attributed to Moses", ("lev", "lv", "leviticus", "levitcus")),
    _B(4, "NUM", "Num", "NUM", "Numbers", "OT", "Law", "Traditionally attributed to Moses", ("num", "nm", "nb", "numbers"), ambiguous=True),
    _B(5, "DEU", "Deut", "DEU", "Deuteronomy", "OT", "Law", "Traditionally attributed to Moses", ("deut", "deu", "dt", "deuteronomy", "duteronomy", "deuteronomey")),
    _B(6, "JOS", "Josh", "JOS", "Joshua", "OT", "History", None, ("josh", "jos", "jsh", "joshua"), ambiguous=True),
    _B(7, "JDG", "Judg", "JDG", "Judges", "OT", "History", None, ("judg", "jdg", "jdgs", "judges"), ambiguous=True),
    _B(8, "RUT", "Ruth", "RUT", "Ruth", "OT", "History", None, ("ruth", "rth", "ru"), ambiguous=True),
    _B(9, "1SA", "1Sam", "1SA", "1 Samuel", "OT", "History", None, ("1 sam", "1 sa", "1 sm", "1 samuel", "1samuel", "1sam")),
    _B(10, "2SA", "2Sam", "2SA", "2 Samuel", "OT", "History", None, ("2 sam", "2 sa", "2 sm", "2 samuel", "2samuel", "2sam")),
    _B(11, "1KI", "1Kgs", "1KI", "1 Kings", "OT", "History", None, ("1 kgs", "1 ki", "1 kin", "1 kings", "1kings", "1kgs")),
    _B(12, "2KI", "2Kgs", "2KI", "2 Kings", "OT", "History", None, ("2 kgs", "2 ki", "2 kin", "2 kings", "2kings", "2kgs")),
    _B(13, "1CH", "1Chr", "1CH", "1 Chronicles", "OT", "History", None, ("1 chr", "1 chron", "1 ch", "1 chronicles", "1chronicles", "1chr")),
    _B(14, "2CH", "2Chr", "2CH", "2 Chronicles", "OT", "History", None, ("2 chr", "2 chron", "2 ch", "2 chronicles", "2chronicles", "2chr")),
    _B(15, "EZR", "Ezra", "EZR", "Ezra", "OT", "History", None, ("ezra", "ezr"), ambiguous=True),
    _B(16, "NEH", "Neh", "NEH", "Nehemiah", "OT", "History", None, ("neh", "nehemiah", "nehemia"), ambiguous=True),
    _B(17, "EST", "Esth", "EST", "Esther", "OT", "History", None, ("esth", "est", "esther", "ester"), ambiguous=True),
    _B(18, "JOB", "Job", "JOB", "Job", "OT", "Wisdom", None, ("job", "jb"), ambiguous=True),
    _B(19, "PSA", "Ps", "PSA", "Psalms", "OT", "Wisdom", "Collected psalms; many are traditionally attributed to David", ("ps", "psa", "pss", "psm", "pslm", "psalm", "psalms", "psalms'", "sams", "salm", "salms", "palm")),
    _B(20, "PRO", "Prov", "PRO", "Proverbs", "OT", "Wisdom", "Traditionally associated with Solomon and other sages", ("prov", "pro", "prv", "proverbs", "proverb")),
    _B(21, "ECC", "Eccl", "ECC", "Ecclesiastes", "OT", "Wisdom", None, ("eccl", "ecc", "eccles", "ecclesiastes", "qoheleth", "ecclesiastics")),
    _B(22, "SNG", "Song", "SOL", "Song of Songs", "OT", "Wisdom", "Traditionally associated with Solomon", ("song of solomon", "song of songs", "songs of solomon", "song of sol", "sng", "sos", "canticles", "canticle of canticles"), ambiguous=True),
    _B(23, "ISA", "Isa", "ISA", "Isaiah", "OT", "Prophets", None, ("isa", "isaiah", "isiah", "isaias", "isaih")),
    _B(24, "JER", "Jer", "JER", "Jeremiah", "OT", "Prophets", None, ("jer", "jr", "jeremiah", "jeremiah's", "jeremias"), ambiguous=True),
    _B(25, "LAM", "Lam", "LAM", "Lamentations", "OT", "Prophets", None, ("lam", "lamentations", "lamentation")),
    _B(26, "EZK", "Ezek", "EZE", "Ezekiel", "OT", "Prophets", None, ("ezek", "eze", "ezk", "ezekiel", "ezekial")),
    _B(27, "DAN", "Dan", "DAN", "Daniel", "OT", "Prophets", None, ("dan", "dn", "daniel"), ambiguous=True),
    _B(28, "HOS", "Hos", "HOS", "Hosea", "OT", "Prophets", None, ("hos", "hosea"), ambiguous=True),
    _B(29, "JOL", "Joel", "JOE", "Joel", "OT", "Prophets", None, ("joel", "jl"), ambiguous=True),
    _B(30, "AMO", "Amos", "AMO", "Amos", "OT", "Prophets", None, ("amos",), ambiguous=True),
    _B(31, "OBA", "Obad", "OBA", "Obadiah", "OT", "Prophets", None, ("obad", "oba", "obadiah"), single_chapter=True),
    _B(32, "JON", "Jonah", "JON", "Jonah", "OT", "Prophets", None, ("jonah", "jon", "jnh"), ambiguous=True),
    _B(33, "MIC", "Mic", "MIC", "Micah", "OT", "Prophets", None, ("mic", "micah"), ambiguous=True),
    _B(34, "NAM", "Nah", "NAH", "Nahum", "OT", "Prophets", None, ("nah", "nahum"), ambiguous=True),
    _B(35, "HAB", "Hab", "HAB", "Habakkuk", "OT", "Prophets", None, ("hab", "habakkuk", "habakuk", "habbakuk")),
    _B(36, "ZEP", "Zeph", "ZEP", "Zephaniah", "OT", "Prophets", None, ("zeph", "zep", "zephaniah")),
    _B(37, "HAG", "Hag", "HAG", "Haggai", "OT", "Prophets", None, ("hag", "haggai")),
    _B(38, "ZEC", "Zech", "ZEC", "Zechariah", "OT", "Prophets", None, ("zech", "zec", "zechariah", "zachariah"), ambiguous=True),
    _B(39, "MAL", "Mal", "MAL", "Malachi", "OT", "Prophets", None, ("mal", "malachi"), ambiguous=True),
    _B(40, "MAT", "Matt", "MAT", "Matthew", "NT", "Gospel", "Traditionally attributed to Matthew", ("matt", "mat", "mt", "matthew", "mathew"), ambiguous=True),
    _B(41, "MRK", "Mark", "MAR", "Mark", "NT", "Gospel", "Traditionally attributed to John Mark", ("mark", "mrk", "mk"), ambiguous=True),
    _B(42, "LUK", "Luke", "LUK", "Luke", "NT", "Gospel", "Traditionally attributed to Luke", ("luke", "luk", "lk"), ambiguous=True),
    _B(43, "JHN", "John", "JOH", "John", "NT", "Gospel", "Traditionally attributed to the apostle John", ("john", "jn", "jhn", "joh"), ambiguous=True),
    _B(44, "ACT", "Acts", "ACT", "Acts", "NT", "History", "Traditionally attributed to Luke", ("acts", "act", "acts of the apostles"), ambiguous=True),
    _B(45, "ROM", "Rom", "ROM", "Romans", "NT", "Letter", "Paul", ("rom", "ro", "rm", "romans", "roman's", "romans'", "roman")),
    _B(46, "1CO", "1Cor", "1CO", "1 Corinthians", "NT", "Letter", "Paul", ("1 cor", "1 co", "1 corinthians", "1corinthians", "1cor", "1 corinthian", "1 corinthian's")),
    _B(47, "2CO", "2Cor", "2CO", "2 Corinthians", "NT", "Letter", "Paul", ("2 cor", "2 co", "2 corinthians", "2corinthians", "2cor", "2 corinthian", "2 corinthian's")),
    _B(48, "GAL", "Gal", "GAL", "Galatians", "NT", "Letter", "Paul", ("gal", "galatians", "galations", "galatian", "galatian's")),
    _B(49, "EPH", "Eph", "EPH", "Ephesians", "NT", "Letter", "Paul", ("eph", "ephes", "ephesians", "ephesian", "ephesian's", "ephesions")),
    _B(50, "PHP", "Phil", "PHI", "Philippians", "NT", "Letter", "Paul", ("phil", "php", "philippians", "phillipians", "philipians", "phillippians", "philippian", "philippines")),
    _B(51, "COL", "Col", "COL", "Colossians", "NT", "Letter", "Paul", ("col", "colossians", "colosians", "collosians", "colossian")),
    _B(52, "1TH", "1Thess", "1TH", "1 Thessalonians", "NT", "Letter", "Paul", ("1 thess", "1 thes", "1 th", "1 thessalonians", "1thessalonians", "1thess", "1 thessalonian")),
    _B(53, "2TH", "2Thess", "2TH", "2 Thessalonians", "NT", "Letter", "Paul", ("2 thess", "2 thes", "2 th", "2 thessalonians", "2thessalonians", "2thess", "2 thessalonian")),
    _B(54, "1TI", "1Tim", "1TI", "1 Timothy", "NT", "Letter", "Traditionally attributed to Paul", ("1 tim", "1 ti", "1 timothy", "1timothy", "1tim")),
    _B(55, "2TI", "2Tim", "2TI", "2 Timothy", "NT", "Letter", "Traditionally attributed to Paul", ("2 tim", "2 ti", "2 timothy", "2timothy", "2tim")),
    _B(56, "TIT", "Titus", "TIT", "Titus", "NT", "Letter", "Traditionally attributed to Paul", ("titus", "tit"), ambiguous=True),
    _B(57, "PHM", "Phlm", "PHM", "Philemon", "NT", "Letter", "Paul", ("philem", "phlm", "phm", "philemon"), single_chapter=True),
    _B(58, "HEB", "Heb", "HEB", "Hebrews", "NT", "Letter", "Author not named in the text", ("heb", "hebrews", "hebrew's")),
    _B(59, "JAS", "Jas", "JAM", "James", "NT", "Letter", "Traditionally attributed to James", ("jas", "jm", "james"), ambiguous=True),
    _B(60, "1PE", "1Pet", "1PE", "1 Peter", "NT", "Letter", "Traditionally attributed to Peter", ("1 pet", "1 pe", "1 pt", "1 peter", "1peter", "1pet")),
    _B(61, "2PE", "2Pet", "2PE", "2 Peter", "NT", "Letter", "Traditionally attributed to Peter", ("2 pet", "2 pe", "2 pt", "2 peter", "2peter", "2pet")),
    _B(62, "1JN", "1John", "1JO", "1 John", "NT", "Letter", "Traditionally attributed to John", ("1 john", "1 jn", "1 jhn", "1 jo", "1john", "1jn")),
    _B(63, "2JN", "2John", "2JO", "2 John", "NT", "Letter", "Traditionally attributed to John", ("2 john", "2 jn", "2 jhn", "2 jo", "2john", "2jn"), single_chapter=True),
    _B(64, "3JN", "3John", "3JO", "3 John", "NT", "Letter", "Traditionally attributed to John", ("3 john", "3 jn", "3 jhn", "3 jo", "3john", "3jn"), single_chapter=True),
    _B(65, "JUD", "Jude", "JUD", "Jude", "NT", "Letter", "Traditionally attributed to Jude", ("jude", "jud", "jd"), ambiguous=True, single_chapter=True),
    _B(66, "REV", "Rev", "REV", "Revelation", "NT", "Apocalyptic", "Traditionally attributed to John", ("rev", "revelation", "revelations", "apocalypse", "the revelation")),
)

BY_CODE: dict[str, Book] = {b.code: b for b in BOOKS}
BY_ORDINAL: dict[int, Book] = {b.ordinal: b for b in BOOKS}
BY_OSIS: dict[str, Book] = {b.osis.lower(): b for b in BOOKS}
BY_BW: dict[str, Book] = {b.bw: b for b in BOOKS}
BY_NAME: dict[str, Book] = {b.name.lower(): b for b in BOOKS}

SPOKEN_BOOK_NAMES: dict[str, str] = {b.code: b.name for b in BOOKS}


@lru_cache
def versification() -> dict[str, list[int]]:
    """book code -> list of verse counts per chapter (index 0 = chapter 1)."""
    if not VERSIFICATION_PATH.exists():
        raise RuntimeError(
            "versification.json missing — run `python -m interactive_bible.cli build-versification` after fetching Bible data"
        )
    return json.loads(VERSIFICATION_PATH.read_text())


def chapter_count(code: str) -> int:
    return len(versification()[code])


def verse_count(code: str, chapter: int) -> int:
    chapters = versification()[code]
    if chapter < 1 or chapter > len(chapters):
        return 0
    return chapters[chapter - 1]


def is_valid(code: str, chapter: int, verse: int | None = None) -> bool:
    if code not in BY_CODE:
        return False
    vc = verse_count(code, chapter)
    if vc == 0:
        return False
    return verse is None or 1 <= verse <= vc


def ordinal(code: str, chapter: int, verse: int) -> int:
    return BY_CODE[code].ordinal * 1_000_000 + chapter * 1_000 + verse


def from_ordinal(value: int) -> tuple[str, int, int]:
    book = BY_ORDINAL[value // 1_000_000]
    return book.code, (value // 1_000) % 1_000, value % 1_000


def canonical_ref(code: str, chapter: int, verse: int) -> str:
    return f"{code}.{chapter}.{verse}"


def ref_from_ordinal(value: int) -> str:
    code, ch, v = from_ordinal(value)
    return canonical_ref(code, ch, v)


def parse_canonical(ref: str) -> int | None:
    """'ROM.8.28' -> ordinal (None when invalid)."""
    parts = ref.strip().split(".")
    if len(parts) != 3:
        return None
    code = parts[0].upper()
    try:
        ch, v = int(parts[1]), int(parts[2])
    except ValueError:
        return None
    if not is_valid(code, ch, v):
        return None
    return ordinal(code, ch, v)


def parse_canonical_range(ref: str) -> tuple[int, int] | None:
    """'ROM.8.28' or 'ROM.8.28-ROM.8.30' -> (start, end) ordinals."""
    ref = ref.strip()
    if "-" in ref:
        a, b = ref.split("-", 1)
        start, end = parse_canonical(a), parse_canonical(b)
        if start is None or end is None or end < start:
            return None
        return start, end
    single = parse_canonical(ref)
    return (single, single) if single is not None else None


def display_ref(start: int, end: int | None = None) -> str:
    """Human readable reference: Romans 8:28, Romans 8:28-30, Matthew 5:1-7:27."""
    code, ch, v = from_ordinal(start)
    name = BY_CODE[code].name
    if end is None or end == start:
        return f"{name} {ch}:{v}"
    ecode, ech, ev = from_ordinal(end)
    if ecode != code:
        return f"{name} {ch}:{v} - {BY_CODE[ecode].name} {ech}:{ev}"
    if ech == ch:
        if v == 1 and ev == verse_count(code, ch):
            return f"{name} {ch}"
        return f"{name} {ch}:{v}-{ev}"
    if v == 1 and ev == verse_count(code, ech):
        return f"{name} {ch}-{ech}"
    return f"{name} {ch}:{v}-{ech}:{ev}"


def canonical_range_str(start: int, end: int | None) -> str:
    if end is None or end == start:
        return ref_from_ordinal(start)
    return f"{ref_from_ordinal(start)}-{ref_from_ordinal(end)}"


def chapter_bounds(code: str, chapter: int) -> tuple[int, int]:
    return ordinal(code, chapter, 1), ordinal(code, chapter, verse_count(code, chapter))


def osis_to_ordinal(osis_ref: str) -> int | None:
    """OpenBible style 'Rom.8.28' -> ordinal."""
    parts = osis_ref.split(".")
    if len(parts) != 3:
        return None
    book = BY_OSIS.get(parts[0].lower())
    if not book:
        return None
    try:
        ch, v = int(parts[1]), int(parts[2])
    except ValueError:
        return None
    if not is_valid(book.code, ch, v):
        return None
    return ordinal(book.code, ch, v)
