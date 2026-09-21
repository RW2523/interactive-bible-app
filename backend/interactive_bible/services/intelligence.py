"""Verse Intelligence (spec §2.3, §9.1): verse text, counts, ranked resources, themes, people/events, related Scripture, map preview."""
from __future__ import annotations

import time
from typing import Any

from sqlalchemy.orm import Session

from .. import cache
from ..ai.llm import get_llm
from ..bible import books as B
from ..bible.refparser import parse_query_reference, verse_ordinals
from ..db import fetch_all
from ..security import Viewer, visibility_clause
from ..vocab.service import entities_for_verse
from . import related
from .bible import NotFound, resolve_translation, verse_texts_for_range
from .cards import build_card, dedupe_cards, visible_links_sql

OVERLAP = "int4range(l.verse_id, coalesce(l.end_verse_id, l.verse_id), '[]') && int4range(:qs, :qe, '[]')"


def resolve_ref(ref: str) -> tuple[int, int]:
    rng = parse_query_reference(ref.replace("_", " "))
    if not rng:
        raise NotFound(f"could not understand the reference '{ref}'")
    return rng


def visible_cards(session: Session, viewer: Viewer, start: int, end: int) -> list[dict[str, Any]]:
    sql, params = visible_links_sql(viewer, OVERLAP)
    rows = fetch_all(session, sql, qs=start, qe=end, **params)
    # a passage parent and its child verse link describe the same mapping: prefer the child for single verses
    child_parents = {r["parent_link_id"] for r in rows if r["parent_link_id"]}
    rows = [r for r in rows if r["mapping_id"] not in child_parents or start != end]
    if start != end:
        rows = [r for r in rows if r["parent_link_id"] is None or not any(x["mapping_id"] == r["parent_link_id"] for x in rows)]
    cards = [build_card(r, start, end) for r in rows]
    return dedupe_cards(cards)


def themes_for(session: Session, viewer: Viewer, start: int, end: int, top_segment_ids: list[str]) -> list[dict[str, Any]]:
    ids = verse_ordinals(start, end)[:50]
    rows = fetch_all(
        session,
        """SELECT t.id, t.canonical_slug AS slug, t.name, t.category, max(vt.confidence) AS confidence, array_agg(DISTINCT vt.provenance->>'source') AS sources
           FROM verse_topics vt JOIN topics t ON t.id = vt.topic_id WHERE vt.verse_id = ANY(:ids)
           GROUP BY t.id ORDER BY confidence DESC LIMIT 10""",
        ids=ids,
    )
    themes = {r["id"]: {**r, "confidence": round(float(r["confidence"]), 3)} for r in rows}
    if top_segment_ids:
        for r in fetch_all(
            session,
            """SELECT t.id, t.canonical_slug AS slug, t.name, t.category, max(st.confidence) AS confidence, count(*) AS n
               FROM segment_topics st JOIN topics t ON t.id = st.topic_id WHERE st.segment_id = ANY(:ids)
               GROUP BY t.id ORDER BY n DESC, confidence DESC LIMIT 8""",
            ids=top_segment_ids,
        ):
            if r["id"] not in themes:
                themes[r["id"]] = {"id": r["id"], "slug": r["slug"], "name": r["name"], "category": r["category"], "confidence": round(float(r["confidence"]) * 0.9, 3), "sources": ["mapped_resources"]}
    return sorted(themes.values(), key=lambda t: -t["confidence"])[:10]


def entities_for(session: Session, start: int, end: int, top_segment_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, dict[str, dict[str, Any]]] = {"person": {}, "place": {}, "event": {}}
    for ent in entities_for_verse(start):
        if ent.type in out:
            span = next(((s, e) for s, e in ent.passages if s <= start <= e), None)
            out[ent.type][ent.id] = {"id": ent.id, "name": ent.name, "type": ent.type, "description": ent.description, "source": "curated_passage",
                                     "passage": B.display_ref(*span) if span else None, "confidence": 0.9}
    ids = verse_ordinals(start, end)[:50]
    for r in fetch_all(session, """SELECT e.id, e.name, e.type, e.description, max(ve.confidence) AS confidence FROM verse_entities ve JOIN entities e ON e.id = ve.entity_id
                                   WHERE ve.verse_id = ANY(:ids) GROUP BY e.id""", ids=ids):
        if r["type"] in out:
            out[r["type"]].setdefault(r["id"], {**r, "source": "verse_tagging", "confidence": round(float(r["confidence"]), 3)})
    if top_segment_ids:
        for r in fetch_all(session, """SELECT e.id, e.name, e.type, e.description, max(se.confidence) AS confidence FROM segment_entities se JOIN entities e ON e.id = se.entity_id
                                       WHERE se.segment_id = ANY(:ids) AND e.type IN ('person','place','event') GROUP BY e.id""", ids=top_segment_ids):
            out[r["type"]].setdefault(r["id"], {**r, "source": "mapped_resources", "confidence": round(float(r["confidence"]) * 0.85, 3)})
    return {"people": list(out["person"].values())[:8], "places": list(out["place"].values())[:6], "events": list(out["event"].values())[:8]}


