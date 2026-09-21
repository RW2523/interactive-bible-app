"""Local auth (signed tokens + scrypt passwords), viewer scopes, RBAC and resource visibility rules (spec §13)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from .config import get_settings
from .db import fetch_all, fetch_one

ROLES = ("member", "editor", "admin")


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _algo, salt_b64, digest_b64 = stored.split("$")
        digest = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt_b64), n=2**14, r=8, p=1, dklen=32)
        return hmac.compare_digest(digest, base64.b64decode(digest_b64))
    except Exception:  # noqa: BLE001
        return False


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def sign(payload: dict[str, Any]) -> str:
    body = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    sig = _b64(hmac.new(get_settings().secret_key.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def unsign(token: str) -> dict[str, Any] | None:
    try:
        body, sig = token.split(".")
        expected = _b64(hmac.new(get_settings().secret_key.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(_unb64(body))
        if payload.get("exp") and payload["exp"] < time.time():
            return None
        return payload
    except Exception:  # noqa: BLE001
        return None


def issue_token(user: dict[str, Any]) -> str:
    return sign({"sub": user["id"], "role": user["role"], "exp": int(time.time() + get_settings().token_ttl_hours * 3600), "typ": "session"})


def file_signature(key: str) -> str:
    """Signature for a stored file key (non-expiring: generated media behaves like a public-bucket object with an unguessable URL)."""
    return _b64(hmac.new(get_settings().secret_key.encode(), f"file:{key}".encode(), hashlib.sha256).digest())[:32]


def media_token(resource_id: str, ttl_seconds: int = 6 * 3600) -> str:
    return sign({"rid": resource_id, "exp": int(time.time() + ttl_seconds), "typ": "media"})


@dataclass
class Viewer:
    user_id: str | None = None
    role: str = "anonymous"
    email: str | None = None
    display_name: str | None = None
    org_ids: list[str] = field(default_factory=list)

    @property
    def is_authenticated(self) -> bool:
        return self.user_id is not None

    @property
    def is_editor(self) -> bool:
        return self.role in ("editor", "admin")

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def scope_key(self) -> str:
        if self.is_editor:
            return "staff"
        if not self.user_id:
            return "anonymous"
        return f"user:{self.user_id}:{','.join(sorted(self.org_ids))}"

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.user_id, "role": self.role, "email": self.email, "display_name": self.display_name, "organization_ids": self.org_ids}


ANONYMOUS = Viewer()


def viewer_from_token(session: Session, token: str | None) -> Viewer:
    if not token:
        return ANONYMOUS
    payload = unsign(token)
    if not payload or payload.get("typ") != "session":
        return ANONYMOUS
    return viewer_for_user(session, payload["sub"])


def viewer_for_user(session: Session, user_id: str | None) -> Viewer:
    """The viewer of an active user account (anonymous when the account is missing or disabled)."""
    if not user_id:
        return ANONYMOUS
    user = fetch_one(session, "SELECT id, email, display_name, role, is_active FROM users WHERE id = :id", id=user_id)
    if not user or not user["is_active"]:
        return ANONYMOUS
    orgs = [r["organization_id"] for r in fetch_all(session, "SELECT organization_id FROM organization_members WHERE user_id = :u", u=user["id"])]
    return Viewer(user["id"], user["role"], user["email"], user["display_name"], orgs)


def visibility_clause(viewer: Viewer, alias: str = "r", discoverable: bool = True) -> tuple[str, dict[str, Any]]:
    """SQL predicate restricting resources to what the viewer may see.

    discoverable=True (verse intelligence, search, map, indicators) excludes 'unlisted' resources
    unless the viewer owns them; direct links (resource detail / clip) pass discoverable=False.
    """
    base = f"{alias}.deleted_at IS NULL"
    if viewer.is_editor:
        return base, {}
    conds = [f"{alias}.visibility = 'public'"]
    params: dict[str, Any] = {}
    if not discoverable:
        conds.append(f"{alias}.visibility = 'unlisted'")
    if viewer.user_id:
        conds.append(f"{alias}.owner_id = :viewer_id")
        params["viewer_id"] = viewer.user_id
    if viewer.org_ids:
        conds.append(f"({alias}.visibility = 'organization' AND {alias}.organization_id = ANY(:viewer_orgs))")
        params["viewer_orgs"] = viewer.org_ids
    return f"({base} AND ({' OR '.join(conds)}))", params


def can_view_resource(viewer: Viewer, resource: dict[str, Any], discoverable: bool = False) -> bool:
    if resource.get("deleted_at"):
        return False
    if viewer.is_editor:
        return True
    vis = resource["visibility"]
    if vis == "public" or (vis == "unlisted" and not discoverable):
        return True
    if viewer.user_id and resource.get("owner_id") == viewer.user_id:
        return True
    return vis == "organization" and resource.get("organization_id") in viewer.org_ids


def can_edit_resource(viewer: Viewer, resource: dict[str, Any]) -> bool:
    return viewer.is_editor or (viewer.user_id is not None and resource.get("owner_id") == viewer.user_id)


# ---------------------------------------------------------------------------- rate limiting
class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window: float = 60.0) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True


rate_limiter = RateLimiter()
