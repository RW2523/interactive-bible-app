"""Explore data: the Bible atlas events and the Bible timeline, loaded from local JSON files
(``settings.explore_data_dir``: ``bible_events.json`` and ``bible_timeline_events.json``).

Each file is parsed once and re-read only when it changes (mtime/size). Every load also builds the verse -> event
reference index behind "See this on the map / timeline" from the reader: each event's Scripture reference strings
("Genesis 1-2", "Exodus 14", "Luke 2:1-20", "Leviticus 8, 9") are parsed with the local reference parser into
verse ordinal ranges.
"""
from __future__ import annotations

import bisect
import json
import logging
import re
import threading
from collections import defaultdict
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Callable

from ...bible import books as B
from ...bible.refparser import find_query_references, parse_query_reference
from ...config import get_settings
from ..bible import NotFound

log = logging.getLogger(__name__)

EVENTS_FILE = "bible_events.json"
TIMELINE_FILE = "bible_timeline_events.json"
Range = tuple[int, int]


class ExploreDataMissing(NotFound):
    """The atlas / timeline data files are not installed."""


@dataclass(frozen=True)
class Dataset:
    raw: Any  # the file as stored (the timeline bundle is served as-is)
    items: list[dict[str, Any]]
    by_id: dict[str, dict[str, Any]]
    ranges: dict[str, list[Range]]  # event id -> verse ordinal ranges covered by its references
    etag: str
    items_json: bytes  # {"items": [...]} pre-encoded
    raw_json: bytes


_lock = threading.Lock()
_loaded: dict[str, tuple[tuple[int, int], Dataset]] = {}


def _load(filename: str, items_of: Callable[[Any], Any], verse_refs_start_passages: bool) -> Dataset:
    path = get_settings().explore_data_dir / filename
    try:
        stat = path.stat()
    except FileNotFoundError:
        raise ExploreDataMissing(f"Explore data is not installed: {filename} was not found in {path.parent}") from None
    stamp = (stat.st_mtime_ns, stat.st_size)
    with _lock:
        cached = _loaded.get(str(path))
        if cached and cached[0] == stamp:
            return cached[1]
        raw = json.loads(path.read_text(encoding="utf-8"))
        items = [e for e in (items_of(raw) or []) if isinstance(e, dict) and isinstance(e.get("id"), str) and e["id"]]
        dataset = Dataset(
            raw=raw, items=items, by_id={e["id"]: e for e in items}, ranges=reference_index(items, verse_refs_start_passages),
            etag=f'W/"{filename}-{stamp[0]}-{stamp[1]}"', items_json=_encode({"items": items}), raw_json=_encode(raw),
        )
        _loaded[str(path)] = (stamp, dataset)
        return dataset


