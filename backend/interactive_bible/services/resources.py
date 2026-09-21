"""Resource registration, upload, processing control, status, segments and mappings (spec §9)."""
from __future__ import annotations

from pathlib import Path
from typing import Any, BinaryIO

from sqlalchemy.orm import Session

from .. import cache, jobs, storage
from ..bible import books as B
from ..db import execute, fetch_all, fetch_one, json_dumps
from ..ids import new_id, sha256_text
from ..ingest import youtube as yt
from ..ingest.transcribe import youtube_id
from ..ingest.validate import UploadRejected, check_extension, max_bytes_for, scan_file, validate_public_url
from ..pipeline.orchestrator import STAGES, create_run
from ..pipeline.routing import display_label
from ..security import Viewer, can_edit_resource, can_view_resource, media_token, visibility_clause
from .bible import NotFound


class Forbidden(Exception):
    pass


EDITABLE_FIELDS = {
    "title", "description", "category", "visibility", "rights_status", "allow_clip_export", "is_official", "requires_review", "language",
    "author", "speaker", "series", "transcript_mode", "pii_redaction", "verse_hints", "topic_hints", "organization_id", "metadata", "source_uri",
}


def _public_resource(r: dict[str, Any], viewer: Viewer) -> dict[str, Any]:
    out = {k: r.get(k) for k in (
        "id", "type", "category", "title", "description", "source_kind", "visibility", "rights_status", "allow_clip_export", "is_official",
        "requires_review", "language", "author", "speaker", "series", "duration_ms", "page_count", "status", "created_at", "updated_at",
        "processed_at", "verse_hints", "topic_hints", "transcript_mode", "organization_id", "original_filename", "mime_type", "size_bytes",
        "last_run_id", "generation_provenance",
    )}
    out["has_media_file"] = bool(r.get("source_uri")) and r.get("source_kind") == "upload" and r.get("type") in ("video", "audio")
    out["has_captions"] = bool(r.get("captions_uri"))
    out["can_edit"] = can_edit_resource(viewer, r)
    out["capabilities"] = capabilities(r)
    if r.get("source_kind") in ("url", "external_embed"):
        out["source_url"] = r.get("source_uri")
    message = (r.get("metadata") or {}).get("message")
    if isinstance(message, dict):  # where the sermon sits inside a service recording, and what the other parts are
        out["message"] = {k: message.get(k) for k in ("start_ms", "end_ms", "confidence", "reason", "parts")}
    video = (r.get("metadata") or {}).get("youtube")
    if isinstance(video, dict):  # what the library, player and resource page need about the hosted video
        out["youtube"] = {k: video.get(k) for k in ("video_id", "channel", "thumbnail", "duration_ms", "upload_date", "watch_url", "embed_url", "chapters", "captions")}
        out["thumbnail_url"] = video.get("thumbnail")
    if viewer.is_editor or r.get("owner_id") == viewer.user_id:
        out["owner_id"] = r.get("owner_id")
        out["source_hash"] = r.get("source_hash")
    return out


def capabilities(r: dict[str, Any]) -> dict[str, Any]:
    rights = r.get("rights_status")
    local_media = r.get("source_kind") == "upload" and bool(r.get("source_uri"))
    streamable = rights in ("owned", "licensed") and local_media
    embed = r.get("source_kind") == "external_embed" and rights in ("owned", "licensed", "embed_only")
    return {
        "playback": "local" if streamable else ("embed" if embed else "none"),
        "clip_export": bool(r.get("allow_clip_export")) and rights in ("owned", "licensed") and local_media and r.get("type") in ("video", "audio"),
        "download": rights == "owned" and local_media,
    }


def get_resource_row(session: Session, resource_id: str) -> dict[str, Any]:
    r = fetch_one(session, "SELECT * FROM resources WHERE id = :id", id=resource_id)
    if not r or r.get("deleted_at"):
        raise NotFound("resource not found")
    return r


def require_view(session: Session, viewer: Viewer, resource_id: str) -> dict[str, Any]:
    r = get_resource_row(session, resource_id)
    if not can_view_resource(viewer, r, discoverable=False):
        raise NotFound("resource not found")  # never reveal private resources exist (AC-08)
    return r


