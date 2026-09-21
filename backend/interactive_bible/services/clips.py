"""Clip metadata, authorized playback details and rights-checked physical export (spec §5, CLIP-01..08, AC-14)."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .. import jobs, storage
from ..ai.llm import AIInvalidOutput, AIUnavailable, get_llm
from ..ai.schemas import CaptionOut
from ..bible import books as B
from ..db import execute, fetch_all, fetch_one, json_dumps, session_scope
from ..ingest import media
from ..pipeline.detectors import grounded_span, passage_text
from ..pipeline.routing import display_label
from ..security import Viewer
from .bible import NotFound
from .resources import Forbidden, audit, capabilities, playback_details, require_edit, require_view


def clip_details(session: Session, viewer: Viewer, segment_id: str) -> dict[str, Any]:
    seg = fetch_one(session, "SELECT * FROM resource_segments WHERE id = :id", id=segment_id)
    if not seg:
        raise NotFound("clip not found")
    r = require_view(session, viewer, seg["resource_id"])
    staff = viewer.is_editor or r.get("owner_id") == viewer.user_id
    statuses = ("published", "approved", "pending_review", "index_only") if staff else ("published", "approved")
    status_list = ",".join(f"'{s}'" for s in statuses)
    links = fetch_all(session, f"""SELECT id, verse_id, end_verse_id, relationship_type, relationship_subtype, confidence, confidence_override, primary_flag, evidence_text,
                                          evidence_offsets, why_related, is_human_verified, review_status, mention_count
                                   FROM verse_resource_links WHERE segment_id = :s AND parent_link_id IS NULL AND review_status IN ({status_list})
                                   ORDER BY primary_flag DESC, confidence DESC""", s=segment_id)
    texts = {row["verse_id"]: row["text"] for row in fetch_all(session, "SELECT verse_id, text FROM bible_verse_texts WHERE verse_id = ANY(:ids) AND translation_id = 'web'", ids=[l["verse_id"] for l in links])}
    verses = []
    for l in links:
        conf = float(l["confidence_override"] if l["confidence_override"] is not None else l["confidence"])
        verses.append({
            "mapping_id": l["id"], "ref": B.canonical_range_str(l["verse_id"], l["end_verse_id"]), "display_ref": B.display_ref(l["verse_id"], l["end_verse_id"]),
            "text": texts.get(l["verse_id"]), "primary": l["primary_flag"], "relationship": {**display_label(l["relationship_type"], conf, l["is_human_verified"]), "subtype": l["relationship_subtype"], "confidence": round(conf, 3)},
            "evidence_text": l["evidence_text"], "evidence_offsets": l["evidence_offsets"], "why_related": l["why_related"], "mention_count": l["mention_count"],
            **({"review_status": l["review_status"]} if staff else {}),
        })
    units = seg["unit_offsets"]
    neighbours = fetch_all(session, """SELECT id, ordinal, start_ms, end_ms FROM resource_segments WHERE resource_id = :r AND is_active AND ordinal IN (:a, :b) ORDER BY ordinal""",
                           r=seg["resource_id"], a=seg["ordinal"] - 1, b=seg["ordinal"] + 1)
    caps = capabilities(r)
    return {
        "segment_id": segment_id,
        "resource": {"id": r["id"], "title": r["title"], "type": r["type"], "category": r["category"], "speaker": r["speaker"], "author": r["author"],
                     "duration_ms": r["duration_ms"], "is_official": r["is_official"], "rights_status": r["rights_status"], "language": r["language"],
                     "thumbnail_url": ((r.get("metadata") or {}).get("youtube") or {}).get("thumbnail"),
                     "youtube_id": ((r.get("metadata") or {}).get("youtube") or {}).get("video_id")},
        "segment": {"ordinal": seg["ordinal"], "start_ms": seg["start_ms"], "end_ms": seg["end_ms"], "page_start": seg["page_start"], "page_end": seg["page_end"],
                    "heading": seg["heading"], "summary": seg["summary"], "text": seg["text_normalized"], "units": units},
        "clip": {
            "start_ms": seg["clip_start_ms"] if seg["clip_start_ms"] is not None else seg["start_ms"],
            "end_ms": seg["clip_end_ms"] if seg["clip_end_ms"] is not None else seg["end_ms"],
            "core_start_ms": seg["clip_core_start_ms"], "core_end_ms": seg["clip_core_end_ms"], "reason": seg["clip_reason"],
            "confidence": seg["clip_confidence"], "review_status": seg["clip_review_status"], "virtual": True,
        },
        "primary_verse": next((v for v in verses if v["primary"]), verses[0] if verses else None),
        "verses": verses,
        "playback": playback_details(r, viewer),
        "can_export": caps["clip_export"],
        "export_blocked_reason": None if caps["clip_export"] else ("Clip export is disabled: the resource's rights do not allow physical clips." if r["type"] in ("video", "audio") else "Not a media resource."),
        "navigation": {"previous_segment": next((n["id"] for n in neighbours if n["ordinal"] < seg["ordinal"]), None), "next_segment": next((n["id"] for n in neighbours if n["ordinal"] > seg["ordinal"]), None)},
        "caption_copy": seg["caption_copy"],
    }


def request_export(session: Session, viewer: Viewer, segment_id: str) -> dict[str, Any]:
    seg = fetch_one(session, "SELECT resource_id FROM resource_segments WHERE id = :id", id=segment_id)
    if not seg:
        raise NotFound("clip not found")
    r = require_view(session, viewer, seg["resource_id"])
    if not viewer.is_authenticated:
        raise Forbidden("sign in to export clips")
    if not capabilities(r)["clip_export"]:
        # the request transaction is rolled back when Forbidden propagates, so record the denial in its own transaction
        with session_scope() as audit_session:
            audit(audit_session, viewer, "clip", segment_id, "export_denied", None, {"rights_status": r["rights_status"], "allow_clip_export": r["allow_clip_export"]})
        raise Forbidden("This app does not have the rights to generate a physical clip for this resource (embedded/virtual playback only).")
    job_id = jobs.enqueue(session, "export_clip", {"segment_id": segment_id, "requested_by": viewer.user_id}, dedupe_key=f"export:{segment_id}")
    audit(session, viewer, "clip", segment_id, "export_requested", None, {"job_id": job_id})
    return {"job_id": job_id, "status": "queued"}


def export_clip_file(segment_id: str, requested_by: str | None) -> dict[str, Any]:
    with session_scope() as s:
        seg = fetch_one(s, "SELECT s.*, r.source_uri, r.type, r.rights_status, r.allow_clip_export, r.source_kind FROM resource_segments s JOIN resources r ON r.id = s.resource_id WHERE s.id = :id", id=segment_id)
    if not seg:
        raise NotFound("clip not found")
    if not capabilities({**seg}) ["clip_export"]:
        raise Forbidden("rights do not allow clip export")
    src = storage.path_for(seg["source_uri"])
    start = seg["clip_start_ms"] if seg["clip_start_ms"] is not None else seg["start_ms"]
    end = seg["clip_end_ms"] if seg["clip_end_ms"] is not None else seg["end_ms"]
    info = media.probe(src)
    ext = "mp4" if info.has_video else "mp3"
    dest = storage.work_dir("exports") / f"{segment_id}_{start}_{end}.{ext}"
    media.export_clip(src, start, end, dest, info.has_video)
    key = storage.save_bytes(dest.read_bytes(), f"clip_{segment_id}.{ext}", namespace="exports")
    dest.unlink(missing_ok=True)
    return {"segment_id": segment_id, "storage_key": key, "start_ms": start, "end_ms": end, "format": ext}


def generate_caption_copy(session: Session, viewer: Viewer, segment_id: str) -> dict[str, Any]:
    seg = fetch_one(session, "SELECT * FROM resource_segments WHERE id = :id", id=segment_id)
    if not seg:
        raise NotFound("clip not found")
    require_edit(session, viewer, seg["resource_id"])
    link = fetch_one(session, "SELECT * FROM verse_resource_links WHERE segment_id = :s AND parent_link_id IS NULL AND review_status IN ('approved', 'published') ORDER BY primary_flag DESC, is_human_verified DESC, confidence DESC LIMIT 1", s=segment_id)
    if not link:
        raise Forbidden("caption copy requires an approved or published mapping")
    try:
        result = get_llm().run("P-13", {
            "verse_ref": B.display_ref(link["verse_id"], link["end_verse_id"]), "verse_text": passage_text(link["verse_id"], link["end_verse_id"] or link["verse_id"], 6),
            "segment_text": seg["text_normalized"], "limits": {"hook_max_chars": 60, "caption_lines_max": 4, "caption_line_max_chars": 42, "description_max_chars": 220, "tone": "warm, sincere, no hype"},
        }, CaptionOut, resource_id=seg["resource_id"])
    except (AIUnavailable, AIInvalidOutput) as exc:
        raise Forbidden(f"caption generation unavailable: {exc}") from exc
    out = result.output.model_dump()
    # quoted speaker words must be exact: flag any quoted phrase not present in the segment
    import re

    issues = []
    for line in [out["hook"], *out["caption_lines"], out["description"]]:
        for q in re.findall(r"[\"“]([^\"”]{6,})[\"”]", line):
            if grounded_span(seg["text_normalized"], q, 95) is None and grounded_span(passage_text(link["verse_id"], link["end_verse_id"] or link["verse_id"], 6), q, 95) is None:
                issues.append(f"quoted text not found in source: {q[:60]}")
    out["validation_issues"] = issues
    out["provenance"] = result.provenance()
    execute(session, "UPDATE resource_segments SET caption_copy = CAST(:c AS jsonb), updated_at = now() WHERE id = :id", c=json_dumps(out), id=segment_id)
    audit(session, viewer, "clip", segment_id, "caption_generated", None, {"issues": issues})
    return out
