"""End-to-end Scripture intelligence pipeline (spec §3.2 ING-01..ING-16, §11.1 stages A-J)."""
from __future__ import annotations

import logging
import time
import traceback
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

from .. import storage
from ..ai.llm import AIInvalidOutput, AIUnavailable, get_llm
from ..ai import schemas as S
from ..ai.prompt_pack import prompt_versions
from ..bible import books as B
from ..bible.refparser import parse_query_reference, parse_references
from ..config import get_settings
from ..db import execute, fetch_all, fetch_one, json_dumps, session_scope
from ..ids import new_id, sha256_text, short_hash
from ..ingest import captions as cap
from ..ingest import extract, media, segment
from ..ingest import youtube as yt
from ..ingest.validate import UploadRejected
from ..ingest.transcribe import TRANSCRIBER_VERSION, download_media, transcribe_media, transcribe_youtube, youtube_id
from ..ingest.units import Unit, finalize_units
from ..retrieval.quotes import get_quote_index
from . import detectors, enrich, merge, persist, routing
from .types import Detection, SegmentWork

log = logging.getLogger(__name__)

STAGES = [
    ("ING-01", "Validate resource"),
    ("ING-02", "Store source & immutable metadata"),
    ("ING-03", "Extract text / transcribe"),
    ("ING-04", "Normalize transcript"),
    ("ING-05", "Semantic segmentation"),
    ("ING-05B", "Locate the message (P-16)"),
    ("ING-06", "Explicit Bible references"),
    ("ING-07", "Quotations & paraphrases"),
    ("ING-08", "Semantic candidate retrieval"),
    ("ING-09", "LLM verification & relationship classification"),
    ("ING-10", "Topics, people, events"),
    ("ING-11", "Segment summaries"),
    ("ING-12", "Clip boundaries"),
    ("AUDIT", "Mapping quality audit (P-12)"),
    ("ING-15", "Review routing"),
    ("ING-13", "Store mappings & provenance"),
    ("ING-14", "Index resource & embeddings"),
    ("ING-16", "Publish"),
]
MEDIA_TYPES = ("video", "audio")


class PipelineError(RuntimeError):
    pass


class StageTracker:
    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
        self.stages = [{"id": sid, "name": name, "status": "pending", "started_at": None, "completed_at": None, "duration_ms": None, "detail": None, "error": None} for sid, name in STAGES]
        self.metrics: dict[str, Any] = {"stage_ms": {}}
        self._save(current=None)

    def _save(self, current: str | None, status: str | None = None, error: str | None = None) -> None:
        with session_scope() as s:
            execute(
                s,
                """UPDATE processing_runs SET stages = CAST(:stages AS jsonb), current_stage = :current, metrics = CAST(:metrics AS jsonb),
                       status = coalesce(:status, status), error = coalesce(:error, error) WHERE id = :id""",
                stages=json_dumps(self.stages), current=current, metrics=json_dumps(self.metrics), status=status, error=error, id=self.run_id,
            )

    @contextmanager
    def stage(self, stage_id: str) -> Iterator[dict[str, Any]]:
        entry = next(s for s in self.stages if s["id"] == stage_id)
        entry.update(status="running", started_at=datetime.now(timezone.utc).isoformat())
        self._save(current=stage_id)
        t0 = time.monotonic()
        info: dict[str, Any] = {}
        try:
            yield info
        except Exception as exc:
            entry.update(status="failed", error=str(exc)[:1000], completed_at=datetime.now(timezone.utc).isoformat(), duration_ms=int((time.monotonic() - t0) * 1000))
            self._save(current=stage_id)
            raise
        entry.update(status=info.pop("_status", "completed"), completed_at=datetime.now(timezone.utc).isoformat(), duration_ms=int((time.monotonic() - t0) * 1000), detail=info or None)
        self.metrics["stage_ms"][stage_id] = entry["duration_ms"]
        self._save(current=stage_id)


def _parallel(items: list[Any], fn: Callable[[Any], Any]) -> list[Any]:
    workers = max(1, min(get_settings().gemini_concurrency, len(items) or 1))
    if workers == 1:
        return [fn(x) for x in items]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(fn, items))


YOUTUBE_CAPTIONS_VERSION = "youtube-captions-1"
MOSTLY_SUNG = 0.6  # a segment with this much music/singing is not analysed for verse links