def require_edit(session: Session, viewer: Viewer, resource_id: str) -> dict[str, Any]:
    r = get_resource_row(session, resource_id)
    if not can_edit_resource(viewer, r):
        if can_view_resource(viewer, r):
            raise Forbidden("you cannot edit this resource")
        raise NotFound("resource not found")
    return r


def audit(session: Session, viewer: Viewer, object_type: str, object_id: str, action: str, previous: Any = None, new: Any = None, note: str | None = None) -> None:
    execute(session, """INSERT INTO review_actions (id, object_type, object_id, reviewer_id, action, previous_value, new_value, note)
                        VALUES (:id, :ot, :oid, :u, :a, CAST(:pv AS jsonb), CAST(:nv AS jsonb), :note)""",
            id=new_id("rev"), ot=object_type, oid=object_id, u=viewer.user_id, a=action, pv=json_dumps(previous) if previous is not None else None,
            nv=json_dumps(new) if new is not None else None, note=note)


def _with_youtube_details(data: dict[str, Any], info: "yt.VideoInfo") -> dict[str, Any]:
    """Fill a pasted YouTube link's resource fields from the video itself (the caller's own values always win)."""
    data = dict(data)
    data["duration_ms"] = data.get("duration_ms") or info.duration_ms
    data["author"] = data.get("author") or info.channel
    if info.language and (data.get("language") or "en") == "en":
        data["language"] = info.language.split("-")[0].lower()
    if (data.get("rights_status") or "unknown") == "unknown":
        data["rights_status"] = "embed_only"  # plays in YouTube's own embed; physical clip export stays off
    data["allow_clip_export"] = False
    data["metadata"] = {**(data.get("metadata") or {}), "youtube": info.public(data.get("language"))}
    return data


def create_resource(session: Session, viewer: Viewer, data: dict[str, Any]) -> dict[str, Any]:
    if not viewer.is_authenticated:
        raise Forbidden("sign in to add resources")
    rtype = data["type"]
    if data.get("is_official") and not viewer.is_editor:
        raise Forbidden("only editors can mark resources as official")
    if data.get("visibility") == "organization" and not data.get("organization_id"):
        data["organization_id"] = viewer.org_ids[0] if viewer.org_ids else None
        if not data["organization_id"]:
            raise UploadRejected("organization visibility requires an organization")
    if data.get("organization_id") and not viewer.is_editor and data["organization_id"] not in viewer.org_ids:
        raise Forbidden("you are not a member of that organization")
    source_kind = "native"
    source_uri = None
    youtube = None
    if data.get("url"):
        source_uri = validate_public_url(data["url"]) if rtype == "article" else data["url"]
        source_kind = "url" if rtype == "article" else "external_embed"
        if rtype in ("video", "audio") and youtube_id(source_uri):
            youtube = yt.inspect(source_uri)  # details + caption tracks; raises UploadRejected with a readable reason
            data = _with_youtube_details(data, youtube)
            source_uri = youtube.url
    elif rtype in ("video", "audio", "pdf") or (rtype == "document" and not data.get("body_text")):
        source_kind = "upload"
    body = data.get("body_text")
    if rtype in ("native", "generated") and not body:
        raise UploadRejected("native/generated resources need body_text")
    if rtype == "generated" and not data.get("generation_provenance"):
        raise UploadRejected("generated resources must include generation_provenance (source, model, prompt)")
    rid = new_id("res")
    status = "ready" if (source_kind in ("native", "url") or body or youtube) else "draft"
    verse_hints = [h for h in (data.get("verse_hints") or []) if h.strip()]
    execute(
        session,
        """INSERT INTO resources (id, type, category, title, description, source_kind, source_uri, source_hash, body_text, owner_id, organization_id, visibility,
               rights_status, allow_clip_export, is_official, requires_review, language, author, speaker, series, duration_ms, transcript_mode, pii_redaction,
               verse_hints, topic_hints, generation_provenance, metadata, status)
           VALUES (:id, :type, :category, :title, :description, :source_kind, :source_uri, :source_hash, :body, :owner, :org, :visibility, :rights, :export,
               :official, :requires_review, :language, :author, :speaker, :series, :duration, :mode, :pii, :vh, :th, CAST(:gp AS jsonb), CAST(:meta AS jsonb), :status)""",
        id=rid, type=rtype, category=data.get("category") or "other", title=data["title"].strip(), description=data.get("description"), source_kind=source_kind,
        source_uri=source_uri, source_hash=sha256_text(body) if body else None, body=body, owner=viewer.user_id, org=data.get("organization_id"),
        visibility=data.get("visibility", "private"), rights=data.get("rights_status", "unknown"), export=bool(data.get("allow_clip_export")),
        official=bool(data.get("is_official")), requires_review=bool(data.get("requires_review")), language=data.get("language") or "en",
        author=data.get("author"), speaker=data.get("speaker"), series=data.get("series"), duration=data.get("duration_ms"), mode=data.get("transcript_mode") or "auto",
        pii=data.get("pii_redaction", True), vh=verse_hints, th=data.get("topic_hints") or [], gp=json_dumps(data.get("generation_provenance")) if data.get("generation_provenance") else None,
        meta=json_dumps(data.get("metadata") or {}), status=status,
    )
    audit(session, viewer, "resource", rid, "create", None, {k: data.get(k) for k in ("title", "type", "visibility", "rights_status", "is_official")})
    return _public_resource(get_resource_row(session, rid), viewer)


