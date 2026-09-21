"""Stages ING-13/14/16: atomic persistence of segments + mappings with human-review protection (REV-05, AC-09, AC-12)."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from .. import cache
from ..bible.refparser import verse_ordinals
from ..config import get_settings
from ..db import execute, fetch_all, json_dumps
from ..ids import new_id
from ..retrieval.semantic import vector_literal
from .types import Mapping, SegmentWork

PROTECTED_SQL = "(is_human_verified OR review_status IN ('approved', 'rejected') OR provenance->>'source' = 'human')"
CHILD_EXPANSION_MAX = 10


def _overlap(a: tuple[int | None, int | None], b: tuple[int | None, int | None]) -> int:
    if None in a or None in b:
        return 0
    return max(0, min(a[1], b[1]) - max(a[0], b[0]))  # type: ignore[type-var]


def _best_target(old: dict[str, Any], new: list[SegmentWork], media: bool) -> SegmentWork | None:
    best, best_score = None, 0
    for s in new:
        score = _overlap((old["start_ms"], old["end_ms"]), (s.start_ms, s.end_ms)) if media else _overlap((old["char_start"], old["char_end"]), (s.char_start, s.char_end))
        if score > best_score:
            best, best_score = s, score
    return best


def _link_row(m: Mapping, seg: SegmentWork, resource: dict[str, Any], run_id: str, degraded: bool, parent_id: str | None = None) -> dict[str, Any]:
    offsets = [
        {"start": s, "end": e, "start_ms": t[0], "end_ms": t[1]}
        for (s, e), t in zip(m.spans, m.evidence_times or [(None, None)] * len(m.spans))
    ]
    provenance = {
        "source": "pipeline", "pipeline_version": get_settings().pipeline_version, "run_id": run_id, "detectors": m.detectors,
        "signals": m.signals, "ai_calls": seg.ai_calls, "degraded": degraded, "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if parent_id:
        provenance["parent_link_id"] = parent_id
    return {
        "id": new_id("map"), "verse_id": m.start, "end_verse_id": m.end if m.end != m.start else None, "segment_id": seg.id,
        "resource_id": resource["id"], "parent_link_id": parent_id, "relationship_type": m.type,
        "relationship_subtype": "passage_member" if parent_id else m.subtype, "confidence": round(float(m.confidence), 4),
        "primary_flag": bool(m.primary) and not parent_id, "evidence_text": m.evidence_text, "evidence_offsets": json_dumps(offsets),
        "mention_count": m.mention_count, "why_related": m.why_related, "provenance": json_dumps(provenance),
        "review_status": m.review_status, "needs_review": bool(m.needs_review), "review_reasons": list(m.review_reasons),
        "audit": json_dumps(m.audit or {}), "run_id": run_id, "pipeline_version": get_settings().pipeline_version,
    }


INSERT_LINK = """
INSERT INTO verse_resource_links (id, verse_id, end_verse_id, segment_id, resource_id, parent_link_id, relationship_type,
    relationship_subtype, confidence, primary_flag, evidence_text, evidence_offsets, mention_count, why_related, provenance,
    review_status, needs_review, review_reasons, is_human_verified, audit, processing_run_id, pipeline_version)
VALUES (:id, :verse_id, :end_verse_id, :segment_id, :resource_id, :parent_link_id, :relationship_type, :relationship_subtype,
    :confidence, :primary_flag, :evidence_text, CAST(:evidence_offsets AS jsonb), :mention_count, :why_related, CAST(:provenance AS jsonb),
    :review_status, :needs_review, :review_reasons, false, CAST(:audit AS jsonb), :run_id, :pipeline_version)
