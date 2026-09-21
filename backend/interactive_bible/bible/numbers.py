"""Spoken / written number parsing for Scripture references.

Handles digits ("28", "8th"), cardinal words ("twenty-eight", "one hundred and nineteen")
and ordinal words ("eighth", "twenty-eighth"). Bare sequences are *not* concatenated:
"three sixteen" parses as 3 followed by 16, which is how references are spoken.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol, Sequence

UNITS = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9}
TEENS = {
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
}
TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fourty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
ORD_UNITS = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6, "seventh": 7, "eighth": 8, "ninth": 9}
ORD_TEENS = {
    "tenth": 10, "eleventh": 11, "twelfth": 12, "thirteenth": 13, "fourteenth": 14, "fifteenth": 15,
    "sixteenth": 16, "seventeenth": 17, "eighteenth": 18, "nineteenth": 19,
}
ORD_TENS = {"twentieth": 20, "thirtieth": 30, "fortieth": 40, "fiftieth": 50, "sixtieth": 60, "seventieth": 70, "eightieth": 80, "ninetieth": 90}

NUMBER_WORDS = set(UNITS) | set(TEENS) | set(TENS) | set(ORD_UNITS) | set(ORD_TEENS) | set(ORD_TENS) | {"hundred", "hundredth"}
_DIGIT_RE = re.compile(r"^(\d+)(st|nd|rd|th)?$")


class TokenLike(Protocol):
    lower: str
    kind: str


@dataclass
class NumberMatch:
    value: int
    start: int  # token index (inclusive)
    end: int  # token index (exclusive)
    kind: str  # "digit" | "word"
    ordinal: bool


def _parts(tok: TokenLike) -> list[str]:
    return tok.lower.split("-") if tok.kind == "word" else [tok.lower]


def parse_number(tokens: Sequence[TokenLike], i: int) -> NumberMatch | None:
    """Parse one number starting at token index i."""
    if i >= len(tokens):
        return None
    tok = tokens[i]
    if tok.kind == "num":
        m = _DIGIT_RE.match(tok.lower)
        if not m:
            return None
        return NumberMatch(int(m.group(1)), i, i + 1, "digit", bool(m.group(2)))
    if tok.kind != "word":
        return None

    # flatten hyphenated word tokens into (word, token_index) pairs, stopping at non-number words
    words: list[tuple[str, int]] = []
    j = i
    while j < len(tokens) and tokens[j].kind == "word":
        parts = _parts(tokens[j])
        if not all(p in NUMBER_WORDS or p in ("and", "a") for p in parts):
            break
        words.extend((p, j) for p in parts)
        j += 1
        if len(words) > 8:
            break
    if not words:
        return None

    pos = 0
    value = 0
    ordinal = False

    def peek(k: int = 0) -> str | None:
        return words[pos + k][0] if pos + k < len(words) else None

    # optional hundreds: [unit|a] hundred [and]
    if peek() in UNITS and peek(1) in ("hundred", "hundredth"):
        value = UNITS[peek()] * 100
        ordinal = peek(1) == "hundredth"
        pos += 2
    elif peek() == "a" and peek(1) == "hundred":
        value = 100
        pos += 2
    elif peek() in ("hundred", "hundredth"):
        value = 100
        ordinal = peek() == "hundredth"
        pos += 1
    if value and not ordinal and peek() == "and" and peek(1) is not None and (
        peek(1) in UNITS or peek(1) in TEENS or peek(1) in TENS or peek(1) in ORD_UNITS or peek(1) in ORD_TEENS or peek(1) in ORD_TENS
    ):
        pos += 1

    w = peek()
    if not ordinal and w is not None:
        if w in TENS:
            value += TENS[w]
            pos += 1
            if peek() in UNITS:
                value += UNITS[peek()]
                pos += 1
            elif peek() in ORD_UNITS:
                value += ORD_UNITS[peek()]
                ordinal = True
                pos += 1
        elif w in ORD_TENS:
            value += ORD_TENS[w]
            ordinal = True
            pos += 1
        elif w in TEENS:
            value += TEENS[w]
            pos += 1
        elif w in ORD_TEENS:
            value += ORD_TEENS[w]
            ordinal = True
            pos += 1
        elif w in UNITS and not value:
            value = UNITS[w]
            pos += 1
        elif w in UNITS and value:
            value += UNITS[w]
            pos += 1
        elif w in ORD_UNITS:
            value += ORD_UNITS[w]
            ordinal = True
            pos += 1

    if pos == 0 or (value == 0 and peek(-1) != "zero"):
        return None
    last_token_index = words[pos - 1][1]
    # a hyphenated token must be consumed entirely ("twenty-eight" ok; "eight-year" never gets here)
    consumed_parts = sum(1 for _, ti in words[:pos] if ti == last_token_index)
    if consumed_parts != len(_parts(tokens[last_token_index])):
        return None
    return NumberMatch(value, i, last_token_index + 1, "word", ordinal)


def number_ending_at(tokens: Sequence[TokenLike], end: int, max_len: int = 5) -> NumberMatch | None:
    """Find the longest number whose token span ends exactly at ``end`` (exclusive)."""
    best: NumberMatch | None = None
    for start in range(max(0, end - max_len), end):
        m = parse_number(tokens, start)
        if m and m.end == end and (best is None or m.start < best.start):
            best = m
    return best
