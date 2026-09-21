"""Bible reading APIs: translations, books, chapters with mapped-resource indicators, verse lookup."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .. import cache
from ..bible import books as B
from ..config import get_settings
from ..db import fetch_all
from ..security import Viewer, visibility_clause


class NotFound(Exception):
    pass


def translations(session: Session) -> list[dict[str, Any]]:
    return fetch_all(session, "SELECT id, name, abbreviation, license, source, verse_count, is_default FROM bible_translations WHERE can_display ORDER BY is_default DESC, id")


def books() -> list[dict[str, Any]]:
    return [
        {"code": b.code, "name": b.name, "testament": b.testament, "genre": b.genre, "chapters": B.chapter_count(b.code), "ordinal": b.ordinal, "attribution": b.attribution}
        for b in B.BOOKS
    ]


def resolve_translation(session: Session, translation: str | None) -> str:
    t = (translation or get_settings().default_translation).lower()
    ok = {r["id"] for r in translations(session)}
    if t not in ok:
        t = get_settings().default_translation if get_settings().default_translation in ok else next(iter(ok), "web")
    return t


def chapter(session: Session, viewer: Viewer, book: str, chapter_no: int, translation: str | None) -> dict[str, Any]:
    code = book.upper()
    if code not in B.BY_CODE:
        match = B.BY_NAME.get(book.lower())
        if not match:
            raise NotFound(f"unknown book {book}")
        code = match.code
    if not B.is_valid(code, chapter_no):
        raise NotFound(f"{code} has no chapter {chapter_no}")
    t = resolve_translation(session, translation)
    first, last = B.chapter_bounds(code, chapter_no)
    global_v, _ = cache.versions(session, [])
    rows = fetch_all(
        session,
        """SELECT v.id, v.verse, t.text FROM bible_verses v
           LEFT JOIN bible_verse_texts t ON t.verse_id = v.id AND t.translation_id = :t
           WHERE v.book_id = :b AND v.chapter = :c ORDER BY v.verse""",
        t=t, b=code, c=chapter_no,
    )
    vis, params = visibility_clause(viewer, "r", discoverable=True)
    indicator_rows = fetch_all(
        session,
        f"""SELECT v.id AS verse_id, r.type AS rtype, count(DISTINCT l.segment_id) AS n,
                   bool_or(l.relationship_type IN ('direct_reference', 'scripture_quote')) AS explicit
            FROM bible_verses v
            JOIN verse_resource_links l ON int4range(l.verse_id, coalesce(l.end_verse_id, l.verse_id), '[]') @> v.id
            JOIN resources r ON r.id = l.resource_id
            WHERE v.id BETWEEN :first AND :last AND l.review_status IN ('published', 'approved')
              AND (l.end_verse_id IS NULL OR l.end_verse_id - l.verse_id <= 9 OR l.parent_link_id IS NOT NULL) AND {vis}
            GROUP BY v.id, r.type""",
        first=first, last=last, **params,
    )
    passage_rows = fetch_all(
        session,
        f"""SELECT count(DISTINCT l.segment_id) AS n FROM verse_resource_links l JOIN resources r ON r.id = l.resource_id
            WHERE int4range(l.verse_id, coalesce(l.end_verse_id, l.verse_id), '[]') && int4range(:first, :last, '[]')
              AND l.end_verse_id - l.verse_id > 9 AND l.parent_link_id IS NULL AND l.review_status IN ('published', 'approved') AND {vis}""",
        first=first, last=last, **params,
    )
    indicators: dict[int, dict[str, Any]] = {}
    for r in indicator_rows:
        ind = indicators.setdefault(r["verse_id"], {"watch": 0, "listen": 0, "study": 0, "total": 0, "explicit": False})
        kind = {"video": "watch", "audio": "listen"}.get(r["rtype"], "study")
        ind[kind] += r["n"]
        ind["total"] += r["n"]
        ind["explicit"] = ind["explicit"] or r["explicit"]
    b = B.BY_CODE[code]
    prev_ref = next_ref = None
    if chapter_no > 1:
        prev_ref = {"book": code, "chapter": chapter_no - 1}
    elif b.ordinal > 1:
        pb = B.BY_ORDINAL[b.ordinal - 1]
        prev_ref = {"book": pb.code, "chapter": B.chapter_count(pb.code)}
    if chapter_no < B.chapter_count(code):
        next_ref = {"book": code, "chapter": chapter_no + 1}
    elif b.ordinal < 66:
        nb = B.BY_ORDINAL[b.ordinal + 1]
        next_ref = {"book": nb.code, "chapter": 1}
    return {
        "book": {"code": code, "name": b.name, "chapters": B.chapter_count(code), "testament": b.testament, "genre": b.genre},
        "chapter": chapter_no,
        "translation": t,
        "verses": [
            {"number": r["verse"], "ref": B.canonical_ref(code, chapter_no, r["verse"]), "text": r["text"], "indicators": indicators.get(r["id"])}
            for r in rows
        ],
        "chapter_resources": passage_rows[0]["n"] if passage_rows else 0,
        "prev": prev_ref,
        "next": next_ref,
        "cache_version": global_v,
    }


def verse_texts_for_range(session: Session, start: int, end: int, translation: str) -> list[dict[str, Any]]:
    from ..bible.refparser import verse_ordinals

    ids = verse_ordinals(start, end)[:200]
    rows = fetch_all(session, "SELECT verse_id, translation_id, text FROM bible_verse_texts WHERE verse_id = ANY(:ids)", ids=ids)
    by = {}
    for r in rows:
        by.setdefault(r["verse_id"], {})[r["translation_id"]] = r["text"]
    return [{"ref": B.ref_from_ordinal(i), "number": B.from_ordinal(i)[2], "text": by.get(i, {}).get(translation) or next(iter(by.get(i, {}).values()), ""), "translations": by.get(i, {})} for i in ids]
