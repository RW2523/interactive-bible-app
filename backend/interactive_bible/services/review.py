"""Admin / editorial review workflow (spec §12 REV-01..REV-07, §9 admin endpoints)."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .. import cache
from ..bible import books as B
from ..bible.refparser import parse_query_reference, verse_ordinals
from ..db import execute, fetch_all, fetch_one, json_dumps
from ..ids import new_id
from ..pipeline.persist import CHILD_EXPANSION_MAX
from ..pipeline.routing import display_label
from ..pipeline.types import TYPE_PRIORITY
from ..security import Viewer
from .bible import NotFound
from .resources import Forbidden, audit

RELATIONSHIP_TYPES = ("direct_reference", "scripture_quote", "contextual_reference", "ai_related")


def _require_editor(viewer: Viewer) -> None:
    if not viewer.is_editor:
        raise Forbidden("editor or admin role required")


def _mapping(session: Session, mapping_id: str) -> dict[str, Any]:
    row = fetch_one(session, "SELECT * FROM verse_resource_links WHERE id = :id", id=mapping_id)
    if not row:
        raise NotFound("mapping not found")
    return row


def _snapshot(row: dict[str, Any]) -> dict[str, Any]:
    return {k: row.get(k) for k in ("verse_id", "end_verse_id", "relationship_type", "relationship_subtype", "confidence", "confidence_override", "primary_flag",
                                     "evidence_text", "why_related", "review_status", "needs_review", "is_human_verified", "segment_id")} | {
        "verse_ref": B.canonical_range_str(row["verse_id"], row["end_verse_id"])}


def _affected(row: dict[str, Any]) -> list[int]:
    return verse_ordinals(row["verse_id"], row["end_verse_id"] or row["verse_id"])[:500]


def review_queue(session: Session, viewer: Viewer, f: dict[str, Any]) -> dict[str, Any]:
    _require_editor(viewer)
    where = ["l.parent_link_id IS NULL", "r.deleted_at IS NULL"]
    params: dict[str, Any] = {}
    status = f.get("status") or "open"
    if status == "open":
        where.append("l.needs_review AND l.review_status NOT IN ('approved', 'rejected')")
    elif status == "flagged":
        where.append("l.feedback_count > 0 AND l.review_status NOT IN ('approved', 'rejected')")
    elif status != "all":
        where.append("l.review_status = ANY(:statuses)")
        params["statuses"] = status.split(",")
    if f.get("resource_id"):
        where.append("l.resource_id = :rid")
        params["rid"] = f["resource_id"]
    # confidence is stored as REAL (0.95 -> 0.949999988); compare rounded values
    if f.get("min_confidence") is not None:
        where.append("round(coalesce(l.confidence_override, l.confidence)::numeric, 3) >= :minc")
        params["minc"] = float(f["min_confidence"])
    if f.get("max_confidence") is not None:
        where.append("round(coalesce(l.confidence_override, l.confidence)::numeric, 3) <= :maxc")
        params["maxc"] = float(f["max_confidence"])
    if f.get("relationship_type"):
        where.append("l.relationship_type = ANY(:rtypes)")
        params["rtypes"] = f["relationship_type"].split(",")
    if f.get("language"):
        where.append("r.language = :lang")
        params["lang"] = f["language"]
    if f.get("official") is not None:
        where.append("r.is_official = :official")
        params["official"] = f["official"]
    if f.get("pipeline_version"):
        where.append("l.pipeline_version = :pv")
        params["pv"] = f["pipeline_version"]
    if f.get("reason"):
        where.append(":reason = ANY(l.review_reasons)")
        params["reason"] = f["reason"]
    if f.get("verse"):
        rng = parse_query_reference(f["verse"])
        if rng:
            where.append("int4range(l.verse_id, coalesce(l.end_verse_id, l.verse_id), '[]') && int4range(:vs, :ve, '[]')")
            params.update(vs=rng[0], ve=rng[1])
    sql_where = " AND ".join(where)
    page, page_size = max(1, int(f.get("page") or 1)), min(100, int(f.get("page_size") or 25))
    total = fetch_one(session, f"SELECT count(*) AS n FROM verse_resource_links l JOIN resources r ON r.id = l.resource_id WHERE {sql_where}", **params)["n"]
    sort = {"confidence": "l.confidence ASC", "newest": "l.created_at DESC", "feedback": "l.feedback_count DESC, l.confidence ASC"}.get(f.get("sort") or "", "r.is_official DESC, l.feedback_count DESC, l.confidence ASC, l.created_at DESC")
    rows = fetch_all(session, f"""SELECT l.*, r.title, r.type AS resource_type, r.is_official, r.language, s.start_ms, s.end_ms, s.page_start, s.heading, s.ordinal
                                  FROM verse_resource_links l JOIN resources r ON r.id = l.resource_id JOIN resource_segments s ON s.id = l.segment_id
                                  WHERE {sql_where} ORDER BY {sort} LIMIT :limit OFFSET :offset""", limit=page_size, offset=(page - 1) * page_size, **params)
    items = [{
        "mapping_id": r["id"], "verse_ref": B.canonical_range_str(r["verse_id"], r["end_verse_id"]), "verse_display": B.display_ref(r["verse_id"], r["end_verse_id"]),
        "relationship_type": r["relationship_type"], "relationship_subtype": r["relationship_subtype"], "confidence": r["confidence"], "confidence_override": r["confidence_override"],
        "review_status": r["review_status"], "needs_review": r["needs_review"], "review_reasons": r["review_reasons"], "feedback_count": r["feedback_count"],
        "is_human_verified": r["is_human_verified"], "primary": r["primary_flag"], "evidence_text": r["evidence_text"], "pipeline_version": r["pipeline_version"],
        "resource": {"id": r["resource_id"], "title": r["title"], "type": r["resource_type"], "is_official": r["is_official"], "language": r["language"]},
        "segment": {"id": r["segment_id"], "ordinal": r["ordinal"], "start_ms": r["start_ms"], "end_ms": r["end_ms"], "page_start": r["page_start"], "heading": r["heading"]},
        "created_at": r["created_at"],
    } for r in rows]
    facets = fetch_all(session, """SELECT l.review_status, count(*) AS n FROM verse_resource_links l JOIN resources r ON r.id = l.resource_id
                                   WHERE l.parent_link_id IS NULL AND r.deleted_at IS NULL GROUP BY l.review_status""")
    open_count = fetch_one(session, "SELECT count(*) AS n FROM verse_resource_links l JOIN resources r ON r.id = l.resource_id WHERE l.parent_link_id IS NULL AND r.deleted_at IS NULL AND l.needs_review AND l.review_status NOT IN ('approved','rejected')")["n"]
    return {"total": total, "page": page, "page_size": page_size, "items": items, "facets": {"status": {f["review_status"]: f["n"] for f in facets}, "open": open_count}}


def mapping_detail(session: Session, viewer: Viewer, mapping_id: str) -> dict[str, Any]:
    _require_editor(viewer)
    m = _mapping(session, mapping_id)
    seg = fetch_one(session, "SELECT * FROM resource_segments WHERE id = :id", id=m["segment_id"])
    r = fetch_one(session, "SELECT id, title, type, category, speaker, author, is_official, requires_review, visibility, rights_status, language, duration_ms FROM resources WHERE id = :id", id=m["resource_id"])
    neighbours = fetch_all(session, "SELECT id, ordinal, text_normalized, start_ms, end_ms, page_start, heading FROM resource_segments WHERE resource_id = :r AND is_active AND ordinal IN (:a, :b) ORDER BY ordinal",
                           r=m["resource_id"], a=seg["ordinal"] - 1, b=seg["ordinal"] + 1)
    ids = verse_ordinals(m["verse_id"], m["end_verse_id"] or m["verse_id"])[:12]
    texts = fetch_all(session, "SELECT verse_id, translation_id, text FROM bible_verse_texts WHERE verse_id = ANY(:ids) ORDER BY verse_id, translation_id", ids=ids)
    verse_text: dict[str, dict[str, str]] = {}
    for t in texts:
        verse_text.setdefault(B.ref_from_ordinal(t["verse_id"]), {})[t["translation_id"]] = t["text"]
    siblings = fetch_all(session, "SELECT id, verse_id, end_verse_id, relationship_type, confidence, review_status, primary_flag, is_human_verified FROM verse_resource_links WHERE segment_id = :s AND parent_link_id IS NULL ORDER BY primary_flag DESC, confidence DESC", s=m["segment_id"])
    history = fetch_all(session, """SELECT a.*, u.display_name AS reviewer_name FROM review_actions a LEFT JOIN users u ON u.id = a.reviewer_id
                                    WHERE (a.object_type = 'mapping' AND a.object_id = :id) OR (a.object_type IN ('clip', 'segment') AND a.object_id = :sid) ORDER BY a.created_at DESC""", id=mapping_id, sid=m["segment_id"])
    feedback = fetch_all(session, "SELECT id, kind, note, status, created_at FROM feedback WHERE object_type = 'mapping' AND object_id = :id ORDER BY created_at DESC", id=mapping_id)
    topics = fetch_all(session, "SELECT t.id, t.name, st.confidence, st.is_human FROM segment_topics st JOIN topics t ON t.id = st.topic_id WHERE st.segment_id = :s ORDER BY st.confidence DESC", s=m["segment_id"])
    entities = fetch_all(session, "SELECT e.id, e.name, e.type, se.confidence, se.is_human FROM segment_entities se JOIN entities e ON e.id = se.entity_id WHERE se.segment_id = :s", s=m["segment_id"])
    conf = float(m["confidence_override"] if m["confidence_override"] is not None else m["confidence"])
    return {
        "mapping": {**_snapshot(m), "id": m["id"], "verse_display": B.display_ref(m["verse_id"], m["end_verse_id"]), "evidence_offsets": m["evidence_offsets"],
                    "mention_count": m["mention_count"], "review_reasons": m["review_reasons"], "provenance": m["provenance"], "audit": m["audit"],
                    "feedback_count": m["feedback_count"], "pipeline_version": m["pipeline_version"], "created_at": m["created_at"], "updated_at": m["updated_at"],
                    "label": display_label(m["relationship_type"], conf, m["is_human_verified"])},
        "resource": r,
        "segment": {"id": seg["id"], "ordinal": seg["ordinal"], "start_ms": seg["start_ms"], "end_ms": seg["end_ms"], "page_start": seg["page_start"], "page_end": seg["page_end"],
                    "heading": seg["heading"], "text": seg["text_normalized"], "transcript_raw": seg["transcript_raw"], "units": seg["unit_offsets"], "summary": seg["summary"],
                    "clip": {"start_ms": seg["clip_start_ms"], "end_ms": seg["clip_end_ms"], "core_start_ms": seg["clip_core_start_ms"], "core_end_ms": seg["clip_core_end_ms"],
                             "reason": seg["clip_reason"], "confidence": seg["clip_confidence"], "review_status": seg["clip_review_status"], "provenance": seg["clip_provenance"]}},
        "context": {"before": next((n for n in neighbours if n["ordinal"] < seg["ordinal"]), None), "after": next((n for n in neighbours if n["ordinal"] > seg["ordinal"]), None)},
        "verse_texts": verse_text,
        "segment_mappings": [{"mapping_id": s["id"], "verse_ref": B.canonical_range_str(s["verse_id"], s["end_verse_id"]), "relationship_type": s["relationship_type"],
                              "confidence": s["confidence"], "review_status": s["review_status"], "primary": s["primary_flag"], "is_human_verified": s["is_human_verified"]} for s in siblings],
        "topics": topics, "entities": entities, "history": history, "feedback": feedback,
    }


def _set_children(session: Session, parent: dict[str, Any], review_status: str, human: bool) -> None:
    execute(session, "UPDATE verse_resource_links SET review_status = :st, is_human_verified = :h, needs_review = false, updated_at = now() WHERE parent_link_id = :id",
            st=review_status, h=human, id=parent["id"])


def approve(session: Session, viewer: Viewer, mapping_id: str, note: str | None) -> dict[str, Any]:
    _require_editor(viewer)
    m = _mapping(session, mapping_id)
    execute(session, "UPDATE verse_resource_links SET review_status = 'approved', is_human_verified = true, needs_review = false, updated_at = now() WHERE id = :id", id=mapping_id)
    _set_children(session, m, "approved", True)
    execute(session, "UPDATE feedback SET status = 'resolved', resolved_at = now() WHERE object_type = 'mapping' AND object_id = :id AND status IN ('open','in_review')", id=mapping_id)
    audit(session, viewer, "mapping", mapping_id, "approve", _snapshot(m), {"review_status": "approved", "is_human_verified": True}, note)
    cache.bump_verses(session, _affected(m))
    _refresh_derived(session, m["resource_id"])
    return mapping_detail(session, viewer, mapping_id)


def reject(session: Session, viewer: Viewer, mapping_id: str, note: str | None) -> dict[str, Any]:
    _require_editor(viewer)
    m = _mapping(session, mapping_id)
    execute(session, "UPDATE verse_resource_links SET review_status = 'rejected', is_human_verified = true, needs_review = false, primary_flag = false, updated_at = now() WHERE id = :id", id=mapping_id)
    _set_children(session, m, "rejected", True)
    execute(session, "UPDATE feedback SET status = 'resolved', resolved_at = now() WHERE object_type = 'mapping' AND object_id = :id AND status IN ('open','in_review')", id=mapping_id)
    audit(session, viewer, "mapping", mapping_id, "reject", _snapshot(m), {"review_status": "rejected"}, note)
    cache.bump_verses(session, _affected(m))
    _refresh_derived(session, m["resource_id"])
    return {"mapping_id": mapping_id, "review_status": "rejected"}


def edit(session: Session, viewer: Viewer, mapping_id: str, data: dict[str, Any]) -> dict[str, Any]:
    _require_editor(viewer)
    m = _mapping(session, mapping_id)
    sets: list[str] = []
    params: dict[str, Any] = {"id": mapping_id}
    new: dict[str, Any] = {}
    if data.get("relationship_type"):
        if data["relationship_type"] not in RELATIONSHIP_TYPES:
            raise ValueError("invalid relationship_type")
        sets.append("relationship_type = :rt")
        params["rt"] = new["relationship_type"] = data["relationship_type"]
    if "relationship_subtype" in data and data["relationship_subtype"] is not None:
        sets.append("relationship_subtype = :rst")
        params["rst"] = new["relationship_subtype"] = data["relationship_subtype"]
    if data.get("confidence_override") is not None:
        sets.append("confidence_override = :co")
        params["co"] = new["confidence_override"] = max(0.0, min(1.0, float(data["confidence_override"])))
    if data.get("evidence_text") is not None:
        sets.append("evidence_text = :ev")
        params["ev"] = new["evidence_text"] = data["evidence_text"]
    if data.get("why_related") is not None:
        sets.append("why_related = :why")
        params["why"] = new["why_related"] = data["why_related"]
    if data.get("verse_ref"):
        rng = parse_query_reference(data["verse_ref"])
        if not rng:
            raise ValueError("could not parse verse_ref")
        conflict = fetch_one(session, "SELECT id FROM verse_resource_links WHERE segment_id = :s AND verse_id = :v AND coalesce(end_verse_id, verse_id) = :e AND id <> :id",
                             s=m["segment_id"], v=rng[0], e=rng[1], id=mapping_id)
        if conflict:
            raise ValueError(f"segment already has a mapping for that verse ({conflict['id']}); merge instead")
        execute(session, "DELETE FROM verse_resource_links WHERE parent_link_id = :id", id=mapping_id)
        sets.append("verse_id = :vid, end_verse_id = :evid")
        params["vid"], params["evid"] = rng[0], (rng[1] if rng[1] != rng[0] else None)
        new["verse_ref"] = B.canonical_range_str(rng[0], rng[1] if rng[1] != rng[0] else None)
    if data.get("primary"):
        execute(session, "UPDATE verse_resource_links SET primary_flag = false WHERE segment_id = :s", s=m["segment_id"])
        sets.append("primary_flag = true")
        new["primary"] = True
    if not sets:
        return mapping_detail(session, viewer, mapping_id)
    status = data.get("review_status") or "approved"
    sets.append("review_status = :st, is_human_verified = true, needs_review = false, updated_at = now(), provenance = provenance || CAST(:prov AS jsonb)")
    params["st"] = status
    params["prov"] = json_dumps({"edited_by": viewer.user_id, "human_edit": True})
    execute(session, f"UPDATE verse_resource_links SET {', '.join(sets)} WHERE id = :id", **params)
    updated = _mapping(session, mapping_id)
    if (updated["verse_id"], updated["end_verse_id"]) != (m["verse_id"], m["end_verse_id"]):
        # tombstone: remember the editor removed the old verse so automated reprocessing never re-adds it (REV-05)
        execute(session, """INSERT INTO verse_resource_links (id, verse_id, end_verse_id, segment_id, resource_id, relationship_type, relationship_subtype, confidence,
                                primary_flag, evidence_text, evidence_offsets, mention_count, provenance, review_status, needs_review, is_human_verified, pipeline_version)
                            VALUES (:id, :v, :e, :s, :r, :rt, 'replaced_by_edit', :c, false, :ev, CAST(:off AS jsonb), 1, CAST(:prov AS jsonb), 'rejected', false, true, :pv)
                            ON CONFLICT DO NOTHING""",
                id=new_id("map"), v=m["verse_id"], e=m["end_verse_id"], s=m["segment_id"], r=m["resource_id"], rt=m["relationship_type"], c=m["confidence"],
                ev=m["evidence_text"], off=json_dumps(m["evidence_offsets"] or []), pv=m["pipeline_version"],
                prov=json_dumps({"source": "human", "tombstone_for": mapping_id, "replaced_by": B.canonical_range_str(updated["verse_id"], updated["end_verse_id"]), "by": viewer.user_id}))
    _expand_children(session, updated)
    audit(session, viewer, "mapping", mapping_id, "edit", _snapshot(m), new, data.get("note"))
    cache.bump_verses(session, _affected(m) + _affected(updated))
    _refresh_derived(session, m["resource_id"])
    return mapping_detail(session, viewer, mapping_id)


def _refresh_derived(session: Session, resource_id: str) -> None:
    from ..pipeline.persist import refresh_resource_derived_data

    refresh_resource_derived_data(session, resource_id)


def _expand_children(session: Session, link: dict[str, Any]) -> None:
    if not link["end_verse_id"] or link["end_verse_id"] == link["verse_id"]:
        return
    ids = verse_ordinals(link["verse_id"], link["end_verse_id"])
    if len(ids) > CHILD_EXPANSION_MAX:
        return
    for v in ids:
        execute(session, """INSERT INTO verse_resource_links (id, verse_id, segment_id, resource_id, parent_link_id, relationship_type, relationship_subtype, confidence,
                                primary_flag, evidence_text, evidence_offsets, mention_count, why_related, provenance, review_status, needs_review, is_human_verified, pipeline_version)
                            SELECT :nid, :v, segment_id, resource_id, id, relationship_type, 'passage_member', confidence, false, evidence_text, evidence_offsets, mention_count,
                                   why_related, provenance || jsonb_build_object('parent_link_id', id), review_status, false, is_human_verified, pipeline_version
                            FROM verse_resource_links WHERE id = :pid ON CONFLICT DO NOTHING""", nid=new_id("map"), v=v, pid=link["id"])


def add_mapping(session: Session, viewer: Viewer, data: dict[str, Any]) -> dict[str, Any]:
    _require_editor(viewer)
    seg = fetch_one(session, "SELECT id, resource_id, text_normalized FROM resource_segments WHERE id = :id", id=data["segment_id"])
    if not seg:
        raise NotFound("segment not found")
    rng = parse_query_reference(data["verse_ref"])
    if not rng:
        raise ValueError("could not parse verse_ref")
    if data.get("relationship_type", "direct_reference") not in RELATIONSHIP_TYPES:
        raise ValueError("invalid relationship_type")
    existing = fetch_one(session, "SELECT id FROM verse_resource_links WHERE segment_id = :s AND verse_id = :v AND coalesce(end_verse_id, verse_id) = :e", s=seg["id"], v=rng[0], e=rng[1])
    if existing:
        return edit(session, viewer, existing["id"], {**data, "verse_ref": None, "review_status": "approved", "relationship_type": data.get("relationship_type")})
    evidence = data.get("evidence_text") or ""
    offsets = []
    if evidence:
        idx = seg["text_normalized"].find(evidence)
        if idx >= 0:
            offsets.append({"start": idx, "end": idx + len(evidence)})
    mid = new_id("map")
    if data.get("primary"):
        execute(session, "UPDATE verse_resource_links SET primary_flag = false WHERE segment_id = :s", s=seg["id"])
    execute(session, """INSERT INTO verse_resource_links (id, verse_id, end_verse_id, segment_id, resource_id, relationship_type, relationship_subtype, confidence,
                            confidence_override, primary_flag, evidence_text, evidence_offsets, why_related, provenance, review_status, needs_review, is_human_verified, pipeline_version)
                        VALUES (:id, :v, :e, :s, :r, :rt, 'manual', 1.0, NULL, :primary, :ev, CAST(:off AS jsonb), :why, CAST(:prov AS jsonb), 'approved', false, true, 'human')""",
            id=mid, v=rng[0], e=rng[1] if rng[1] != rng[0] else None, s=seg["id"], r=seg["resource_id"], rt=data.get("relationship_type", "direct_reference"),
            primary=bool(data.get("primary")), ev=evidence, off=json_dumps(offsets), why=data.get("why_related"),
            prov=json_dumps({"source": "human", "created_by": viewer.user_id}))
    _expand_children(session, _mapping(session, mid))
    audit(session, viewer, "mapping", mid, "add", None, {"verse_ref": data["verse_ref"], "segment_id": seg["id"], "relationship_type": data.get("relationship_type")}, data.get("note"))
    cache.bump_verses(session, verse_ordinals(rng[0], rng[1])[:500])
    _refresh_derived(session, seg["resource_id"])
    return mapping_detail(session, viewer, mid)


def merge_mappings(session: Session, viewer: Viewer, mapping_ids: list[str], note: str | None) -> dict[str, Any]:
    _require_editor(viewer)
    rows = [_mapping(session, i) for i in mapping_ids]
    if len(rows) < 2 or len({r["segment_id"] for r in rows}) != 1:
        raise ValueError("merge needs at least two mappings from the same segment")
    books = {B.from_ordinal(r["verse_id"])[0] for r in rows}
    if len(books) != 1:
        raise ValueError("cannot merge mappings from different books")
    start = min(r["verse_id"] for r in rows)
    end = max(r["end_verse_id"] or r["verse_id"] for r in rows)
    keep = max(rows, key=lambda r: (TYPE_PRIORITY[r["relationship_type"]], r["confidence"]))
    for r in rows:
        if r["id"] != keep["id"]:
            execute(session, "DELETE FROM verse_resource_links WHERE id = :id", id=r["id"])
    execute(session, "DELETE FROM verse_resource_links WHERE parent_link_id = :id", id=keep["id"])
    execute(session, """UPDATE verse_resource_links SET verse_id = :s, end_verse_id = :e, review_status = 'approved', is_human_verified = true, needs_review = false,
                            mention_count = :mc, evidence_text = :ev, updated_at = now() WHERE id = :id""",
            s=start, e=end if end != start else None, mc=sum(r["mention_count"] for r in rows), ev=" … ".join(dict.fromkeys(r["evidence_text"] or "" for r in rows))[:1000], id=keep["id"])
    merged = _mapping(session, keep["id"])
    _expand_children(session, merged)
    audit(session, viewer, "mapping", keep["id"], "merge", [_snapshot(r) for r in rows], _snapshot(merged), note)
    cache.bump_verses(session, verse_ordinals(start, end)[:500])
    _refresh_derived(session, keep["resource_id"])
    return mapping_detail(session, viewer, keep["id"])


def set_primary(session: Session, viewer: Viewer, segment_id: str, mapping_id: str, note: str | None) -> dict[str, Any]:
    _require_editor(viewer)
    m = _mapping(session, mapping_id)
    if m["segment_id"] != segment_id:
        raise ValueError("mapping does not belong to that segment")
    previous = fetch_one(session, "SELECT id FROM verse_resource_links WHERE segment_id = :s AND primary_flag", s=segment_id)
    execute(session, "UPDATE verse_resource_links SET primary_flag = (id = :id), updated_at = now() WHERE segment_id = :s AND parent_link_id IS NULL", id=mapping_id, s=segment_id)
    audit(session, viewer, "segment", segment_id, "change_primary_verse", {"primary_mapping": previous["id"] if previous else None}, {"primary_mapping": mapping_id}, note)
    cache.bump_verses(session, _affected(m))
    _refresh_derived(session, m["resource_id"])
    return {"segment_id": segment_id, "primary_mapping": mapping_id}


def edit_clip(session: Session, viewer: Viewer, segment_id: str, data: dict[str, Any]) -> dict[str, Any]:
    _require_editor(viewer)
    seg = fetch_one(session, "SELECT * FROM resource_segments WHERE id = :id", id=segment_id)
    if not seg:
        raise NotFound("segment not found")
    r = fetch_one(session, "SELECT duration_ms FROM resources WHERE id = :id", id=seg["resource_id"])
    if data.get("approve_only"):
        execute(session, "UPDATE resource_segments SET clip_review_status = 'approved', updated_at = now() WHERE id = :id", id=segment_id)
        audit(session, viewer, "clip", segment_id, "approve_clip", {"start_ms": seg["clip_start_ms"], "end_ms": seg["clip_end_ms"]}, None, data.get("note"))
    else:
        if data.get("start_ms") is None or data.get("end_ms") is None:
            raise ValueError("start_ms and end_ms are required (or set approve_only)")
        start, end = int(data["start_ms"]), int(data["end_ms"])
        if start < 0 or end <= start or (r["duration_ms"] and end > r["duration_ms"] + 1000):
            raise ValueError("clip boundaries are outside the media")
        if end - start > 600_000:
            raise ValueError("clips longer than 10 minutes are not supported")
        core_start = data.get("core_start_ms", seg["clip_core_start_ms"])
        core_end = data.get("core_end_ms", seg["clip_core_end_ms"])
        execute(session, """UPDATE resource_segments SET clip_start_ms = :a, clip_end_ms = :b, clip_core_start_ms = :c, clip_core_end_ms = :d,
                               clip_reason = coalesce(:reason, clip_reason), clip_review_status = 'edited',
                               clip_provenance = coalesce(clip_provenance, '{}'::jsonb) || CAST(:prov AS jsonb), updated_at = now() WHERE id = :id""",
                a=start, b=end, c=core_start, d=core_end, reason=data.get("reason"), prov=json_dumps({"edited_by": viewer.user_id}), id=segment_id)
        audit(session, viewer, "clip", segment_id, "edit_clip", {"start_ms": seg["clip_start_ms"], "end_ms": seg["clip_end_ms"]}, {"start_ms": start, "end_ms": end}, data.get("note"))
    ids = [r2["verse_id"] for r2 in fetch_all(session, "SELECT verse_id FROM verse_resource_links WHERE segment_id = :s", s=segment_id)]
    cache.bump_verses(session, ids)
    return fetch_one(session, "SELECT id, clip_start_ms, clip_end_ms, clip_core_start_ms, clip_core_end_ms, clip_review_status FROM resource_segments WHERE id = :id", id=segment_id)


def edit_tags(session: Session, viewer: Viewer, segment_id: str, data: dict[str, Any]) -> dict[str, Any]:
    _require_editor(viewer)
    seg = fetch_one(session, "SELECT id, resource_id FROM resource_segments WHERE id = :id", id=segment_id)
    if not seg:
        raise NotFound("segment not found")
    before = {
        "topics": [r["topic_id"] for r in fetch_all(session, "SELECT topic_id FROM segment_topics WHERE segment_id = :s", s=segment_id)],
        "entities": [r["entity_id"] for r in fetch_all(session, "SELECT entity_id FROM segment_entities WHERE segment_id = :s", s=segment_id)],
    }
    for tid in data.get("add_topics") or []:
        execute(session, "INSERT INTO segment_topics (segment_id, topic_id, confidence, provenance, is_human) VALUES (:s, :t, 1.0, CAST(:p AS jsonb), true) ON CONFLICT (segment_id, topic_id) DO UPDATE SET is_human = true, confidence = 1.0",
                s=segment_id, t=tid, p=json_dumps({"source": "human", "by": viewer.user_id}))
    for tid in data.get("remove_topics") or []:
        execute(session, "DELETE FROM segment_topics WHERE segment_id = :s AND topic_id = :t", s=segment_id, t=tid)
    for eid in data.get("add_entities") or []:
        execute(session, "INSERT INTO segment_entities (segment_id, entity_id, confidence, provenance, is_human) VALUES (:s, :e, 1.0, CAST(:p AS jsonb), true) ON CONFLICT (segment_id, entity_id) DO UPDATE SET is_human = true, confidence = 1.0",
                s=segment_id, e=eid, p=json_dumps({"source": "human", "by": viewer.user_id}))
    for eid in data.get("remove_entities") or []:
        execute(session, "DELETE FROM segment_entities WHERE segment_id = :s AND entity_id = :e", s=segment_id, e=eid)
    after = {
        "topics": [r["topic_id"] for r in fetch_all(session, "SELECT topic_id FROM segment_topics WHERE segment_id = :s", s=segment_id)],
        "entities": [r["entity_id"] for r in fetch_all(session, "SELECT entity_id FROM segment_entities WHERE segment_id = :s", s=segment_id)],
    }
    audit(session, viewer, "segment", segment_id, "edit_tags", before, after, data.get("note"))
    ids = [r["verse_id"] for r in fetch_all(session, "SELECT verse_id FROM verse_resource_links WHERE segment_id = :s", s=segment_id)]
    cache.bump_verses(session, ids)
    _refresh_derived(session, seg["resource_id"])  # verse themes are aggregated from segment topics
    return after


def audit_log(session: Session, viewer: Viewer, object_type: str | None, object_id: str | None, reviewer_id: str | None, page: int, page_size: int) -> dict[str, Any]:
    _require_editor(viewer)
    where, params = ["true"], {}
    if object_type:
        where.append("a.object_type = :ot")
        params["ot"] = object_type
    if object_id:
        where.append("a.object_id = :oid")
        params["oid"] = object_id
    if reviewer_id:
        where.append("a.reviewer_id = :rid")
        params["rid"] = reviewer_id
    w = " AND ".join(where)
    total = fetch_one(session, f"SELECT count(*) AS n FROM review_actions a WHERE {w}", **params)["n"]
    rows = fetch_all(session, f"""SELECT a.*, u.display_name AS reviewer_name, u.email AS reviewer_email FROM review_actions a LEFT JOIN users u ON u.id = a.reviewer_id
                                  WHERE {w} ORDER BY a.created_at DESC LIMIT :limit OFFSET :offset""", limit=page_size, offset=(max(1, page) - 1) * page_size, **params)
    return {"total": total, "items": rows, "page": page, "page_size": page_size}


def vocabulary(session: Session, kind: str) -> list[dict[str, Any]]:
    if kind == "topics":
        return fetch_all(session, "SELECT id, name, category, canonical_slug AS slug, aliases, is_controlled, (SELECT count(*) FROM segment_topics st WHERE st.topic_id = t.id) AS usage FROM topics t ORDER BY name")
    return fetch_all(session, "SELECT id, type, name, canonical_key AS key, aliases, passages, link_passages, description, is_controlled, (SELECT count(*) FROM segment_entities se WHERE se.entity_id = e.id) AS usage FROM entities e ORDER BY type, name")


def upsert_vocabulary(session: Session, viewer: Viewer, kind: str, data: dict[str, Any]) -> dict[str, Any]:
    _require_editor(viewer)
    if kind == "topics":
        slug = data.get("slug") or data["name"].lower().replace(" ", "-")
        tid = data.get("id") or f"topic_{slug}"
        execute(session, """INSERT INTO topics (id, name, category, canonical_slug, description, aliases, is_controlled) VALUES (:id, :name, :cat, :slug, :desc, :aliases, true)
                            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, description = EXCLUDED.description, aliases = EXCLUDED.aliases""",
                id=tid, name=data["name"], cat=data.get("category") or "custom", slug=slug, desc=data.get("description"), aliases=data.get("aliases") or [])
        audit(session, viewer, "topic", tid, "upsert", None, data)
        return fetch_one(session, "SELECT * FROM topics WHERE id = :id", id=tid)
    key = data.get("key") or data["name"].lower().replace(" ", "-")
    eid = data.get("id") or f"ent_{key}"
    for p in data.get("passages") or []:
        if not B.parse_canonical_range(p):
            raise ValueError(f"invalid passage {p}")
    execute(session, """INSERT INTO entities (id, type, name, canonical_key, description, aliases, passages, link_passages, is_controlled)
                        VALUES (:id, :type, :name, :key, :desc, :aliases, :passages, :link, true)
                        ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, name = EXCLUDED.name, description = EXCLUDED.description, aliases = EXCLUDED.aliases,
                            passages = EXCLUDED.passages, link_passages = EXCLUDED.link_passages""",
            id=eid, type=data.get("type") or "person", name=data["name"], key=key, desc=data.get("description"), aliases=data.get("aliases") or [],
            passages=data.get("passages") or [], link=bool(data.get("link_passages")))
    audit(session, viewer, "entity", eid, "upsert", None, data)
    return fetch_one(session, "SELECT * FROM entities WHERE id = :id", id=eid)
