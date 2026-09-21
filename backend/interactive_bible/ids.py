"""Identifier and hashing helpers."""
from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Any

_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"  # Crockford base32 (lowercase)


def _b32(value: int, length: int) -> str:
    out = []
    for _ in range(length):
        out.append(_ALPHABET[value & 31])
        value >>= 5
    return "".join(reversed(out))


def new_id(prefix: str) -> str:
    """Time-sortable id: <prefix>_<10 chars time><10 chars random>."""
    ms = int(time.time() * 1000)
    rnd = int.from_bytes(os.urandom(7), "big")
    return f"{prefix}_{_b32(ms, 10)}{_b32(rnd, 10)}"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def stable_hash(value: Any) -> str:
    return sha256_text(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str))


def short_hash(value: Any, n: int = 16) -> str:
    return stable_hash(value)[:n]


def sha256_file(path: str | os.PathLike[str], chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            block = fh.read(chunk)
            if not block:
                break
            h.update(block)
    return h.hexdigest()
