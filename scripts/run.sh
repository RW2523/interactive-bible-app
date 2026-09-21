#!/usr/bin/env bash
# Process manager for local runs.
#   scripts/run.sh start   # Postgres + API (serving the built web app) + worker, in the background
#   scripts/run.sh dev     # Postgres + API (--reload) + worker + Vite dev server, in the foreground (Ctrl-C stops all)
#   scripts/run.sh stop    # stop background API + worker (Postgres keeps running; scripts/pg.sh stop)
#   scripts/run.sh status
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-5173}"
LOGS="$ROOT/.data/logs"
PIDS="$ROOT/.data/pids"
mkdir -p "$LOGS" "$PIDS"
PY="$ROOT/backend/.venv/bin/python"
export PYTHONPATH="$ROOT/backend"

is_running() { [ -f "$PIDS/$1.pid" ] && kill -0 "$(cat "$PIDS/$1.pid")" 2>/dev/null; }

start_bg() {
  local name="$1"; shift
  if is_running "$name"; then echo "✓ $name already running (pid $(cat "$PIDS/$name.pid"))"; return; fi
  # Detach into a new session (its own process group, stdio on the log file) so `stop` can terminate the whole
  # tree (venv launchers and uvicorn --workers spawn children) and a caller's pipe, e.g. `run.sh start | tee`,
  # is not held open. macOS has no setsid(1) and bash 3.2's `set -m` leaves a wrapper shell holding the pipe.
  "$PY" - "$ROOT/backend" "$LOGS/$name.log" "$PIDS/$name.pid" "$@" <<'PYEOF'
import subprocess, sys
cwd, log, pidfile, *cmd = sys.argv[1:]
with open(log, "ab") as out:
    proc = subprocess.Popen(cmd, cwd=cwd, stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
with open(pidfile, "w") as f:
    f.write(f"{proc.pid}\n")
PYEOF
  sleep 0.3
  echo "✓ $name started (pid $(cat "$PIDS/$name.pid"), log .data/logs/$name.log)"
}

kill_tree() {
  local pid="$1" sig="${2:-TERM}"
  kill "-$sig" -- "-$pid" 2>/dev/null
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child" "$sig"; done
  kill "-$sig" "$pid" 2>/dev/null
}

stop_bg() {
  local name="$1" pattern="$2"
  if [ -f "$PIDS/$name.pid" ]; then
    local pid; pid="$(cat "$PIDS/$name.pid")"
    kill_tree "$pid" TERM
    for _ in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done  # worker hands jobs back within ~4s
    kill -0 "$pid" 2>/dev/null && kill_tree "$pid" KILL
  fi
  # safety net for orphaned children from earlier runs
  local stray; stray="$(pgrep -f "$pattern" 2>/dev/null || true)"
  if [ -n "$stray" ]; then
    kill $stray 2>/dev/null; sleep 1
    stray="$(pgrep -f "$pattern" 2>/dev/null || true)"; [ -n "$stray" ] && kill -9 $stray 2>/dev/null
  fi
  rm -f "$PIDS/$name.pid"
  echo "✓ $name stopped"
}

wait_api() {
  for _ in $(seq 1 60); do
    curl -fs "http://127.0.0.1:$API_PORT/healthz" >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  echo "API did not become healthy — see .data/logs/api.log" >&2
  return 1
}

case "${1:-start}" in
  start)
    scripts/pg.sh start
    (cd backend && "$PY" -m interactive_bible.migrate >/dev/null)
    [ -f frontend/dist/index.html ] || (cd frontend && npm run build)
    if lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1 && ! is_running api; then
      echo "port $API_PORT is already in use — run 'scripts/run.sh stop' (or free the port) first" >&2
      exit 1
    fi
    start_bg api "$PY" -m uvicorn interactive_bible.api.main:app --host 0.0.0.0 --port "$API_PORT" --workers 2
    start_bg worker "$PY" -m interactive_bible.worker --queues pipeline,embeddings,ai,media,default --threads 2
    wait_api && echo "→ Interactive Bible App is running at http://localhost:$API_PORT  (API docs: /docs)"
    ;;
  dev)
    scripts/pg.sh start
    (cd backend && "$PY" -m interactive_bible.migrate >/dev/null)
    trap 'echo; echo "stopping…"; kill 0' INT TERM EXIT
    (cd backend && "$PY" -m uvicorn interactive_bible.api.main:app --host 127.0.0.1 --port "$API_PORT" --reload --reload-dir interactive_bible 2>&1 | sed "s/^/[api] /") &
    (cd backend && "$PY" -m interactive_bible.worker --queues pipeline,embeddings,ai,media,default --threads 2 2>&1 | sed "s/^/[worker] /") &
    (cd frontend && npx vite --port "$WEB_PORT" --strictPort 2>&1 | sed "s/^/[web] /") &
    wait_api && echo "→ open http://localhost:$WEB_PORT (Vite) — API on :$API_PORT"
    wait
    ;;
  stop)
    stop_bg api "uvicorn interactive_bible.api.main:app --host 0.0.0.0 --port $API_PORT"
    stop_bg worker "interactive_bible.worker --queues"
    ;;
  status)
    for n in api worker; do is_running "$n" && echo "● $n running (pid $(cat "$PIDS/$n.pid"))" || echo "○ $n stopped"; done
    scripts/pg.sh status | head -1
    curl -fs "http://127.0.0.1:$API_PORT/healthz" >/dev/null 2>&1 && echo "● API healthy on :$API_PORT" || echo "○ API not responding on :$API_PORT"
    ;;
  *) echo "usage: $0 start|dev|stop|status" >&2; exit 2 ;;
esac
