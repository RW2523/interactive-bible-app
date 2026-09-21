# Development guide

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Python | 3.11+ (3.13 tested) | backend and scripts |
| Node.js | 18+ (22 tested) | web app |
| PostgreSQL | 16 or 17 + **pgvector** | run locally by `scripts/pg.sh` on port 54329 |
| ffmpeg / ffprobe | any recent | media processing, story-video MP4s, tests |
| Tesseract + Poppler | optional | OCR for scanned PDFs |

On macOS: `brew install postgresql@17 pgvector ffmpeg tesseract poppler node`.

## Setup and daily commands

```bash
make setup          # venv, npm install + build, local Postgres + pgvector, Bible texts, vocabularies, demo users + content
make dev            # API with --reload on :8000 + worker + Vite dev server on http://localhost:5173 (foreground)
make start / stop   # production-style run in the background (the API serves frontend/dist) → http://localhost:8000
make status         # what is running
make check-gemini   # verify the key, models, JSON generation and embeddings
```

| Command | What it does |
|---|---|
| `make test` | Backend test suite against the separate `interactive_bible_test` database |
| `make typecheck` / `make build` | TypeScript check / production build of the web app |
| `make eval` / `make eval-ai` | Scripture-mapping evaluation on the gold set (deterministic, or with live Gemini) |
| `make seed` / `make reset-demo` | Process the demo resources again / wipe library data and re-seed (sermons, stories and accounts are kept) |
| `make demo-media` | Rebuild the synthetic demo video, podcast, PDF and DOCX (macOS `say` + ffmpeg) |
| `make embed` | Build the verse embedding index now |
| `make backup` / `make restore BACKUP=…` | Database dump + storage copy under `.data/backups/` |
| `scripts/pg.sh psql` | SQL shell on the local database |
| `backend/.venv/bin/python scripts/build_geodata.py` | Rebuild the offline basemap from Natural Earth |

API documentation (OpenAPI) is served at <http://localhost:8000/docs>; Prometheus metrics at `/metrics`.

## Backend conventions

- **Raw SQL helpers** (`db.fetch_one`, `fetch_all`, `execute`, `session_scope`) over SQLAlchemy sessions; keep queries
  explicit and parameterised.
- **Migrations** are numbered SQL files in `backend/migrations/`, checksummed and applied on start. Never edit an applied
  migration — add a new one.
- **Errors → HTTP**: `NotFound` 404, `Forbidden` 403, `UploadRejected`/`ValueError` 400/422, `AIUnavailable` 503,
  `AIInvalidOutput` 502 (handlers in `api/main.py`).
- **AI calls** only through `get_llm()` (`run`, `embed`, `image`, `speech`). New prompts go in `ai/prompts/` with a
  `version`, an output schema in `ai/schemas*.py`, and user content fenced between `<<<` and `>>>`.
- **Long work** runs as jobs (`jobs.enqueue`) with `jobs.report_progress(...)`; handlers are registered in `worker.py`.
- **Files** go through `storage.put_bytes` / `signed_url`; never serve raw paths.

## Frontend conventions

- React 19 + TypeScript, Vite 7, Tailwind CSS 4 (tokens in `src/styles/app.css`), TanStack Query, Base UI / shadcn-style
  primitives in `src/components/ui/`, icons from `lucide-react`, toasts with `sonner`.
- Use the theme tokens (`bg-card`, `text-ink`, `border-border`, `text-ink-3`, …) so light and dark both work; check a
  375 px phone width.
- Explore (`features/explore`) is plain JSX with scoped CSS (`.bjm-root`, `@layer explore`); Sermon Studio
  (`features/sermons`) keeps its data hooks in `api.ts` and stage components in `stages/`.

## Tests

- `make test` runs ~650 tests in about 30 seconds. Every test starts from clean mutable tables; the Bible corpus and
  vocabularies are loaded once.
- **No network.** The suite installs a fake Gemini client (`tests/fakes.py`, with default answers per prompt) and a
  guard that blocks Google hosts; YouTube tests replace `ingest.youtube.extractor` and `track_downloader` with stubs.
- Media tests use real ffmpeg at tiny sizes (they skip when ffmpeg is missing).
- CI (`.github/workflows/ci.yml`) runs the backend suite against `pgvector/pgvector:pg17` and type-checks and builds the
  web app on every push and pull request.

## Evaluation

`make eval` scores the pipeline on 71 hand-labelled gold items plus the demo resources (explicit references,
quotations, narrative passages, semantic links and hard negatives). With a key, `make eval-ai` runs the Gemini stages
too. Run it after changing any Scripture-mapping prompt and include the numbers in your pull request.

## Troubleshooting (development)

| Symptom | Fix |
|---|---|
| `postmaster became multithreaded during startup` (macOS) | start Postgres with `scripts/pg.sh start` (it sets `LC_ALL`) |
| port 8000 or 5173 in use | `make stop`, or set `API_PORT` / `WEB_PORT` in `.env` |
| tests fail with "TEST_DATABASE_URL must differ" | set a separate test database URL |
| jobs stay *queued* | the worker isn't running — `make status`, then `make start`; logs in `.data/logs/` |
| a model is "not found" | run `make check-gemini` to list available models, or rely on the `*_FALLBACKS` settings |
| YouTube requests are refused | update yt-dlp: `backend/.venv/bin/pip install -U yt-dlp` |
