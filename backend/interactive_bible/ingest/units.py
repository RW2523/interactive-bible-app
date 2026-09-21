"""Transcript/document units and normalisation (ING-03/ING-04).

A *unit* is a sentence (spoken content) or a block (documents). Raw text is kept unchanged;
normalised text is derived; char offsets point into the resource's normalised full text.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any

from ..bible.text import nfkc, sentence_split

FILLERS = re.compile(r"(?<![A-Za-z])(?:um+|uh+|erm+|uhm+|hmm+)(?![A-Za-z])[,.]?\s*", re.IGNORECASE)
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE = re.compile(r"(?<![\d:])(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?![\d:])")
CARD = re.compile(r"(?<!\d)\d(?:[ -]?\d){12,15}(?!\d)")


@dataclass
class Unit:
    id: str
    kind: str  # sentence | paragraph | heading | list_item | table | quote
    text_raw: str
    text: str = ""
    start_ms: int | None = None
    end_ms: int | None = None
    speaker: str | None = None
    page: int | None = None
    heading: str | None = None
    char_start: int = 0
    char_end: int = 0
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Unit":
        return cls(**{k: d.get(k) for k in cls.__dataclass_fields__ if k in d})  # type: ignore[arg-type]

    @property
    def duration_ms(self) -> int:
        if self.start_ms is None or self.end_ms is None:
            return 0
        return max(0, self.end_ms - self.start_ms)


def _luhn_ok(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def redact_pii(text: str) -> tuple[str, int]:
    count = 0

    def sub(tag: str):
        def inner(m: re.Match[str]) -> str:
            nonlocal count
            count += 1
            return tag
        return inner

    text = EMAIL.sub(sub("[email]"), text)
    text = PHONE.sub(sub("[phone]"), text)

    def card(m: re.Match[str]) -> str:
        nonlocal count
        digits = re.sub(r"\D", "", m.group(0))
        if 13 <= len(digits) <= 16 and _luhn_ok(digits):
            count += 1
            return "[number]"
        return m.group(0)

    text = CARD.sub(card, text)
    return text, count


def normalize_text(text: str, redact: bool = True) -> tuple[str, int]:
    t = nfkc(text)
    t = FILLERS.sub("", t)
    t = re.sub(r"\s+([,.;:!?])", r"\1", t)
    t = re.sub(r"[ \t]+", " ", t).strip()
    redactions = 0
    if redact:
        t, redactions = redact_pii(t)
    return t, redactions


def finalize_units(units: list[Unit], spoken: bool, redact: bool = True) -> tuple[list[Unit], str, dict[str, Any]]:
    """Normalise every unit and build the full normalised text with char offsets."""
    parts: list[str] = []
    pos = 0
    redactions = 0
    prev: Unit | None = None
    kept: list[Unit] = []
    for u in units:
        u.text, r = normalize_text(u.text_raw, redact)
        redactions += r
        if not u.text:
            continue
        if prev is not None:
            if spoken:
                sep = "\n" if (u.speaker or "") != (prev.speaker or "") else " "
            else:
                sep = "\n\n"
            parts.append(sep)
            pos += len(sep)
        u.char_start = pos
        parts.append(u.text)
        pos += len(u.text)
        u.char_end = pos
        kept.append(u)
        prev = u
    for i, u in enumerate(kept, start=1):
        u.id = f"u{i:04d}"
    return kept, "".join(parts), {"pii_redactions": redactions, "unit_count": len(kept)}


def split_sentences_with_times(text: str, start_ms: int | None, end_ms: int | None) -> list[tuple[str, int | None, int | None]]:
    """Split a timed text span into sentences, allocating time proportionally to characters."""
    spans = sentence_split(text)
    if not spans:
        return []
    if start_ms is None or end_ms is None or len(spans) == 1:
        return [(text[s:e], start_ms, end_ms) for s, e in spans] if len(spans) > 1 else [(text.strip(), start_ms, end_ms)]
    total = max(1, len(text))
    out = []
    for s, e in spans:
        st = start_ms + int((end_ms - start_ms) * s / total)
        en = start_ms + int((end_ms - start_ms) * e / total)
        out.append((text[s:e], st, max(st, en)))
    return out
