# Interactive Bible App

One local app for reading, exploring and preaching the Bible:

| Module | What it does |
|---|---|
| **Read & Library** | WEB / KJV / ASV reader with verse intelligence: sermons, podcasts, studies and articles are split into sections and linked to the exact verses they **mention, quote, explain or strongly relate to** — with timestamps, evidence, confidence, provenance and human review. Semantic search, Ask AI, Scripture Map, admin review workflow. |
| **Explore** | A journey atlas of 50 major Bible events on an offline map, a 583-event timeline (Creation → Revelation), family line to Jesus, people, a knowledge graph, AI teaching content, AI event illustrations and narrated **AI story videos** with MP4 export. |
| **Sermon Studio** | Turn typed notes, live dictation, voice memos, documents and Scripture references into a structured sermon: AI polish with 10 formats, 6 tones and 10 languages, rich-text editor, suggestions, speaker notes, AI visuals, a designed slide deck, PDF / PowerPoint / print / narrated video exports, social outreach copy and a public share page. |

**Everything runs on your machine** — PostgreSQL + pgvector, job queue and workers, file storage, Bible corpora, map data,
fonts and the web app. **The only remote dependency is the Gemini API** (text, embeddings, images and narration), and it is
only called where a feature needs AI.

The product merges three code bases: this Bible Tagger + Advanced Read build, the Sermon Builder (Next.js + Supabase) and the
Bible Journey Map explorer (Vite + Supabase/Vercel functions). Supabase auth, database and storage, Vercel functions, remote
map tiles and web-font CDNs were all replaced by local equivalents (see [How the merge works](#how-the-merge-works)).

---

## Quick start

```bash
make setup          # venv, npm build, local Postgres 17 + pgvector, Bible corpora, vocabularies, demo users + demo content
# add your key:  GEMINI_API_KEY=...  in .env
make check-gemini   # verifies key, models, JSON generation and embeddings
make start          # API (serves the web app) + worker in the background
open http://localhost:8000
```

Development mode with hot reload: `make dev` → http://localhost:5173 (Vite) with the API on :8000.
Stop background processes with `make stop` (Postgres keeps running; `scripts/pg.sh stop`).

**No sign-in on this computer.** The app runs in *personal mode* (`SINGLE_USER_MODE=true`): everything you open on this machine
acts as the owner account (**Ada Admin — full admin access**; rename yourself in the profile menu). Other devices on your network
(e.g. `http://<your-computer-ip>:8000`) still sign in with an account, so nobody else on the Wi-Fi gets owner access or spends your
Gemini credits. Set `SINGLE_USER_MODE=false` for a multi-user setup where everyone signs in, or `SINGLE_USER_TRUST_NETWORK=true` to
give every device owner access (only on a network you trust).

Accounts for other devices and multi-user mode (password `bible-demo`, configurable via `DEMO_PASSWORD`; visitors can also create
their own account on `/signup` unless `ALLOW_SIGNUP=false`):

| Account | Role | Use it to… |
|---|---|---|
| `admin@interactivebible.local` | admin | the owner in personal mode: metrics, system/AI status, everything an editor can do |
| `editor@interactivebible.local` | editor | review queue, approve/edit mappings, clip boundaries, ingest |
| `member@interactivebible.local` | member (Grace Community org) | sermons, story videos, organization + own private resources, upload |
| `outsider@interactivebible.local` | member (no org) | verify private resources and sermons never leak |

Prerequisites (macOS/Homebrew shown): `brew install postgresql@17 pgvector ffmpeg tesseract poppler node` and Python 3.11+.
`ffmpeg` is required (media processing, story-video MP4 export). `yt-dlp` (installed with the Python requirements) reads
public YouTube details and caption tracks; keep it current (`backend/.venv/bin/pip install -U yt-dlp`), because YouTube
changes often.

### Without a Gemini key
The app still runs in **degraded, fail-safe mode**: reading, explicit references (written, spoken, ASR-damaged), exact quotations,
named passages, captions-based media, documents, review, map, keyword search, the atlas, timeline, family line, knowledge graph,
previously generated (cached) Explore content and stories, and the whole Sermon Studio editor, exports and share pages work.
AI-only actions (transcription, semantic verse mapping, AI search, Ask AI, sermon polish/visuals/outreach, new story videos,
illustrations) return a clear "AI unavailable" message — nothing is published because AI failed.

---

## What you get

### Read, Search & Library

| Surface | Where |
|---|---|
| Advanced Read / Chapter — clean text, verse numbers, verse & range selection, mapped-resource indicators | `/read/:book/:chapter` |
| Verse Intelligence sheet — Watch, Listen, Study, Related Scripture + *Why related?*, Themes, People & Events, Scripture Map, Ask AI, and **Bring it to life** (start a sermon on the passage, open the matching atlas / timeline events) | side panel (desktop) / bottom sheet (mobile), `/verse/:ref` |
| Clip Player — starts at the mapped clip, clip-only or continue full source, captions, transcript with highlighted evidence, export (rights-checked) | `/clip/:segmentId` |
| Scripture Map — focused graph + accessible list view, filters | `/map?root=verse:ROM.8.28` |
| Semantic Bible Search — exact refs + natural language, parsed intent, reasons per result | `/search` |
| Library and resource detail — metadata, sections, transcript, mapped verses, topics | `/library`, `/resources/:id` |
| Add a **YouTube link** — paste a sermon's URL and the app reads the video's details and captions, maps the talk to verses and makes a short verse clip for each mapping | `/admin/ingest` |
| Admin — mapping review, ingest (file, YouTube/web link, text, captions), processing monitor, feedback, audit, metrics, vocabularies, system & AI status | `/admin/*` |

#### YouTube links

Paste a YouTube URL in **Add to library** and the app:

1. reads the video's title, channel, length, thumbnail and chapters, and lists its caption tracks (`yt-dlp`, no download);
2. takes the transcript from the video's own captions — a human-made track when there is one, otherwise the auto-generated
   one; a video with no captions at all is transcribed by Gemini instead (slower, and it costs AI credits);
3. splits the talk into sections (speech pauses carry the split for auto-generated captions, which have no punctuation),
   links each section to the verses it mentions, quotes or explains, and picks a **short clip** around the evidence;
4. plays every verse clip in YouTube's own embedded player, bounded to that clip — from the verse panel, the library and `/clip/:id`.

A recorded service is usually part worship, part teaching. Captions mark the songs (`[Music]`, `[singing]`, `♪`), so those
sections are detected (`resource_segments.non_speech_ratio`), kept out of the AI analysis and never mined for verse links —
the mapping comes from the preaching, and the AI bill drops with it. Measured on a 65-minute service: 32 of its 65 minutes
are music, 24 of 47 sections were skipped, and verse links fell from 71 (46 of them sung lines) to 48 with 5 left in songs
that quote Scripture.

**The video is never downloaded or re-hosted**: only its transcript and details are stored locally, rights are set to
`embed_only`, and file export stays disabled. A 10-minute sermon processes in about a minute on the captions path
(measured: 207 caption cues → 87 sentences → 6 sections of 76–147 s, each with its own clip and verse links).

### Explore — `/explore`

| Feature | Notes |
|---|---|
| Journey atlas | 50 events with travel routes, regions and illustrated markers on an **offline Natural Earth basemap** (relief, parchment and night styles; no tile server). Shareable URLs: `/explore?event=red_sea_crossing&tab=story` |
| Timeline | 583 events grouped into eras with search, OT/NT and major-event filters; references open the passage in Read; *Open on map*, *Open lineage*, *Start a sermon*; deep links `/explore?view=timeline&t=<event id>` |
| Info, Family, People, Graph tabs | event details, ancient/modern locations, family line to Jesus (interactive tree), people perspectives, Bible knowledge graph |
| AI teaching content (E-01) | summary, map and lineage explanations, application, discussion questions, quiz — generated once, then served free to everyone from the cache |
| AI story videos (E-02) | a background job writes the script, paints 3–6 scenes (landscape 16:9 or portrait 9:16) and records the narration (Gemini TTS) with live progress; stories are saved and shared. Play in the browser, render a captioned video in the browser, or export a full-HD H.264 **MP4** rendered locally with ffmpeg |
| AI event illustrations | a painted hero image for an event's map card, only when a signed-in user asks |
| Timeline AI (E-03/E-04) | *Explain* an event for kids / general / study / pastors, and a guided *Story mode* through several events |

### Sermon Studio — `/sermons`

1. **Collect** — typed notes, live dictation (Web Speech API), audio upload with Gemini transcription (long recordings are chunked),
   PDF/DOCX/TXT/MD/HTML documents (extracted locally), and Bible references resolved to the **exact local verse text**.
2. **Polish** — S-01 turns everything into a structured sermon (title, theme, scripture, introduction, points, applications,
   conclusion, prayer) in the chosen format, tone and language; every Scripture reference is grounded with the exact verse text.
   Apply another template, edit in the rich-text editor (autosaved, sanitised server-side), get suggestions (hooks, illustrations,
   cross references, applications) and speaker notes.
3. **Visuals** — AI images (illustration, map, timeline, scripture slide, title graphic; typed or auto prompt; high-quality option),
   a planned visual set, captions, regenerate, download.
4. **Present & publish** — 5 export themes, a designed slide deck with scene images and diagrams (S-05), PDF, PowerPoint and print
   exports, recorded-narration video, outreach copy (summary, caption, hashtags, Instagram, Facebook, X thread) and a public
   share page `/share/:slug` that can be unpublished at any time.

Sermons are private to their author (another user — admins included — gets *not found*).

### A ten-minute tour
1. **Read** → Romans 8 → tap verse 28 → *Watch* → **Watch clip**; open **Related** → *Why related?*; in *Bring it to life* open the timeline event.
2. **Explore** → *Crossing the Red Sea* → **Video** → *Create story video* → watch the scenes being painted → play it → **MP4 (HD)**.
3. **Timeline** → *The Exodus Begins* → **Explain** (Kids) → *Start a sermon*.
4. **Sermon Studio** → *New sermon* → add notes, a voice memo and *Romans 8:28-30* → **Polish** → edit → **Visuals** → **Design deck** → export PDF / PowerPoint → **Publish** and open the share link.
5. **Admin → Review queue** → approve / edit a mapping → see it in Read.
6. From another device (accounts mode) sign in as `outsider@interactivebible.local` → private resources and other people's sermons never appear.

---

## Architecture

```
                ┌──────────────────────────────────── local machine ─────────────────────────────────────┐
 React 19 SPA   │  FastAPI API ──────── PostgreSQL 17 + pgvector ──────── Worker(s)                        │
 Read · Explore ┼─▶ /v1/...              (corpus, resources, mappings,     (SKIP LOCKED job queue:         │
 Sermon Studio  │  /v1/sermons           sermons, stories, jobs, audit,     pipeline, embeddings, ai,      │
 Admin          │  /v1/explore           LLM cache + call log)              media: clips, story videos)    │
                │  /v1/files (signed)         │                                   │                          │
                │  local storage (resources, sermons/, explore/)      ffmpeg · pypdf · tesseract · Pillow   │
                └─────────┼───────────────────────────────────────────────────────┼──────────────────────────┘
                          └───────────────────── Gemini API (only remote) ─────────┘
                        generateContent (P/S/E prompts) · embeddings · image generation · text-to-speech
```

* **Backend** `backend/interactive_bible/` — FastAPI + SQLAlchemy 2 + psycopg 3, plain SQL migrations (`backend/migrations`).
  * `api/` — `main.py` (Read, search, resources, admin, auth, jobs), `sermons.py`, `explore.py`, `files.py` (HMAC-signed file URLs).
  * `services/sermons/` — CRUD + owner-only access, inputs (transcription, extraction, verse grounding), writing (polish,
    templates, suggestions, notes, outreach), slide plan + visuals, HTML sanitiser.
  * `services/explore/` — event/timeline data + reference index, AI content, story jobs, ffmpeg video export, illustrations, timeline AI.
  * `pipeline/`, `ingest/`, `retrieval/`, `bible/`, `vocab/` — the Scripture intelligence pipeline, parser, retrieval and vocabularies.
  * `ai/` — Gemini REST client (model aliases + fallbacks, JSON-schema output, retries/backoff, rate limiting, image and TTS),
    prompt pack (P-00…P-15 Read, S-01…S-07 Sermon Studio, E-01…E-04 Explore) with versions, schemas, cache, token budget, call log.
* **Frontend** `frontend/src/` — React 19 + TypeScript + Vite 7 + Tailwind CSS 4 + TanStack Query, Base UI / shadcn-style
  components, light and dark themes, responsive with a phone tab bar. Feature modules: `features/explore/` (atlas, timeline,
  story player; Leaflet with the offline basemap), `features/sermons/` (dashboard, workspace stages, exports, share page).
  Fonts (Inter, Fraunces, Source Serif 4, JetBrains Mono) are bundled locally.
* **Data** `data/bible/` — World English Bible, KJV, ASV (public domain, eBible.org) and OpenBible.info cross references (CC-BY).
  `data/explore/` — atlas events and the timeline. `frontend/public/geo/` — Natural Earth relief + vectors (public domain),
  built by `scripts/build_geodata.py`.

### Processing pipeline (Read & Library)

| Stage | Implementation |
|---|---|
| ING-01/02 validate & store | magic-byte + extension checks, executable/zip-bomb guard, size limits, content-addressed storage, source hash |
| ING-03 extract / transcribe | PDF text layer → Tesseract OCR per page when empty · DOCX · Markdown · HTML article (SSRF-guarded fetch) · captions (VTT/SRT) · **Gemini P-00** on silence-aligned ffmpeg chunks with timestamp validation/repair |
| ING-04 normalize | raw text kept unchanged; normalized text separately with unit offsets |
| ING-05 segment | spoken: 30–120 s target, never split sentences/quotes, **P-01** refinement · documents: headings, 1–4 paragraphs |
| ING-06 explicit refs | deterministic parser → **P-02** only for spoken/ambiguous/context/ASR forms |
| ING-07 quotes | shingle index candidates across translations → **P-03** classification with grounded evidence |
| contextual refs | named stories/passages vocabulary (e.g. *prodigal son* → LUK.15.11-32) and justified chapter-context inheritance |
| ING-08 candidates | Gemini embeddings + pgvector + full-text + theme-only + verse hints, RRF fusion |
| ING-09 verify & classify | **P-04** (≤5 strong verses, evidence must be in the segment) → merge/dedupe/range collapse → **P-05** primary verse |
| ING-10/11 | **P-06** topics/entities against controlled vocabularies · **P-07** ≤28-word summary |
| ING-12 clips | **P-08** snapped to sentence boundaries, 15–180 s; deterministic fallback |
| audit | **P-12** second-pass audit (reject / needs review) |
| ING-15 routing | confidence thresholds, editorial review for official content, low-confidence queue |
| ING-13/14/16 | atomic swap per resource; human-reviewed mappings protected & migrated on re-segmentation; verse topic aggregation; cache invalidation |

Confidence rules: **≥0.95** publish · **0.90–0.94** publish · **0.80–0.89** kept for search and review (see the AI Related policy
below; official content waits for approval) · **0.65–0.79** index/search only + review queue · **<0.65** discarded.
*Confidence is not theological truth* — this note is shown in the UI.

---

## How the merge works

| In the original projects | In the Interactive Bible App |
|---|---|
| Supabase Auth (sermon-builder, explorer) | personal mode (no sign-in on this computer, owner = admin) plus local accounts for other devices: scrypt password hashes, signed tokens (HTTP-only cookie + bearer), sign-up page, profile |
| Supabase Postgres tables + RLS | local PostgreSQL tables (`002_sermon_studio_and_explore.sql`) with owner checks in every query |
| Supabase Storage buckets | `storage/sermons/…` and `storage/explore/…` served through HMAC-signed `/v1/files` URLs |
| Next.js API routes / Vercel functions calling Gemini | FastAPI endpoints and worker jobs using the shared Gemini client, prompt pack, cache, budget and cost log |
| No YouTube ingest (uploads only) | pasted YouTube links become library resources: captions read with yt-dlp, verses mapped by the same pipeline, verse clips bounded in the YouTube embed |
| Browser-side story generation + remote map tiles | `generate_story` job with progress and resume, ffmpeg `export_story_video` job, offline Natural Earth basemap |
| Separate apps and brands | one React SPA and design system; cross-links Read ⇄ Explore ⇄ Sermon Studio |

---

## Configuration

All settings live in `.env` (see `.env.example`). The important ones:

| Variable | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | — | required for AI features |
| `GEMINI_MODEL_ANALYSIS` / `_FAST` / `_TRANSCRIBE` | `gemini-flash-latest` / `gemini-flash-lite-latest` / `gemini-flash-latest` | unavailable models fall back to `GEMINI_MODEL_FALLBACKS` |
| `GEMINI_IMAGE_MODEL` / `_HQ` / `_FALLBACKS` | `gemini-3.1-flash-image` / `gemini-3-pro-image` / … | sermon visuals, slide scenes, story scenes, event illustrations |
| `GEMINI_TTS_MODEL` / `_FALLBACKS`, `GEMINI_TTS_VOICE` | `gemini-3.1-flash-tts-preview`, `Kore` | story narration |
| `GEMINI_EMBED_MODEL`, `EMBEDDING_DIM` | `gemini-embedding-001`, `768` | dimension must match the `vector(768)` columns |
| `GEMINI_MAX_RPM`, `GEMINI_CONCURRENCY` | 60, 4 | per-process rate limit and parallel segment analysis |
| `GEMINI_DAILY_TOKEN_BUDGET` | 5,000,000 | when exceeded, AI stages degrade and route to review |
| `AI_CREATIVE_CALLS_PER_HOUR` | 120 | per signed-in user: sermon + Explore generation endpoints |
| `SINGLE_USER_MODE`, `OWNER_USER_ID` | true, `usr_admin` | personal mode: no sign-in on this computer; requests from localhost act as the owner (admin) |
| `SINGLE_USER_TRUST_NETWORK` | false | also give owner access to other devices that can reach the port |
| `ALLOW_SIGNUP` | true | show the sign-up page (accounts mode / other devices) |
| `TRANSCRIBE_CHUNK_SECONDS` | 300 | shorter chunks = more accurate timestamps |
| `OFFICIAL_REQUIRES_REVIEW` | true | official content waits for editorial approval |
| `EMBED_BIBLE_ON_START` | true | builds the verse embedding index in the background (resumable; `make embed` to run it now) |
| `WORKER_SHUTDOWN_GRACE_SECONDS`, `WORKER_HEARTBEAT_STALE_SECONDS` | 4, 120 | graceful stop; jobs of a silent worker are requeued |

---

## Useful commands

```bash
make status | stop | start | dev
make seed            # register + process demo resources again
make reset-demo      # wipe resources/mappings and re-seed (sermons, stories and accounts are kept)
make demo-media      # rebuild the demo sermon video, podcast, PDF and DOCX (macOS `say` + ffmpeg)
make embed           # build the verse embedding index now
make test            # backend tests (interactive_bible_test database)
make eval            # evaluation harness on eval/gold (deterministic, or AI when a key is set)
make build           # production build of the web app (frontend/dist, served by the API)
scripts/pg.sh psql   # SQL shell on the local database
backend/.venv/bin/python scripts/build_geodata.py   # rebuild the offline basemap from Natural Earth (setup-time download)
```

API documentation (OpenAPI): http://localhost:8000/docs. Prometheus metrics: http://localhost:8000/metrics.

**Backup & migrations.** `make backup` writes a PostgreSQL dump plus the object storage to `.data/backups/<timestamp>`;
`make restore BACKUP=.data/backups/<timestamp>` restores both. Schema changes are ordered, checksummed SQL files in
`backend/migrations/` applied automatically on start.

---

## Tests & evaluation

* `make test` — **643 backend tests** against the separate `interactive_bible_test` database with an offline fake Gemini client
  (a guard in `conftest.py` blocks Google hosts), including:
  * Read & Library: acceptance criteria end to end (real media through the API + worker, visibility leaks, human-review protection,
    idempotent retries, rights-checked export), RBAC, review/audit/feedback, uploads, job queue, LLM service, reference parser,
    Gemini wire format (text, embeddings, images, TTS).
  * Sermon Studio (99): CRUD and owner isolation, text/Scripture/audio/document inputs, polish/template/suggestions/notes with
    grounding, sanitiser, concurrency, visuals and slide plans with partial failures, outreach and share pages.
  * YouTube links (23): link parsing, caption-track choice (human-made over auto, machine translations ignored), cue
    parsing, readable failures, the inspect endpoint, prefilled resources, and two end-to-end runs (punctuated and
    auto-generated captions) down to the verse clips, plus a church-service recording where the worship songs are separated
    from the teaching — all with a stubbed extractor, never touching the network.
  * Explore (81): data and by-verse matching for every reference in both data files, AI content, story jobs with progress,
    partial failures and regeneration clean-up, **real ffmpeg** MP4 export, illustrations, timeline AI, rate limits.
* `make eval` — the Scripture-mapping harness on 71 gold items + the demo resources (see `eval/README.md`). With live Gemini:
  explicit P/R 1.00/1.00, quote precision 1.00, semantic precision/recall 0.91/1.00, hard-negative false positives 0.
* Live end-to-end checks against Gemini were run for Explore (content, explain, story mode, illustration, a 4-scene story with
  narration and a 1920×1080 MP4) and Sermon Studio (transcription, polish, template, suggestions, notes, images, a 39-slide deck
  with scene images, outreach, publish, share page).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `make check-gemini` fails with *auth* | the key in `.env` is wrong or restricted; create one at https://aistudio.google.com/apikey, then `make stop && make start` |
| Gemini *quota* / 429 errors | lower `GEMINI_MAX_RPM` / `GEMINI_CONCURRENCY`; jobs retry with backoff and resume from cache |
| a model is *not found* | pick one from `make check-gemini` or rely on the `*_FALLBACKS` settings (image and TTS models too) |
| "You have reached the hourly AI limit" | raise `AI_CREATIVE_CALLS_PER_HOUR` |
| story video stuck on *queued* / resource stuck in *queued* | the worker is not running: `make status`, then `make start` (logs in `.data/logs/worker.log`) |
| MP4 export fails with *ffmpeg is not installed* | `brew install ffmpeg`, then `make stop && make start` |
| a YouTube link is refused (*private*, *unavailable*, *members-only*, *live*) | the message says which: the video has to be public or unlisted, and a live stream has to finish first |
| *YouTube refused the request* | try again in a few minutes, then update yt-dlp: `backend/.venv/bin/pip install -U yt-dlp` |
| a YouTube video has no captions | the app falls back to Gemini transcription (costs credits); add captions on YouTube, or upload a VTT/SRT file and set transcript mode *captions* |
| live dictation button missing | the browser has no Web Speech API (use Chrome, Edge or Safari) |
| `postmaster became multithreaded during startup` (macOS) | use `scripts/pg.sh` (it sets `LC_ALL=en_US.UTF-8`) |
| port 8000 / 5173 already in use | `make stop`; set `API_PORT` / `WEB_PORT` in `.env` |
| semantic search shows *keyword + references* | add the Gemini key; verse embeddings build in the background (**Admin → System & AI** shows progress) |

## Notable decisions

* **PostgreSQL job queue** instead of a separate broker — story generation and MP4 rendering run as jobs with progress, heartbeats
  and graceful hand-back, so a page reload or restart never loses work.
* **Shared AI results are cached for everyone.** Explore content, timeline explanations and stories are the same for every reader,
  so they are generated once (by a signed-in user) and then served without calling Gemini — also when AI is unavailable.
* **Grounded Scripture.** Sermon polish, templates, suggestions, Bible-reference inputs and slide scripture use the exact local
  verse text; the model is told to quote only supplied text. Scripture-slide images letter only the reference (Gemini refuses to
  paint long verse text as *recitation*; the app retries once without lettering).
* **Offline basemap.** Natural Earth II relief is reprojected to Web Mercator and cropped to the atlas bounds so the map works with
  no network; vectors are clipped and simplified at build time.
* **Content-addressed segment IDs** keep human-reviewed mappings attached across reprocessing.
* **Virtual clips** by default; physical export only when rights allow.
* **Gemini model aliases** (`*-latest`) with automatic fallback and schema-mode fallback so the app keeps working as model versions change.
* **AI Related is shown only when it is the strongest, well-supported match (≥ 0.90)** — measured with live Gemini, weaker matches
  were mostly thematic neighbours, so they are kept for search and editorial review instead of being displayed.
* **Embedding requests use request-level `taskType` / `outputDimensionality`** (a nested config is silently ignored by the API).
* Licensing: only public-domain Bible translations are bundled; cross references are CC-BY; map data is Natural Earth (public domain).