def _youtube_caption_units(resource: dict[str, Any], mode: str) -> tuple[list[Unit], dict[str, Any]]:
    """The video's own caption track (human-made first, else auto-generated), read from YouTube without downloading it.

    Returns ([], {}) when the video has no captions (or Gemini transcription was explicitly asked for), so the caller
    falls back to transcribing the video through Gemini.
    """
    if mode == "gemini":
        return [], {}
    try:
        info = yt.inspect(resource["source_uri"])
        cues, track = yt.caption_cues(info, resource.get("language"))
    except UploadRejected as exc:
        if mode == "captions":
            raise PipelineError(str(exc)) from exc
        log.info("no usable YouTube captions for %s (%s) - falling back to transcription", resource["id"], exc)
        return [], {}
    units = cap.cues_to_units(cues)
    return units, {
        "source": "youtube",
        "youtube": {"video_id": info.video_id, "captions": track.public(), "chapters": len(info.chapters)},
        "sentence_split": "pauses" if cap.looks_unpunctuated(cues) else "sentences",
        "cues": len(cues),
        "units": len(units),
        "duration_ms": info.duration_ms or max(c["end_ms"] for c in cues),
    }


MIN_MESSAGE_SEGMENTS = 6  # a short recording is almost always the message alone
MIN_MESSAGE_DURATION_MS = 10 * 60_000
MESSAGE_SNIPPET_CHARS = 150
MIN_MESSAGE_SHARE = 0.1  # a model answer that keeps almost nothing of a long recording is not trusted


def _mmss(ms: int | None) -> str:
    total = int((ms or 0) / 1000)
    h, m, sec = total // 3600, (total % 3600) // 60, total % 60
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


def _save_message_span(resource_id: str, span: dict[str, Any]) -> None:
    with session_scope() as s:
        execute(s, """UPDATE resources SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{message}', CAST(:v AS jsonb), true),
                          updated_at = now() WHERE id = :id""", v=json_dumps(span), id=resource_id)


def locate_message(segments: list[SegmentWork], resource: dict[str, Any], run_id: str, ai: bool, spoken: bool) -> dict[str, Any]:
    """Label every section of a recording and keep the verse analysis on the message (the sermon or teaching).

    Captions already tell us which sections are sung; P-16 then reads the section texts and says where the teaching
    starts and ends, so worship, welcome, announcements, offering talk and prayers are never mined for verse links.
    Anything uncertain falls back to "analyse everything that is not a song", which is what happened before.
    """
    for sg in segments:
        sg.part = "worship" if sg.non_speech_ratio >= MOSTLY_SUNG else "message"

    def counts() -> dict[str, int]:
        return dict(Counter(sg.part for sg in segments))

    timed = [sg for sg in segments if sg.start_ms is not None and sg.end_ms is not None]
    total_ms = (timed[-1].end_ms - timed[0].start_ms) if timed else 0
    if not spoken or len(segments) < MIN_MESSAGE_SEGMENTS or total_ms < MIN_MESSAGE_DURATION_MS:
        return {"method": "whole recording", "parts": counts()}
    if not ai:
        return {"method": "songs only (AI not configured)", "parts": counts()}

    lines = [f"#{sg.ordinal} | {_mmss(sg.start_ms)}-{_mmss(sg.end_ms)}"
             f"{' [music]' if sg.non_speech_ratio >= MOSTLY_SUNG else ''} | {' '.join((sg.text or '').split())[:MESSAGE_SNIPPET_CHARS]}"
             for sg in segments]
    try:
        result = get_llm().run("P-16", {"duration": _mmss(total_ms), "sections": "\n".join(lines)}, S.MessageLocationOut,
                               resource_id=resource["id"], run_id=run_id)
    except (AIUnavailable, AIInvalidOutput) as exc:
        return {"_status": "degraded", "error": str(exc)[:300], "method": "songs only (AI failed)", "parts": counts()}

    out = result.output
    labels = {p.ordinal: p.part for p in out.parts}
    start, end = out.message_start_ordinal, out.message_end_ordinal
    has_span = start >= 0 and end >= start
    for sg in segments:
        if has_span and start <= sg.ordinal <= end:
            sg.part = "message"  # the teaching stays whole, including a prayer or reading inside it
        else:
            sg.part = labels.get(sg.ordinal) or ("worship" if sg.non_speech_ratio >= MOSTLY_SUNG else "other")

    message_ms = sum((sg.end_ms or 0) - (sg.start_ms or 0) for sg in segments if sg.part == "message")
    too_little = message_ms < max(MIN_MESSAGE_DURATION_MS * 0.3, total_ms * MIN_MESSAGE_SHARE)
    no_message_claim = not has_span and out.confidence >= 0.6
    if too_little and not no_message_claim:  # never let one odd answer wipe out the whole recording
        for sg in segments:
            sg.part = "worship" if sg.non_speech_ratio >= MOSTLY_SUNG else "message"
        return {"method": "songs only (message answer not trusted)", "parts": counts(), "model_reason": (out.reason or "")[:160]}

    span = {"start_ms": min((sg.start_ms for sg in segments if sg.part == "message" and sg.start_ms is not None), default=None),
            "end_ms": max((sg.end_ms for sg in segments if sg.part == "message" and sg.end_ms is not None), default=None),
            "confidence": round(float(out.confidence or 0), 3), "reason": (out.reason or "")[:300],
            "parts": counts(), "prompt_version": result.prompt_version, "model": result.model}
    _save_message_span(resource["id"], span)
    return {"method": "P-16", "parts": counts(), "message_at": f"{_mmss(span['start_ms'])}-{_mmss(span['end_ms'])}" if span["start_ms"] is not None else None,
            "confidence": span["confidence"], "reason": span["reason"][:160], "cached": result.cached}


