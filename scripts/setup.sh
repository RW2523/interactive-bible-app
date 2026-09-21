#!/usr/bin/env bash
# One-shot local setup: prerequisites check, .env, Python venv, frontend build, Postgres cluster,
# Bible corpus + vocabularies + demo users, and (optionally) the demo resources.
#   scripts/setup.sh            # full setup incl. demo content
#   scripts/setup.sh --no-demo  # skip demo resources
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DEMO=1
for arg in "$@"; do [ "$arg" = "--no-demo" ] && DEMO=0; done

bold() { printf "\n\033[1m%s\033[0m\n" "$1"; }
fail() { printf "\033[31m✗ %s\033[0m\n" "$1" >&2; exit 1; }

bold "1/7 Checking prerequisites"
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  for c in python3.13 python3.12 python3.11 python3; do
    if command -v "$c" >/dev/null && "$c" -c 'import sys; exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then PY="$(command -v "$c")"; break; fi
  done
fi
[ -n "$PY" ] || fail "Python 3.11+ is required"
echo "✓ python: $PY ($("$PY" --version))"
command -v node >/dev/null || fail "Node.js 18+ is required (brew install node)"
echo "✓ node: $(node --version)"
command -v ffmpeg >/dev/null || fail "ffmpeg is required for audio/video (brew install ffmpeg)"
echo "✓ ffmpeg"
PG_FOUND=""
for candidate in "${PG_BIN:-}" /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /opt/homebrew/opt/postgresql@16/bin /usr/lib/postgresql/17/bin /usr/lib/postgresql/16/bin; do
  if [ -n "$candidate" ] && [ -x "$candidate/pg_ctl" ]; then PG_FOUND="$candidate"; break; fi
done
[ -n "$PG_FOUND" ] || fail "PostgreSQL 16/17 is required (brew install postgresql@17 pgvector)"
if ! ls "$PG_FOUND/../share/postgresql"*/extension/vector.control >/dev/null 2>&1 && ! ls /opt/homebrew/share/postgresql@17/extension/vector.control >/dev/null 2>&1 && ! ls /usr/share/postgresql/*/extension/vector.control >/dev/null 2>&1; then
  echo "• pgvector extension not found next to $PG_FOUND — install it (brew install pgvector) if migrations fail"
fi
echo "✓ postgresql ($PG_FOUND)"
command -v tesseract >/dev/null && echo "✓ tesseract (OCR for scanned PDFs)" || echo "• tesseract not found — scanned PDFs will not be OCR'd (brew install tesseract)"
command -v pdftoppm >/dev/null && echo "✓ poppler" || echo "• poppler not found — needed for OCR (brew install poppler)"

bold "2/7 Environment file"
if [ ! -f .env ]; then
  cp .env.example .env
  SECRET="$("$PY" -c 'import secrets; print(secrets.token_urlsafe(48))')"
  sed -i.bak "s|^SECRET_KEY=.*|SECRET_KEY=${SECRET}|" .env && rm -f .env.bak
  echo "✓ created .env (add your GEMINI_API_KEY there)"
else
  echo "✓ .env exists"
fi

bold "3/7 Python environment"
if [ ! -x backend/.venv/bin/python ]; then "$PY" -m venv backend/.venv; fi
backend/.venv/bin/pip install -q --upgrade pip
backend/.venv/bin/pip install -q -r backend/requirements.txt
echo "✓ backend dependencies installed"

bold "4/7 Frontend"
(cd frontend && npm install --no-audit --no-fund --loglevel=error && npm run build >/dev/null)
echo "✓ frontend built (frontend/dist)"

bold "5/7 Bible data"
scripts/fetch_data.sh

bold "6/7 Local PostgreSQL + pgvector"
scripts/pg.sh init
(cd backend && PYTHONPATH=. .venv/bin/python -m interactive_bible.cli bootstrap)

if [ "$DEMO" = "1" ]; then
  bold "7/7 Demo resources"
  if [ ! -f demo_content/media/sermon_all_things_for_good.mp4 ]; then
    (cd "$ROOT" && backend/.venv/bin/python demo_content/build_demo_media.py) || echo "• demo media generation needs macOS 'say'; skipping media"
  fi
  (cd backend && PYTHONPATH=. .venv/bin/python -m interactive_bible.cli seed-demo --approve)
else
  bold "7/7 Skipping demo resources"
fi

bold "Setup complete"
cat <<EOF
Next:
  1. Put your Gemini key in .env  →  GEMINI_API_KEY=...
  2. Verify it:                      make check-gemini
  3. Start everything:               make start     (http://localhost:8000)
     or for development:             make dev       (http://localhost:5173)
Demo users (password: bible-demo): admin@interactivebible.local · editor@interactivebible.local · member@interactivebible.local · outsider@interactivebible.local
EOF
