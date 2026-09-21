"""Database engine/session helpers (SQLAlchemy 2 + psycopg 3)."""
from __future__ import annotations

import json
from contextlib import contextmanager
from typing import Any, Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .config import get_settings

_engines: dict[str, Engine] = {}
_sessionmakers: dict[str, sessionmaker] = {}


def _json_default(o: Any) -> Any:
    if hasattr(o, "isoformat"):
        return o.isoformat()
    if isinstance(o, set):
        return sorted(o)
    raise TypeError(f"not JSON serialisable: {type(o)}")


def json_dumps(value: Any) -> str:
    return json.dumps(value, default=_json_default, ensure_ascii=False)


def get_engine(url: str | None = None) -> Engine:
    url = url or get_settings().database_url
    if url not in _engines:
        _engines[url] = create_engine(
            url,
            pool_size=10,
            max_overflow=10,
            pool_pre_ping=True,
            json_serializer=json_dumps,
            future=True,
        )
    return _engines[url]


def get_sessionmaker(url: str | None = None) -> sessionmaker:
    url = url or get_settings().database_url
    if url not in _sessionmakers:
        _sessionmakers[url] = sessionmaker(bind=get_engine(url), expire_on_commit=False, future=True)
    return _sessionmakers[url]


_override_url: str | None = None


def set_database_url_override(url: str | None) -> None:
    """Used by tests to point the whole app at the test database."""
    global _override_url
    _override_url = url


def current_url() -> str:
    return _override_url or get_settings().database_url


@contextmanager
def session_scope() -> Iterator[Session]:
    session = get_sessionmaker(current_url())()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def fetch_all(session: Session, sql: str, **params: Any) -> list[dict[str, Any]]:
    return [dict(r) for r in session.execute(text(sql), params).mappings().all()]


def fetch_one(session: Session, sql: str, **params: Any) -> dict[str, Any] | None:
    row = session.execute(text(sql), params).mappings().first()
    return dict(row) if row else None


def execute(session: Session, sql: str, **params: Any) -> Any:
    return session.execute(text(sql), params)
