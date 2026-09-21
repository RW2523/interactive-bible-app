"""FastAPI dependencies: DB session, viewer resolution, RBAC guards, rate limits."""
from __future__ import annotations

import socket
from typing import Iterator

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import current_url, get_sessionmaker
from ..security import ANONYMOUS, Viewer, rate_limiter, viewer_for_user, viewer_from_token


def get_session() -> Iterator[Session]:
    session = get_sessionmaker(current_url())()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def token_from_request(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.cookies.get("ibible_token")


def is_local_client(request: Request) -> bool:
    host = (request.client.host if request.client else "") or ""
    return host in ("::1", "localhost") or host.startswith("127.") or host.startswith("::ffff:127.")


def lan_address() -> str | None:
    """This computer's address on the local network (the UDP probe sends no packets), or None when offline."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("10.255.255.255", 1))
            address = probe.getsockname()[0]
    except OSError:
        return None
    return None if address.startswith("127.") or address == "0.0.0.0" else address


def share_base(request: Request) -> tuple[str | None, str | None]:
    """(base URL, source) for links meant for other people: PUBLIC_BASE_URL, else this computer's network address."""
    configured = get_settings().public_base_url.strip().rstrip("/")
    if configured:
        return configured, "config"
    address = lan_address()
    if not address:
        return None, None
    port = request.url.port
    return f"{request.url.scheme}://{address}{f':{port}' if port else ''}", "lan"


def owner_access(request: Request) -> bool:
    """Personal mode: this request acts as the owner account without signing in."""
    settings = get_settings()
    return settings.single_user_mode and (settings.single_user_trust_network or is_local_client(request))


def get_viewer(request: Request, session: Session = Depends(get_session)) -> Viewer:
    viewer = ANONYMOUS
    if owner_access(request):
        viewer = viewer_for_user(session, get_settings().owner_user_id)
    if not viewer.is_authenticated:  # accounts mode, other devices, or no owner account yet
        viewer = viewer_from_token(session, token_from_request(request))
    request.state.viewer = viewer
    return viewer


def require_user(viewer: Viewer = Depends(get_viewer)) -> Viewer:
    if not viewer.is_authenticated:
        raise HTTPException(status_code=401, detail="sign in required")
    return viewer


def require_editor(viewer: Viewer = Depends(get_viewer)) -> Viewer:
    if not viewer.is_authenticated:
        raise HTTPException(status_code=401, detail="sign in required")
    if not viewer.is_editor:
        raise HTTPException(status_code=403, detail="editor or admin role required")
    return viewer


def client_key(request: Request, viewer: Viewer | None = None) -> str:
    if viewer and viewer.user_id:
        return f"user:{viewer.user_id}"
    fwd = request.headers.get("x-forwarded-for")
    return f"ip:{(fwd.split(',')[0].strip() if fwd else (request.client.host if request.client else 'unknown'))}"


def rate_limit(bucket: str, per_minute: int | None = None):
    def dep(request: Request, viewer: Viewer = Depends(get_viewer)) -> None:
        limit = per_minute or get_settings().rate_limit_per_minute
        if not rate_limiter.allow(f"{bucket}:{client_key(request, viewer)}", limit):
            raise HTTPException(status_code=429, detail=f"rate limit exceeded for {bucket}; try again shortly")
    return dep


def creative_ai_limit(viewer: Viewer = Depends(require_user)) -> Viewer:
    """Signed-in users only, with an hourly cap on creative generation (sermon + explore AI)."""
    limit = get_settings().ai_creative_calls_per_hour
    if limit and not rate_limiter.allow(f"creative:{viewer.user_id}", limit, window=3600.0):
        raise HTTPException(status_code=429, detail="You have reached the hourly limit for AI generation. Please try again later.")
    return viewer