def _resource_file(resource: dict[str, Any]) -> Path | None:
    if resource["source_kind"] == "upload" and resource.get("source_uri"):
        p = storage.path_for(resource["source_uri"])
        return p if p.exists() else None
    return None


# --------------------------------------------------------------------------- stage A
def extract_units(resource: dict[str, Any], run_id: str, ai: bool, options: dict[str, Any]) -> tuple[list[Unit], str, dict[str, Any], str]:
    rtype = resource["type"]
    work = storage.work_dir(f"{resource['id']}_{run_id}")
    src = _resource_file(resource)
    diagnostics: dict[str, Any] = {}
    if rtype in MEDIA_TYPES:
        captions_path = storage.path_for(resource["captions_uri"]) if resource.get("captions_uri") else None
        mode = resource.get("transcript_mode") or "auto"
        use_captions = captions_path is not None and captions_path.exists() and (mode == "captions" or mode == "auto" or (mode == "gemini" and not ai))
        if mode == "gemini" and ai and src is not None:
            use_captions = False
        if use_captions:
            cues = cap.parse_captions(captions_path.read_text(encoding="utf-8", errors="replace"))
            if not cues:
                raise PipelineError("captions file contains no cues")
            units = cap.cues_to_units(cues)
            method, version = "captions", "captions-1"
            diagnostics["cues"] = len(cues)
            if src is not None:
                info = media.probe(src)
                diagnostics.update(duration_ms=info.duration_ms, media_start_offset_ms=info.start_offset_ms, has_video=info.has_video)
            else:
                diagnostics["duration_ms"] = max(c["end_ms"] for c in cues)
        else:
            remote = resource.get("source_uri") if resource["source_kind"] in ("external_embed", "url") else None
            if src is None and remote and youtube_id(remote):
                yt_units, yt_diag = _youtube_caption_units(resource, mode)  # the video's own captions, when it has any
                if yt_units:
                    diagnostics.update(yt_diag, has_video=True)
                    return yt_units, "youtube_captions", diagnostics, YOUTUBE_CAPTIONS_VERSION
                if not ai:
                    raise AIUnavailable("That video has no captions on YouTube, so Gemini has to transcribe it: add GEMINI_API_KEY to .env, or upload a captions file (VTT/SRT).")
                units, diag = transcribe_youtube(remote, resource.get("duration_ms"), resource["id"], run_id, resource.get("language") or "en", resource.get("speaker"))
                diagnostics.update(diag, has_video=True)
                return units, "gemini_youtube_transcription", diagnostics, TRANSCRIBER_VERSION
            if src is None and remote:
                src = download_media(remote, work, get_settings().max_upload_mb_media * 1024 * 1024)
                diagnostics["downloaded_from"] = remote
            if src is None:
                raise PipelineError("no local media file to transcribe - upload the media or a captions file (VTT/SRT)")
            if not ai:
                raise AIUnavailable("Transcription requires GEMINI_API_KEY. Add the key to .env, or upload a captions file and choose transcript mode 'captions'.")
            units, diag = transcribe_media(src, resource["id"], run_id, resource.get("language") or "en", resource.get("speaker"), work)
            diagnostics.update(diag)
            info = media.probe(src)
            diagnostics.update(has_video=info.has_video)
            method, version = "gemini_transcription", TRANSCRIBER_VERSION
        return units, method, diagnostics, version
    if rtype == "pdf":
        if src is None:
            raise PipelineError("PDF file has not been uploaded")
        units, diag = extract.extract_pdf(src)
        return units, diag["method"], diag, "pdf-1"
    if rtype == "document":
        if src is None:
            if resource.get("body_text"):
                units, diag = extract.extract_markdown(resource["body_text"])
                return units, "markdown", diag, "md-1"
            raise PipelineError("document file has not been uploaded")
        if src.suffix.lower() == ".docx":
            units, diag = extract.extract_docx(src)
            return units, "docx", diag, "docx-1"
        units, diag = extract.extract_markdown(src.read_text(encoding="utf-8", errors="replace"))
        return units, "markdown", diag, "md-1"
    if rtype == "article":
        if resource["source_kind"] == "url" and resource.get("source_uri") and not resource.get("body_text"):
            html = extract.fetch_article(resource["source_uri"])
            units, diag = extract.extract_html(html)
            return units, "html", diag, "html-1"
        if src is not None and src.suffix.lower() in (".html", ".htm"):
            units, diag = extract.extract_html(src.read_text(encoding="utf-8", errors="replace"))
            return units, "html", diag, "html-1"
    if resource.get("body_text"):
        units, diag = extract.extract_markdown(resource["body_text"])
        return units, "native", diag, "native-1"
    raise PipelineError(f"no extractable content for resource type {rtype}")


