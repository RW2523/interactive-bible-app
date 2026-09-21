"""Local object storage (content-addressed originals + derived artefacts). Replaceable by S3/GCS later."""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import BinaryIO

from .config import get_settings

_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def safe_filename(name: str, default: str = "file") -> str:
    base = os.path.basename(name or "").strip().replace(" ", "_")
    base = _SAFE.sub("", base)[:120]
    return base or default


def root() -> Path:
    r = get_settings().storage_dir.resolve()
    r.mkdir(parents=True, exist_ok=True)
    return r


def path_for(key: str) -> Path:
    p = (root() / key).resolve()
    if root() not in p.parents and p != root():
        raise ValueError("invalid storage key")
    return p


def save_stream(stream: BinaryIO, filename: str, namespace: str = "originals", max_bytes: int | None = None) -> tuple[str, str, int]:
    """Stream to a temp file while hashing, then move to originals/<hash>/<filename>. Returns (key, sha256, size)."""
    h = hashlib.sha256()
    size = 0
    tmp_dir = root() / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=tmp_dir)
    try:
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = stream.read(1 << 20)
                if not chunk:
                    break
                size += len(chunk)
                if max_bytes is not None and size > max_bytes:
                    raise ValueError(f"file exceeds the maximum allowed size of {max_bytes // (1024 * 1024)} MB")
                h.update(chunk)
                out.write(chunk)
        digest = h.hexdigest()
        key = f"{namespace}/{digest[:2]}/{digest}/{safe_filename(filename)}"
        dest = path_for(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            os.unlink(tmp_path)
        else:
            shutil.move(tmp_path, dest)
        return key, digest, size
    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


def save_bytes(data: bytes, filename: str, namespace: str = "derived") -> str:
    digest = hashlib.sha256(data).hexdigest()
    key = f"{namespace}/{digest[:2]}/{digest}/{safe_filename(filename)}"
    dest = path_for(key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        dest.write_bytes(data)
    return key


def work_dir(name: str) -> Path:
    p = root() / "work" / safe_filename(name)
    p.mkdir(parents=True, exist_ok=True)
    return p


def exists(key: str | None) -> bool:
    return bool(key) and path_for(key).exists()


# ---------------------------------------------------------------------------------------------- generated files
SIGNED_NAMESPACES = ("sermons/", "explore/")  # generated/user files that may be served through signed URLs


def put_bytes(key: str, data: bytes) -> str:
    """Write ``data`` at an explicit key (callers choose unique keys, e.g. with a new id)."""
    dest = path_for(key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, dest)
    return key


def delete_key(key: str | None) -> None:
    if key:
        path_for(key).unlink(missing_ok=True)


def delete_prefix(prefix: str) -> None:
    """Remove a directory of generated files (e.g. everything a deleted sermon produced)."""
    if not prefix or ".." in prefix:
        raise ValueError("invalid storage prefix")
    target = path_for(prefix.rstrip("/"))
    if target.is_dir() and target != root():
        shutil.rmtree(target, ignore_errors=True)


def signed_url(key: str | None) -> str | None:
    """Stable, unguessable URL for a generated file (like a public-bucket URL, but HMAC-signed with SECRET_KEY)."""
    if not key:
        return None
    import base64
    from urllib.parse import quote

    from .security import file_signature

    token = base64.urlsafe_b64encode(key.encode()).rstrip(b"=").decode()
    return f"/v1/files/{token}/{quote(os.path.basename(key))}?sig={file_signature(key)}"


def resolve_signed(token: str, sig: str) -> Path | None:
    import base64
    import hmac as _hmac

    from .security import file_signature

    try:
        key = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)).decode()
    except Exception:  # noqa: BLE001
        return None
    if not key.startswith(SIGNED_NAMESPACES) or not _hmac.compare_digest(sig or "", file_signature(key)):
        return None
    try:
        path = path_for(key)
    except ValueError:
        return None
    return path if path.is_file() else None