def _discard_upload(session: Session, key: str) -> None:
    """Remove a rejected upload unless another resource already uses the same content-addressed file."""
    in_use = fetch_one(session, "SELECT 1 AS used FROM resources WHERE source_uri = :k OR captions_uri = :k LIMIT 1", k=key)
    if not in_use:
        path = storage.path_for(key)
        path.unlink(missing_ok=True)
        try:
            path.parent.rmdir()
        except OSError:
            pass


def upload_file(session: Session, viewer: Viewer, resource_id: str, stream: BinaryIO, filename: str, kind: str) -> dict[str, Any]:
    r = require_edit(session, viewer, resource_id)
    duplicate = None
    if kind == "captions":
        mime = check_extension("captions", filename)
        key, digest, size = storage.save_stream(stream, filename, max_bytes=10 * 1024 * 1024)
        try:
            scan_file(storage.path_for(key), filename)
            from ..ingest.captions import parse_captions

            if not parse_captions(storage.path_for(key).read_text(encoding="utf-8", errors="replace")):
                raise UploadRejected("captions file contains no timed cues (expected WebVTT or SRT)")
        except UploadRejected:
            _discard_upload(session, key)
            raise
        execute(session, "UPDATE resources SET captions_uri = :k, status = CASE WHEN status = 'draft' THEN 'ready' ELSE status END, updated_at = now() WHERE id = :id", k=key, id=resource_id)
        audit(session, viewer, "resource", resource_id, "upload_captions", None, {"filename": filename, "sha256": digest, "size": size})
    else:
        if r["type"] in ("native", "generated", "article") and not filename.lower().endswith((".html", ".htm")):
            raise UploadRejected(f"{r['type']} resources do not take file uploads")
        rtype = r["type"]
        mime = check_extension(rtype, filename) if rtype != "article" else "text/html"
        key, digest, size = storage.save_stream(stream, filename, max_bytes=max_bytes_for(rtype))
        path = storage.path_for(key)
        try:
            scan_file(path, filename)
            if rtype in ("video", "audio"):
                from ..ingest import media

                try:
                    info = media.probe(path)
                except media.MediaError as exc:
                    raise UploadRejected(f"media file could not be read: {exc}") from exc
                if not info.has_audio:
                    raise UploadRejected("media file has no audio track")
                execute(session, "UPDATE resources SET duration_ms = :d, media_start_offset_ms = :o WHERE id = :id", d=info.duration_ms, o=info.start_offset_ms, id=resource_id)
        except UploadRejected:
            _discard_upload(session, key)
            raise
        duplicate = fetch_one(session, "SELECT id, title FROM resources WHERE source_hash = :h AND id <> :id AND deleted_at IS NULL LIMIT 1", h=digest, id=resource_id)
        execute(session, """UPDATE resources SET source_kind = 'upload', source_uri = :k, source_hash = :h, original_filename = :fn, mime_type = :mime, size_bytes = :size,
                                status = CASE WHEN status IN ('draft', 'failed') THEN 'ready' ELSE status END, updated_at = now() WHERE id = :id""",
                k=key, h=digest, fn=filename, mime=mime, size=size, id=resource_id)
        audit(session, viewer, "resource", resource_id, "upload_source", None, {"filename": filename, "sha256": digest, "size": size, "duplicate_of": duplicate["id"] if duplicate else None})
    out = _public_resource(get_resource_row(session, resource_id), viewer)
    if kind != "captions" and duplicate:
        out["warnings"] = [f"identical file already uploaded as '{duplicate['title']}' ({duplicate['id']})"]
    return out