ON CONFLICT DO NOTHING
"""


def persist_results(session: Session, resource: dict[str, Any], run_id: str, transcript_id: str, segments: list[SegmentWork], degraded: bool, media: bool) -> dict[str, Any]:
    rid = resource["id"]
    affected: set[int] = set()
    for r in fetch_all(session, "SELECT verse_id, coalesce(end_verse_id, verse_id) AS end_id FROM verse_resource_links WHERE resource_id = :r", r=rid):
        affected.update(range(r["verse_id"], r["end_id"] + 1) if r["end_id"] - r["verse_id"] < 2000 else [r["verse_id"]])

    old_segments = fetch_all(session, "SELECT id, start_ms, end_ms, char_start, char_end, clip_review_status, clip_start_ms, clip_end_ms, clip_core_start_ms, clip_core_end_ms, clip_reason FROM resource_segments WHERE resource_id = :r", r=rid)
    new_ids = {s.id for s in segments}

    # --- upsert segments (content addressed ids keep human-reviewed links attached)
    for seg in segments:
        clip = seg.clip or {}
        execute(
            session,
            """INSERT INTO resource_segments (id, resource_id, transcript_id, ordinal, start_ms, end_ms, page_start, page_end, char_start, char_end,
                   unit_ids, heading, speaker, transcript_raw, text_normalized, unit_offsets, topic_hint, boundary_reason, summary, summary_provenance,
                   clip_start_ms, clip_end_ms, clip_core_start_ms, clip_core_end_ms, clip_reason, clip_confidence, clip_provenance, clip_review_status,
                   non_speech_ratio, part, is_active, processing_run_id, updated_at)
               VALUES (:id, :rid, :tid, :ordinal, :start_ms, :end_ms, :page_start, :page_end, :char_start, :char_end, :unit_ids, :heading, :speaker,
                   :raw, :text, CAST(:unit_offsets AS jsonb), :topic_hint, :boundary_reason, :summary, CAST(:summary_prov AS jsonb),
                   :clip_start, :clip_end, :core_start, :core_end, :clip_reason, :clip_conf, CAST(:clip_prov AS jsonb), :clip_status, :non_speech, :part, true, :run_id, now())
               ON CONFLICT (id) DO UPDATE SET transcript_id = EXCLUDED.transcript_id, ordinal = EXCLUDED.ordinal, unit_ids = EXCLUDED.unit_ids,
                   heading = EXCLUDED.heading, speaker = EXCLUDED.speaker, unit_offsets = EXCLUDED.unit_offsets, topic_hint = EXCLUDED.topic_hint,
                   boundary_reason = EXCLUDED.boundary_reason, summary = coalesce(EXCLUDED.summary, resource_segments.summary),
                   summary_provenance = coalesce(EXCLUDED.summary_provenance, resource_segments.summary_provenance),
                   clip_start_ms = CASE WHEN resource_segments.clip_review_status IN ('approved', 'edited') THEN resource_segments.clip_start_ms ELSE EXCLUDED.clip_start_ms END,
                   clip_end_ms = CASE WHEN resource_segments.clip_review_status IN ('approved', 'edited') THEN resource_segments.clip_end_ms ELSE EXCLUDED.clip_end_ms END,
                   clip_core_start_ms = CASE WHEN resource_segments.clip_review_status IN ('approved', 'edited') THEN resource_segments.clip_core_start_ms ELSE EXCLUDED.clip_core_start_ms END,
                   clip_core_end_ms = CASE WHEN resource_segments.clip_review_status IN ('approved', 'edited') THEN resource_segments.clip_core_end_ms ELSE EXCLUDED.clip_core_end_ms END,
                   clip_reason = CASE WHEN resource_segments.clip_review_status IN ('approved', 'edited') THEN resource_segments.clip_reason ELSE EXCLUDED.clip_reason END,
                   clip_confidence = CASE WHEN resource_segments.clip_review_status IN ('approved', 'edited') THEN resource_segments.clip_confidence ELSE EXCLUDED.clip_confidence END,
                   clip_provenance = CASE WHEN resource_segments.clip_review_status IN ('approved', 'edited') THEN resource_segments.clip_provenance ELSE EXCLUDED.clip_provenance END,
                   clip_review_status = CASE WHEN resource_segments.clip_review_status IN ('approved', 'edited') THEN resource_segments.clip_review_status ELSE EXCLUDED.clip_review_status END,
                   non_speech_ratio = EXCLUDED.non_speech_ratio, part = EXCLUDED.part,
                   is_active = true, processing_run_id = EXCLUDED.processing_run_id, updated_at = now()""",
            id=seg.id, rid=rid, tid=transcript_id, ordinal=seg.ordinal, start_ms=seg.start_ms, end_ms=seg.end_ms, page_start=seg.page_start,
            page_end=seg.page_end, char_start=seg.char_start, char_end=seg.char_end, unit_ids=seg.unit_ids, heading=seg.heading, speaker=seg.speaker,
            raw=seg.transcript_raw, text=seg.text, unit_offsets=json_dumps(seg.unit_offsets), topic_hint=seg.topic_hint, boundary_reason=seg.boundary_reason,
            non_speech=seg.non_speech_ratio, part=seg.part,
            summary=seg.summary, summary_prov=json_dumps(seg.summary_provenance) if seg.summary_provenance else None,
            clip_start=clip.get("start_ms"), clip_end=clip.get("end_ms"), core_start=clip.get("core_start_ms"), core_end=clip.get("core_end_ms"),
            clip_reason=clip.get("reason"), clip_conf=clip.get("confidence"), clip_prov=json_dumps(clip.get("provenance")) if clip else None,
            clip_status="auto" if clip else "none", run_id=run_id,
        )

    # --- retire segments that no longer exist; migrate protected decisions onto the best-overlapping new segment
    migrated = 0
    for old in old_segments:
        if old["id"] in new_ids:
            continue
        target = _best_target(old, segments, media)
        protected = fetch_all(session, f"SELECT id, verse_id, coalesce(end_verse_id, verse_id) AS end_id FROM verse_resource_links WHERE segment_id = :s AND {PROTECTED_SQL}", s=old["id"])
        if target is not None:
            for link in protected:
                execute(session, f"DELETE FROM verse_resource_links WHERE segment_id = :t AND verse_id = :v AND coalesce(end_verse_id, verse_id) = :e AND NOT {PROTECTED_SQL}", t=target.id, v=link["verse_id"], e=link["end_id"])
                execute(session, "UPDATE verse_resource_links SET segment_id = :t, updated_at = now(), provenance = provenance || jsonb_build_object('migrated_from_segment', CAST(:old AS text)) WHERE id = :id AND NOT EXISTS (SELECT 1 FROM verse_resource_links x WHERE x.segment_id = :t AND x.verse_id = :v AND coalesce(x.end_verse_id, x.verse_id) = :e)", t=target.id, old=old["id"], id=link["id"], v=link["verse_id"], e=link["end_id"])
                migrated += 1
            if old["clip_review_status"] in ("approved", "edited"):
                execute(session, "UPDATE resource_segments SET clip_start_ms = :a, clip_end_ms = :b, clip_core_start_ms = :c, clip_core_end_ms = :d, clip_reason = :r, clip_review_status = :st WHERE id = :t AND clip_review_status NOT IN ('approved', 'edited')",
                        a=old["clip_start_ms"], b=old["clip_end_ms"], c=old["clip_core_start_ms"], d=old["clip_core_end_ms"], r=old["clip_reason"], st=old["clip_review_status"], t=target.id)
        remaining = fetch_all(session, f"SELECT 1 FROM verse_resource_links WHERE segment_id = :s AND {PROTECTED_SQL} LIMIT 1", s=old["id"])
        if remaining:
            execute(session, "UPDATE resource_segments SET is_active = false WHERE id = :s", s=old["id"])
        else:
            execute(session, "DELETE FROM resource_segments WHERE id = :s", s=old["id"])

    # --- mappings, tags, embeddings per segment (replace automated rows, never protected ones)
    counts: dict[str, int] = {}
    new_verse_ids: set[int] = set()
    for seg in segments:
        protected_keys = {(r["verse_id"], r["end_id"]) for r in fetch_all(session, f"SELECT verse_id, coalesce(end_verse_id, verse_id) AS end_id FROM verse_resource_links WHERE segment_id = :s AND {PROTECTED_SQL}", s=seg.id)}
        execute(session, f"DELETE FROM verse_resource_links WHERE segment_id = :s AND NOT {PROTECTED_SQL}", s=seg.id)
        own_keys = {(m.start, m.end) for m in seg.mappings}
        for m in seg.mappings:
            if (m.start, m.end) in protected_keys:
                continue
            row = _link_row(m, seg, resource, run_id, degraded)
            execute(session, INSERT_LINK, **row)
            counts[m.review_status] = counts.get(m.review_status, 0) + 1
            span = verse_ordinals(m.start, m.end) if m.end != m.start else [m.start]
            new_verse_ids.update(span[:2000])
            if m.end != m.start and len(span) <= CHILD_EXPANSION_MAX and m.review_status != "discarded":
                for v in span:
                    if (v, v) in own_keys or (v, v) in protected_keys:
                        continue
                    child = Mapping(**{**m.__dict__, "start": v, "end": v, "primary": False})
                    execute(session, INSERT_LINK, **_link_row(child, seg, resource, run_id, degraded, parent_id=row["id"]))
        execute(session, "DELETE FROM segment_topics WHERE segment_id = :s AND NOT is_human", s=seg.id)
        for t in seg.tags.get("topics", []):
            execute(session, "INSERT INTO segment_topics (segment_id, topic_id, confidence, provenance) VALUES (:s, :t, :c, CAST(:p AS jsonb)) ON CONFLICT DO NOTHING",
                    s=seg.id, t=t["id"], c=t["confidence"], p=json_dumps(seg.tags_provenance))
        execute(session, "DELETE FROM segment_entities WHERE segment_id = :s AND NOT is_human", s=seg.id)
        for field_name in ("people", "places", "events", "life_situations", "questions"):
            for e in seg.tags.get(field_name, []):
                execute(session, "INSERT INTO segment_entities (segment_id, entity_id, confidence, provenance) VALUES (:s, :e, :c, CAST(:p AS jsonb)) ON CONFLICT DO NOTHING",
                        s=seg.id, e=e["id"], c=e["confidence"], p=json_dumps(seg.tags_provenance))
        for purpose, (model, vec) in seg.embeddings.items():
            execute(session, """INSERT INTO segment_embeddings (segment_id, purpose, model, content_hash, embedding) VALUES (:s, :p, :m, :h, CAST(:v AS vector))
                                ON CONFLICT (segment_id, purpose, model) DO UPDATE SET content_hash = EXCLUDED.content_hash, embedding = EXCLUDED.embedding, created_at = now()""",
                    s=seg.id, p=purpose, m=model, h=seg.content_hash, v=vector_literal(vec))

    affected |= new_verse_ids
    _aggregate_verse_topics(session, sorted(affected))
    rebuild_pipeline_relationships(session, rid)
    cache.bump_verses(session, affected)
    return {"mapping_status_counts": counts, "protected_links_migrated": migrated, "affected_verses": len(affected)}


def resource_verse_ids(session: Session, resource_id: str) -> list[int]:
    ids: set[int] = set()
    for r in fetch_all(session, "SELECT verse_id, coalesce(end_verse_id, verse_id) AS end_id FROM verse_resource_links WHERE resource_id = :r", r=resource_id):
        span = verse_ordinals(r["verse_id"], r["end_id"]) if r["end_id"] != r["verse_id"] else [r["verse_id"]]
        ids.update(span[:2000])
    return sorted(ids)


def rebuild_pipeline_relationships(session: Session, resource_id: str) -> None:
    """VERSE -> RELATED_TO -> VERSE rows derived from a resource (primary verse -> AI-related verses in the same segment).

    Rebuilt from the stored, currently visible mappings so rejections, edits, deletions and visibility
    changes are always reflected; only public resources contribute (their evidence is shown to everyone).
    """
    execute(session, "DELETE FROM verse_relationships WHERE source = 'pipeline' AND evidence->>'resource_id' = :r", r=resource_id)
    execute(
        session,
        """INSERT INTO verse_relationships (from_verse_id, from_end_verse_id, to_verse_id, to_end_verse_id, relationship_type, source, confidence,
               explanation, explanation_confidence, explanation_provenance, evidence, provenance, review_status)
           SELECT DISTINCT ON (p.verse_id, coalesce(p.end_verse_id, p.verse_id), a.verse_id, coalesce(a.end_verse_id, a.verse_id))
                  p.verse_id, p.end_verse_id, a.verse_id, a.end_verse_id,
                  CASE WHEN a.relationship_subtype IN ('thematic', 'conceptual', 'narrative_parallel', 'question_answer', 'doctrinal_context')
                       THEN a.relationship_subtype ELSE 'thematic' END,
                  'pipeline', coalesce(a.confidence_override, a.confidence), a.why_related, coalesce(a.confidence_override, a.confidence),
                  jsonb_build_object('source', 'P-04', 'segment_id', a.segment_id),
                  jsonb_build_object('resource_id', a.resource_id, 'segment_id', a.segment_id, 'evidence_text', left(coalesce(a.evidence_text, ''), 400)),
                  jsonb_build_object('source', 'pipeline', 'pipeline_version', a.pipeline_version),
                  'published'
           FROM verse_resource_links p
           JOIN verse_resource_links a ON a.segment_id = p.segment_id AND a.id <> p.id
           JOIN resources r ON r.id = p.resource_id
           WHERE p.resource_id = :r AND p.primary_flag AND p.parent_link_id IS NULL AND a.parent_link_id IS NULL
             AND p.review_status IN ('published', 'approved') AND a.review_status IN ('published', 'approved')
             AND a.relationship_type = 'ai_related' AND r.visibility = 'public' AND r.deleted_at IS NULL
             AND (p.verse_id, coalesce(p.end_verse_id, p.verse_id)) <> (a.verse_id, coalesce(a.end_verse_id, a.verse_id))
           ORDER BY p.verse_id, coalesce(p.end_verse_id, p.verse_id), a.verse_id, coalesce(a.end_verse_id, a.verse_id), a.confidence DESC
           ON CONFLICT DO NOTHING""",
        r=resource_id,
    )


def refresh_resource_derived_data(session: Session, resource_id: str) -> None:
    """Re-derive everything computed from a resource's mappings after visibility/rights/review/deletion changes."""
    verse_ids = resource_verse_ids(session, resource_id)
    rebuild_pipeline_relationships(session, resource_id)
    _aggregate_verse_topics(session, verse_ids)
    cache.bump_verses(session, verse_ids)


def _aggregate_verse_topics(session: Session, verse_ids: list[int]) -> None:
    if not verse_ids:
        return
    execute(session, "DELETE FROM verse_topics WHERE provenance->>'source' = 'segment_aggregation' AND verse_id = ANY(:ids)", ids=verse_ids)
    execute(
        session,
        """INSERT INTO verse_topics (verse_id, topic_id, confidence, provenance)
           SELECT l.verse_id, st.topic_id, max(l.confidence * st.confidence),
                  jsonb_build_object('source', 'segment_aggregation', 'segments', count(DISTINCT l.segment_id))
           FROM verse_resource_links l
           JOIN segment_topics st ON st.segment_id = l.segment_id
           JOIN resources r ON r.id = l.resource_id
           WHERE l.verse_id = ANY(:ids) AND l.review_status IN ('published', 'approved')
             AND coalesce(l.end_verse_id, l.verse_id) - l.verse_id <= 3
             AND r.visibility = 'public' AND r.deleted_at IS NULL
           GROUP BY l.verse_id, st.topic_id
           ON CONFLICT (verse_id, topic_id) DO NOTHING""",  # curated/AI verse topics win: never mutate rows this rebuild cannot re-derive
        ids=verse_ids,
    )


