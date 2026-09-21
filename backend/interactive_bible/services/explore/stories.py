"""AI story videos for atlas events: a narrated script (E-02), one illustration per scene and a narration track,
produced by the ``generate_story`` job and kept per event and image format (landscape 16:9 / portrait 9:16).

``explore_stories.manifest`` stores storage keys only; the public manifest with signed file URLs is built at read
time. Every generation writes its files to its own directory (``explore/stories/{event}/{format}/{gen_id}/``), so a
regeneration never touches the story currently being served; the previous generation's files are removed only
after the new manifest has been committed.
"""
from __future__ import annotations

import io
import json
import logging
import re
import wave
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from sqlalchemy.orm import Session

from ... import jobs, storage
from ...ai.gemini import MediaResult
from ...ai.llm import AIUnavailable, LLMService, get_llm
from ...ai.schemas_explore import StoryScene, StoryScriptOut
from ...db import execute, fetch_all, fetch_one, session_scope
from ...ids import new_id
from ...security import Viewer
from ..bible import NotFound
from . import data
from .common import image_extension, storage_segment, utc_now_iso

log = logging.getLogger(__name__)

FORMATS = ("landscape", "portrait")
ASPECT_RATIOS = {"landscape": "16:9", "portrait": "9:16"}
MIN_SCENES, MAX_SCENES, DEFAULT_SCENES = 3, 6, 4
IMAGE_CONCURRENCY = 2
IMAGE_PURPOSE, SPEECH_PURPOSE = "IMG:explore", "TTS:explore"
NARRATION_STYLE = "Narrate in a warm, calm, reverent Bible documentary narrator voice"
SCRIPT_IMAGE_HINTS = {
    "portrait": "detailed 9:16 VERTICAL portrait illustrated scene prompt: tall composition, full-figure or close-up subjects, sky at top, "
                "ground at bottom, warm parchment palette, cinematic, no text overlays, no gore, no modern objects",
    "landscape": "detailed 16:9 widescreen illustrated scene prompt, warm parchment palette, cinematic, no text overlays, no gore, no modern objects",
}
COMPOSITION_HINTS = {
    "portrait": "9:16 VERTICAL portrait composition, tall frame, subjects shown full-body or close-up, sky fills upper third, strong foreground detail.",
    "landscape": "16:9 widescreen horizontal composition, wide establishing shot, cinematic panorama.",
}
SCRIPT_EVENT_FIELDS = ("id", "title", "era", "timelineDate", "mapLocation", "references", "summary", "details", "mainPeople",
                       "lesson", "videoIdea", "route", "placeContext", "journey")
_GEN_ID = re.compile(r"^gen_[0-9a-z]{20}$")


def story_format(value: Any) -> str:
    if value not in FORMATS:
        raise ValueError("format must be 'landscape' or 'portrait'")
    return value


def story_dir(event_id: str, image_format: str, gen_id: str) -> str:
    return f"explore/stories/{event_id}/{image_format}/{gen_id}"


def video_key(event_id: str, image_format: str, gen_id: str) -> str:
    return f"explore/videos/{event_id}/{image_format}/{gen_id}.mp4"


def dedupe_key(event_id: str, image_format: str) -> str:
    return f"story:{event_id}:{image_format}"


def story_row(session: Session, event_id: str, image_format: str) -> dict[str, Any] | None:
    return fetch_one(session, "SELECT * FROM explore_stories WHERE event_id = :e AND image_format = :f", e=event_id, f=image_format)


def scene_image_prompt(image_prompt: str, image_format: str) -> str:
    return (f"{image_prompt}\n\nArt direction: premium illustrated Bible storybook, parchment palette, warm golden-hour light, "
            f"soft painterly detail, reverent and educational. {COMPOSITION_HINTS[image_format]} No text overlays, no watermarks, no modern objects.")


