"""Interactive Bible App HTTP API."""
from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from sqlalchemy.orm import Session

from .. import cache
from ..ai.llm import AIInvalidOutput, AIUnavailable
from ..bible import books as B
from ..bible.refparser import find_query_references, parse_query_reference
from ..config import get_settings
from ..db import execute, fetch_one, json_dumps
from ..ingest.validate import UploadRejected
from ..logging_setup import request_id_var, setup_logging
from ..security import Viewer, hash_password, issue_token, verify_password
from ..services import ask as ask_service
from ..services import bible as bible_service
from ..services import clips as clip_service
from ..services import feedback as feedback_service
from ..services import intelligence, metrics, related, resources, review, scripture_map, search as search_service
from ..services.bible import NotFound
from ..services.embeddings import embedding_progress, ensure_embedding_job
from ..services.resources import Forbidden
from . import schemas as S
from .util import json_safe
from .deps import client_key, get_session, get_viewer, owner_access, rate_limit, require_editor, require_user

log = logging.getLogger("interactive_bible.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    from ..db import session_scope

    try:
        with session_scope() as s:
            cache.ensure_scopes(s)
        if get_settings().embed_bible_on_start:
            ensure_embedding_job()
    except Exception:  # noqa: BLE001
        log.exception("startup checks failed (is the database running and migrated?)")
    yield


app = FastAPI(title="Interactive Bible App API", version="1.0.0", lifespan=lifespan,
              description="Scripture intelligence: resource ingestion, verse tagging, Verse Intelligence, Scripture Map, semantic search, editorial review.")
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origin_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def request_context(request: Request, call_next):
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    token = request_id_var.set(rid)
    t0 = time.monotonic()
    try:
        response = await call_next(request)
    finally:
        request_id_var.reset(token)
    response.headers["x-request-id"] = rid
    response.headers["server-timing"] = f"app;dur={(time.monotonic() - t0) * 1000:.1f}"
    return response


@app.exception_handler(NotFound)
async def _not_found(_: Request, exc: NotFound):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(Forbidden)
async def _forbidden(_: Request, exc: Forbidden):
    return JSONResponse(status_code=403, content={"detail": str(exc)})


@app.exception_handler(UploadRejected)
async def _rejected(_: Request, exc: UploadRejected):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(ValueError)
async def _value_error(_: Request, exc: ValueError):
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.exception_handler(AIUnavailable)
async def _ai_unavailable(_: Request, exc: AIUnavailable):
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.exception_handler(AIInvalidOutput)
async def _ai_invalid(_: Request, exc: AIInvalidOutput):
    return JSONResponse(status_code=502, content={"detail": str(exc)})


v1 = APIRouter(prefix="/v1")
admin = APIRouter(prefix="/v1/admin", dependencies=[Depends(require_editor)])


# ----------------------------------------------------------------------------- auth
@v1.post("/auth/login", tags=["auth"], dependencies=[Depends(rate_limit("login", 20))])
def login(body: S.LoginIn, session: Session = Depends(get_session)):
    user = fetch_one(session, "SELECT * FROM users WHERE lower(email) = lower(:e) AND is_active", e=body.email.strip())
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="invalid email or password")
    token = issue_token(user)
    resp = JSONResponse({"token": token, "user": {"id": user["id"], "email": user["email"], "display_name": user["display_name"], "role": user["role"]}})
    resp.set_cookie("ibible_token", token, httponly=True, samesite="lax", max_age=get_settings().token_ttl_hours * 3600)
    return resp


@v1.post("/auth/signup", tags=["auth"], status_code=201, dependencies=[Depends(rate_limit("signup", 10))])
def signup(body: S.SignupIn, session: Session = Depends(get_session)):
    import re

    from ..ids import new_id

    if not get_settings().allow_signup:
        raise HTTPException(status_code=403, detail="creating accounts is disabled on this server")
    email = body.email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=422, detail="enter a valid email address")
    if fetch_one(session, "SELECT id FROM users WHERE lower(email) = :e", e=email):
        raise HTTPException(status_code=409, detail="an account with this email already exists — sign in instead")
    uid = new_id("usr")
    execute(session, "INSERT INTO users (id, email, display_name, password_hash, role, church) VALUES (:id, :e, :n, :p, 'member', :c)",
            id=uid, e=email, n=body.display_name.strip(), p=hash_password(body.password), c=(body.church or "").strip() or None)
    user = fetch_one(session, "SELECT * FROM users WHERE id = :id", id=uid)
    token = issue_token(user)
    resp = JSONResponse(status_code=201, content={"token": token, "user": {"id": uid, "email": email, "display_name": user["display_name"], "role": "member"}})
    resp.set_cookie("ibible_token", token, httponly=True, samesite="lax", max_age=get_settings().token_ttl_hours * 3600)
    return resp


