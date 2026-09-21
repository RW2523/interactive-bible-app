"""Helpers shared by the Explore services."""
from __future__ import annotations

import datetime as dt
import re
from typing import Any, TypeVar

from pydantic import BaseModel

from ...ai.llm import AIUnavailable, LLMResult, get_llm

T = TypeVar("T", bound=BaseModel)

_SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$")
IMAGE_TYPES = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}
_MIME_EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp"}


def run_shared(prompt_id: str, variables: dict[str, Any], schema: type[T]) -> LLMResult[T]:
    """Explore text is the same for every user: serve the cached result when there is one (this works even without
    an API key), otherwise generate it once and cache it for everyone."""
    llm = get_llm()
    try:
        return llm.run(prompt_id, variables, schema, cache_only=True)
    except AIUnavailable:
        return llm.run(prompt_id, variables, schema, use_cache=True)


def storage_segment(value: Any) -> str:
    """Identifiers used inside storage keys must be plain path segments."""
    if not isinstance(value, str) or not _SAFE_SEGMENT.fullmatch(value):
        raise ValueError(f"invalid identifier for a storage path: {value!r}")
    return value


def image_extension(mime_type: str | None, data: bytes) -> str:
    """File extension for generated image bytes (sniffed first: files are served with a type derived from it)."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return _MIME_EXTENSIONS.get((mime_type or "").split(";")[0].strip().lower(), "png")


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
