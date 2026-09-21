"""Signed file URLs for generated media (sermon visuals, story scenes and narration, event illustrations)."""
from __future__ import annotations

import mimetypes

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from .. import storage

router = APIRouter(prefix="/v1/files", tags=["files"])


@router.get("/{token}/{name}")
def signed_file(token: str, name: str, sig: str = Query(..., min_length=10, max_length=64)):
    path = storage.resolve_signed(token, sig)
    if path is None:
        raise HTTPException(status_code=404, detail="file not found")
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(path, media_type=mime, headers={
        "cache-control": "public, max-age=604800, immutable",  # keys are unique per generation
        "accept-ranges": "bytes",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; img-src 'self' data:; media-src 'self'; sandbox",
    })
