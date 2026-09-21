"""Tiny ordered SQL migration runner (migrations/NNN_name.sql, checksummed)."""
from __future__ import annotations

import hashlib
import logging
from pathlib import Path

from sqlalchemy import text

from .config import BACKEND_ROOT
from .db import get_engine

log = logging.getLogger(__name__)
MIGRATIONS_DIR = BACKEND_ROOT / "migrations"


def migrate(database_url: str | None = None) -> list[str]:
    engine = get_engine(database_url)
    applied: list[str] = []
    with engine.begin() as conn:
        conn.execute(text("SELECT pg_advisory_xact_lock(4242001)"))
        conn.execute(
            text(
                """CREATE TABLE IF NOT EXISTS schema_migrations (
                       name text PRIMARY KEY, checksum text NOT NULL,
                       applied_at timestamptz NOT NULL DEFAULT now())"""
            )
        )
        done = {r[0]: r[1] for r in conn.execute(text("SELECT name, checksum FROM schema_migrations"))}
        for path in sorted(Path(MIGRATIONS_DIR).glob("*.sql")):
            sql = path.read_text(encoding="utf-8")
            checksum = hashlib.sha256(sql.encode()).hexdigest()
            if path.name in done:
                if done[path.name] != checksum:
                    log.warning("migration %s changed after being applied (ignored)", path.name)
                continue
            conn.exec_driver_sql(sql)
            conn.execute(
                text("INSERT INTO schema_migrations (name, checksum) VALUES (:n, :c)"),
                {"n": path.name, "c": checksum},
            )
            applied.append(path.name)
            log.info("applied migration %s", path.name)
    return applied


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(migrate() or "up to date")