def start_processing(session: Session, viewer: Viewer, resource_id: str, options: dict[str, Any]) -> dict[str, Any]:
    r = require_edit(session, viewer, resource_id)
    if options.get("reset_human") and not viewer.is_editor:
        raise Forbidden("only editors can reset human-reviewed mappings")
    active = fetch_one(session, "SELECT id FROM processing_runs WHERE resource_id = :r AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1", r=resource_id)
    if active and not options.get("force"):
        return {"run_id": active["id"], "status": "already_queued", "job_id": None}
    run_id = create_run(session, resource_id, viewer.user_id, {**options, "triggered_by": viewer.user_id})
    job_id = jobs.enqueue(session, "process_resource", {"resource_id": resource_id, "run_id": run_id, "options": {**options, "triggered_by": viewer.user_id}},
                          dedupe_key=f"process:{resource_id}:{run_id}", max_attempts=3)
    audit(session, viewer, "resource", resource_id, "process", None, {"run_id": run_id, "options": options})
    return {"run_id": run_id, "job_id": job_id, "status": "queued"}


def status(session: Session, viewer: Viewer, resource_id: str) -> dict[str, Any]:
    r = require_view(session, viewer, resource_id)
    run = fetch_one(session, "SELECT * FROM processing_runs WHERE resource_id = :r ORDER BY created_at DESC LIMIT 1", r=resource_id)
    job = fetch_one(session, "SELECT id, status, attempts, max_attempts, last_error, run_after FROM jobs WHERE payload->>'run_id' = :run ORDER BY created_at DESC LIMIT 1", run=run["id"]) if run else None
    progress = None
    if run:
        done = sum(1 for s in run["stages"] if s["status"] in ("completed", "skipped", "degraded"))
        progress = round(done / max(1, len(STAGES)), 3)
    counts = fetch_one(session, """SELECT count(*) FILTER (WHERE parent_link_id IS NULL) AS mappings,
                                          count(*) FILTER (WHERE parent_link_id IS NULL AND review_status IN ('published','approved')) AS visible,
                                          count(*) FILTER (WHERE parent_link_id IS NULL AND needs_review AND review_status NOT IN ('approved','rejected')) AS in_review
                                   FROM verse_resource_links WHERE resource_id = :r""", r=resource_id)
    out = {"resource_id": resource_id, "status": r["status"], "progress": progress, "counts": counts, "job": job, "run": None}
    if run and (viewer.is_editor or can_edit_resource(viewer, r)):
        out["run"] = {k: run[k] for k in ("id", "status", "current_stage", "stages", "metrics", "error", "attempts", "degraded", "started_at", "completed_at", "created_at", "pipeline_version", "model_versions", "prompt_versions", "options")}
    elif run:
        out["run"] = {k: run[k] for k in ("id", "status", "current_stage", "started_at", "completed_at")}
    return out


