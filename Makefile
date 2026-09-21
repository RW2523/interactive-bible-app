PY := backend/.venv/bin/python
CLI := cd backend && PYTHONPATH=. .venv/bin/python -m interactive_bible.cli

.PHONY: help setup start dev stop status db-start db-stop bootstrap seed reseed check-gemini embed test eval eval-ai build typecheck fetch-data demo-media reset-demo backup restore demo-password new-demo-password

help:
	@echo "make setup         one-shot local setup (venv, npm, Postgres, Bible corpus, demo content)"
	@echo "make start         run API (serves web app) + worker in the background  → http://localhost:8000"
	@echo "make dev           API --reload + worker + Vite dev server (foreground)   → http://localhost:5173"
	@echo "make stop|status   stop / inspect background processes"
	@echo "make check-gemini  verify GEMINI_API_KEY, models, JSON generation and embeddings"
	@echo "make embed         build the Bible verse embedding index now (resumable)"
	@echo "make seed          register + process the demo resources"
	@echo "make new-demo-password  new password for the sample accounts (saved as DEMO_PASSWORD in .env)"
	@echo "make demo-password      apply DEMO_PASSWORD from .env to the sample accounts"
	@echo "make reset-demo    wipe resources/mappings and re-seed the demo"
	@echo "make test          backend test suite (uses the interactive_bible_test database)"
	@echo "make eval          evaluation harness on the gold set (deterministic or AI when a key is set)"

setup:
	scripts/setup.sh

start:
	scripts/run.sh start

dev:
	scripts/run.sh dev

stop:
	scripts/run.sh stop

status:
	scripts/run.sh status

db-start:
	scripts/pg.sh start

db-stop:
	scripts/pg.sh stop

fetch-data:
	scripts/fetch_data.sh

bootstrap:
	$(CLI) bootstrap

seed:
	$(CLI) seed-demo --approve

demo-media:
	$(PY) demo_content/build_demo_media.py

reset-demo:
	scripts/pg.sh psql -q -c "TRUNCATE resources, jobs, processing_runs, llm_calls, review_actions, feedback, analytics_events, search_logs CASCADE; DELETE FROM verse_relationships WHERE source <> 'openbible'; DELETE FROM verse_topics WHERE provenance->>'source' IS DISTINCT FROM 'curated_topic_index'; DELETE FROM verse_entities;"
	rm -rf storage/originals storage/derived storage/work storage/exports
	$(CLI) seed-demo --approve

check-gemini:
	$(CLI) check-gemini

demo-password:
	$(CLI) demo-password

new-demo-password:
	$(CLI) demo-password --new

embed:
	$(CLI) embed-bible --all

build:
	cd frontend && npm run build

typecheck:
	cd frontend && npx tsc --noEmit -p .

test:
	cd backend && PYTHONPATH=. .venv/bin/python -m pytest -q

eval:
	$(CLI) eval --mode auto

eval-ai:
	$(CLI) eval --mode ai

# Backup: database (custom-format dump) + object storage. Restore: make restore BACKUP=.data/backups/<stamp>
backup:
	@mkdir -p .data/backups/$$(date +%Y%m%dT%H%M%S) && d=.data/backups/$$(ls -t .data/backups | head -1) && \
	PG_BIN=$${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}; \
	$$PG_BIN/pg_dump -h localhost -p $${PG_PORT:-54329} -U interactive_bible -Fc interactive_bible -f $$d/interactive_bible.dump && \
	tar -czf $$d/storage.tgz storage && echo "backup written to $$d"

restore:
	@test -n "$(BACKUP)" || (echo "usage: make restore BACKUP=.data/backups/<stamp>" && exit 1)
	scripts/run.sh stop
	PG_BIN=$${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}; \
	$$PG_BIN/pg_restore -h localhost -p $${PG_PORT:-54329} -U interactive_bible -d interactive_bible --clean --if-exists $(BACKUP)/interactive_bible.dump
	tar -xzf $(BACKUP)/storage.tgz
	@echo "restored from $(BACKUP) — start again with make start"
