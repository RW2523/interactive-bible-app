"""Exact local Scripture text for Sermon Studio.

* Scripture inputs store the verse text resolved from the local Bible (never model text).
* Prompts receive VERSE_TEXTS: the exact text of the sermon's Scripture focus and of every Scripture input.
* Drafts are grounded: when the sermon is written in English, a reference the model put in ``scripture`` fields is rewritten as
  ``"{display ref} — {exact text}"`` (WEB unless the pastor's Scripture inputs chose another translation).
"""
from __future__ import annotations

from collections import Counter
from typing import Any

from sqlalchemy.orm import Session

from ...bible import books as B
from ...bible.refparser import find_query_references, parse_query_reference, verse_ordinals
from ...config import get_settings
from ...db import fetch_all, fetch_one

MAX_VERSES = 12
SEPARATOR = " — "
ELLIPSIS = "…"
GROUNDED_LANGUAGES = ("English",)


def parse_reference(text: str | None) -> tuple[int, int] | None:
    """First Bible reference in ``text`` ('John 3:16', 'rom 8:28-30', 'Psalm 23', 'JHN.3.16') as (start, end) ordinals."""
    value = (text or "").strip()[:300]
    if not value:
        return None
    try:
        return parse_query_reference(value)
    except Exception:  # noqa: BLE001 - free text from users and models must never break a request
        return None


def all_references(text: str | None) -> list[tuple[int, int]]:
    """Every distinct reference in ``text``, in order."""
    value = (text or "").strip()[:600]
    found: list[tuple[int, int]] = []
    first = parse_reference(value)
    if first:
        found.append(first)
    try:
        refs = find_query_references(value) if value else []
    except Exception:  # noqa: BLE001
        refs = []
    for r in refs:
        rng = (r.start_ordinal, r.end_ordinal)
        if rng not in found:
            found.append(rng)
    return found


def translation_abbreviation(session: Session, translation: str) -> str:
    row = fetch_one(session, "SELECT abbreviation FROM bible_translations WHERE id = :t", t=translation)
    return ((row or {}).get("abbreviation") or translation).upper()


def passage_text(session: Session, start: int, end: int, translation: str | None = None, max_verses: int = MAX_VERSES) -> str:
    """Exact verse text of a passage (verses joined with spaces), capped at ``max_verses`` with a trailing ellipsis."""
    translation = translation or get_settings().default_translation
    ids = verse_ordinals(start, end)
    shown = ids[:max_verses]
    if not shown:
        return ""
    rows = fetch_all(session, """SELECT verse_id, translation_id, text FROM bible_verse_texts
                                 WHERE verse_id = ANY(:ids) AND translation_id IN (:t, :fallback)""",
                     ids=shown, t=translation, fallback=get_settings().default_translation)
    texts: dict[int, str] = {}
    for r in sorted(rows, key=lambda r: r["translation_id"] != translation):  # the requested translation wins, the default fills gaps
        texts.setdefault(r["verse_id"], (r["text"] or "").strip())
    body = " ".join(texts[i] for i in shown if texts.get(i))
    if body and len(ids) > max_verses:
        body += f" {ELLIPSIS}"
    return body


def display(start: int, end: int) -> str:
    return B.display_ref(start, end if end != start else None)


def canonical(start: int, end: int) -> str:
    return B.canonical_range_str(start, end if end != start else None)


def preferred_translation(inputs: list[dict[str, Any]]) -> str:
    """The translation the pastor used for their Scripture inputs (most common), else the default (WEB)."""
    used = Counter((i.get("meta") or {}).get("translation") for i in inputs if i.get("kind") == "bible_ref")
    used.pop(None, None)
    return used.most_common(1)[0][0] if used else get_settings().default_translation


def verse_texts_block(session: Session, scripture_ref: str | None, inputs: list[dict[str, Any]], translation: str) -> str:
    """VERSE_TEXTS for prompts: the sermon's Scripture focus plus every Scripture input, with exact local text."""
    lines: list[str] = []
    seen: set[tuple[str, str]] = set()
    abbreviations: dict[str, str] = {}

    def abbr(t: str) -> str:
        if t not in abbreviations:
            abbreviations[t] = translation_abbreviation(session, t)
        return abbreviations[t]

    for start, end in all_references(scripture_ref)[:6]:
        key = (canonical(start, end), translation)
        text = passage_text(session, start, end, translation)
        if text and key not in seen:
            seen.add(key)
            lines.append(f"{display(start, end)} ({abbr(translation)}): {text}")
    for inp in inputs:
        meta = inp.get("meta") or {}
        if inp.get("kind") != "bible_ref" or not meta.get("verse_text"):
            continue
        t = meta.get("translation") or translation
        key = (meta.get("canonical") or meta.get("reference") or "", t)
        if key in seen:
            continue
        seen.add(key)
        lines.append(f"{meta.get('reference') or meta.get('canonical')} ({abbr(t)}): {meta['verse_text']}")
    return "\n".join(lines) or "(none supplied)"


def ground_reference(session: Session, value: str | None, translation: str) -> tuple[str | None, dict[str, Any] | None]:
    """'Romans 8:28' (or 'Romans 8:28 (NIV): And we know...') -> 'Romans 8:28 — We know that all things work together...'.

    Extra references in the same field are kept as "(see also ...)". Unparseable values are returned unchanged."""
    if not value:
        return value, None
    head = value.split(SEPARATOR, 1)[0] if SEPARATOR in value else value
    refs = all_references(head)
    if not refs:
        return value, None
    start, end = refs[0]
    text = passage_text(session, start, end, translation)
    if not text:
        return value, None
    extras = [display(s, e) for s, e in refs[1:4]]
    grounded = f"{display(start, end)}{SEPARATOR}{text}" + (f" (see also {', '.join(extras)})" if extras else "")
    return grounded, {"reference": display(start, end), "canonical": canonical(start, end), "translation": translation}


def ground_structured(session: Session, structured: dict[str, Any], language: str, translation: str) -> list[dict[str, Any]]:
    """Rewrite the sermon's and each point's ``scripture`` with exact local text (English sermons only). Mutates ``structured``;
    returns what was grounded (for provenance)."""
    if language not in GROUNDED_LANGUAGES:
        return []
    grounded: list[dict[str, Any]] = []
    new, info = ground_reference(session, structured.get("scripture"), translation)
    if info:
        structured["scripture"] = new
        grounded.append({"field": "scripture", **info})
    for i, point in enumerate(structured.get("main_points") or []):
        new, info = ground_reference(session, point.get("scripture"), translation)
        if info:
            point["scripture"] = new
            grounded.append({"field": f"main_points[{i}].scripture", **info})
    return grounded


def reference_label(value: str | None, max_chars: int = 200) -> str | None:
    """A short Scripture label for the sermon's ``scripture_ref`` ('John 3:16-17'), from a (grounded) scripture field."""
    if not value:
        return None
    rng = parse_reference(value.split(SEPARATOR, 1)[0])
    if rng:
        return display(*rng)
    return value.strip().split("\n")[0][:max_chars] or None
