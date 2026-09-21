"""Sermon visuals (stage 3 "Multimedia" and the stage 4 slide deck): AI images, a planned visual set, and the slide plan with
diagram enrichment (S-05) and scene images.

Ports ``app/api/image/route.ts`` (KIND_PROMPT_SUFFIX, KIND_AUTO_HINT), ``app/api/image-set/route.ts`` (planPrompts) and
``app/api/plan/route.ts`` (scene budget, reuse, STYLE_SUFFIX). Images are written under ``sermons/{user}/{sermon}/media/`` and
``.../plan/``; the database keeps storage keys and every response signs them (``url`` / ``visual.imageUrl``).

Scene images are generated once per distinct scene subject (slides that share a subject share the image) and remembered per
draft in ``provenance.scene_images`` (bounded), so redesigning a deck - or re-planning after a format change cleared the plan -
reuses them instead of paying again. Files that fall out of that cache are deleted.
"""
from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy.orm import Session

from ... import storage
from ...ai.llm import AIInvalidOutput, AIUnavailable, get_llm
from ...ai.schemas_sermons import ImagePromptOut, SlideEnrichmentOut
from ...db import execute, fetch_one, json_dumps
from ...ids import new_id
from ...security import Viewer
from ..bible import NotFound
from . import slides
from .catalog import DEFAULT_THEME, DEFAULT_TITLE, EXPORT_THEMES
from .store import latest_draft, owned_draft, owned_sermon, serialize_media, sermon_prefix, touch, with_image_urls
from .structured import draft_text, normalize_structured, structured_to_plain_text

log = logging.getLogger(__name__)

MEDIA_KINDS = ("image", "map", "timeline", "scripture_slide", "graphic")
IMAGE_PURPOSE = "IMG:sermon"
ASPECT_RATIO = "16:9"
IMAGE_THREADS = 3
SCENE_BUDGET = 8  # distinct AI scene images per deck (time + cost)
SCENE_CACHE_LIMIT = 24  # remembered scene images per draft
SET_MIN, SET_MAX = 2, 8

KIND_PROMPT_SUFFIX: dict[str, str] = {
    "image": "Masterful cinematic Christian fine-art illustration in the style of a classical oil painting. Dramatic chiaroscuro lighting with golden-hour rim light, volumetric god rays, deep navy-and-gold color grading, rich texture and painterly brushwork, epic composition with strong foreground depth, museum quality, 8k detail. Suitable for a large worship screen.",
    "map": "Exquisite hand-drawn biblical map in the style of an antique 17th-century cartographer. Aged parchment texture, warm sepia and gold-leaf tones, ornate compass rose, elegant serif labels on key locations, decorative border flourishes, subtle terrain shading, museum-archive quality.",
    "timeline": "Elegant biblical timeline infographic with a refined editorial design. Deep navy background, luminous gold accent lines and markers, classical serif typography, small painterly vignette illustrations at each event, balanced composition with generous spacing, premium print quality.",
    "scripture_slide": "Breathtaking scripture slide. Deep navy gradient background with subtle volumetric light rays from above, only the Scripture reference (book, chapter and verse numbers) set in elegant gold serif lettering with refined letterspacing - do not write out the verse text itself - delicate gold flourish ornaments framing a calm central space, faint dove or cross silhouette in the atmosphere, premium worship-screen quality.",
    "graphic": "Premium sermon title graphic with sophisticated church branding. Deep navy backdrop, luminous gold serif title treatment as the focal point, subtle radial glow behind the type, delicate ornamental line flourishes, cinematic atmosphere, polished and modern yet reverent, presentation-ready.",
}

KIND_AUTO_HINT: dict[str, str] = {
    "image": "action-based illustration or biblical scene",
    "map": "biblical location map or ancient Middle East geographical illustration",
    "timeline": "chronological timeline of biblical events or historical context relevant to the sermon",
    "scripture_slide": "scripture highlight slide featuring a key verse from the sermon",
    "graphic": "sermon title graphic or thematic banner for the sermon",
}

# Used when Gemini refuses an image because the requested lettering would reproduce existing text (finishReason=RECITATION,
# e.g. a Bible verse written out in full): the same subject and style is rendered once more without any lettering.
LETTERING_FREE_SUFFIX: dict[str, str] = {
    "scripture_slide": "Scripture slide background: deep navy gradient with subtle volumetric light rays from above, delicate gold flourish "
                       "ornaments framing an empty central space for the verse, faint dove or cross silhouette in the atmosphere, premium "
                       "worship-screen quality. No text, no letters, no words.",
    "graphic": "Sermon title graphic background: deep navy backdrop, subtle radial glow, delicate gold ornamental line flourishes around an "
               "empty central space for the title, cinematic, reverent and modern. No text, no letters, no words.",
}

