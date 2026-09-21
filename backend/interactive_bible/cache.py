"""Versioned caches (spec §14 Caching): payload caches keyed by content versions that bump on every publish/edit."""
from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Any, Iterable

from sqlalchemy.orm import Session

from .db import execute, fetch_all


class TTLCache:
    def __init__(self, maxsize: int = 2048, ttl: float = 600.0) -> None:
        self.maxsize, self.ttl = maxsize, ttl
        self._data: OrderedDict[Any, tuple[float, Any]] = OrderedDict()
        self._lock = threading.Lock()
        self.hits = self.misses = 0

    def get(self, key: Any) -> Any | None:
        with self._lock:
            item = self._data.get(key)
            if not item or time.monotonic() - item[0] > self.ttl:
                self.misses += 1
                if item:
                    self._data.pop(key, None)
                return None
            self._data.move_to_end(key)
            self.hits += 1
            return item[1]

    def set(self, key: Any, value: Any) -> None:
        with self._lock:
            self._data[key] = (time.monotonic(), value)
            self._data.move_to_end(key)
            while len(self._data) > self.maxsize:
                self._data.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


intelligence_cache = TTLCache(maxsize=4096, ttl=900)
search_cache = TTLCache(maxsize=1024, ttl=300)
chapter_cache = TTLCache(maxsize=512, ttl=300)


def bump_verses(session: Session, verse_ids: Iterable[int]) -> None:
    ids = sorted({int(v) for v in verse_ids})
    if not ids:
        return
    execute(
        session,
        """INSERT INTO cache_versions (scope, version)
           SELECT 'verse:' || v, 2 FROM unnest(CAST(:ids AS int[])) AS v
           ON CONFLICT (scope) DO UPDATE SET version = cache_versions.version + 1, updated_at = now()""",
        ids=ids,
    )
    execute(session, "UPDATE cache_versions SET version = version + 1, updated_at = now() WHERE scope = 'search'")


def bump_global(session: Session) -> None:
    execute(session, "UPDATE cache_versions SET version = version + 1, updated_at = now() WHERE scope IN ('global', 'search')")


def versions(session: Session, verse_ids: Iterable[int]) -> tuple[int, dict[int, int]]:
    scopes = ["global"] + [f"verse:{v}" for v in verse_ids]
    rows = fetch_all(session, "SELECT scope, version FROM cache_versions WHERE scope = ANY(:s)", s=scopes)
    data = {r["scope"]: r["version"] for r in rows}
    return data.get("global", 1), {v: data.get(f"verse:{v}", 1) for v in verse_ids}


def search_version(session: Session) -> int:
    rows = fetch_all(session, "SELECT version FROM cache_versions WHERE scope IN ('global', 'search')")
    return sum(r["version"] for r in rows)


def ensure_scopes(session: Session) -> None:
    execute(session, "INSERT INTO cache_versions (scope, version) VALUES ('global', 1), ('search', 1) ON CONFLICT DO NOTHING")
