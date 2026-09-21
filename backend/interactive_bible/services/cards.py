"""Shared builders for resource cards, relationship labels and link queries."""
from __future__ import annotations

from typing import Any

from ..bible import books as B
from ..pipeline.routing import display_label
from ..security import Viewer, visibility_clause

MEDIA_KIND = {"video": "watch", "audio": "listen"}
TYPE_WEIGHT = {"direct_reference": 1.0, "scripture_quote": 0.92, "contextual_reference": 0.75, "ai_related": 0.65}
LINK_COLUMNS = """
    l.id AS mapping_id, l.verse_id, l.end_verse_id, l.parent_link_id, l.relationship_type, l.relationship_subtype, l.confidence,
    l.confidence_override, l.primary_flag, l.evidence_text, l.evidence_offsets, l.mention_count, l.why_related, l.review_status,
    l.is_human_verified, l.needs_review, l.updated_at AS link_updated_at, l.pipeline_version, l.provenance->>'source' AS provenance_source,
    s.id AS segment_id, s.ordinal AS segment_ordinal, s.start_ms, s.end_ms, s.page_start, s.page_end, s.heading, s.summary, s.speaker AS segment_speaker,
    left(s.text_normalized, 400) AS excerpt, s.clip_start_ms, s.clip_end_ms, s.clip_core_start_ms, s.clip_core_end_ms, s.clip_review_status,
    r.id AS resource_id, r.title, r.type AS resource_type, r.category, r.speaker, r.author, r.duration_ms, r.page_count, r.is_official,
    r.visibility, r.rights_status, r.language, r.source_kind, r.series, r.created_at AS resource_created_at,
    r.metadata->'youtube'->>'thumbnail' AS resource_thumbnail, r.metadata->'youtube'->>'video_id' AS resource_youtube_id
"""


def media_kind(resource_type: str) -> str:
    return MEDIA_KIND.get(resource_type, "study")


def effective_confidence(row: dict[str, Any]) -> float:
    return float(row["confidence_override"] if row.get("confidence_override") is not None else row["confidence"])


def visible_links_sql(viewer: Viewer, where: str, statuses: tuple[str, ...] = ("published", "approved"), discoverable: bool = True) -> tuple[str, dict[str, Any]]:
    vis, params = visibility_clause(viewer, "r", discoverable=discoverable)
    status_list = ",".join(f"'{s}'" for s in statuses)
    sql = f"""SELECT {LINK_COLUMNS}
              FROM verse_resource_links l
              JOIN resource_segments s ON s.id = l.segment_id
              JOIN resources r ON r.id = l.resource_id
              WHERE ({where}) AND l.review_status IN ({status_list}) AND {vis}"""
    return sql, params


def build_card(row: dict[str, Any], query_start: int | None = None, query_end: int | None = None) -> dict[str, Any]:
    conf = effective_confidence(row)
    start, end = row["verse_id"], row["end_verse_id"] or row["verse_id"]
    span = end - start
    exact = row["parent_link_id"] is not None or span == 0
    passage_note = None
    rel_type = row["relationship_type"]
    label = display_label(rel_type, conf, bool(row["is_human_verified"]))
    exactness = 1.0
    if query_start is not None and not exact:
        from ..bible.refparser import verse_ordinals

        size = len(verse_ordinals(start, end)) if B.from_ordinal(start)[0] == B.from_ordinal(end)[0] else 999
        if size > 10:
            exactness = 0.6
            passage_note = f"Discusses {B.display_ref(start, end)}"
            if rel_type in ("direct_reference", "scripture_quote") and not (start == query_start and end == query_end):
                label = {**label, "type": "contextual_reference", "label": "Contextual Reference", "note": passage_note}
        else:
            exactness = 0.85
    human = bool(row["is_human_verified"])
    rank = TYPE_WEIGHT.get(label["type"], 0.6) * conf * exactness + (0.12 if human else 0) + (0.06 if row["primary_flag"] else 0) \
        + 0.03 * min(max(row["mention_count"] - 1, 0), 3) + (0.02 if row["is_official"] else 0)
    kind = media_kind(row["resource_type"])
    clip = None
    if row.get("start_ms") is not None:
        clip = {
            "start_ms": row["clip_start_ms"] if row["clip_start_ms"] is not None else row["start_ms"],
            "end_ms": row["clip_end_ms"] if row["clip_end_ms"] is not None else row["end_ms"],
            "core_start_ms": row["clip_core_start_ms"], "core_end_ms": row["clip_core_end_ms"],
            "reviewed": row["clip_review_status"] in ("approved", "edited"),
        }
    return {
        "mapping_id": row["mapping_id"],
        "segment_id": row["segment_id"],
        "media_kind": kind,
        "resource": {
            "id": row["resource_id"], "title": row["title"], "type": row["resource_type"], "category": row["category"],
            "speaker": row["speaker"] or row.get("segment_speaker"), "author": row["author"], "duration_ms": row["duration_ms"],
            "page_count": row["page_count"], "is_official": row["is_official"], "visibility": row["visibility"], "language": row["language"],
            "series": row.get("series"), "thumbnail_url": row.get("resource_thumbnail"), "youtube_id": row.get("resource_youtube_id"),
        },
        "verse_ref": B.canonical_range_str(start, row["end_verse_id"]),
        "verse_display": B.display_ref(start, row["end_verse_id"]),
        "segment": {"ordinal": row["segment_ordinal"], "start_ms": row["start_ms"], "end_ms": row["end_ms"], "page_start": row["page_start"], "page_end": row["page_end"], "heading": row["heading"]},
        "clip": clip,
        "summary": row["summary"],
        "excerpt": row["excerpt"],
        "evidence_text": row["evidence_text"],
        "why_related": row["why_related"],
        "relationship": {**label, "subtype": row["relationship_subtype"], "confidence": round(conf, 3), "primary": row["primary_flag"], "mention_count": row["mention_count"], "passage_note": passage_note},
        "review_status": row["review_status"],
        "rank_score": round(rank, 4),
    }


def dedupe_cards(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One card per segment: keep the best-ranked mapping for each segment."""
    best: dict[str, dict[str, Any]] = {}
    for c in cards:
        cur = best.get(c["segment_id"])
        if cur is None or c["rank_score"] > cur["rank_score"]:
            best[c["segment_id"]] = c
    return sorted(best.values(), key=lambda c: -c["rank_score"])