def list_resources(session: Session, viewer: Viewer, q: str | None, rtype: str | None, status_filter: str | None, mine: bool, page: int, page_size: int) -> dict[str, Any]:
    vis, params = visibility_clause(viewer, "r", discoverable=not mine)
    where = [vis]
    if q:
        where.append("(r.title ILIKE :q OR r.speaker ILIKE :q OR r.author ILIKE :q OR r.series ILIKE :q)")
        params["q"] = f"%{q}%"
    if rtype:
        where.append("(r.type = ANY(:types) OR r.category = ANY(:types))")
        params["types"] = rtype.split(",")
    if status_filter:
        where.append("r.status = ANY(:statuses)")
        params["statuses"] = status_filter.split(",")
    if mine and viewer.user_id and not viewer.is_editor:
        where.append("r.owner_id = :viewer_id")
    sql_where = " AND ".join(where)
    total = fetch_one(session, f"SELECT count(*) AS n FROM resources r WHERE {sql_where}", **params)["n"]
    rows = fetch_all(session, f"""SELECT r.*, (SELECT count(*) FROM verse_resource_links l WHERE l.resource_id = r.id AND l.parent_link_id IS NULL AND l.review_status IN ('published','approved')) AS visible_mappings,
                                         (SELECT count(*) FROM resource_segments s WHERE s.resource_id = r.id AND s.is_active) AS segment_count
                                  FROM resources r WHERE {sql_where} ORDER BY r.updated_at DESC LIMIT :limit OFFSET :offset""",
                   limit=page_size, offset=(max(1, page) - 1) * page_size, **params)
    items = []
    for r in rows:
        item = _public_resource(r, viewer)
        item["visible_mappings"] = r["visible_mappings"]
        item["segment_count"] = r["segment_count"]
        items.append(item)
    return {"total": total, "page": page, "page_size": page_size, "items": items}


def resource_detail(session: Session, viewer: Viewer, resource_id: str) -> dict[str, Any]:
    r = require_view(session, viewer, resource_id)
    out = _public_resource(r, viewer)
    out["playback"] = playback_details(r, viewer)
    topics = fetch_all(session, """SELECT t.id, t.name, t.canonical_slug AS slug, count(*) AS segments, max(st.confidence) AS confidence
                                   FROM segment_topics st JOIN resource_segments s ON s.id = st.segment_id JOIN topics t ON t.id = st.topic_id
                                   WHERE s.resource_id = :r AND s.is_active GROUP BY t.id ORDER BY segments DESC, confidence DESC""", r=resource_id)
    entities = fetch_all(session, """SELECT e.id, e.name, e.type, count(*) AS segments FROM segment_entities se JOIN resource_segments s ON s.id = se.segment_id
                                     JOIN entities e ON e.id = se.entity_id WHERE s.resource_id = :r AND s.is_active GROUP BY e.id ORDER BY segments DESC""", r=resource_id)
    out["topics"] = topics
    out["entities"] = entities
    return out


def playback_details(r: dict[str, Any], viewer: Viewer) -> dict[str, Any]:
    caps = capabilities(r)
    details: dict[str, Any] = {"mode": caps["playback"], "media_type": r["type"]}
    if r["type"] not in ("video", "audio"):
        details["mode"] = "document" if r.get("source_kind") == "upload" and r["type"] == "pdf" else "text"
        if r["type"] == "pdf" and r.get("source_uri") and r.get("rights_status") in ("owned", "licensed"):
            details["document_url"] = f"/v1/media/{r['id']}?token={media_token(r['id'])}"
        return details
    if caps["playback"] == "local":
        details["url"] = f"/v1/media/{r['id']}?token={media_token(r['id'])}"
        details["mime_type"] = r.get("mime_type")
    elif caps["playback"] == "embed":
        url = r.get("source_uri") or ""
        details["url"] = url
        video_id = youtube_id(url)
        if video_id:
            details["provider"] = "youtube"
            details["youtube_id"] = video_id
        elif url.lower().split("?")[0].endswith((".mp4", ".m4v", ".mov", ".webm", ".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac")):
            details["provider"] = "direct"
    if r.get("captions_uri") or r.get("last_run_id"):
        details["captions_url"] = f"/v1/resources/{r['id']}/captions.vtt?token={media_token(r['id'])}"
    return details