def verse_intelligence(session: Session, viewer: Viewer, ref: str, translation: str | None = None) -> dict[str, Any]:
    t0 = time.monotonic()
    start, end = resolve_ref(ref)
    t = resolve_translation(session, translation)
    span_ids = verse_ordinals(start, end)[:60]
    global_v, verse_v = cache.versions(session, span_ids)
    key = ("intel", start, end, t, viewer.scope_key, global_v, tuple(sorted(verse_v.items())))
    cached = cache.intelligence_cache.get(key)
    if cached is not None:
        return {**cached, "provenance": {**cached["provenance"], "cache": "hit", "latency_ms": int((time.monotonic() - t0) * 1000)}}

    verses = verse_texts_for_range(session, start, end, t)
    cards = visible_cards(session, viewer, start, end)
    groups = {"watch": [c for c in cards if c["media_kind"] == "watch"], "listen": [c for c in cards if c["media_kind"] == "listen"], "study": [c for c in cards if c["media_kind"] == "study"]}
    top_segments = [c["segment_id"] for c in cards[:12]]
    themes = themes_for(session, viewer, start, end, top_segments)
    entities = entities_for(session, start, end, top_segments)
    rel = related.related_verses(session, viewer, start, end, limit=24)
    code, ch, v = B.from_ordinal(start)
    book = B.BY_CODE[code]
    rows = fetch_all(session, f"SELECT max(l.updated_at) AS ts, array_agg(DISTINCT l.pipeline_version) AS versions FROM verse_resource_links l WHERE {OVERLAP}", qs=start, qe=end)
    last_updated = rows[0]["ts"] if rows and rows[0]["ts"] else None
    payload = {
        "verse": {
            "ref": B.canonical_range_str(start, end if end != start else None), "display_ref": B.display_ref(start, end if end != start else None),
            "start": start, "end": end, "translation": t, "text": " ".join(x["text"] for x in verses), "verses": verses,
            "book": {"code": code, "name": book.name, "chapter": ch, "verse": v},
        },
        "counts": {"video": len(groups["watch"]), "audio": len(groups["listen"]), "study": len(groups["study"]), "related_verses": len(rel), "themes": len(themes),
                   "people_events": len(entities["people"]) + len(entities["events"]) + len(entities["places"])},
        "top_resources": cards[:10],
        "sections": {k: v[:8] for k, v in groups.items()},
        "themes": themes,
        "entities": entities,
        "book_context": {"code": code, "name": book.name, "testament": "Old Testament" if book.testament == "OT" else "New Testament", "genre": book.genre, "attribution": book.attribution},
        "related_verses": rel[:12],
        "map_preview": {
            "nodes": 1 + len(themes[:6]) + len(rel[:8]) + len(cards[:8]) + sum(len(x[:4]) for x in entities.values()),
            "top": [{"type": "theme", "label": th["name"]} for th in themes[:3]] + [{"type": "verse", "label": r["display_ref"]} for r in rel[:3]] + [{"type": "resource", "label": c["resource"]["title"]} for c in cards[:2]],
        },
        "ai_available": get_llm().available,
        "provenance": {
            "last_updated": last_updated.isoformat() if hasattr(last_updated, "isoformat") else None,
            "pipeline_versions": [x for x in (rows[0]["versions"] if rows else []) or [] if x],
            "cache": "miss", "cache_version": {"global": global_v, "verses": sum(verse_v.values())},
            "confidence_note": "Confidence is not theological truth; it is the system's confidence that a relationship is supported by the source content and Bible corpus.",
        },
    }
    payload["provenance"]["latency_ms"] = int((time.monotonic() - t0) * 1000)
    cache.intelligence_cache.set(key, payload)
    if get_llm().available and start == end and (not themes or any(r["why_status"] == "pending" for r in rel[:6])):
        related.maybe_enqueue_enrichment(start)
    return payload


def verse_resources(session: Session, viewer: Viewer, ref: str, kind: str | None, relationship: str | None, human_verified: bool | None,
                    resource_type: str | None, sort: str, page: int, page_size: int) -> dict[str, Any]:
    start, end = resolve_ref(ref)
    cards = visible_cards(session, viewer, start, end)
    if kind:
        cards = [c for c in cards if c["media_kind"] == kind]
    if relationship:
        wanted = set(relationship.split(","))
        cards = [c for c in cards if c["relationship"]["type"] in wanted or c["relationship"]["detected_type"] in wanted]
    if human_verified:
        cards = [c for c in cards if c["relationship"]["human_verified"]]
    if resource_type:
        types = set(resource_type.split(","))
        cards = [c for c in cards if c["resource"]["type"] in types or c["resource"]["category"] in types]
    if sort == "confidence":
        cards.sort(key=lambda c: -c["relationship"]["confidence"])
    elif sort == "title":
        cards.sort(key=lambda c: c["resource"]["title"].lower())
    total = len(cards)
    page = max(1, page)
    items = cards[(page - 1) * page_size : page * page_size]
    return {"ref": B.canonical_range_str(start, end if end != start else None), "total": total, "page": page, "page_size": page_size, "items": items}