CINEMATIC = ("Masterful cinematic Christian fine-art illustration in the style of a classical oil painting. Dramatic chiaroscuro lighting with golden-hour "
             "rim light, volumetric god rays, deep navy-and-gold color grading, rich painterly texture, epic composition with strong foreground depth, "
             "museum quality. No text, no words, no lettering.")
STYLE_SUFFIX = "Cinematic, reverent Christian fine-art illustration; dramatic light, painterly depth, museum quality. No text, no letters, no words."
_NO_TEXT = re.compile(r"no text|no letters|no words", re.I)
_EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/gif": "gif"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _data(text: str | None) -> str:
    return (text or "").replace("<<<", "‹‹‹").replace(">>>", "›››")


def image_extension(mime_type: str | None) -> str:
    return _EXTENSIONS.get((mime_type or "").split(";")[0].strip().lower(), "png")


def _parallel(items: list[Any], fn: Callable[[Any], Any], workers: int = IMAGE_THREADS) -> list[tuple[bool, Any]]:
    """Run ``fn`` over ``items`` on up to ``workers`` threads; each result is (ok, value-or-exception), in input order."""
    if not items:
        return []
    out: list[tuple[bool, Any]] = []
    with ThreadPoolExecutor(max_workers=max(1, min(workers, len(items)))) as pool:
        for future in [pool.submit(fn, item) for item in items]:
            try:
                out.append((True, future.result()))
            except Exception as exc:  # noqa: BLE001 - partial failures are tolerated and counted
                log.warning("sermon image generation failed: %s", exc)
                out.append((False, exc))
    return out


def _mark_multimedia(session: Session, sermon_id: str) -> None:
    execute(session, "UPDATE sermons SET status = CASE WHEN status = 'polished' THEN 'multimedia' ELSE status END, updated_at = now() WHERE id = :id", id=sermon_id)


# ---------------------------------------------------------------------------------------------- single image
def generate_media(session: Session, viewer: Viewer, sermon_id: str, *, kind: str = "image", prompt: str | None = None, auto_prompt: bool = False,
                   high_quality: bool = False, regenerate_id: str | None = None) -> dict[str, Any]:
    sermon = owned_sermon(session, viewer, sermon_id)
    if kind not in MEDIA_KINDS:
        raise ValueError(f"kind must be one of: {', '.join(MEDIA_KINDS)}")
    prompt = (prompt or "").strip()
    if not prompt and not auto_prompt:
        raise ValueError("Describe the image or turn on auto prompt")
    old = None
    if regenerate_id:
        old = fetch_one(session, "SELECT * FROM sermon_media WHERE id = :m AND sermon_id = :s", m=regenerate_id, s=sermon_id)
        if not old:
            raise NotFound("media not found")
    llm = get_llm()
    if not llm.available:
        raise AIUnavailable("Image generation needs the Gemini API key to be configured on the server.")
    prompt_provenance = None
    if auto_prompt:
        text = draft_text(latest_draft(session, sermon_id))
        if not text.strip():
            raise ValueError("Generate the sermon draft first")
        session.commit()
        suggestion = llm.run("S-06", {
            "visual_hint": KIND_AUTO_HINT[kind], "focus": _data(prompt) or "(none)",
            "sermon": _data(f"TITLE: {sermon['title']}\n\n{text[:2000]}"),
        }, ImagePromptOut, use_cache=False, run_id=sermon_id)
        prompt = suggestion.output.prompt.strip()
        if not prompt:
            raise AIInvalidOutput("Could not suggest an image prompt — please type one or try again")
        prompt_provenance = suggestion.provenance()
    session.commit()  # no transaction is held while the image renders
    subject = prompt.rstrip(" .")
    try:
        result = llm.image(f"{subject}. {KIND_PROMPT_SUFFIX[kind]}", IMAGE_PURPOSE, high_quality=high_quality, aspect_ratio=ASPECT_RATIO, run_id=sermon_id)
    except AIUnavailable as exc:
        if "RECITATION" not in str(exc):
            raise
        log.info("image refused as recitation; rendering %s without lettering", kind)
        result = llm.image(f"{subject}. {LETTERING_FREE_SUFFIX.get(kind, CINEMATIC)}", IMAGE_PURPOSE, high_quality=high_quality,
                           aspect_ratio=ASPECT_RATIO, run_id=sermon_id)
    key = f"{sermon_prefix(viewer.user_id, sermon_id)}/media/{new_id('img')}.{image_extension(result.mime_type)}"
    storage.put_bytes(key, result.data)
    provenance = {"model": result.model, "purpose": IMAGE_PURPOSE, "high_quality": high_quality, "aspect_ratio": ASPECT_RATIO,
                  "auto_prompt": auto_prompt, "prompt_provenance": prompt_provenance, "generated_at": _now()}
    replaced_key = None
    try:
        owned_sermon(session, viewer, sermon_id, lock=True)  # media writers of a sermon are serialised by this lock
        row = None
        current = fetch_one(session, "SELECT storage_key FROM sermon_media WHERE id = :id AND sermon_id = :s", id=old["id"], s=sermon_id) if old else None
        if current:  # replace the image in place: same row, same position
            replaced_key = current["storage_key"]
            row = fetch_one(session, """UPDATE sermon_media SET kind = :kind, prompt = :prompt, storage_key = :key, mime_type = :mime, provenance = CAST(:prov AS jsonb)
                                        WHERE id = :id AND sermon_id = :s RETURNING *""",
                            kind=kind, prompt=prompt, key=key, mime=result.mime_type, prov=json_dumps(provenance), id=old["id"], s=sermon_id)
        if row is None:  # a new image (or the image to replace was deleted meanwhile)
            row = fetch_one(session, """INSERT INTO sermon_media (id, sermon_id, kind, prompt, storage_key, mime_type, order_index, provenance)
                                        VALUES (:id, :s, :kind, :prompt, :key, :mime,
                                                (SELECT coalesce(max(order_index) + 1, 0) FROM sermon_media WHERE sermon_id = :s), CAST(:prov AS jsonb))
                                        RETURNING *""",
                            id=new_id("med"), s=sermon_id, kind=kind, prompt=prompt, key=key, mime=result.mime_type, prov=json_dumps(provenance))
        _mark_multimedia(session, sermon_id)
        session.commit()
    except BaseException:
        storage.delete_key(key)
        raise
    if replaced_key and replaced_key != key:
        storage.delete_key(replaced_key)  # only once the new image is saved and recorded
    return {"media": serialize_media(row)}