@v1.patch("/auth/me", tags=["auth"])
def update_profile(body: S.ProfileIn, session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    fields = body.model_dump(exclude_unset=True)
    if "display_name" in fields and fields["display_name"] is not None:
        execute(session, "UPDATE users SET display_name = :n WHERE id = :id", n=fields["display_name"].strip(), id=viewer.user_id)
    if "church" in fields:
        execute(session, "UPDATE users SET church = :c WHERE id = :id", c=(fields["church"] or "").strip() or None, id=viewer.user_id)
    if body.new_password:
        row = fetch_one(session, "SELECT password_hash FROM users WHERE id = :id", id=viewer.user_id)
        if not body.current_password or not verify_password(body.current_password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="current password is incorrect")
        execute(session, "UPDATE users SET password_hash = :p WHERE id = :id", p=hash_password(body.new_password), id=viewer.user_id)
    user = fetch_one(session, "SELECT id, email, display_name, role, church FROM users WHERE id = :id", id=viewer.user_id)
    return {"authenticated": True, **{k: user[k] for k in ("id", "email", "display_name", "role", "church")}, "organization_ids": viewer.org_ids}


@v1.post("/auth/logout", tags=["auth"])
def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("ibible_token")
    return resp


@v1.get("/auth/me", tags=["auth"])
def me(request: Request, viewer: Viewer = Depends(get_viewer), session: Session = Depends(get_session)):
    church = None
    if viewer.is_authenticated:
        church = (fetch_one(session, "SELECT church FROM users WHERE id = :id", id=viewer.user_id) or {}).get("church")
    single_user = owner_access(request) and viewer.user_id == get_settings().owner_user_id
    return {"authenticated": viewer.is_authenticated, **viewer.to_dict(), "church": church,
            "auth_mode": "single_user" if single_user else "accounts", "allow_signup": get_settings().allow_signup}


# ----------------------------------------------------------------------------- bible
@v1.get("/bible/translations", tags=["bible"])
def translations(session: Session = Depends(get_session)):
    return bible_service.translations(session)


@v1.get("/bible/books", tags=["bible"])
def books():
    return bible_service.books()


@v1.get("/bible/chapters/{book}/{chapter}", tags=["bible"])
def chapter(book: str, chapter: int, translation: str | None = None, session: Session = Depends(get_session), viewer: Viewer = Depends(get_viewer)):
    return bible_service.chapter(session, viewer, book, chapter, translation)


@v1.get("/bible/parse", tags=["bible"])
def parse_reference(q: str = Query(..., max_length=300)):
    refs = find_query_references(q)
    single = parse_query_reference(q)
    return {"query": q, "references": [r.to_dict() for r in refs], "canonical": B.canonical_range_str(single[0], single[1] if single and single[1] != single[0] else None) if single else None}


# ----------------------------------------------------------------------------- verses
@v1.get("/verses/{ref}/intelligence", tags=["verses"])
def verse_intelligence(ref: str, request: Request, translation: str | None = None, session: Session = Depends(get_session), viewer: Viewer = Depends(get_viewer)):
    payload = intelligence.verse_intelligence(session, viewer, ref, translation)
    execute(session, "INSERT INTO analytics_events (type, user_id, payload) VALUES ('verse_intelligence_view', :u, CAST(:p AS jsonb))",
            u=viewer.user_id, p=json_dumps({"ref": payload["verse"]["ref"], "cards": len(payload["top_resources"]), "cache": payload["provenance"]["cache"]}))
    etag = f'W/"{payload["verse"]["ref"]}-{payload["provenance"]["cache_version"]["global"]}-{payload["provenance"]["cache_version"]["verses"]}-{viewer.scope_key}-{payload["verse"]["translation"]}-{len(payload["related_verses"])}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"etag": etag})
    return JSONResponse(json_safe(payload), headers={"etag": etag, "cache-control": "private, max-age=30"})


@v1.get("/verses/{ref}/resources", tags=["verses"])
def verse_resources(ref: str, kind: str | None = Query(None, pattern="^(watch|listen|study)$"), relationship: str | None = None, human_verified: bool | None = None,
                    resource_type: str | None = None, sort: str = "relevance", page: int = 1, page_size: int = Query(20, le=100),
                    session: Session = Depends(get_session), viewer: Viewer = Depends(get_viewer)):
    return json_safe(intelligence.verse_resources(session, viewer, ref, kind, relationship, human_verified, resource_type, sort, page, page_size))


@v1.get("/verses/{ref}/related", tags=["verses"])
def verse_related(ref: str, limit: int = Query(24, le=60), session: Session = Depends(get_session), viewer: Viewer = Depends(get_viewer)):
    start, end = intelligence.resolve_ref(ref)
    return related.related_verses(session, viewer, start, end, limit)


@v1.get("/verses/{ref}/related/{to_ref}/why", tags=["verses"], dependencies=[Depends(rate_limit("why", 60))])
def why_related(ref: str, to_ref: str, session: Session = Depends(get_session), viewer: Viewer = Depends(get_viewer)):
    return related.why_related_now(session, viewer, intelligence.resolve_ref(ref), intelligence.resolve_ref(to_ref))


# ----------------------------------------------------------------------------- resources
@v1.post("/resources", tags=["resources"], status_code=201)
def create_resource(body: S.ResourceIn, session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    return json_safe(resources.create_resource(session, viewer, body.model_dump()))


@v1.get("/resources", tags=["resources"])
def list_resources(q: str | None = None, type: str | None = None, status: str | None = None, mine: bool = False, page: int = 1, page_size: int = Query(25, le=100),
                   session: Session = Depends(get_session), viewer: Viewer = Depends(get_viewer)):
    return json_safe(resources.list_resources(session, viewer, q, type, status, mine, page, page_size))


@v1.post("/resources/{resource_id}/upload", tags=["resources"], dependencies=[Depends(rate_limit("upload", 30))])
def upload(resource_id: str, file: UploadFile = File(...), kind: str = Form("source"), session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    if kind not in ("source", "captions"):
        raise HTTPException(status_code=422, detail="kind must be 'source' or 'captions'")
    return json_safe(resources.upload_file(session, viewer, resource_id, file.file, file.filename or "upload", kind))


@v1.post("/resources/inspect-url", tags=["resources"], dependencies=[Depends(rate_limit("inspect_url", 30))])
def inspect_url(body: S.UrlIn, viewer: Viewer = Depends(require_user)):
    """Read a public YouTube link (details + caption tracks) so the add-to-library form can be filled in before saving."""
    from ..ingest import youtube as yt
    from ..ingest.transcribe import youtube_id

    url = body.url.strip()
    if not youtube_id(url):
        raise HTTPException(status_code=422, detail="Paste a YouTube video link (youtube.com/watch?v=… or youtu.be/…). Other web pages can be added as an article.")
    info = yt.inspect(url)
    best = info.best_track()
    return {
        **info.public(),
        "captions_available": best is not None,
        "captions_kind": best.kind if best else None,
        "transcript_source": "captions" if best else "gemini",
        "suggested": {
            "type": "video", "category": "sermon", "title": info.title, "author": info.channel, "speaker": None,
            "duration_ms": info.duration_ms, "language": (info.language or "en").split("-")[0], "rights_status": "embed_only",
            "allow_clip_export": False, "url": info.url,
        },
    }


@v1.post("/resources/{resource_id}/process", tags=["resources"])
def process(resource_id: str, body: S.ProcessIn | None = None, session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    return resources.start_processing(session, viewer, resource_id, (body or S.ProcessIn()).model_dump())


@v1.get("/resources/{resource_id}/status", tags=["resources"])
def resource_status(resource_id: str, session: Session = Depends(get_session), viewer: Viewer = Depends(get_viewer)):
    return json_safe(resources.status(session, viewer, resource_id))


@v1.get("/resources/{resource_id}", tags=["resources"])
def resource_detail(resource_id: str, session: Session = Depends(get_session), viewer: Viewer = Depends(get_viewer)):
    return json_safe(resources.resource_detail(session, viewer, resource_id))


@v1.patch("/resources/{resource_id}", tags=["resources"])
def update_resource(resource_id: str, body: S.ResourcePatch, session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    return json_safe(resources.update_resource(session, viewer, resource_id, body.model_dump(exclude_unset=True)))


@v1.delete("/resources/{resource_id}", tags=["resources"])
def delete_resource(resource_id: str, session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    return resources.delete_resource(session, viewer, resource_id)


@v1.get("/resources/{resource_id}/segments", tags=["resources"])
def resource_segments(resource_id: str, include_mappings: bool = True, session: Session = Depends(get_session), viewer: Viewer = Depends(get_viewer)):
    return json_safe(resources.segments(session, viewer, resource_id, include_mappings))


@v1.get("/resources/{resource_id}/verse-links", tags=["resources"])
def resource_verse_links(resource_id: str, session: Session = Depends(get_session), viewer: Viewer = Depends(get_viewer)):
    return json_safe(resources.verse_links(session, viewer, resource_id))


@v1.get("/resources/{resource_id}/captions.vtt", tags=["resources"])
def resource_captions(resource_id: str, token: str | None = None, session: Session = Depends(get_session), viewer: Viewer = Depends(get_viewer)):
    return PlainTextResponse(resources.captions_vtt(session, resource_id, token, viewer), media_type="text/vtt")


@v1.get("/media/{resource_id}", tags=["resources"])
def media(resource_id: str, token: str | None = None, session: Session = Depends(get_session), viewer: Viewer = Depends(get_viewer)):
    path, mime = resources.media_file(session, resource_id, token, viewer)
    return FileResponse(path, media_type=mime or None, headers={"accept-ranges": "bytes", "cache-control": "private, max-age=3600"})


# ----------------------------------------------------------------------------- clips
@v1.get("/clips/{segment_id}", tags=["clips"])
def clip(segment_id: str, session: Session = Depends(get_session), viewer: Viewer = Depends(get_viewer)):
    return json_safe(clip_service.clip_details(session, viewer, segment_id))


@v1.post("/clips/{segment_id}/export", tags=["clips"], status_code=202)
def export_clip(segment_id: str, session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    return clip_service.request_export(session, viewer, segment_id)


DOWNLOADABLE_JOBS = ("export_clip", "export_story_video")


@v1.get("/jobs/{job_id}", tags=["jobs"])
def job_status(job_id: str, session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    job = fetch_one(session, "SELECT id, type, status, attempts, max_attempts, last_error, result, progress, created_at, updated_at, payload FROM jobs WHERE id = :id", id=job_id)
    if not job:
        raise NotFound("job not found")
    if not viewer.is_editor and (job["payload"] or {}).get("requested_by") != viewer.user_id:
        raise NotFound("job not found")
    out = {k: v for k, v in job.items() if k != "payload"}
    if job["type"] in DOWNLOADABLE_JOBS and job["status"] == "succeeded":
        out["download_url"] = f"/v1/jobs/{job_id}/download"
    return json_safe(out)


@v1.get("/jobs/{job_id}/download", tags=["jobs"])
def job_download(job_id: str, session: Session = Depends(get_session), viewer: Viewer = Depends(require_user)):
    from .. import storage

    job = fetch_one(session, "SELECT * FROM jobs WHERE id = :id AND type = ANY(:types) AND status = 'succeeded'", id=job_id, types=list(DOWNLOADABLE_JOBS))
    if not job or (not viewer.is_editor and job["payload"].get("requested_by") != viewer.user_id):
        raise NotFound("export not found")
    key = job["result"]["storage_key"]
    if not storage.exists(key):
        raise NotFound("the exported file is no longer available — export again")
    return FileResponse(storage.path_for(key), filename=job["result"].get("filename") or Path(key).name)


# ----------------------------------------------------------------------------- map / search / ask / feedback
@v1.get("/scripture-map", tags=["map"])
def get_scripture_map(root_type: str = Query("verse", pattern="^(verse|topic|resource|entity)$"), root_id: str = Query(...), depth: int = Query(1, ge=1, le=2),
                      types: str | None = None, direct_only: bool = False, explicit_only: bool = False, human_verified_only: bool = False,
                      session: Session = Depends(get_session), viewer: Viewer = Depends(get_viewer)):
    filters = {"types": [t for t in (types or "").split(",") if t], "direct_only": direct_only, "explicit_only": explicit_only, "human_verified_only": human_verified_only}
    return json_safe(scripture_map.scripture_map(session, viewer, root_type, root_id, filters, depth))


@v1.post("/search/scripture", tags=["search"], dependencies=[Depends(rate_limit("search", 60))])
def search(body: S.SearchIn, session: Session = Depends(get_session), viewer: Viewer = Depends(get_viewer)):
    return json_safe(search_service.search(session, viewer, body.query, body.scope, {"resource_types": body.resource_types, "no_rerank": body.no_rerank}, body.translation, body.limit))


@v1.post("/ask", tags=["ask"])
def ask(body: S.AskIn, request: Request, session: Session = Depends(get_session), viewer: Viewer = Depends(get_viewer)):
    from ..security import rate_limiter

    if not rate_limiter.allow(f"ask:{client_key(request, viewer)}", get_settings().ask_rate_limit_per_minute):
        raise HTTPException(status_code=429, detail="Ask AI rate limit reached; please wait a minute")
    return json_safe(ask_service.ask(session, viewer, body.ref, body.question, body.translation))


@v1.post("/feedback", tags=["feedback"], status_code=201, dependencies=[Depends(rate_limit("feedback", 30))])
def feedback(body: S.FeedbackIn, request: Request, session: Session = Depends(get_session), viewer: Viewer = Depends(get_viewer)):
    return feedback_service.submit(session, viewer, body.model_dump(), client_key(request, viewer))


@v1.get("/topics", tags=["vocabulary"])
def topics(session: Session = Depends(get_session)):
    return review.vocabulary(session, "topics")


@v1.get("/entities", tags=["vocabulary"])
def entities(session: Session = Depends(get_session)):
    return review.vocabulary(session, "entities")


@v1.get("/system/status", tags=["system"])
def system_status(session: Session = Depends(get_session), viewer: Viewer = Depends(get_viewer)):
    status = metrics.system_status(session)
    if not viewer.is_editor:
        status = {"corpus": status["corpus"], "ai": {"configured": status["ai"]["configured"]}, "embeddings": {k: status["embeddings"][k] for k in ("embedded", "total", "complete")}}
    return json_safe(status)


@app.get("/healthz", include_in_schema=False)
def healthz(session: Session = Depends(get_session)):
    fetch_one(session, "SELECT 1 AS ok")
    return {"ok": True}


@app.get("/metrics", include_in_schema=False)
def prometheus(session: Session = Depends(get_session)):
    return PlainTextResponse(metrics.prometheus(session), media_type="text/plain; version=0.0.4")


# ----------------------------------------------------------------------------- admin
@admin.get("/review-queue", tags=["admin"])
def review_queue(status: str = "open", resource_id: str | None = None, min_confidence: float | None = None, max_confidence: float | None = None,
                 relationship_type: str | None = None, language: str | None = None, official: bool | None = None, pipeline_version: str | None = None,
                 reason: str | None = None, verse: str | None = None, sort: str | None = None, page: int = 1, page_size: int = 25,
                 session: Session = Depends(get_session), viewer: Viewer = Depends(require_editor)):
    return json_safe(review.review_queue(session, viewer, locals_filters(locals())))


def locals_filters(values: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in values.items() if k not in ("session", "viewer")}


@admin.get("/mappings/{mapping_id}", tags=["admin"])
def mapping_detail(mapping_id: str, session: Session = Depends(get_session), viewer: Viewer = Depends(require_editor)):
    return json_safe(review.mapping_detail(session, viewer, mapping_id))


@admin.post("/mappings/{mapping_id}/approve", tags=["admin"])
def approve_mapping(mapping_id: str, body: S.NoteIn | None = None, session: Session = Depends(get_session), viewer: Viewer = Depends(require_editor)):
    return json_safe(review.approve(session, viewer, mapping_id, (body or S.NoteIn()).note))


@admin.patch("/mappings/{mapping_id}", tags=["admin"])
def patch_mapping(mapping_id: str, body: S.MappingPatch, session: Session = Depends(get_session), viewer: Viewer = Depends(require_editor)):
    return json_safe(review.edit(session, viewer, mapping_id, body.model_dump(exclude_unset=True)))


@admin.delete("/mappings/{mapping_id}", tags=["admin"])
def delete_mapping(mapping_id: str, note: str | None = None, session: Session = Depends(get_session), viewer: Viewer = Depends(require_editor)):
    return review.reject(session, viewer, mapping_id, note)


@admin.post("/mappings", tags=["admin"], status_code=201)
def add_mapping(body: S.MappingIn, session: Session = Depends(get_session), viewer: Viewer = Depends(require_editor)):
    return json_safe(review.add_mapping(session, viewer, body.model_dump()))


@admin.post("/mappings/merge", tags=["admin"])
def merge_mappings(body: S.MergeIn, session: Session = Depends(get_session), viewer: Viewer = Depends(require_editor)):
    return json_safe(review.merge_mappings(session, viewer, body.mapping_ids, body.note))


@admin.post("/segments/{segment_id}/primary", tags=["admin"])
def set_primary(segment_id: str, body: S.PrimaryIn, session: Session = Depends(get_session), viewer: Viewer = Depends(require_editor)):
    return review.set_primary(session, viewer, segment_id, body.mapping_id, body.note)


@admin.patch("/segments/{segment_id}/clip", tags=["admin"])
def edit_clip(segment_id: str, body: S.ClipPatch, session: Session = Depends(get_session), viewer: Viewer = Depends(require_editor)):
    return json_safe(review.edit_clip(session, viewer, segment_id, body.model_dump(exclude_unset=True)))


@admin.patch("/segments/{segment_id}/tags", tags=["admin"])
def edit_tags(segment_id: str, body: S.TagsPatch, session: Session = Depends(get_session), viewer: Viewer = Depends(require_editor)):
    return review.edit_tags(session, viewer, segment_id, body.model_dump())


@admin.post("/clips/{segment_id}/caption", tags=["admin"])
def caption_copy(segment_id: str, session: Session = Depends(get_session), viewer: Viewer = Depends(require_editor)):
    return clip_service.generate_caption_copy(session, viewer, segment_id)


@admin.get("/audit", tags=["admin"])
def audit_log(object_type: str | None = None, object_id: str | None = None, reviewer_id: str | None = None, page: int = 1, page_size: int = Query(50, le=200),
              session: Session = Depends(get_session), viewer: Viewer = Depends(require_editor)):
    return json_safe(review.audit_log(session, viewer, object_type, object_id, reviewer_id, page, page_size))


@admin.get("/feedback", tags=["admin"])
def list_feedback(status: str | None = None, kind: str | None = None, page: int = 1, page_size: int = Query(50, le=200),
                  session: Session = Depends(get_session), viewer: Viewer = Depends(require_editor)):
    return json_safe(feedback_service.list_feedback(session, viewer, status, kind, page, page_size))


@admin.patch("/feedback/{feedback_id}", tags=["admin"])
def patch_feedback(feedback_id: str, body: S.FeedbackPatch, session: Session = Depends(get_session), viewer: Viewer = Depends(require_editor)):
    return feedback_service.update_feedback(session, viewer, feedback_id, body.status, body.note)


@admin.get("/metrics", tags=["admin"])
def admin_metrics(days: int = Query(7, ge=1, le=90), session: Session = Depends(get_session)):
    return json_safe(metrics.dashboard(session, days))


@admin.get("/runs", tags=["admin"])
def runs(resource_id: str | None = None, limit: int = Query(50, le=200), session: Session = Depends(get_session)):
    from ..db import fetch_all

    where = "WHERE p.resource_id = :r" if resource_id else ""
    rows = fetch_all(session, f"""SELECT p.id, p.resource_id, r.title, r.type, p.status, p.current_stage, p.degraded, p.error, p.attempts, p.started_at, p.completed_at, p.created_at,
                                         p.pipeline_version, p.metrics->'mappings_by_status' AS mappings_by_status, p.metrics->'ai' AS ai
                                  FROM processing_runs p JOIN resources r ON r.id = p.resource_id {where} ORDER BY p.created_at DESC LIMIT :limit""",
                   r=resource_id, limit=limit)
    return json_safe(rows)


@admin.get("/runs/{run_id}", tags=["admin"])
def run_detail(run_id: str, session: Session = Depends(get_session)):
    from ..db import fetch_all

    run = fetch_one(session, "SELECT * FROM processing_runs WHERE id = :id", id=run_id)
    if not run:
        raise NotFound("run not found")
    calls = fetch_all(session, "SELECT prompt_id, model, status, cached, latency_ms, prompt_tokens, output_tokens, cost_usd, error, created_at FROM llm_calls WHERE run_id = :id ORDER BY created_at", id=run_id)
    return json_safe({**run, "llm_calls": calls})


@admin.get("/jobs", tags=["admin"])
def list_jobs(status: str | None = None, limit: int = Query(50, le=200), session: Session = Depends(get_session)):
    from ..db import fetch_all

    rows = fetch_all(session, "SELECT id, queue, type, status, attempts, max_attempts, last_error, run_after, created_at, updated_at FROM jobs WHERE (CAST(:s AS text) IS NULL OR status = CAST(:s AS text)) ORDER BY created_at DESC LIMIT :limit",
                     s=status, limit=limit)
    return json_safe(rows)


@admin.post("/jobs/{job_id}/retry", tags=["admin"])
def retry_job(job_id: str, session: Session = Depends(get_session), viewer: Viewer = Depends(require_editor)):
    execute(session, "UPDATE jobs SET status = 'queued', run_after = now(), attempts = 0, updated_at = now() WHERE id = :id AND status IN ('failed', 'dead')", id=job_id)
    return {"id": job_id, "status": "queued"}


@admin.post("/system/check-gemini", tags=["admin"])
def check_gemini():
    return json_safe(metrics.gemini_doctor(force=True))


@admin.post("/system/embed-bible", tags=["admin"])
def start_embedding():
    job = ensure_embedding_job()
    return {"job_id": job, "progress": json_safe(embedding_progress())}


@admin.post("/topics", tags=["admin"])
def upsert_topic(body: S.VocabIn, session: Session = Depends(get_session), viewer: Viewer = Depends(require_editor)):
    return json_safe(review.upsert_vocabulary(session, viewer, "topics", body.model_dump()))


@admin.post("/entities", tags=["admin"])
def upsert_entity(body: S.VocabIn, session: Session = Depends(get_session), viewer: Viewer = Depends(require_editor)):
    return json_safe(review.upsert_vocabulary(session, viewer, "entities", body.model_dump()))


@admin.get("/users", tags=["admin"])
def users(session: Session = Depends(get_session)):
    from ..db import fetch_all

    return json_safe(fetch_all(session, """SELECT u.id, u.email, u.display_name, u.role, u.is_active, array_remove(array_agg(o.name), NULL) AS organizations
                                           FROM users u LEFT JOIN organization_members m ON m.user_id = u.id LEFT JOIN organizations o ON o.id = m.organization_id
                                           GROUP BY u.id ORDER BY u.role DESC, u.email"""))


app.include_router(v1)
app.include_router(admin)

from .explore import router as explore_router  # noqa: E402
from .files import router as files_router  # noqa: E402
from .sermons import router as sermons_router  # noqa: E402

app.include_router(files_router)
app.include_router(sermons_router)
app.include_router(explore_router)


# ----------------------------------------------------------------------------- single-page app
_dist = get_settings().frontend_dist


@app.get("/{full_path:path}", include_in_schema=False)
def spa(full_path: str):
    if full_path.startswith(("v1/", "docs", "openapi.json", "redoc")):
        raise HTTPException(status_code=404)
    dist = _dist.resolve()
    candidate = (dist / full_path).resolve() if full_path else dist / "index.html"
    if full_path and dist in candidate.parents and candidate.is_file():
        return FileResponse(candidate)
    index = dist / "index.html"
    if index.exists():
        return FileResponse(index, headers={"cache-control": "no-cache"})
    return JSONResponse({"message": "Interactive Bible App API is running. Build the frontend (cd frontend && npm run build) or use the Vite dev server on :5173.", "docs": "/docs"})