def segments(session: Session, viewer: Viewer, resource_id: str, include_mappings: bool) -> dict[str, Any]:
    r = require_view(session, viewer, resource_id)
    rows = fetch_all(session, """SELECT id, ordinal, start_ms, end_ms, page_start, page_end, heading, speaker, text_normalized, transcript_raw, unit_offsets, summary,
                                        clip_start_ms, clip_end_ms, clip_core_start_ms, clip_core_end_ms, clip_reason, clip_confidence, clip_review_status, topic_hint,
                                        non_speech_ratio, part
                                 FROM resource_segments WHERE resource_id = :r AND is_active ORDER BY ordinal""", r=resource_id)
    staff = viewer.is_editor or can_edit_resource(viewer, r)
    statuses = ("published", "approved", "pending_review", "index_only", "rejected", "discarded") if staff else ("published", "approved")
    links_by_segment: dict[str, list[dict[str, Any]]] = {}
    if include_mappings and rows:
        status_list = ",".join(f"'{s}'" for s in statuses)
        for l in fetch_all(session, f"""SELECT id, segment_id, verse_id, end_verse_id, relationship_type, relationship_subtype, confidence, confidence_override, primary_flag,
                                               evidence_text, evidence_offsets, mention_count, why_related, review_status, needs_review, review_reasons, is_human_verified
                                        FROM verse_resource_links WHERE resource_id = :r AND parent_link_id IS NULL AND review_status IN ({status_list})
                                        ORDER BY primary_flag DESC, confidence DESC""", r=resource_id):
            conf = float(l["confidence_override"] if l["confidence_override"] is not None else l["confidence"])
            links_by_segment.setdefault(l["segment_id"], []).append({
                "mapping_id": l["id"], "verse_ref": B.canonical_range_str(l["verse_id"], l["end_verse_id"]), "verse_display": B.display_ref(l["verse_id"], l["end_verse_id"]),
                "relationship": {**display_label(l["relationship_type"], conf, l["is_human_verified"]), "subtype": l["relationship_subtype"], "confidence": round(conf, 3), "primary": l["primary_flag"]},
                "evidence_text": l["evidence_text"], "evidence_offsets": l["evidence_offsets"], "mention_count": l["mention_count"], "why_related": l["why_related"],
                **({"review_status": l["review_status"], "needs_review": l["needs_review"], "review_reasons": l["review_reasons"]} if staff else {}),
            })
        topic_rows = fetch_all(session, """SELECT st.segment_id, t.name, t.canonical_slug AS slug, st.confidence FROM segment_topics st JOIN topics t ON t.id = st.topic_id
                                           JOIN resource_segments s ON s.id = st.segment_id WHERE s.resource_id = :r ORDER BY st.confidence DESC""", r=resource_id)
    else:
        topic_rows = []
    topics_by_segment: dict[str, list[dict[str, Any]]] = {}
    for t in topic_rows:
        topics_by_segment.setdefault(t["segment_id"], []).append({"name": t["name"], "slug": t["slug"], "confidence": t["confidence"]})
    items = []
    for s in rows:
        item = {k: s[k] for k in ("id", "ordinal", "start_ms", "end_ms", "page_start", "page_end", "heading", "speaker", "summary", "topic_hint")}
        item["non_speech_ratio"] = round(float(s["non_speech_ratio"] or 0), 3)  # ≥0.6 means a sung / music section
        item["part"] = s["part"] or "message"  # only "message" sections are mapped to verses and clipped
        item["text"] = s["text_normalized"]
        item["units"] = s["unit_offsets"]
        if staff:
            item["transcript_raw"] = s["transcript_raw"]
        item["clip"] = {"start_ms": s["clip_start_ms"], "end_ms": s["clip_end_ms"], "core_start_ms": s["clip_core_start_ms"], "core_end_ms": s["clip_core_end_ms"],
                        "reason": s["clip_reason"], "confidence": s["clip_confidence"], "review_status": s["clip_review_status"]} if s["clip_start_ms"] is not None else None
        item["mappings"] = links_by_segment.get(s["id"], [])
        item["topics"] = topics_by_segment.get(s["id"], [])
        items.append(item)
    return {"resource_id": resource_id, "segments": items}


def verse_links(session: Session, viewer: Viewer, resource_id: str) -> dict[str, Any]:
    data = segments(session, viewer, resource_id, include_mappings=True)
    links = []
    for seg in data["segments"]:
        for m in seg["mappings"]:
            links.append({**m, "segment_id": seg["id"], "segment_ordinal": seg["ordinal"], "start_ms": seg["start_ms"], "end_ms": seg["end_ms"], "page_start": seg["page_start"], "heading": seg["heading"]})
    by_verse: dict[str, int] = {}
    for l in links:
        by_verse[l["verse_ref"]] = by_verse.get(l["verse_ref"], 0) + 1
    return {"resource_id": resource_id, "total": len(links), "verses": [{"ref": k, "display": B.display_ref(*B.parse_canonical_range(k)) if B.parse_canonical_range(k) else k, "segments": v} for k, v in by_verse.items()], "links": links}


