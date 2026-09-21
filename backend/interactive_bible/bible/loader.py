"""Load public-domain Bible corpora (eBible VPL) and OpenBible cross references into PostgreSQL."""
from __future__ import annotations

import hashlib
import logging
import math
import re
from pathlib import Path

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import execute, fetch_one
from . import books as B
from .text import clean_kjv

log = logging.getLogger(__name__)

TRANSLATIONS = [
    {
        "id": "web", "file": "engwebp_vpl.txt", "name": "World English Bible", "abbreviation": "WEB",
        "license": "Public Domain", "source": "https://ebible.org/Scriptures/engwebp_vpl.zip", "is_default": True,
    },
    {
        "id": "kjv", "file": "eng-kjv2006_vpl.txt", "name": "King James Version", "abbreviation": "KJV",
        "license": "Public Domain (Crown copyright in the UK)", "source": "https://ebible.org/Scriptures/eng-kjv2006_vpl.zip", "is_default": False,
    },
    {
        "id": "asv", "file": "eng-asv_vpl.txt", "name": "American Standard Version (1901)", "abbreviation": "ASV",
        "license": "Public Domain", "source": "https://ebible.org/Scriptures/eng-asv_vpl.zip", "is_default": False,
    },
]
CROSSREF_FILE = "cross_references.txt"
CLEANING_VERSION = "clean-2"  # bump when read_vpl cleaning changes so corpora reload
VPL_RE = re.compile(r"^(\w{3}) (\d+):(\d+) ?(.*)$")


def _copy_rows(session: Session, sql: str, rows: list[tuple]) -> None:
    raw = session.connection().connection.driver_connection
    with raw.cursor() as cur:
        with cur.copy(sql) as copy:
            for row in rows:
                copy.write_row(row)


def read_vpl(path: Path, translation_id: str) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    with path.open(encoding="utf-8-sig") as fh:
        for line in fh:
            m = VPL_RE.match(line.rstrip("\n"))
            if not m:
                continue
            book = B.BY_BW.get(m.group(1))
            if not book:
                continue
            text = clean_kjv(m.group(4).replace("¶", "")).strip()
            if not text:
                continue
            out.append((B.ordinal(book.code, int(m.group(2)), int(m.group(3))), text))
    return out


def load_books_and_verses(session: Session) -> int:
    existing = fetch_one(session, "SELECT count(*) AS n FROM bible_verses")["n"]
    if existing:
        return existing
    for book in B.BOOKS:
        execute(
            session,
            """INSERT INTO bible_books (id, ordinal, osis, name, testament, genre, attribution, chapters)
               VALUES (:id, :ordinal, :osis, :name, :testament, :genre, :attribution, :chapters)
               ON CONFLICT (id) DO NOTHING""",
            id=book.code, ordinal=book.ordinal, osis=book.osis, name=book.name, testament=book.testament,
            genre=book.genre, attribution=book.attribution, chapters=B.chapter_count(book.code),
        )
    rows = []
    for book in B.BOOKS:
        for ch_index, count in enumerate(B.versification()[book.code], start=1):
            for v in range(1, count + 1):
                rows.append((B.ordinal(book.code, ch_index, v), f"{book.code}.{ch_index}.{v}", book.code, ch_index, v))
    _copy_rows(session, "COPY bible_verses (id, canonical_ref, book_id, chapter, verse) FROM STDIN", rows)
    return len(rows)


def load_translations(session: Session, data_dir: Path | None = None) -> dict[str, int]:
    data_dir = data_dir or get_settings().bible_data_dir
    loaded: dict[str, int] = {}
    for spec in TRANSLATIONS:
        path = data_dir / spec["file"]
        if not path.exists():
            log.warning("translation file missing: %s (run scripts/fetch_data.sh)", path)
            continue
        version = hashlib.sha256(path.read_bytes() + CLEANING_VERSION.encode()).hexdigest()[:16]
        row = fetch_one(session, "SELECT corpus_version, verse_count FROM bible_translations WHERE id = :id", id=spec["id"])
        if row and row["corpus_version"] == version and row["verse_count"] > 0:
            loaded[spec["id"]] = row["verse_count"]
            continue
        verses = read_vpl(path, spec["id"])
        execute(session, "DELETE FROM bible_verse_texts WHERE translation_id = :id", id=spec["id"])
        execute(
            session,
            """INSERT INTO bible_translations (id, name, abbreviation, license, source, is_default, corpus_version, verse_count)
               VALUES (:id, :name, :abbr, :license, :source, :is_default, :version, :count)
               ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, abbreviation = EXCLUDED.abbreviation,
                 license = EXCLUDED.license, source = EXCLUDED.source, is_default = EXCLUDED.is_default,
                 corpus_version = EXCLUDED.corpus_version, verse_count = EXCLUDED.verse_count, loaded_at = now()""",
            id=spec["id"], name=spec["name"], abbr=spec["abbreviation"], license=spec["license"], source=spec["source"],
            is_default=spec["is_default"], version=version, count=len(verses),
        )
        _copy_rows(
            session,
            "COPY bible_verse_texts (verse_id, translation_id, text) FROM STDIN",
            [(ordinal, spec["id"], text) for ordinal, text in verses],
        )
        loaded[spec["id"]] = len(verses)
        log.info("loaded %s: %d verses", spec["id"], len(verses))
    return loaded


def _osis_range(value: str) -> tuple[int, int | None] | None:
    if "-" in value:
        a, b = value.split("-", 1)
        start, end = B.osis_to_ordinal(a), B.osis_to_ordinal(b)
        if start is None or end is None or end < start:
            return None
        return start, end
    start = B.osis_to_ordinal(value)
    return (start, None) if start is not None else None


def crossref_confidence(votes: int) -> float:
    return round(min(0.95, 0.5 + 0.45 * math.log10(max(votes, 1)) / 3.0), 3)


def load_cross_references(session: Session, min_votes: int = 10, data_dir: Path | None = None) -> int:
    data_dir = data_dir or get_settings().bible_data_dir
    path = data_dir / CROSSREF_FILE
    if not path.exists():
        log.warning("cross reference file missing: %s", path)
        return 0
    existing = fetch_one(session, "SELECT count(*) AS n FROM verse_relationships WHERE source = 'openbible'")["n"]
    if existing:
        return existing
    rows = []
    seen = set()
    with path.open(encoding="utf-8") as fh:
        next(fh, None)
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            try:
                votes = int(parts[2])
            except ValueError:
                continue
            if votes < min_votes:
                continue
            src, dst = _osis_range(parts[0]), _osis_range(parts[1])
            if not src or not dst:
                continue
            key = (src[0], src[1] or src[0], dst[0], dst[1] or dst[0])
            if key in seen:
                continue
            seen.add(key)
            evidence = '{"votes": %d, "dataset": "OpenBible.info cross references (CC-BY)"}' % votes
            rows.append((src[0], src[1], dst[0], dst[1], "cross_reference", "openbible", crossref_confidence(votes), evidence, '{"source": "openbible.info", "license": "CC-BY"}'))
    _copy_rows(
        session,
        "COPY verse_relationships (from_verse_id, from_end_verse_id, to_verse_id, to_end_verse_id, relationship_type, source, confidence, evidence, provenance) FROM STDIN",
        rows,
    )
    return len(rows)


def corpus_status(session: Session) -> dict:
    translations = [
        dict(r) for r in session.execute(
            sql_text("SELECT id, name, abbreviation, license, verse_count, is_default, corpus_version FROM bible_translations ORDER BY is_default DESC, id")
        ).mappings()
    ]
    return {"translations": translations}