def _source_hash(resource: dict[str, Any]) -> str:
    parts = [resource.get("source_hash") or "", resource.get("captions_uri") or "", sha256_text(resource.get("body_text") or ""), resource.get("transcript_mode") or "", str(resource.get("pii_redaction"))]
    return sha256_text("|".join(parts))


# --------------------------------------------------------------------------- orchestration
def process_resource(resource_id: str, run_id: str, options: dict[str, Any] | None = None) -> dict[str, Any]:
    options = options or {}
    settings = get_settings()
    llm = get_llm()
    ai = llm.available and not options.get("disable_ai")
    with session_scope() as s:
        resource = fetch_one(s, "SELECT * FROM resources WHERE id = :id", id=resource_id)
        if not resource:
            raise PipelineError(f"resource {resource_id} not found")
        execute(s, "UPDATE processing_runs SET status = 'running', started_at = coalesce(started_at, now()), attempts = attempts + 1, model_versions = CAST(:mv AS jsonb), prompt_versions = CAST(:pv AS jsonb) WHERE id = :id",
                id=run_id, mv=json_dumps({"analysis": settings.gemini_model_analysis, "fast": settings.gemini_model_fast, "transcribe": settings.gemini_model_transcribe, "embedding": settings.gemini_embed_model, "ai_enabled": ai}),
                pv=json_dumps(prompt_versions()))
        execute(s, "UPDATE resources SET status = 'processing', last_run_id = :run, updated_at = now() WHERE id = :id", run=run_id, id=resource_id)
    tracker = StageTracker(run_id)
    media_resource = resource["type"] in MEDIA_TYPES
    degraded = not ai
    try:
        with tracker.stage("ING-01") as info:
            if resource.get("deleted_at"):
                raise PipelineError("resource is deleted")
            if resource["type"] in MEDIA_TYPES + ("pdf",) and resource["source_kind"] == "upload" and not resource.get("source_uri") and not resource.get("captions_uri"):
                raise PipelineError("upload the media/document file before processing")
            info.update(type=resource["type"], ai_enabled=ai)
        if options.get("reset_human"):
            with session_scope() as s:
                n = fetch_one(s, "SELECT count(*) AS n FROM verse_resource_links WHERE resource_id = :r", r=resource_id)["n"]
                execute(s, "DELETE FROM verse_resource_links WHERE resource_id = :r", r=resource_id)
                execute(s, "INSERT INTO review_actions (id, object_type, object_id, reviewer_id, action, previous_value, note) VALUES (:id, 'resource', :r, :u, 'reset_mappings', CAST(:pv AS jsonb), 'Explicit reset before reprocessing')",
                        id=new_id("rev"), r=resource_id, u=options.get("triggered_by"), pv=json_dumps({"deleted_links": n}))

        with tracker.stage("ING-02") as info:
            src_hash = _source_hash(resource)
            info.update(source_hash=src_hash[:16], source_uri=resource.get("source_uri"), original_hash=(resource.get("source_hash") or "")[:16])

        with tracker.stage("ING-03") as info:
            with session_scope() as s:
                existing = fetch_all(s, "SELECT * FROM resource_transcripts WHERE resource_id = :r AND source_hash = :h ORDER BY created_at DESC LIMIT 1", r=resource_id, h=src_hash)
            if existing and not options.get("force_retranscribe"):
                transcript = existing[0]
                info.update(reused_transcript=transcript["id"], method=transcript["method"])
                units = None
            else:
                units, method, diag, method_version = extract_units(resource, run_id, ai, options)
                info.update(method=method, raw_units=len(units))
                transcript = None

        with tracker.stage("ING-04") as info:
            if transcript is None:
                assert units is not None
                units, full_text, norm_diag = finalize_units(units, spoken=media_resource, redact=bool(resource.get("pii_redaction", True)))
                if not units:
                    raise PipelineError("no text could be extracted from the resource")
                transcript_id = new_id("trn")
                with session_scope() as s:
                    execute(
                        s,
                        """INSERT INTO resource_transcripts (id, resource_id, source_hash, method, method_version, model, language, units, text_raw, text_normalized, diagnostics)
                           VALUES (:id, :r, :h, :m, :mv, :model, :lang, CAST(:units AS jsonb), :raw, :norm, CAST(:diag AS jsonb))
                           ON CONFLICT (resource_id, source_hash, method, method_version) DO UPDATE SET units = EXCLUDED.units, text_raw = EXCLUDED.text_raw,
                             text_normalized = EXCLUDED.text_normalized, diagnostics = EXCLUDED.diagnostics""",
                        id=transcript_id, r=resource_id, h=src_hash, m=method, mv=method_version,
                        model=settings.gemini_model_transcribe if method == "gemini_transcription" else None, lang=resource.get("language"),
                        units=json_dumps([u.to_dict() for u in units]), raw="\n".join(u.text_raw for u in units), norm=full_text,
                        diag=json_dumps({**diag, **norm_diag}),
                    )
                    transcript = fetch_one(s, "SELECT * FROM resource_transcripts WHERE resource_id = :r AND source_hash = :h AND method = :m AND method_version = :mv", r=resource_id, h=src_hash, m=method, mv=method_version)
            units = [Unit.from_dict(u) for u in transcript["units"]]
            full_text = transcript["text_normalized"]
            diag = transcript["diagnostics"] or {}
            with session_scope() as s:
                execute(s, "UPDATE resources SET duration_ms = coalesce(:d, duration_ms), page_count = coalesce(:p, page_count), media_start_offset_ms = coalesce(:o, media_start_offset_ms) WHERE id = :id",
                        d=diag.get("duration_ms"), p=diag.get("page_count"), o=diag.get("media_start_offset_ms"), id=resource_id)
                resource = fetch_one(s, "SELECT * FROM resources WHERE id = :id", id=resource_id)
            info.update(units=len(units), characters=len(full_text), pii_redactions=diag.get("pii_redactions", 0), transcript_id=transcript["id"])

        with tracker.stage("ING-05") as info:
            with session_scope() as s:
                qindex = get_quote_index(s)
            scripture_units = set()
            for i, u in enumerate(units):
                if parse_references(u.text) or any(c.containment >= 0.5 for c in qindex.search(u.text, min_containment=0.5, limit=1)):
                    scripture_units.add(i)
            plans = None
            if media_resource:
                if ai:
                    plans = segment.ai_segments_spoken(units, scripture_units, resource["type"], resource.get("language") or "en", resource_id, run_id)
                plans = plans or segment.rule_segments_spoken(units, scripture_units)
            else:
                plans = segment.rule_segments_document(units)
            problems = segment.validate_plan(plans, len(units))
            if problems:
                raise PipelineError(f"invalid segmentation: {problems}")
            segments = _build_segments(resource, units, full_text, plans)
            info.update(segments=len(segments), source=Counter(p.source for p in plans), scripture_units=len(scripture_units))

        hint_ids = [r[0] for r in (parse_query_reference(h) for h in (resource.get("verse_hints") or [])) if r]

        with tracker.stage("ING-05B") as info:
            info.update(locate_message(segments, resource, run_id, ai, media_resource))
        message = [sg for sg in segments if sg.part == "message"]
        skipped_parts = Counter(sg.part for sg in segments if sg.part != "message")
        if skipped_parts:
            log.info("%s: analysing the message only (%s sections skipped: %s)", resource_id, len(segments) - len(message), dict(skipped_parts))

        with tracker.stage("ING-06") as info:
            results = _parallel(message, lambda sg: detectors.detect_explicit(sg, resource, run_id, ai))
            for sg, dets in zip(message, results):
                sg.detections.extend(dets)
            info.update(explicit_references=sum(len(r) for r in results), skipped_sections=dict(skipped_parts))

        with tracker.stage("ING-07") as info:
            outputs = _parallel(message, lambda sg: detectors.detect_quotes(sg, qindex, resource, run_id, ai))
            theme_only: dict[str, list[int]] = {}
            raw_quote: dict[str, list[Any]] = {}
            for sg, (dets, themes, raw) in zip(message, outputs):
                sg.detections.extend(dets)
                theme_only[sg.id] = themes
                raw_quote[sg.id] = raw
            previous_direct: list[Detection] = []
            contextual = 0
            for sg in message:
                already = {(d.start, d.end) for d in sg.detections}
                ctx = detectors.detect_contextual(sg, previous_direct, raw_quote[sg.id], already)
                sg.detections.extend(ctx)
                contextual += len(ctx)
                own_direct = [d for d in sg.detections if d.type == "direct_reference"]
                previous_direct = own_direct if own_direct else []
            info.update(quotes=sum(len(o[0]) for o in outputs), contextual=contextual)

        with tracker.stage("ING-08") as info:
            if ai:
                try:
                    _embed_segments(message, run_id)
                    info.update(embedded_segments=len(message), skipped_sections=dict(skipped_parts))
                except AIUnavailable as exc:
                    degraded = True
                    info.update(_status="degraded", error=str(exc)[:300])
            else:
                info.update(_status="skipped", reason="AI not configured")

        with tracker.stage("ING-09") as info:
            if ai:
                sem = _parallel(message, lambda sg: detectors.detect_semantic(sg, resource, run_id, [d for d in sg.detections], theme_only.get(sg.id, []), hint_ids))
                for sg, dets in zip(message, sem):
                    sg.detections.extend(dets)
                info.update(ai_related_candidates=sum(len(x) for x in sem), skipped_sections=dict(skipped_parts))
            for sg in message:
                sg.mappings = merge.merge_detections(sg, sg.detections)
            _parallel(message, lambda sg: merge.classify_and_select_primary(sg, sg.mappings, resource, run_id, ai, media_resource))
            info.update(mappings=sum(len(sg.mappings) for sg in segments))

        with tracker.stage("ING-10") as info:
            _parallel(message, lambda sg: enrich.tag_segment(sg, resource, run_id, ai))
            info.update(topics=sum(len(sg.tags.get("topics", [])) for sg in segments), skipped_sections=dict(skipped_parts))

        with tracker.stage("ING-11") as info:
            if ai:
                _parallel(message, lambda sg: enrich.summarize_segment(sg, resource, run_id, ai))
                info.update(summaries=sum(1 for sg in segments if sg.summary))
            else:
                info.update(_status="skipped", reason="AI not configured")

        with tracker.stage("ING-12") as info:
            if media_resource:
                all_units = [{"id": u.id, "start_ms": u.start_ms, "end_ms": u.end_ms, "text": u.text} for u in units if u.start_ms is not None]
                _parallel([sg for sg in segments if sg.mappings], lambda sg: enrich.select_clip(sg, all_units, resource, run_id, ai))
                info.update(clips=sum(1 for sg in segments if sg.clip))
            else:
                info.update(_status="skipped", reason="not a media resource")

        with tracker.stage("AUDIT") as info:
            if ai:
                _parallel([sg for sg in segments if sg.mappings], lambda sg: enrich.audit_segment(sg, resource, run_id, ai))
                info.update(audited_segments=sum(1 for sg in segments if sg.mappings))
            else:
                info.update(_status="skipped", reason="AI not configured")

        with tracker.stage("ING-15") as info:
            status_counts: Counter[str] = Counter()
            for sg in segments:
                merge.apply_semantic_precision_policy(sg)
                for m in sg.mappings:
                    m.review_status, m.needs_review, m.review_reasons = routing.route(m.confidence, m.needs_review, m.review_reasons, resource)
                    m.review_reasons = sorted(set(m.review_reasons))
                    status_counts[m.review_status] += 1
                primary = next((m for m in sg.mappings if m.primary), None)
                if primary and primary.review_status in ("discarded", "index_only"):  # the primary verse must be one a reader can see
                    primary.primary = False
                    alt = merge.deterministic_primary(sg, [m for m in sg.mappings if m.review_status not in ("discarded", "index_only")], media_resource)
                    if alt:
                        alt.primary = True
            info.update(**status_counts)

        with tracker.stage("ING-13") as info:
            with session_scope() as s:
                result = persist.persist_results(s, resource, run_id, transcript["id"], segments, degraded, media_resource)
            info.update(**result)

        with tracker.stage("ING-14") as info:
            info.update(segments_indexed=len(segments), embeddings=sum(len(sg.embeddings) for sg in segments), full_text="generated tsvector columns")

        with tracker.stage("ING-16") as info:
            with session_scope() as s:
                execute(s, "UPDATE resources SET status = 'processed', processed_at = now(), updated_at = now() WHERE id = :id", id=resource_id)
                published = fetch_one(s, "SELECT count(*) FILTER (WHERE review_status IN ('published','approved')) AS visible, count(*) FILTER (WHERE needs_review) AS review FROM verse_resource_links WHERE resource_id = :r AND parent_link_id IS NULL", r=resource_id)
            info.update(visible_mappings=published["visible"], in_review_queue=published["review"])

        metrics = _run_metrics(run_id, segments)
        tracker.metrics.update(metrics)
        with session_scope() as s:
            execute(s, "UPDATE processing_runs SET status = 'succeeded', completed_at = now(), degraded = :d, metrics = CAST(:m AS jsonb), error = NULL WHERE id = :id",
                    d=degraded, m=json_dumps(tracker.metrics), id=run_id)
        return {"run_id": run_id, "status": "succeeded", "degraded": degraded, "metrics": tracker.metrics}
    except Exception as exc:
        log.exception("pipeline failed for %s", resource_id)
        with session_scope() as s:
            execute(s, "UPDATE processing_runs SET status = 'failed', completed_at = now(), error = :e, metrics = CAST(:m AS jsonb) WHERE id = :id",
                    e=f"{type(exc).__name__}: {exc}"[:2000], m=json_dumps({**tracker.metrics, "traceback": traceback.format_exc()[-2000:]}), id=run_id)
            has_segments = fetch_one(s, "SELECT count(*) AS n FROM resource_segments WHERE resource_id = :r", r=resource_id)["n"]
            execute(s, "UPDATE resources SET status = :st, updated_at = now() WHERE id = :id", st="processed" if has_segments else "failed", id=resource_id)
        raise