def update_resource(session: Session, viewer: Viewer, resource_id: str, data: dict[str, Any]) -> dict[str, Any]:
    r = require_edit(session, viewer, resource_id)
    changes = {k: v for k, v in data.items() if k in EDITABLE_FIELDS and v is not None}
    if ("is_official" in changes or "requires_review" in changes) and not viewer.is_editor:
        raise Forbidden("only editors can change editorial flags")
    if not changes:
        return _public_resource(r, viewer)
    sets = []
    params: dict[str, Any] = {"id": resource_id}
    for k, v in changes.items():
        if k == "metadata":
            sets.append("metadata = CAST(:metadata AS jsonb)")
            params[k] = json_dumps(v)
        else:
            sets.append(f"{k} = :{k}")
            params[k] = v
    execute(session, f"UPDATE resources SET {', '.join(sets)}, updated_at = now() WHERE id = :id", **params)
    audit(session, viewer, "resource", resource_id, "update", {k: r.get(k) for k in changes}, changes)
    if any(k in changes for k in ("visibility", "organization_id", "rights_status")):
        # derived verse relationships and verse themes must follow the new visibility (AC-08)
        from ..pipeline.persist import refresh_resource_derived_data

        refresh_resource_derived_data(session, resource_id)
        cache.bump_global(session)
    return _public_resource(get_resource_row(session, resource_id), viewer)


def delete_resource(session: Session, viewer: Viewer, resource_id: str) -> dict[str, Any]:
    from ..pipeline.persist import refresh_resource_derived_data

    r = require_edit(session, viewer, resource_id)
    execute(session, "UPDATE resources SET deleted_at = now(), status = 'deleted', updated_at = now() WHERE id = :id", id=resource_id)
    refresh_resource_derived_data(session, resource_id)
    audit(session, viewer, "resource", resource_id, "delete", {"title": r["title"], "visibility": r["visibility"]}, None)
    cache.bump_global(session)
    return {"deleted": True, "id": resource_id}


def media_file(session: Session, resource_id: str, token: str | None, viewer: Viewer) -> tuple[Path, str | None]:
    from ..security import unsign

    r = get_resource_row(session, resource_id)
    payload = unsign(token) if token else None
    authorized = (payload and payload.get("typ") == "media" and payload.get("rid") == resource_id) or can_view_resource(viewer, r, discoverable=False)
    if not authorized:
        raise NotFound("media not found")
    caps = capabilities(r)
    if r["type"] in ("video", "audio") and caps["playback"] != "local":
        raise Forbidden("playback of this media is not permitted by its rights status")
    if r["type"] == "pdf" and r.get("rights_status") not in ("owned", "licensed"):
        raise Forbidden("viewing the original document is not permitted by its rights status")
    if not r.get("source_uri") or r.get("source_kind") != "upload":
        raise NotFound("no media file")
    path = storage.path_for(r["source_uri"])
    if not path.exists():
        raise NotFound("media file missing from storage")
    return path, r.get("mime_type")


def captions_vtt(session: Session, resource_id: str, token: str | None, viewer: Viewer) -> str:
    from ..ingest.captions import units_to_vtt
    from ..security import unsign

    r = get_resource_row(session, resource_id)
    payload = unsign(token) if token else None
    if not ((payload and payload.get("rid") == resource_id) or can_view_resource(viewer, r, discoverable=False)):
        raise NotFound("captions not found")
    t = fetch_one(session, "SELECT units FROM resource_transcripts WHERE resource_id = :r ORDER BY created_at DESC LIMIT 1", r=resource_id)
    if t:
        return units_to_vtt(t["units"])
    if r.get("captions_uri") and storage.exists(r["captions_uri"]):
        return storage.path_for(r["captions_uri"]).read_text(encoding="utf-8", errors="replace")
    raise NotFound("no transcript yet")