# ---------------------------------------------------------------------------------------------- visual set
def plan_prompts(s: dict[str, Any], max_items: int) -> list[dict[str, Any]]:
    """An establishing scene, the key Scripture, then one scene per main point."""
    title = s.get("title") or DEFAULT_TITLE
    theme = s.get("theme") or title
    plan = [{"kind": "image", "caption": title,
             "prompt": f'A sweeping establishing scene that captures the heart of a sermon titled "{title}". Theme: {theme}. {CINEMATIC}'}]
    scripture = s.get("scripture") or ""
    if scripture:
        plan.append({"kind": "scripture_slide", "caption": slides.ref_of(scripture) or scripture.split("\n")[0][:80],
                     "prompt": f"A reverent biblical scene evoking this passage: {scripture[:220]}. {CINEMATIC}"})
    for point in s.get("main_points") or []:
        plan.append({"kind": "image", "caption": point.get("heading") or None,
                     "prompt": f'A vivid biblical scene illustrating the message "{point.get("heading") or ""}": {(point.get("body") or "")[:180]}. {CINEMATIC}'})
    return plan[:max_items]


def generate_media_set(session: Session, viewer: Viewer, sermon_id: str, *, count: int = 6, high_quality: bool = False) -> dict[str, Any]:
    sermon = owned_sermon(session, viewer, sermon_id)
    draft = latest_draft(session, sermon_id)
    if not draft or not draft.get("structured"):
        raise ValueError("Generate the sermon draft first")
    plan = plan_prompts(normalize_structured(draft["structured"], sermon["title"] or DEFAULT_TITLE), max(SET_MIN, min(SET_MAX, int(count))))
    llm = get_llm()
    if not llm.available:
        raise AIUnavailable("Image generation needs the Gemini API key to be configured on the server.")
    session.commit()
    prefix = sermon_prefix(viewer.user_id, sermon_id)

    def render(item: dict[str, Any]) -> dict[str, Any]:
        result = llm.image(item["prompt"], IMAGE_PURPOSE, high_quality=high_quality, aspect_ratio=ASPECT_RATIO, run_id=sermon_id)
        key = f"{prefix}/media/{new_id('img')}.{image_extension(result.mime_type)}"
        storage.put_bytes(key, result.data)
        return {**item, "key": key, "mime_type": result.mime_type, "model": result.model}

    done = [value for ok, value in _parallel(plan, render) if ok]
    if not done:
        raise AIInvalidOutput("Could not generate the visual set — please try again")
    try:
        owned_sermon(session, viewer, sermon_id, lock=True)
        base = fetch_one(session, "SELECT coalesce(max(order_index) + 1, 0) AS n FROM sermon_media WHERE sermon_id = :s", s=sermon_id)["n"]
        rows = []
        for offset, item in enumerate(done):  # plan order
            provenance = {"model": item["model"], "purpose": IMAGE_PURPOSE, "high_quality": high_quality, "aspect_ratio": ASPECT_RATIO, "visual_set": True, "generated_at": _now()}
            rows.append(fetch_one(session, """INSERT INTO sermon_media (id, sermon_id, kind, prompt, caption, storage_key, mime_type, order_index, provenance)
                                              VALUES (:id, :s, :kind, :prompt, :caption, :key, :mime, :order, CAST(:prov AS jsonb)) RETURNING *""",
                                  id=new_id("med"), s=sermon_id, kind=item["kind"], prompt=item["prompt"], caption=item["caption"], key=item["key"],
                                  mime=item["mime_type"], order=base + offset, prov=json_dumps(provenance)))
        _mark_multimedia(session, sermon_id)
        session.commit()
    except BaseException:
        for item in done:
            storage.delete_key(item["key"])
        raise
    return {"media": [serialize_media(r) for r in rows], "generated": len(done), "requested": len(plan)}