def _encode(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def atlas() -> Dataset:
    """The Bible atlas events (map + story videos)."""
    return _load(EVENTS_FILE, lambda raw: raw if isinstance(raw, list) else raw.get("events"), verse_refs_start_passages=False)


def timeline() -> Dataset:
    """The Bible timeline bundle ({schemaVersion, eraGroups, events, ...})."""
    return _load(TIMELINE_FILE, lambda raw: raw.get("events") if isinstance(raw, dict) else raw, verse_refs_start_passages=True)


def get_event(event_id: str) -> dict[str, Any]:
    event = atlas().by_id.get(event_id)
    if event is None:
        raise NotFound("Bible event not found")
    return event


def get_timeline_event(event_id: str) -> dict[str, Any]:
    event = timeline().by_id.get(event_id)
    if event is None:
        raise NotFound("timeline event not found")
    return event


def event_brief(event: dict[str, Any]) -> dict[str, Any]:
    return {"id": event["id"], "title": event.get("title"), "references": event.get("references") or [], "era": event.get("era"),
            "mapLocation": event.get("mapLocation")}


# ---------------------------------------------------------------------------------------------- reference index
_PARENTHETICAL = re.compile(r"\([^)]*\)")
_BOOK_FIXES = ((re.compile(r"^\s*songs\b", re.IGNORECASE), "Song of Songs"),)  # the timeline writes "Songs 1 - 8"
_CHAPTER_LIST_ITEM = re.compile(r"\s*[,;]\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?(?=\s*(?:[,;]|$))")
_THROUGH_CHAPTER = re.compile(r"\s*[-–—]\s*(\d{1,3})(?::(\d{1,3}))?(?=\s*(?:[,;]|$))")


@dataclass(frozen=True)
class RefRange:
    start: int
    end: int
    verse_marker: bool = False  # written as a single "chapter:verse" (the timeline marks where an event's passage starts)


def parse_reference(text: str) -> list[RefRange]:
    """Verse ranges covered by one reference string from the data files.

    Chapter-only references cover whole chapters ("Genesis 1-2", "Leviticus 8, 9", "Psalm 50, 73, 75 - 78"); a
    one-chapter book cited as chapter 1 ("Obadiah 1", "Jude 1") covers the book; "Deuteronomy 4:44 - 31" runs from
    4:44 to the end of chapter 31; notes in parentheses ("Psalms 2 - 145 (Assorted)") are ignored.
    """
    s = _PARENTHETICAL.sub(" ", text or "").strip()
    for pattern, replacement in _BOOK_FIXES:
        s = pattern.sub(replacement, s)
    refs = find_query_references(s)
    out: list[RefRange] = []
    for r in refs:
        with_colon = ":" in r.raw_text
        if r.kind == "verse" and not with_colon and B.BY_CODE[r.book].single_chapter and r.verse == 1:
            out.append(RefRange(*B.chapter_bounds(r.book, 1)))
        else:
            out.append(RefRange(r.start_ordinal, r.end_ordinal, r.kind == "verse" and with_colon))
    if not refs:
        return out
    # the conversational parser stops at chapter lists and at "4:44 - 31": finish those here
    last, tail, pos = refs[-1], s[refs[-1].end:], 0
    if last.kind in ("verse", "range"):
        m = _THROUGH_CHAPTER.match(tail)
        if m:
            chapter, verse = int(m.group(1)), int(m.group(2)) if m.group(2) else None
            if chapter > last.end_chapter and B.is_valid(last.book, chapter, verse):
                end = B.ordinal(last.book, chapter, verse) if verse else B.chapter_bounds(last.book, chapter)[1]
                out[-1] = RefRange(out[-1].start, end)
    elif last.kind in ("chapter", "chapter_range"):
        while m := _CHAPTER_LIST_ITEM.match(tail, pos):
            first = int(m.group(1))
            final = int(m.group(2)) if m.group(2) else first
            if final < first or not (B.is_valid(last.book, first) and B.is_valid(last.book, final)):
                break
            out.append(RefRange(B.chapter_bounds(last.book, first)[0], B.chapter_bounds(last.book, final)[1]))
            pos = m.end()
    return out


def _reference_strings(item: dict[str, Any]) -> list[str]:
    refs = item.get("references")
    if isinstance(refs, str):
        refs = [refs]
    if not refs and isinstance(item.get("referenceText"), str):
        refs = [part for part in re.split(r"[\n;]+", item["referenceText"]) if part.strip()]
    return [r for r in refs or [] if isinstance(r, str) and r.strip()]


def reference_index(items: list[dict[str, Any]], verse_refs_start_passages: bool) -> dict[str, list[Range]]:
    """event id -> verse ranges.

    With ``verse_refs_start_passages`` (the timeline), a reference to a single verse marks where the event's passage
    starts ("Birth of Jesus: Luke 2:6", "The Famine in Canaan: Genesis 12:10"): it runs up to the next such start in
    the same chapter, or to the end of the chapter.
    """
    parsed: dict[str, list[RefRange]] = {}
    for item in items:
        ranges: list[RefRange] = []
        for text in _reference_strings(item):
            found = parse_reference(text)
            if not found:
                log.warning("explore data: could not parse reference %r of %s", text, item["id"])
            ranges.extend(found)
        parsed[item["id"]] = ranges
    if not verse_refs_start_passages:
        return {eid: [(r.start, r.end) for r in ranges] for eid, ranges in parsed.items()}

    starts: dict[tuple[str, int], set[int]] = defaultdict(set)
    for ranges in parsed.values():
        for r in ranges:
            if r.verse_marker:
                code, chapter, verse = B.from_ordinal(r.start)
                starts[(code, chapter)].add(verse)
    ordered = {key: sorted(verses) for key, verses in starts.items()}
    index: dict[str, list[Range]] = {}
    for eid, ranges in parsed.items():
        out: list[Range] = []
        for r in ranges:
            if not r.verse_marker:
                out.append((r.start, r.end))
                continue
            code, chapter, verse = B.from_ordinal(r.start)
            later = ordered[(code, chapter)]
            i = bisect.bisect_right(later, verse)
            last_verse = later[i] - 1 if i < len(later) else B.verse_count(code, chapter)
            out.append((r.start, B.ordinal(code, chapter, last_verse)))
        index[eid] = out
    return index


@lru_cache
def _chapter_offsets() -> dict[str, list[int]]:
    """book code -> number of canon verses before each of its chapters."""
    offsets: dict[str, list[int]] = {}
    total = 0
    for book in B.BOOKS:
        chapter_starts = []
        for count in B.versification()[book.code]:
            chapter_starts.append(total)
            total += count
        offsets[book.code] = chapter_starts
    return offsets


def verse_span(start: int, end: int) -> int:
    """Number of verses from ``start`` to ``end`` (inclusive), across chapters and books."""
    def position(ordinal: int) -> int:
        code, chapter, verse = B.from_ordinal(ordinal)
        return _chapter_offsets()[code][chapter - 1] + verse - 1

    return max(1, position(end) - position(start) + 1)


def resolve_passage(ref: str) -> Range:
    rng = parse_query_reference((ref or "").replace("_", " ").strip())
    if not rng:
        raise NotFound(f"could not understand the reference '{ref}'")
    return rng


def matching_items(dataset: Dataset, start: int, end: int, limit: int) -> list[dict[str, Any]]:
    """Items with a reference overlapping [start, end], tightest reference first (then data order)."""
    scored = []
    for position, item in enumerate(dataset.items):
        spans = [verse_span(s, e) for s, e in dataset.ranges.get(item["id"], ()) if s <= end and e >= start]
        if spans:
            scored.append((min(spans), position, item))
    scored.sort(key=lambda t: (t[0], t[1]))
    return [item for _, _, item in scored[:limit]]


def events_for_reference(ref: str, limit: int = 20) -> dict[str, Any]:
    """Atlas + timeline events whose Scripture references overlap a verse or passage (canonical or display form)."""
    start, end = resolve_passage(ref)
    return {
        "ref": B.canonical_range_str(start, end),
        "display": B.display_ref(start, end),
        "events": [{"id": e["id"], "title": e.get("title"), "references": e.get("references") or [], "era": e.get("era")}
                   for e in matching_items(atlas(), start, end, limit)],
        "timeline": [{"id": e["id"], "title": e.get("title"), "dateLabel": e.get("dateLabel"), "referenceText": e.get("referenceText")}
                     for e in matching_items(timeline(), start, end, limit)],
    }
