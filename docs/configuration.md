# Configuration

All settings are environment variables, read from the `.env` file in the project root (created from
[`.env.example`](../.env.example) by `make setup`). After changing `.env`, restart the app:

```bash
make stop && make start
```

`.env` is git-ignored — keep your keys there and never commit it.

## The one setting you need

| Variable | Default | What it does |
|---|---|---|
| `GEMINI_API_KEY` | *(empty)* | Your Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey). Without it the app runs in a fail-safe mode: reading, the atlas, timeline, library, review, exports and every previously generated result keep working; new AI work (transcription, AI verse links, Ask AI, sermon polish, images, story videos) returns a clear "AI unavailable" message. Check it with `make check-gemini`. |

## Access and accounts

| Variable | Default | What it does |
|---|---|---|
| `SINGLE_USER_MODE` | `true` | **Personal mode.** No sign-in on the computer running the app: requests from `localhost` act as the owner account with full admin access. |
| `OWNER_USER_ID` | `usr_admin` | The account that personal mode signs in as. |
| `SINGLE_USER_TRUST_NETWORK` | `false` | Also give owner access to *other devices* that can reach the port. Only on a network you trust — anyone who can reach it gets full access and uses your Gemini key. |
| `ALLOW_SIGNUP` | `true` | Let visitors on other devices create member accounts on `/signup`. |
| `DEMO_PASSWORD` | *(random, set by setup)* | Shared password of the sample accounts (`admin@`, `editor@`, `member@`, `outsider@interactivebible.local`), used from other devices or with personal mode off. `make new-demo-password` replaces it with a new random one and applies it at once; after setting your own, run `make demo-password`. Empty: the sample accounts can't be signed into. |
| `PUBLIC_BASE_URL` | *(empty)* | The address share links use (sermon share pages, verse and chapter links), e.g. `https://bible.example.org`. Empty: links copied on the computer itself use its address on your network instead of `localhost`. |
| `SECRET_KEY` | *(random, set by setup)* | Signs session tokens and file links. Keep it secret; changing it signs everyone out. |
| `TOKEN_TTL_HOURS` | `72` | How long a sign-in lasts. |
| `CORS_ORIGINS` | `http://localhost:5173,…` | Origins allowed to call the API (only the Vite dev server needs this). |

## Gemini models and budget

Model names accept Google's `-latest` aliases. If a model is unavailable, the fallbacks are tried in order.

| Variable | Default | Used for |
|---|---|---|
| `GEMINI_MODEL_ANALYSIS` | `gemini-flash-latest` | Verse verification, sermon writing, the message locator, Explore content |
| `GEMINI_MODEL_FAST` | `gemini-flash-lite-latest` | Short summaries, tags, search parsing |
| `GEMINI_MODEL_TRANSCRIBE` | `gemini-flash-latest` | Transcribing uploads and caption-less YouTube videos |
| `GEMINI_MODEL_FALLBACKS` | `gemini-3-flash-preview,gemini-2.5-flash,…` | Tried when a model above is unavailable |
| `GEMINI_EMBED_MODEL` / `EMBEDDING_DIM` | `gemini-embedding-001` / `768` | Meaning-based search. The dimension must match the `vector(768)` columns. |
| `GEMINI_IMAGE_MODEL` / `GEMINI_IMAGE_MODEL_HQ` | `gemini-3.1-flash-image` / `gemini-3-pro-image` | Sermon visuals, slide scenes, Explore illustrations and story scenes ("High quality" uses the HQ model) |
| `GEMINI_IMAGE_FALLBACKS` | `gemini-2.5-flash-image,…` | Image fallbacks |
| `GEMINI_TTS_MODEL` / `GEMINI_TTS_FALLBACKS` / `GEMINI_TTS_VOICE` | `gemini-3.1-flash-tts-preview` / … / `Kore` | Story-video narration |
| `GEMINI_MAX_RPM` | `60` | Requests per minute (per process) |
| `GEMINI_CONCURRENCY` | `4` | Parallel AI calls while processing one resource |
| `GEMINI_TIMEOUT_SECONDS` | `180` | Per-request timeout |
| `GEMINI_DAILY_TOKEN_BUDGET` | `5000000` | When exceeded, AI stages degrade and uncertain work goes to review — nothing is published because AI failed |
| `GEMINI_THINKING_LEVEL` | `low` | Thinking level for Gemini 3 models (`low`, `medium`, `high`) |
| `GEMINI_THINKING_BUDGET` | *(unset)* | Only for models that support a thinking budget |
| `AI_CREATIVE_CALLS_PER_HOUR` | `120` | Per-user hourly cap on paid generation (sermon writing and visuals, Explore content, stories, illustrations) |
| `GEMINI_PRICE_*` | see `.env.example` | Prices used for the cost figures on the admin dashboard |

## Processing

| Variable | Default | What it does |
|---|---|---|
| `TRANSCRIBE_CHUNK_SECONDS` | `300` | Length of each transcription window; shorter windows give more accurate timestamps |
| `OFFICIAL_REQUIRES_REVIEW` | `true` | Verse links on resources marked *official* wait for an editor's approval |
| `FEEDBACK_HIDE_THRESHOLD` | `3` | Reader reports needed before an unreviewed link is hidden |
| `SEMANTIC_CANDIDATES` / `SEMANTIC_MAX_ACCEPTED` | `20` / `5` | Candidate verses considered and accepted per section |
| `DEFAULT_TRANSLATION` | `web` | Translation shown by default (`web`, `kjv`, `asv`) |
| `EMBED_BIBLE_ON_START` | `true` | Build the verse search index in the background when the API starts (resumable; `make embed` runs it now) |

## Uploads and limits

| Variable | Default | What it does |
|---|---|---|
| `MAX_UPLOAD_MB_MEDIA` | `1024` | Largest audio/video upload |
| `MAX_UPLOAD_MB_DOCUMENT` | `50` | Largest PDF/DOCX/text upload |
| `ALLOW_PRIVATE_URL_FETCH` | `false` | Allow fetching articles from private network addresses (keep off) |
| `RATE_LIMIT_PER_MINUTE` / `ASK_RATE_LIMIT_PER_MINUTE` | `120` / `12` | General API and Ask AI rate limits |

## Local services and paths

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://interactive_bible@localhost:54329/interactive_bible` | The app database |
| `TEST_DATABASE_URL` | `…/interactive_bible_test` | Used only by `make test`; must differ from `DATABASE_URL` |
| `PG_PORT` / `PG_BIN` | `54329` / auto | Local PostgreSQL port and binaries used by `scripts/pg.sh` |
| `API_PORT` / `WEB_PORT` | `8000` / `5173` | App port and Vite dev-server port |
| `API_HOST` | `0.0.0.0` | Where `make start` listens: `0.0.0.0` lets phones and other computers on your network open the app (they still sign in); `127.0.0.1` keeps it to this computer |
| `STORAGE_DIR` | `storage/` | Uploaded files, sermon media, story videos |
| `CACHE_DIR` | `.data/cache/` | Local caches |

## Background worker

| Variable | Default | What it does |
|---|---|---|
| `WORKER_SHUTDOWN_GRACE_SECONDS` | `4` | On stop, running jobs get this long to finish before they are handed back to the queue |
| `WORKER_HEARTBEAT_STALE_SECONDS` | `120` | Jobs of a worker that stopped checking in are requeued after this long |