def update_media(session: Session, viewer: Viewer, sermon_id: str, media_id: str, caption: str | None) -> dict[str, Any]:
    owned_sermon(session, viewer, sermon_id, lock=True)
    value = (caption or "").strip()
    if len(value) > 300:
        raise ValueError("caption must be at most 300 characters")
    row = fetch_one(session, "UPDATE sermon_media SET caption = :c WHERE id = :m AND sermon_id = :s RETURNING *", c=value or None, m=media_id, s=sermon_id)
    if not row:
        raise NotFound("media not found")
    touch(session, sermon_id)
    return serialize_media(row)


def delete_media(session: Session, viewer: Viewer, sermon_id: str, media_id: str) -> dict[str, Any]:
    owned_sermon(session, viewer, sermon_id, lock=True)
    row = fetch_one(session, "DELETE FROM sermon_media WHERE id = :m AND sermon_id = :s RETURNING storage_key", m=media_id, s=sermon_id)
    if not row:
        raise NotFound("media not found")
    touch(session, sermon_id)
    session.commit()
    storage.delete_key(row["storage_key"])
    return {"ok": True}


# ---------------------------------------------------------------------------------------------- slide plan
def plan_scene_images(plan: Any) -> dict[str, str]:
    """scene subject -> storage key of the scene images in a plan."""
    out: dict[str, str] = {}
    if not isinstance(plan, dict):
        return out
    for slide in plan.get("slides") or []:
        visual = slide.get("visual") if isinstance(slide, dict) else None
        if isinstance(visual, dict) and visual.get("type") == "scene" and visual.get("imageKey"):
            out.setdefault(slides.scene_key(slide), visual["imageKey"])
    return out


def remember_scene_images(cache: dict[str, str] | None, *plans: Any) -> tuple[dict[str, str], list[str]]:
    """Merge the scene images of ``plans`` (newest first) into a draft's bounded reuse cache.

    Returns the new cache and the storage keys that are no longer kept (to delete once the database change is committed)."""
    candidates: dict[str, str] = {}
    every_key: set[str] = set()
    for source in [*(plan_scene_images(p) for p in plans), cache or {}]:
        for subject, key in source.items():
            if not isinstance(key, str) or not key:
                continue
            every_key.add(key)
            if subject not in candidates and storage.exists(key):
                candidates[subject] = key
    kept = dict(list(candidates.items())[:SCENE_CACHE_LIMIT])
    return kept, sorted(every_key - set(kept.values()))


