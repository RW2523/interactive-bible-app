"""Deterministic Bible reference parser (spec §4.1 step 1, stage C).

Supports written ("John 3:16", "Rom. 8:28-30", "1 Cor 13:4-7; 14:1", "Matthew 5-7", "Jude 3"),
spoken ("first Corinthians chapter thirteen", "Romans eight twenty-eight",
"the eighth chapter of Romans, verse twenty-eight", "Psalm one hundred and nineteen verse one hundred and five"),
context-inferred ("... verse thirty-one" after a Romans 8 reference) and common ASR errors
("Roman's 8 28", "Philippines 4:13", "John 316", fuzzy book names).

Precision first: ambiguous book names that are also names/words (John, Mark, Job, Acts,
Numbers...) need a verse or a corroborating cue before a chapter-only reference is emitted.
The parser never invents references: every result is validated against the versification.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Iterable

from rapidfuzz import fuzz, process

from . import books as B
from .numbers import NumberMatch, number_ending_at, parse_number

TOKEN_RE = re.compile(r"\d+(?:st|nd|rd|th)?|[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+)*['’]?|[:;,.\-–—]")

CHAPTER_WORDS = {"chapter", "chapters", "ch", "chap", "chs"}
VERSE_WORDS = {"verse", "verses", "v", "vv", "vs", "vss", "ver"}
RANGE_WORDS = {"-", "–", "—", "to", "through", "thru", "till", "until"}
RELATIVE_WORDS = {"next": 1, "following": 1, "previous": -1, "preceding": -1}
CUE_WORDS = {
    "turn", "open", "read", "reading", "reads", "in", "from", "see", "look", "go", "found", "book", "gospel",
    "according", "chapter", "cf", "compare", "study", "studying", "preach", "preaching", "quote", "quoted",
    "says", "said", "text", "passage", "scripture", "letter", "epistle", "at", "into",
}
# words that make "<Book> <number>" a non-reference ("Ruth 2 years ago", "John 3 times")
DENY_AFTER_CHAPTER = {
    "times", "time", "people", "persons", "person", "men", "women", "kids", "children", "sons", "daughters",
    "years", "year", "days", "day", "weeks", "week", "months", "month", "hours", "hour", "minutes", "minute",
    "seconds", "second", "o'clock", "oclock", "am", "pm", "a.m", "p.m", "percent", "dollars", "dollar", "cents",
    "miles", "mile", "feet", "foot", "pounds", "points", "point", "items", "things", "on", "of", "or", "out",
    "more", "less", "and", "x", "%", "st", "street", "avenue", "ave", "apartment", "room", "goals", "games",
}
# misspellings / ASR confusions -> confidence cap
ASR_ALIASES = {
    "philippines": 0.88, "sams": 0.8, "salm": 0.85, "salms": 0.85, "palm": 0.75, "roman's": 0.93,
    "romans'": 0.95, "roman": 0.9, "hebrew's": 0.92, "galations": 0.93, "galatian's": 0.92, "ephesian's": 0.92,
    "ephesions": 0.9, "phillipians": 0.94, "philipians": 0.94, "phillippians": 0.93, "colosians": 0.93,
    "collosians": 0.93, "revelations": 0.96, "isiah": 0.93, "isaih": 0.92, "ezekial": 0.94, "genisis": 0.93,
    "gensis": 0.92, "duteronomy": 0.93, "deuteronomey": 0.93, "ecclesiastics": 0.9, "habakuk": 0.94,
    "habbakuk": 0.94, "zachariah": 0.9, "mathew": 0.94, "ester": 0.9, "nehemia": 0.93, "levitcus": 0.93,
    "corinthian's": 0.92, "psalms'": 0.95, "proverb": 0.95, "lamentation": 0.95, "jeremiah's": 0.9,
}
ABBREV_LONG = {
    "matt", "prov", "deut", "judg", "eccl", "ezek", "zeph", "zech", "obad", "phil", "thess", "thes", "chron",
    "philem", "ephes", "eccles", "exod", "josh", "esth", "pslm", "judg", "jdgs", "kgs",
}
NUMBER_PREFIXES: dict[int, list[tuple[str, bool]]] = {
    1: [("1", False), ("1st", False), ("first", False), ("i", True), ("one", True)],
    2: [("2", False), ("2nd", False), ("second", False), ("ii", False), ("two", True)],
    3: [("3", False), ("3rd", False), ("third", False), ("iii", False), ("three", True)],
}
BOOK_CONTEXT_CUES = [("book", "of"), ("gospel", "of"), ("letter", "to", "the"), ("epistle", "to", "the"), ("according", "to"), ("letter", "to"), ("epistle", "to")]


@dataclass
class Tok:
    text: str
    lower: str
    start: int
    end: int
    kind: str  # num | word | punct


def tokenize(text: str) -> list[Tok]:
    out: list[Tok] = []
    for m in TOKEN_RE.finditer(text):
        t = m.group(0)
        kind = "num" if t[0].isdigit() else ("word" if t[0].isalpha() else "punct")
        out.append(Tok(t, t.lower().replace("’", "'"), m.start(), m.end(), kind))
    return out


@dataclass(frozen=True)
class AliasInfo:
    code: str
    abbreviation: bool
    weak_prefix: bool
    asr_conf: float | None
    length: int


@dataclass
class ParsedRef:
    book: str
    chapter: int
    verse: int | None
    end_chapter: int
    end_verse: int | None
    kind: str  # verse | range | chapter | chapter_range
    raw_text: str
    start: int  # char offsets in the parsed text
    end: int
    form: str  # written | spoken
    confidence: float
    flags: list[str] = field(default_factory=list)

    @property
    def start_ordinal(self) -> int:
        return B.ordinal(self.book, self.chapter, self.verse or 1)

    @property
    def end_ordinal(self) -> int:
        if self.end_verse is not None:
            return B.ordinal(self.book, self.end_chapter, self.end_verse)
        return B.ordinal(self.book, self.end_chapter, B.verse_count(self.book, self.end_chapter))

    @property
    def canonical(self) -> str:
        return B.canonical_range_str(self.start_ordinal, self.end_ordinal)

    @property
    def canonical_start(self) -> str:
        return B.ref_from_ordinal(self.start_ordinal)

    @property
    def canonical_end(self) -> str:
        return B.ref_from_ordinal(self.end_ordinal)

    @property
    def verse_span(self) -> int:
        return len(verse_ordinals(self.start_ordinal, self.end_ordinal))

    @property
    def needs_verification(self) -> bool:
        return self.confidence < 0.95 or any(
            f in self.flags for f in ("context_book", "context_chapter", "context_relative", "asr_split", "fuzzy_book", "asr_alias", "ambiguous_book", "spoken_bare")
        )

    def to_dict(self) -> dict:
        return {
            "book": self.book, "chapter": self.chapter, "verse": self.verse, "end_chapter": self.end_chapter,
            "end_verse": self.end_verse, "kind": self.kind, "raw_text": self.raw_text, "start": self.start,
            "end": self.end, "form": self.form, "confidence": round(self.confidence, 3), "flags": self.flags,
            "canonical_start": self.canonical_start, "canonical_end": self.canonical_end, "display": B.display_ref(self.start_ordinal, self.end_ordinal),
        }


def verse_ordinals(start: int, end: int) -> list[int]:
    """All valid verse ordinals between two ordinals (inclusive), across chapters."""
    out: list[int] = []
    code, ch, v = B.from_ordinal(start)
    ecode, ech, ev = B.from_ordinal(end)
    if code != ecode:
        return [start, end]
    for chapter in range(ch, ech + 1):
        first = v if chapter == ch else 1
        last = ev if chapter == ech else B.verse_count(code, chapter)
        out.extend(B.ordinal(code, chapter, x) for x in range(first, last + 1))
    return out


@lru_cache
def alias_index() -> tuple[dict[tuple[str, ...], AliasInfo], int]:
    idx: dict[tuple[str, ...], AliasInfo] = {}

    def is_abbrev(base: list[str]) -> bool:
        if len(base) != 1:
            return False
        t = base[0]
        return (len(t) <= 3 and t not in {"job"}) or t in ABBREV_LONG

    for book in B.BOOKS:
        names = set(book.aliases) | {book.name.lower()}
        for alias in names:
            parts = [t.lower for t in tokenize(alias)]
            if not parts:
                continue
            if book.code[0].isdigit():
                n = int(book.code[0])
                if parts[0] != str(n):
                    continue
                base = parts[1:]
                if not base:
                    continue
                for prefix, weak in NUMBER_PREFIXES[n]:
                    key = (prefix, *base)
                    idx[key] = AliasInfo(book.code, is_abbrev(base), weak, ASR_ALIASES.get(" ".join(base)), len(key))
            else:
                key = tuple(parts)
                idx[key] = AliasInfo(book.code, is_abbrev(parts), False, ASR_ALIASES.get(alias), len(key))
    return idx, max(len(k) for k in idx)


@lru_cache
def _fuzzy_names() -> dict[str, str]:
    names: dict[str, str] = {}
    for book in B.BOOKS:
        base = book.name.lower()
        if book.code[0].isdigit():
            base = base[2:]
        if len(base) >= 5:
            names[base] = book.code if not book.code[0].isdigit() else book.code[1:]
    return names


def _numbered_code(prefix_value: int, base_code_suffix: str) -> str | None:
    code = f"{prefix_value}{base_code_suffix}"
    return code if code in B.BY_CODE else None


class _Parser:
    def __init__(self, lenient: bool) -> None:
        self.lenient = lenient
        self.last_book: str | None = None
        self.last_chapter: int | None = None
        self.last_verse: int | None = None
        self.last_end: int = -10_000
        self.offset_shift = 0  # negative offsets for context_before text

    # ------------------------------------------------------------------ helpers
    def _match_alias(self, toks: list[Tok], i: int) -> tuple[AliasInfo, int] | None:
        idx, maxlen = alias_index()
        for length in range(min(maxlen, len(toks) - i), 0, -1):
            window = toks[i : i + length]
            if any(t.kind == "punct" for t in window):
                continue
            # tokens of a multi-token alias must be separated by whitespace only
            key = tuple(t.lower for t in window)
            info = idx.get(key)
            if info:
                return info, i + length
        return None

    def _fuzzy_alias(self, toks: list[Tok], i: int) -> tuple[AliasInfo, int] | None:
        """Fuzzy book name followed by a chapter:verse locator (ASR/misspelling)."""
        t = toks[i]
        if t.kind != "word" or len(t.lower) < 5 or not (t.text[0].isupper() or self.lenient):
            return None
        # require a written chapter:verse right after
        if not (i + 3 < len(toks) and toks[i + 1].kind == "num" and toks[i + 2].lower == ":" and toks[i + 3].kind == "num"):
            return None
        names = _fuzzy_names()
        match = process.extractOne(t.lower, list(names.keys()), scorer=fuzz.ratio, score_cutoff=84)
        if not match:
            return None
        base_code = names[match[0]]
        code = base_code
        start_index = i
        if base_code not in B.BY_CODE:  # numbered book base (e.g. "CO" from 1CO)
            if i == 0:
                return None
            prev = toks[i - 1].lower
            value = {"1": 1, "1st": 1, "first": 1, "i": 1, "2": 2, "2nd": 2, "second": 2, "ii": 2, "3": 3, "3rd": 3, "third": 3, "iii": 3}.get(prev)
            if not value:
                return None
            numbered = _numbered_code(value, base_code)
            if not numbered:
                return None
            code = numbered
            start_index = i - 1
        info = AliasInfo(code, False, False, 0.86, 1)
        return info, i + 1 if start_index == i else i + 1

    @staticmethod
    def _is_cap(tok: Tok) -> bool:
        return tok.text[:1].isupper()

    def _has_cue_before(self, toks: list[Tok], i: int) -> bool:
        for k in range(max(0, i - 3), i):
            if toks[k].lower in CUE_WORDS:
                return True
        return False

    def _book_context_mention(self, toks: list[Tok], i: int, j: int, info: AliasInfo) -> bool:
        book = B.BY_CODE[info.code]
        for cue in BOOK_CONTEXT_CUES:
            n = len(cue)
            if i - n >= 0 and tuple(t.lower for t in toks[i - n : i]) == cue:
                return True
        if info.abbreviation or info.weak_prefix or info.asr_conf is not None:
            return False
        if book.ambiguous:
            return False
        return self._is_cap(toks[j - 1]) or self.lenient

    # ------------------------------------------------------------------ main
    def run(self, text: str, emit: bool, base_offset: int = 0) -> list[ParsedRef]:
        toks = tokenize(text)
        refs: list[ParsedRef] = []
        i = 0
        n = len(toks)
        while i < n:
            matched = self._match_alias(toks, i)
            fuzzy = False
            if not matched:
                matched = self._fuzzy_alias(toks, i)
                fuzzy = matched is not None
            if matched:
                info, j = matched
                result = self._parse_after_book(text, toks, i, j, info, fuzzy)
                if result:
                    new_refs, next_i = result
                    for r in new_refs:
                        r.start += base_offset
                        r.end += base_offset
                    refs.extend(new_refs)
                    last = new_refs[-1]
                    self.last_book, self.last_chapter, self.last_end = last.book, last.end_chapter, last.end
                    self.last_verse = last.end_verse
                    i = max(next_i, i + 1)
                    continue
                if self._book_context_mention(toks, i, j, info):
                    self.last_book, self.last_chapter, self.last_end = info.code, None, toks[j - 1].end + base_offset
                    self.last_verse = None
                    i = j
                    continue
                i += 1
                continue

            low = toks[i].lower
            if low in CHAPTER_WORDS and self.last_book:
                result = self._parse_context_chapter(text, toks, i, base_offset)
                if result:
                    new_refs, next_i = result
                    refs.extend(new_refs)
                    last = new_refs[-1]
                    self.last_chapter, self.last_end, self.last_verse = last.end_chapter, last.end, last.end_verse
                    i = next_i
                    continue
            if low in VERSE_WORDS and self.last_book and self.last_chapter:
                result = self._parse_context_verse(text, toks, i, base_offset)
                if result:
                    new_refs, next_i = result
                    refs.extend(new_refs)
                    self.last_end, self.last_verse = new_refs[-1].end, new_refs[-1].end_verse
                    i = next_i
                    continue
            if low in RELATIVE_WORDS and self.last_book and self.last_chapter and self.last_verse:
                result = self._parse_relative_verse(text, toks, i, base_offset)
                if result:
                    new_refs, next_i = result
                    refs.extend(new_refs)
                    self.last_end, self.last_verse = new_refs[-1].end, new_refs[-1].end_verse
                    i = next_i
                    continue
            i += 1
        return refs if emit else []

    def _parse_relative_verse(self, text: str, toks: list[Tok], i: int, base_offset: int):
        """'the next verse' / 'the following verse' / 'the previous verse' relative to the last cited verse."""
        n = len(toks)
        if i + 1 >= n or toks[i + 1].lower not in ("verse", "verses"):
            return None
        delta = RELATIVE_WORDS[toks[i].lower]
        target = (self.last_verse or 0) + delta
        book = B.BY_CODE[self.last_book]
        if not B.is_valid(book.code, self.last_chapter, target):
            return None
        start_tok = i - 1 if i > 0 and toks[i - 1].lower == "the" else i
        r = self._build(text, toks, start_tok, i + 1, book, self.last_chapter, target, self.last_chapter, None, "verse", "spoken", 0.82, ["context_relative"], True)
        if r is None:
            return None
        r.start += base_offset
        r.end += base_offset
        return [r], i + 2

    # ------------------------------------------------------------------ patterns
    def _prebook_chapter(self, toks: list[Tok], i: int) -> tuple[int, int, int | None] | None:
        """'the eighth chapter of <Book>' / 'chapter eight of <Book>' / 'verse 28 of <Book> 8'.

        Returns (chapter_or_0, start_token_index, verse_or_None). chapter 0 means a verse-only prefix.
        """
        if i < 3 or toks[i - 1].lower != "of":
            return None
        # "<ordinal> chapter of"
        if toks[i - 2].lower in CHAPTER_WORDS:
            num = number_ending_at(toks, i - 2, 4)
            if num and num.ordinal:
                start = num.start - 1 if num.start > 0 and toks[num.start - 1].lower == "the" else num.start
                return num.value, start, None
        # "chapter <n> of"
        num = number_ending_at(toks, i - 1, 5)
        if num and num.start > 0:
            before = toks[num.start - 1].lower
            if before in CHAPTER_WORDS and not num.ordinal:
                return num.value, num.start - 1, None
            if before in VERSE_WORDS and not num.ordinal:
                return 0, num.start - 1, num.value
        return None

    def _parse_after_book(self, text: str, toks: list[Tok], i: int, j: int, info: AliasInfo, fuzzy: bool):
        book = B.BY_CODE[info.code]
        n = len(toks)
        book_tok = toks[j - 1]
        start_tok = i
        flags: list[str] = []
        if fuzzy:
            flags.append("fuzzy_book")
        if info.asr_conf is not None and not fuzzy:
            flags.append("asr_alias")

        pre = self._prebook_chapter(toks, i)
        k = j
        if info.abbreviation and k < n and toks[k].lower == ".":
            k += 1

        if pre is not None:
            pre_chapter, pre_start, pre_verse = pre
            if pre_chapter:  # "... eighth chapter of Romans[, verse twenty-eight]"
                chapter = pre_chapter
                start_tok = pre_start
                verse, verse_end, k2 = self._optional_verse_keyword(toks, k)
                form = "spoken"
                if verse is None:
                    return self._finish(text, toks, start_tok, k - 1, book, info, chapter, None, chapter, None, "chapter", form, 0.93, flags, had_chapter_kw=True, next_index=k)
                end_v = verse_end or verse
                kind = "range" if verse_end and verse_end != verse else "verse"
                return self._finish(text, toks, start_tok, k2 - 1, book, info, chapter, verse, chapter, end_v, kind, form, 0.96, flags, had_chapter_kw=True, next_index=k2)
            # "verse 28 of Romans 8"
            chap = parse_number(toks, k)
            if chap and not chap.ordinal:
                return self._finish(text, toks, pre_start, chap.end - 1, book, info, chap.value, pre_verse, chap.value, pre_verse, "verse", "spoken" if chap.kind == "word" else "written", 0.95, flags, had_chapter_kw=False, next_index=chap.end)

        had_chapter_kw = False
        k_before_kw = k
        if k < n and toks[k].lower == "," and k + 1 < n and toks[k + 1].lower in CHAPTER_WORDS:
            k += 1
        if k < n and toks[k].lower in CHAPTER_WORDS:
            had_chapter_kw = True
            k += 1
            if k < n and toks[k].lower == ".":
                k += 1
        chap = parse_number(toks, k)
        if chap is None:
            return None
        if chap.ordinal:
            return None
        # a digit must follow the book name directly (no comma) unless the chapter keyword was used
        if not had_chapter_kw and k != k_before_kw:
            return None
        form = "written" if chap.kind == "digit" else "spoken"
        chapter = chap.value
        k = chap.end
        verse: int | None = None
        verse_end: int | None = None
        end_chapter = chapter
        pair_kind = None  # colon | keyword | bare | comma

        if k + 1 < n and toks[k].lower == ":" and toks[k + 1].kind == "num":
            vm = parse_number(toks, k + 1)
            if vm and not vm.ordinal:
                verse, k, pair_kind = vm.value, vm.end, "colon"
        elif (
            k + 1 < n and toks[k].lower == "." and toks[k + 1].kind == "num"
            and toks[k].start == toks[k - 1].end and toks[k + 1].start == toks[k].end
        ):
            vm = parse_number(toks, k + 1)
            if vm and not vm.ordinal:
                verse, k, pair_kind = vm.value, vm.end, "colon"
        else:
            k2 = k
            if k2 < n and toks[k2].lower in (",", "and"):
                k2 += 1
            if k2 < n and toks[k2].lower in VERSE_WORDS:
                k3 = k2 + 1
                if k3 < n and toks[k3].lower == ".":
                    k3 += 1
                vm = parse_number(toks, k3)
                if vm and not vm.ordinal:
                    verse, k, pair_kind = vm.value, vm.end, "keyword"
            elif k2 == k:
                vm = parse_number(toks, k)
                if vm and not vm.ordinal and vm.kind == chap.kind and not had_chapter_kw:
                    verse, k, pair_kind = vm.value, vm.end, "bare"
            elif toks[k].lower == "," and form == "spoken":
                vm = parse_number(toks, k2)
                if vm and not vm.ordinal and vm.kind == "word":
                    verse, k, pair_kind = vm.value, vm.end, "comma"

        extra: list[tuple[int, int, int | None, int | None, int]] = []  # (chapter, verse, end_chapter, end_verse, token_end)
        kind = "verse"
        if verse is not None:
            # ranges
            if k < n and toks[k].lower in RANGE_WORDS:
                k2 = k + 1
                if k2 < n and toks[k2].lower in VERSE_WORDS:
                    k2 += 1
                rm = parse_number(toks, k2)
                if rm and not rm.ordinal:
                    if rm.end + 1 < n and toks[rm.end].lower == ":" and toks[rm.end + 1].kind == "num":
                        vm2 = parse_number(toks, rm.end + 1)
                        if vm2:
                            end_chapter, verse_end, k = rm.value, vm2.value, vm2.end
                            kind = "range"
                    elif rm.value > verse:
                        verse_end, k = rm.value, rm.end
                        kind = "range"
            elif k < n and toks[k].lower == "and":
                rm = parse_number(toks, k + 1)
                if rm and not rm.ordinal and rm.kind == chap.kind:
                    if rm.value == verse + 1:
                        verse_end, k = rm.value, rm.end
                        kind = "range"
                    elif rm.value > verse + 1:
                        extra.append((chapter, rm.value, chapter, None, rm.end))
                        k = rm.end
            # lists: ", 31" / "; 12:2"
            while k + 1 < n and toks[k].lower in (",", ";") and toks[k + 1].kind == "num" and form == "written":
                sep = toks[k].lower
                a = parse_number(toks, k + 1)
                if not a or a.ordinal:
                    break
                if a.end + 1 < n and toks[a.end].lower == ":" and toks[a.end + 1].kind == "num":
                    b = parse_number(toks, a.end + 1)
                    if not b:
                        break
                    e_ch, e_v, kk = a.value, None, b.end
                    if kk + 1 < n and toks[kk].lower in RANGE_WORDS and toks[kk + 1].kind == "num":
                        c = parse_number(toks, kk + 1)
                        if c and c.value > b.value:
                            e_v, kk = c.value, c.end
                    extra.append((a.value, b.value, e_ch, e_v, kk))
                    k = kk
                elif sep == ",":
                    e_v = None
                    kk = a.end
                    if kk + 1 < n and toks[kk].lower in RANGE_WORDS and toks[kk + 1].kind == "num":
                        c = parse_number(toks, kk + 1)
                        if c and c.value > a.value:
                            e_v, kk = c.value, c.end
                    extra.append((end_chapter, a.value, end_chapter, e_v, kk))
                    k = kk
                else:
                    break
        else:
            kind = "chapter"
            if k < n and toks[k].lower in RANGE_WORDS:
                k2 = k + 1
                if k2 < n and toks[k2].lower in CHAPTER_WORDS:
                    k2 += 1
                rm = parse_number(toks, k2)
                if rm and not rm.ordinal and rm.value > chapter and rm.kind == chap.kind:
                    end_chapter, k = rm.value, rm.end
                    kind = "chapter_range"

        # ------------------------------------------------ ASR digit split ("John 316" -> John 3:16)
        if verse is None and kind == "chapter" and form == "written" and not had_chapter_kw and not B.is_valid(book.code, chapter) and 100 <= chapter <= 9999:
            digits = str(chapter)
            candidates = [
                (int(digits[:cut]), int(digits[cut:]))
                for cut in range(1, len(digits))
                if digits[cut] != "0" and B.is_valid(book.code, int(digits[:cut]), int(digits[cut:]))
            ]
            if len(candidates) != 1:
                return None
            chapter, verse = candidates[0]
            end_chapter, kind, pair_kind = chapter, "verse", "asr_split"
            flags.append("asr_split")

        # ------------------------------------------------ confidence
        if verse is not None:
            conf = {"colon": 0.99, "keyword": 0.97, "bare": 0.9, "comma": 0.93, "asr_split": 0.85}[pair_kind or "colon"]
            if form == "spoken":
                conf = {"keyword": 0.96, "bare": 0.92, "comma": 0.93}.get(pair_kind or "keyword", 0.95)
                if pair_kind == "bare":
                    flags.append("spoken_bare")
            elif pair_kind == "bare":
                flags.append("spoken_bare")
            if info.abbreviation:
                if not self.lenient and not self._is_cap(book_tok):
                    return None
                conf -= 0.01
            if book.ambiguous:
                conf -= 0.01
                if pair_kind == "bare":
                    conf -= 0.02
        else:
            if book.single_chapter and not had_chapter_kw and kind == "chapter":
                # "Jude 3" -> verse 3 of the only chapter
                verse, chapter, end_chapter = chapter, 1, 1
                kind = "verse"
                conf = 0.95 if form == "written" else 0.9
            else:
                next_tok = toks[k] if k < n else None
                if next_tok is not None and next_tok.lower in DENY_AFTER_CHAPTER and not had_chapter_kw:
                    if not (next_tok.lower == "and" and kind == "chapter_range"):
                        return None
                if info.weak_prefix:
                    return None
                if info.abbreviation and not self.lenient and not (self._is_cap(book_tok) and form == "written"):
                    return None
                if form == "spoken" and not had_chapter_kw:
                    if book.ambiguous or not self.lenient and not self._is_cap(book_tok):
                        return None
                    conf = 0.86
                elif book.ambiguous and not had_chapter_kw:
                    if kind == "chapter_range" and form == "written" and (self.lenient or self._is_cap(book_tok)):
                        conf = 0.9  # "Matthew 5-7": the range notation itself corroborates the book
                    else:
                        if not self.lenient:
                            if not (self._is_cap(book_tok) and self._has_cue_before(toks, i)):
                                return None
                        conf = 0.84
                    flags.append("ambiguous_book")
                else:
                    conf = 0.95 if form == "written" else 0.93
        if info.weak_prefix:
            conf -= 0.05
        if info.asr_conf is not None:
            conf = min(conf, info.asr_conf)

        refs = []
        primary = self._build(text, toks, start_tok, k - 1, book, chapter, verse, end_chapter, verse_end, kind, form, conf, flags, had_chapter_kw)
        if primary is None:
            return None
        refs.append(primary)
        for (e_ch, e_v, e_ech, e_ev, tok_end) in extra:
            kind2 = "range" if e_ev else "verse"
            r = self._build(text, toks, start_tok, tok_end - 1, book, e_ch, e_v, e_ech, e_ev, kind2, form, conf - 0.01, list(flags) + ["list_item"], False)
            if r:
                # evidence span for list items is the whole citation
                refs.append(r)
        return refs, k

    def _finish(self, text, toks, start_tok, end_tok, book, info, chapter, verse, end_chapter, end_verse, kind, form, conf, flags, had_chapter_kw, next_index):
        if info.asr_conf is not None:
            conf = min(conf, info.asr_conf)
        r = self._build(text, toks, start_tok, end_tok, book, chapter, verse, end_chapter, end_verse, kind, form, conf, flags, had_chapter_kw)
        if r is None:
            return None
        return [r], next_index

    def _optional_verse_keyword(self, toks: list[Tok], k: int) -> tuple[int | None, int | None, int]:
        n = len(toks)
        k2 = k
        if k2 < n and toks[k2].lower in (",", "and"):
            k2 += 1
        if k2 < n and toks[k2].lower in VERSE_WORDS:
            vm = parse_number(toks, k2 + 1)
            if vm and not vm.ordinal:
                end = vm.end
                verse_end = None
                if end < n and toks[end].lower in RANGE_WORDS | {"and"}:
                    rm = parse_number(toks, end + 1)
                    if rm and rm.value > vm.value:
                        verse_end, end = rm.value, rm.end
                return vm.value, verse_end, end
        return None, None, k

    def _build(self, text, toks, start_tok, end_tok, book, chapter, verse, end_chapter, end_verse, kind, form, conf, flags, had_chapter_kw) -> ParsedRef | None:
        code = book.code
        flags = list(flags)
        # --- validation + ASR digit split ("John 316" -> 3:16)
        if not B.is_valid(code, chapter):
            return None
        if verse is not None and not B.is_valid(code, chapter, verse):
            return None
        if kind == "chapter_range" and not B.is_valid(code, end_chapter):
            end_chapter = B.chapter_count(code)
            flags.append("range_clamped")
        if end_verse is not None:
            if not B.is_valid(code, end_chapter):
                return None
            max_v = B.verse_count(code, end_chapter)
            if end_verse > max_v:
                end_verse = max_v
                flags.append("range_clamped")
                conf -= 0.03
        if verse is not None and end_verse is None:
            end_verse = verse
            end_chapter = chapter
        if kind == "range" and B.ordinal(code, end_chapter, end_verse) <= B.ordinal(code, chapter, verse):
            kind = "verse"
            end_chapter, end_verse = chapter, verse
        start_char = toks[start_tok].start
        end_char = toks[end_tok].end
        return ParsedRef(
            book=code, chapter=chapter, verse=verse, end_chapter=end_chapter, end_verse=end_verse if verse is not None else None,
            kind=kind, raw_text=text[start_char:end_char], start=start_char, end=end_char, form=form,
            confidence=round(max(0.0, min(conf, 0.995)), 3), flags=flags,
        )

    def _parse_context_chapter(self, text: str, toks: list[Tok], i: int, base_offset: int):
        n = len(toks)
        num = parse_number(toks, i + 1)
        if not num or num.ordinal:
            return None
        # "chapter 8 of Romans" is handled by the book branch
        if num.end < n and toks[num.end].lower == "of":
            return None
        book = B.BY_CODE[self.last_book]
        k = num.end
        verse, verse_end, k2 = self._optional_verse_keyword(toks, k)
        flags = ["context_book"]
        distance_penalty = 0.04 if (toks[i].start + base_offset - self.last_end) > 1500 else 0.0
        if verse is None:
            if k < n and toks[k].lower in DENY_AFTER_CHAPTER:
                return None
            r = self._build(text, toks, i, k - 1, book, num.value, None, num.value, None, "chapter", "written" if num.kind == "digit" else "spoken", 0.8 - distance_penalty, flags, True)
            next_i = k
        else:
            kind = "range" if verse_end else "verse"
            r = self._build(text, toks, i, k2 - 1, book, num.value, verse, num.value, verse_end, kind, "written" if num.kind == "digit" else "spoken", 0.86 - distance_penalty, flags, True)
            next_i = k2
        if r is None:
            return None
        r.start += base_offset
        r.end += base_offset
        return [r], next_i

    def _parse_context_verse(self, text: str, toks: list[Tok], i: int, base_offset: int):
        n = len(toks)
        k = i + 1
        if k < n and toks[k].lower == ".":
            k += 1
        num = parse_number(toks, k)
        if not num or num.ordinal:
            return None
        if num.end < n and toks[num.end].lower == "of":
            return None  # "verse 28 of Romans 8" handled by the book branch
        verse_end = None
        end = num.end
        if end < n and toks[end].lower in RANGE_WORDS | {"and"}:
            rm = parse_number(toks, end + 1)
            if rm and not rm.ordinal and rm.value > num.value and (toks[end].lower != "and" or rm.value == num.value + 1):
                verse_end, end = rm.value, rm.end
        book = B.BY_CODE[self.last_book]
        distance_penalty = 0.04 if (toks[i].start + base_offset - self.last_end) > 1500 else 0.0
        kind = "range" if verse_end else "verse"
        r = self._build(text, toks, i, end - 1, book, self.last_chapter, num.value, self.last_chapter, verse_end, kind,
                        "written" if num.kind == "digit" else "spoken", 0.84 - distance_penalty, ["context_chapter"], True)
        if r is None:
            return None
        r.start += base_offset
        r.end += base_offset
        return [r], end


def parse_references(text: str, context_before: str = "", lenient: bool = False) -> list[ParsedRef]:
    """Parse references in ``text``; ``context_before`` only establishes book/chapter context."""
    parser = _Parser(lenient=lenient)
    if context_before:
        parser.run(context_before, emit=False)
        # offsets in context_before are "before" the text: make them negative distances
        parser.last_end = parser.last_end - len(context_before) - 1 if parser.last_end > -10_000 else parser.last_end
    return parser.run(text, emit=True)


_CANONICAL_RE = re.compile(r"^\s*([1-3]?[A-Za-z]{2,3})\.(\d{1,3})\.(\d{1,3})(?:\s*-\s*([1-3]?[A-Za-z]{2,3})\.(\d{1,3})\.(\d{1,3}))?\s*$")


def parse_query_reference(query: str) -> tuple[int, int] | None:
    """Parse a user-supplied reference ('ROM.8.28', 'rom 8:28-30', 'Psalm 23') to (start, end) ordinals."""
    m = _CANONICAL_RE.match(query)
    if m:
        start = B.parse_canonical(f"{m.group(1)}.{m.group(2)}.{m.group(3)}")
        if start is None:
            return None
        if m.group(4):
            end = B.parse_canonical(f"{m.group(4)}.{m.group(5)}.{m.group(6)}")
            if end is None or end < start:
                return None
            return start, end
        return start, start
    refs = parse_references(query, lenient=True)
    if not refs:
        return None
    r = refs[0]
    return r.start_ordinal, r.end_ordinal


def find_query_references(query: str) -> list[ParsedRef]:
    return parse_references(query, lenient=True)


def iter_ordinals(refs: Iterable[ParsedRef]) -> list[tuple[int, int]]:
    return [(r.start_ordinal, r.end_ordinal) for r in refs]
