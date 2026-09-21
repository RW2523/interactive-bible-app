# Contributing

Thanks for helping! Bug reports, fixes, documentation and ideas are all welcome.

## Ground rules

- **Local first.** Everything runs on the user's computer. The only remote dependency is the Gemini API — please don't
  add other cloud services, SDKs, tile servers or font CDNs.
- **Never commit secrets.** `.env` is git-ignored; `.env.example` holds placeholders only.
- **Respect content rights.** Don't commit third-party media, transcripts or copyrighted Bible translations. Public-domain
  texts are downloaded at setup time (`scripts/fetch_data.sh`).
- Be kind — see the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting set up

```bash
make setup      # Python venv, npm install + build, local Postgres 17 + pgvector, Bible texts, demo content
make dev        # API with auto-reload on :8000 + worker + Vite dev server on http://localhost:5173
```

AI features need a Gemini key in `.env` (`GEMINI_API_KEY=...`); everything else works without one.
See [docs/development.md](docs/development.md) for the project layout and day-to-day commands.

## Before you open a pull request

```bash
make test        # backend test suite (uses the separate interactive_bible_test database, AI is faked)
make typecheck   # TypeScript
make build       # production build of the web app
```

- Add or update tests for behaviour you change. Tests never call the real Gemini API (a guard blocks Google hosts) —
  use the fakes in `backend/tests/fakes.py`.
- Changing an AI prompt (`backend/interactive_bible/ai/prompts/*.md`)? Bump its `version`, keep the output schema in
  sync with `ai/schemas*.py`, and — for the Scripture-mapping prompts — run `make eval-ai` and report the numbers.
- Database changes go in a new numbered file in `backend/migrations/` (never edit an applied migration).
- Match the surrounding code style; keep UI text plain and friendly, and check light + dark themes and a phone width.
- Update the docs (`README.md`, `docs/`) when behaviour or setup changes, and add a line to `CHANGELOG.md`.

## Reporting bugs and ideas

Use the issue templates. For security problems, follow [SECURITY.md](SECURITY.md) instead of opening an issue.