def build_plan(session: Session, viewer: Viewer, sermon_id: str, *, theme_id: str | None = None, target_slide_count: int | None = None) -> dict[str, Any]:
    if theme_id is not None and theme_id not in EXPORT_THEMES:
        raise ValueError(f"theme_id must be one of: {', '.join(EXPORT_THEMES)}")
    sermon = owned_sermon(session, viewer, sermon_id)
    draft = latest_draft(session, sermon_id)
    if not draft or not draft.get("structured"):
        raise ValueError("Generate the sermon draft first")
    structured = normalize_structured(draft["structured"], sermon["title"] or DEFAULT_TITLE)
    theme = theme_id or sermon["export_template"] or DEFAULT_THEME
    plan = slides.build_content_plan(structured, theme, target_slide_count)  # the faithful spine: always valid
    reusable, _ = remember_scene_images((draft.get("provenance") or {}).get("scene_images"), draft.get("slide_plan"))
    llm = get_llm()
    session.commit()

    # content-aware diagrams only ADD slides; if the enrichment fails the content deck stands on its own
    enrichment: dict[str, Any] | None = None
    if llm.available:
        points = "\n".join(f"{i}. {p.get('heading') or '(untitled point)'}" for i, p in enumerate(structured["main_points"], start=1)) or "(no main points)"
        try:
            result = llm.run("S-05", {"language": sermon["language"], "points": _data(points), "sermon": _data(structured_to_plain_text(structured)[:9000])},
                             SlideEnrichmentOut, use_cache=False, run_id=sermon_id)
            before = len(plan["slides"])
            plan = slides.merge_enrichments(plan, [v.model_dump() for v in result.output.visuals])
            enrichment = {**result.provenance(), "slides_added": len(plan["slides"]) - before}
        except (AIUnavailable, AIInvalidOutput) as exc:
            log.warning("slide enrichment failed (keeping the content deck): %s", exc)
            enrichment = {"error": str(exc)[:300]}

    # one image per distinct scene subject, within the budget; reuse what this draft already paid for
    groups: dict[str, list[int]] = {}
    for index, slide in enumerate(plan["slides"]):
        if (slide.get("visual") or {}).get("type") != "scene":
            continue
        subject = slides.scene_key(slide)
        if subject not in groups:
            if len(groups) >= SCENE_BUDGET:
                continue
            groups[subject] = []
        groups[subject].append(index)
    reused = generated = failed = 0
    pending: list[tuple[str, list[int]]] = []
    for subject, indexes in groups.items():
        if subject and subject in reusable:
            for i in indexes:
                plan["slides"][i]["visual"]["imageKey"] = reusable[subject]
            reused += 1
        else:
            pending.append((subject, indexes))
    new_keys: list[str] = []
    if pending and not llm.available:
        failed = len(pending)
    elif pending:
        prefix = sermon_prefix(viewer.user_id, sermon_id)

        def render(entry: tuple[str, list[int]]) -> str:
            _, indexes = entry
            first = plan["slides"][indexes[0]]
            visual = first["visual"]
            base = (visual.get("prompt") or visual.get("spec") or first.get("heading") or structured["theme"] or structured["title"]).strip()
            prompt = base if _NO_TEXT.search(base) else f"{base}. {STYLE_SUFFIX}"
            high_quality = any(plan["slides"][i]["visual"].get("highQuality") for i in indexes)
            result = llm.image(prompt, IMAGE_PURPOSE, high_quality=high_quality, aspect_ratio=ASPECT_RATIO, run_id=sermon_id)
            key = f"{prefix}/plan/{new_id('scn')}.{image_extension(result.mime_type)}"
            storage.put_bytes(key, result.data)
            return key

        for (_, indexes), (ok, value) in zip(pending, _parallel(pending, render)):
            if ok:
                new_keys.append(value)
                for i in indexes:
                    plan["slides"][i]["visual"]["imageKey"] = value
                generated += 1
            else:
                failed += 1
    counts = {"scenes_generated": generated, "scenes_reused": reused, "scenes_requested": len(groups), "scenes_failed": failed}

    try:
        owned_sermon(session, viewer, sermon_id, lock=True)
        current = owned_draft(session, sermon_id, draft["id"], lock=True)
        provenance = dict(current.get("provenance") or {})
        scene_images, evicted = remember_scene_images(provenance.get("scene_images"), plan, current.get("slide_plan"))
        provenance["scene_images"] = scene_images
        provenance["slide_plan"] = {"generated_at": _now(), "theme": theme, "target_slide_count": target_slide_count, "enrichment": enrichment, **counts}
        execute(session, "UPDATE sermon_drafts SET slide_plan = CAST(:plan AS jsonb), provenance = CAST(:prov AS jsonb), updated_at = now() WHERE id = :id",
                plan=json_dumps(plan), prov=json_dumps(provenance), id=current["id"])
        touch(session, sermon_id)
        session.commit()
    except BaseException:
        for key in new_keys:
            storage.delete_key(key)
        raise
    for key in evicted:
        storage.delete_key(key)
    return {"plan": with_image_urls(plan), **counts}