def _build_segments(resource: dict[str, Any], units: list[Unit], full_text: str, plans: list[segment.SegmentPlan]) -> list[SegmentWork]:
    out: list[SegmentWork] = []
    for ordinal, plan in enumerate(plans):
        us = [units[i] for i in plan.unit_indices]
        cs, ce = us[0].char_start, us[-1].char_end
        text = full_text[cs:ce]
        before = units[max(0, plan.unit_indices[0] - 3) : plan.unit_indices[0]]
        after = units[plan.unit_indices[-1] + 1 : plan.unit_indices[-1] + 4]
        speakers = Counter(u.speaker for u in us if u.speaker)
        pages = [u.page for u in us if u.page is not None]
        seg_id = "seg_" + short_hash([resource["id"], cs, ce, sha256_text(text)], 20)
        out.append(SegmentWork(
            id=seg_id, ordinal=ordinal, text=text, transcript_raw="\n".join(u.text_raw for u in us), unit_ids=[u.id for u in us],
            unit_offsets=[{"id": u.id, "start": u.char_start - cs, "end": u.char_end - cs, "start_ms": u.start_ms, "end_ms": u.end_ms, "page": u.page,
                           "speaker": u.speaker, "kind": u.kind, **({"non_speech": True} if u.meta.get("non_speech") else {})} for u in us],
            start_ms=us[0].start_ms, end_ms=us[-1].end_ms, page_start=min(pages) if pages else None, page_end=max(pages) if pages else None,
            char_start=cs, char_end=ce, heading=next((u.heading for u in us if u.heading), None), speaker=speakers.most_common(1)[0][0] if speakers else None,
            context_before=" ".join(u.text for u in before), context_after=" ".join(u.text for u in after), preceding_text=full_text[max(0, cs - 1500) : cs],
            topic_hint=plan.topic_hint, boundary_reason=plan.boundary_reason, content_hash=sha256_text(text),
            non_speech_ratio=round(sum(len(u.text) for u in us if u.meta.get("non_speech")) / max(1, sum(len(u.text) for u in us)), 3),
        ))
    return out