# ---------------------------------------------------------------------------------------------- read
def manifest(row: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
    """Public story manifest: signed URLs for the files that exist, built from the stored keys."""
    stored = row["manifest"] or {}

    def url(key: Any) -> str | None:
        return storage.signed_url(key) if isinstance(key, str) and key and storage.exists(key) else None

    audio_url = url(stored.get("audioKey"))
    return {
        "mode": row["mode"],
        "eventId": row["event_id"],
        "generatedAt": stored.get("generatedAt") or row["updated_at"],
        "imageFormat": row["image_format"],
        "title": row["title"],
        "reference": stored.get("reference") or "",
        "narration": stored.get("narration") or "",
        "audioUrl": audio_url,
        "durationSeconds": stored.get("durationSeconds") if audio_url else None,
        "scenes": [{
            "title": scene.get("title") or "",
            "durationSec": scene.get("durationSec"),
            "narration": scene.get("narration") or "",
            "imagePrompt": scene.get("imagePrompt") or "",
            "imageUrl": url(scene.get("imageKey")),
        } for scene in stored.get("scenes") or []],
        "quiz": [{"question": q.get("question") or "", "answer": q.get("answer") or ""} for q in stored.get("quiz") or []],
        "event": data.event_brief(event),
    }


def get_story(session: Session, event_id: str, image_format: str = "landscape") -> dict[str, Any]:
    event = data.get_event(event_id)
    row = story_row(session, event_id, story_format(image_format))
    if not row:
        raise NotFound("no story has been generated for this event yet")
    return manifest(row, event)


def _job_visible(job: dict[str, Any], viewer: Viewer) -> bool:
    """Job ids are only useful to whoever may poll /v1/jobs/{id}: the requester (or staff)."""
    return viewer.is_editor or (viewer.user_id is not None and (job.get("payload") or {}).get("requested_by") == viewer.user_id)


def active_story_jobs(session: Session, event_id: str) -> list[dict[str, Any]]:
    return fetch_all(session, """SELECT id, status, progress, payload, created_at FROM jobs
                                 WHERE dedupe_key = ANY(:keys) AND type = 'generate_story' AND status IN ('queued', 'running')
                                 ORDER BY created_at DESC""", keys=[dedupe_key(event_id, f) for f in FORMATS])


def story_meta(session: Session, viewer: Viewer, event_id: str) -> dict[str, Any]:
    data.get_event(event_id)
    rows = {r["image_format"]: r for r in fetch_all(session, """SELECT image_format, scene_count, has_audio, mode, updated_at,
                                                                   manifest->>'generatedAt' AS generated_at
                                                               FROM explore_stories WHERE event_id = :e""", e=event_id)}
    active = active_story_jobs(session, event_id)
    formats = {}
    for fmt in FORMATS:
        row = rows.get(fmt)
        formats[fmt] = {
            "cached": row is not None,
            "sceneCount": row["scene_count"] if row else 0,
            "hasAudio": bool(row and row["has_audio"]),
            "generatedAt": (row["generated_at"] or row["updated_at"]) if row else None,
            "mode": row["mode"] if row else None,
            "generating": any((j["payload"] or {}).get("image_format") == fmt for j in active),
        }
    mine = next((j for j in active if _job_visible(j, viewer)), None)
    job = {"job_id": mine["id"], "format": (mine["payload"] or {}).get("image_format"), "status": mine["status"], "progress": mine["progress"]} if mine else None
    return {"eventId": event_id, "formats": formats, "job": job, "generating": bool(active)}


# ---------------------------------------------------------------------------------------------- request
def request_story(session: Session, viewer: Viewer, event_id: str, scene_count: int = DEFAULT_SCENES, force: bool = False,
                  image_format: str = "landscape") -> tuple[int, dict[str, Any]]:
    """(200, {status: ready, story}) when a story exists and force is false, else (202, {status: queued, job_id})."""
    event = data.get_event(event_id)
    storage_segment(event["id"])
    fmt = story_format(image_format)
    if not MIN_SCENES <= scene_count <= MAX_SCENES:
        raise ValueError(f"sceneCount must be between {MIN_SCENES} and {MAX_SCENES}")
    if not force:
        row = story_row(session, event_id, fmt)
        if row:
            return 200, {"status": "ready", "story": manifest(row, event)}
    key = dedupe_key(event_id, fmt)
    job = fetch_one(session, "SELECT id, payload FROM jobs WHERE dedupe_key = :dk AND status IN ('queued', 'running')", dk=key)
    if job is None:
        if not get_llm().available:
            raise AIUnavailable("GEMINI_API_KEY is not configured")
        job_id = jobs.enqueue(session, "generate_story", {
            "event_id": event_id, "image_format": fmt, "scene_count": scene_count, "force": force, "requested_by": viewer.user_id,
        }, dedupe_key=key)
        job = fetch_one(session, "SELECT id, payload FROM jobs WHERE id = :id", id=job_id) if job_id else None
    if job is not None and _job_visible(job, viewer):
        return 202, {"status": "queued", "job_id": job["id"]}
    # someone else's generation of this story is already running: the UI follows it through story/meta
    return 202, {"status": "queued", "job_id": None, "generating": True}


# ---------------------------------------------------------------------------------------------- job
def generate_story(payload: dict[str, Any]) -> dict[str, Any]:
    """``generate_story`` job: script -> scene images (2 in parallel, one retry each) -> narration -> save."""
    event = data.get_event(payload["event_id"])
    event_id = storage_segment(event["id"])
    fmt = story_format(payload.get("image_format", "landscape"))
    scene_count = min(MAX_SCENES, max(MIN_SCENES, int(payload.get("scene_count") or DEFAULT_SCENES)))
    force = bool(payload.get("force"))
    if not force:
        with session_scope() as s:
            existing = story_row(s, event_id, fmt)
        if existing:  # already generated (e.g. an earlier attempt of this job committed before it was interrupted)
            return _result(existing, reused=True)

    llm = get_llm()
    jobs.report_progress("script", message="Writing the story script")
    script_result = llm.run("E-02", {
        "scene_count": scene_count,
        "image_format": fmt,
        "image_hint": SCRIPT_IMAGE_HINTS[fmt],
        "event": json.dumps({k: event[k] for k in SCRIPT_EVENT_FIELDS if event.get(k) not in (None, "", [], {})}, ensure_ascii=False, indent=2),
    }, StoryScriptOut, use_cache=not force)
    script = script_result.output
    scenes = script.scenes[:scene_count]
    if len(scenes) < MIN_SCENES:
        raise ValueError(f"the story script has {len(scenes)} scenes; at least {MIN_SCENES} are needed")

    gen_id = new_id("gen")
    prefix = story_dir(event_id, fmt, gen_id)
    try:
        images, image_errors = _paint_scenes(llm, scenes, fmt, prefix)
        audio, audio_error = _record_narration(llm, script.narration, prefix)
        if not any(images) and audio is None:
            last_error = audio_error or (image_errors[-1] if image_errors else "unknown error")
            raise AIUnavailable(f"story generation failed: no scene image or narration could be generated ({last_error})")
        jobs.report_progress("saving", message="Saving the story")
        mode = "gemini" if all(images) and audio is not None else "partial"
        stored = {
            "version": 1,
            "genId": gen_id,
            "generatedAt": utc_now_iso(),
            "reference": script.reference or ", ".join(event.get("references") or []),
            "narration": script.narration,
            "audioKey": audio["key"] if audio else None,
            "durationSeconds": audio["seconds"] if audio else None,
            "scenes": [{**scene.model_dump(), "imageKey": image["key"] if image else None} for scene, image in zip(scenes, images, strict=True)],
            "quiz": [q.model_dump() for q in script.quiz],
            "provenance": {
                "script": script_result.provenance(),
                "image_models": sorted({image["model"] for image in images if image}),
                "tts_model": audio["model"] if audio else None,
            },
        }
        _save(event_id, fmt, script.title or event.get("title") or event_id, stored, len(scenes), audio is not None, mode, payload.get("requested_by"))
    except BaseException:
        storage.delete_prefix(prefix)
        raise
    remove_older_generations(event_id, fmt, gen_id)  # only after the new manifest is committed
    return {"event_id": event_id, "image_format": fmt, "scene_count": len(scenes), "has_audio": audio is not None, "mode": mode,
            "generation_id": gen_id, "images_generated": sum(1 for image in images if image)}


def remove_older_generations(event_id: str, image_format: str, current_gen: str) -> None:
    """Delete the files of the generation that was replaced, and of any attempt left behind by an interrupted job, with
    their cached videos. Generation ids sort by creation time."""
    for base, suffix in ((f"explore/stories/{event_id}/{image_format}", ""), (f"explore/videos/{event_id}/{image_format}", ".mp4")):
        folder = storage.path_for(base)
        if not folder.is_dir():
            continue
        for child in folder.iterdir():
            gen = child.name.removesuffix(suffix) if suffix else child.name
            if not (_GEN_ID.fullmatch(gen) and gen < current_gen and (child.is_dir() != bool(suffix))):
                continue
            if child.is_dir():
                storage.delete_prefix(f"{base}/{child.name}")
            else:
                storage.delete_key(f"{base}/{child.name}")


def _result(row: dict[str, Any], reused: bool = False) -> dict[str, Any]:
    return {"event_id": row["event_id"], "image_format": row["image_format"], "scene_count": row["scene_count"], "has_audio": row["has_audio"],
            "mode": row["mode"], "generation_id": (row["manifest"] or {}).get("genId"), "reused": reused}


def _permanent(exc: Exception) -> bool:
    message = str(exc)
    return "not configured" in message or "budget" in message


def _scene_image(llm: LLMService, prompt: str, aspect_ratio: str) -> MediaResult:
    try:
        return llm.image(prompt, IMAGE_PURPOSE, aspect_ratio=aspect_ratio)
    except AIUnavailable as exc:
        if _permanent(exc):
            raise
        log.info("story scene image failed, retrying once: %s", exc)
        return llm.image(prompt, IMAGE_PURPOSE, aspect_ratio=aspect_ratio)


def _paint_scenes(llm: LLMService, scenes: list[StoryScene], image_format: str, prefix: str) -> tuple[list[dict[str, Any] | None], list[str]]:
    total = len(scenes)
    images: list[dict[str, Any] | None] = [None] * total
    errors: list[str] = []
    jobs.report_progress("images", 0, total, f"Painting {total} scenes")
    with ThreadPoolExecutor(max_workers=max(1, IMAGE_CONCURRENCY), thread_name_prefix="story-image") as pool:
        futures = {pool.submit(_scene_image, llm, scene_image_prompt(scene.imagePrompt, image_format), ASPECT_RATIOS[image_format]): i
                   for i, scene in enumerate(scenes)}
        for done, future in enumerate(as_completed(futures), start=1):
            index = futures[future]
            try:
                image = future.result()
            except AIUnavailable as exc:  # the scene keeps no image; the story becomes "partial"
                log.warning("story scene %d has no image: %s", index + 1, exc)
                errors.append(str(exc))
            else:
                ext = image_extension(image.mime_type, image.data)
                images[index] = {"key": storage.put_bytes(f"{prefix}/scene-{index + 1}.{ext}", image.data), "model": image.model}
            # progress is reported from this thread: the job context (job id) is not visible inside pool threads
            jobs.report_progress("images", done, total, f"Painted {done} of {total} scenes")
    return images, errors


def _record_narration(llm: LLMService, text: str, prefix: str) -> tuple[dict[str, Any] | None, str | None]:
    jobs.report_progress("narration", message="Recording the narration")
    try:
        speech = llm.speech(text, SPEECH_PURPOSE, style=NARRATION_STYLE)
    except AIUnavailable as exc:
        log.warning("story narration failed, continuing without audio: %s", exc)
        return None, str(exc)
    key = storage.put_bytes(f"{prefix}/narration.wav", speech.data)
    return {"key": key, "seconds": speech.duration_seconds or wav_seconds(speech.data), "model": speech.model}, None


def wav_seconds(data_bytes: bytes) -> float | None:
    try:
        with wave.open(io.BytesIO(data_bytes)) as w:
            return round(w.getnframes() / float(w.getframerate()), 3)
    except (wave.Error, EOFError, ZeroDivisionError):
        return None


def _save(event_id: str, image_format: str, title: str, stored: dict[str, Any], scene_count: int, has_audio: bool, mode: str,
          requested_by: str | None) -> None:
    with session_scope() as s:
        execute(s, """INSERT INTO explore_stories (event_id, image_format, title, manifest, scene_count, has_audio, mode, generated_by)
                      VALUES (:e, :f, :t, CAST(:m AS jsonb), :n, :a, :mode, (SELECT id FROM users WHERE id = :u))
                      ON CONFLICT (event_id, image_format) DO UPDATE SET title = EXCLUDED.title, manifest = EXCLUDED.manifest,
                          scene_count = EXCLUDED.scene_count, has_audio = EXCLUDED.has_audio, mode = EXCLUDED.mode,
                          generated_by = EXCLUDED.generated_by, updated_at = now()""",
                e=event_id, f=image_format, t=title, m=json.dumps(stored, ensure_ascii=False), n=scene_count, a=has_audio, mode=mode, u=requested_by)
