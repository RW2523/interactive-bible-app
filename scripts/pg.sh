#!/usr/bin/env bash
# Project-local PostgreSQL 17 + pgvector cluster (never touches your other Postgres data dirs).
# Usage: scripts/pg.sh init|start|stop|status|psql|reset-test
set -euo pipefail
# macOS: postmaster refuses to start ("became multithreaded") without a valid locale
export LC_ALL="en_US.UTF-8" LANG="en_US.UTF-8"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$ROOT/.env" ]; then set -a; . "$ROOT/.env"; set +a; fi

PG_BIN="${PG_BIN:-}"
if [ -z "$PG_BIN" ]; then
  for candidate in /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /opt/homebrew/opt/postgresql@16/bin /usr/lib/postgresql/17/bin /usr/lib/postgresql/16/bin; do
    if [ -x "$candidate/pg_ctl" ]; then PG_BIN="$candidate"; break; fi
  done
fi
if [ -z "$PG_BIN" ] || [ ! -x "$PG_BIN/pg_ctl" ]; then
  echo "PostgreSQL 16/17 binaries not found. Install with: brew install postgresql@17 pgvector" >&2
  exit 1
fi

PGDATA="${PGDATA_DIR:-$ROOT/.data/postgres}"
PGRUN="$ROOT/.data/run"
PGPORT="${PG_PORT:-54329}"
PGUSER_NAME="${PG_USER:-interactive_bible}"
DB_NAME="${PG_DATABASE:-interactive_bible}"
TEST_DB_NAME="${PG_TEST_DATABASE:-interactive_bible_test}"
LOG="$ROOT/.data/postgres.log"

cmd="${1:-status}"

ensure_db() {
  local name="$1"
  if ! "$PG_BIN/psql" -h localhost -p "$PGPORT" -U "$PGUSER_NAME" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$name'" | grep -q 1; then
    "$PG_BIN/createdb" -h localhost -p "$PGPORT" -U "$PGUSER_NAME" "$name"
    echo "created database $name"
  fi
  "$PG_BIN/psql" -h localhost -p "$PGPORT" -U "$PGUSER_NAME" -d "$name" -q -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;"
}

start() {
  if "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
    echo "postgres already running on port $PGPORT"
  else
    mkdir -p "$PGRUN"
    "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$LOG" -o "-p $PGPORT -k $PGRUN -c listen_addresses=localhost" -w start >/dev/null
    echo "postgres started on localhost:$PGPORT (data: $PGDATA)"
  fi
}

case "$cmd" in
  init)
    if [ ! -f "$PGDATA/PG_VERSION" ]; then
      mkdir -p "$PGDATA" "$PGRUN"
      "$PG_BIN/initdb" -D "$PGDATA" -U "$PGUSER_NAME" --auth=trust --encoding=UTF8 --locale=C >/dev/null
      {
        echo "shared_buffers = 256MB"
        echo "work_mem = 32MB"
        echo "maintenance_work_mem = 256MB"
        echo "max_connections = 60"
      } >> "$PGDATA/postgresql.conf"
      echo "initialised cluster at $PGDATA"
    fi
    start
    ensure_db "$DB_NAME"
    ensure_db "$TEST_DB_NAME"
    ;;
  start) start ;;
  stop) "$PG_BIN/pg_ctl" -D "$PGDATA" -m fast stop || true ;;
  status) "$PG_BIN/pg_ctl" -D "$PGDATA" status || true ;;
  psql) shift; exec "$PG_BIN/psql" -h localhost -p "$PGPORT" -U "$PGUSER_NAME" -d "$DB_NAME" "$@" ;;
  reset-test)
    "$PG_BIN/dropdb" -h localhost -p "$PGPORT" -U "$PGUSER_NAME" --if-exists "$TEST_DB_NAME"
    ensure_db "$TEST_DB_NAME"
    ;;
  *) echo "usage: $0 init|start|stop|status|psql|reset-test" >&2; exit 2 ;;
esac