def _embed_segments(segments: list[SegmentWork], run_id: str) -> None:
    settings = get_settings()
    model = settings.gemini_embed_model
    with session_scope() as s:
        existing = fetch_all(s, "SELECT segment_id, purpose, content_hash, embedding::text AS vec FROM segment_embeddings WHERE segment_id = ANY(:ids) AND model = :m",
                             ids=[sg.id for sg in segments], m=model)
    cached = {(r["segment_id"], r["purpose"]): r for r in existing}
    for purpose, task in (("query", "RETRIEVAL_QUERY"), ("document", "RETRIEVAL_DOCUMENT")):
        todo = []
        for sg in segments:
            row = cached.get((sg.id, purpose))
            if row and row["content_hash"] == sg.content_hash:
                sg.embeddings[purpose] = (model, [float(x) for x in row["vec"].strip("[]").split(",")])
            else:
                todo.append(sg)
        if todo:
            texts = [((sg.heading + ". ") if sg.heading and purpose == "document" else "") + sg.text for sg in todo]
            vectors, used_model = get_llm().embed(texts, task, run_id=run_id)
            for sg, vec in zip(todo, vectors):
                sg.embeddings[purpose] = (used_model, vec)


def _run_metrics(run_id: str, segments: list[SegmentWork]) -> dict[str, Any]:
    mappings = [m for sg in segments for m in sg.mappings]
    hist = Counter(f"{int(min(m.confidence, 0.999) * 10) / 10:.1f}" for m in mappings)
    with session_scope() as s:
        calls = fetch_one(s, """SELECT count(*) AS calls, count(*) FILTER (WHERE cached) AS cached, coalesce(sum(prompt_tokens),0) AS prompt_tokens,
                                       coalesce(sum(output_tokens + thought_tokens),0) AS output_tokens, coalesce(sum(cost_usd),0)::float AS cost_usd,
                                       count(*) FILTER (WHERE status NOT IN ('ok','cached')) AS failures
                                FROM llm_calls WHERE run_id = :r""", r=run_id)
    return {
        "segments": len(segments),
        "mappings_by_type": dict(Counter(m.type for m in mappings)),
        "mappings_by_status": dict(Counter(m.review_status for m in mappings)),
        "confidence_histogram": dict(sorted(hist.items())),
        "ai": calls,
        "notes": [n for sg in segments for n in sg.notes][:50],
    }


def create_run(session, resource_id: str, triggered_by: str | None, options: dict[str, Any]) -> str:
    run_id = new_id("run")
    execute(session, "INSERT INTO processing_runs (id, resource_id, pipeline_version, status, options, triggered_by) VALUES (:id, :r, :v, 'queued', CAST(:o AS jsonb), :u)",
            id=run_id, r=resource_id, v=get_settings().pipeline_version, o=json_dumps(options), u=triggered_by)
    execute(session, "UPDATE resources SET status = 'queued', last_run_id = :run, updated_at = now() WHERE id = :id", run=run_id, id=resource_id)
    return run_id
