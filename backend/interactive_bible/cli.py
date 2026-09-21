"""Command line: python -m interactive_bible.cli <command>

  bootstrap          migrate + load Bible corpora + cross references + vocabularies + demo users
  migrate            apply SQL migrations
  seed-demo          register the demo resources (demo_content/manifest.json) and process them
  process <id>       process one resource synchronously (no worker needed)
  embed-bible        embed Bible verses with Gemini (resumable; --max-batches N)
  check-gemini       verify the Gemini key, models, JSON generation and embeddings
  create-user        create a user: --email --name --role --password [--org]
  eval               run the evaluation harness (see eval/run_eval.py)
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from .config import PROJECT_ROOT, get_settings
from .db import execute, fetch_one, json_dumps, session_scope
from .logging_setup import setup_logging

log = logging.getLogger("interactive_bible.cli")

DEMO_ORG = ("org_grace", "Grace Community Church")
DEMO_USERS = [
    ("usr_admin", "admin@interactivebible.local", "Ada Admin", "admin", True),
    ("usr_editor", "editor@interactivebible.local", "Eli Editor", "editor", True),
    ("usr_member", "member@interactivebible.local", "Mia Member", "member", True),
    ("usr_outsider", "outsider@interactivebible.local", "Oscar Outsider", "member", False),
]


def cmd_migrate(_: argparse.Namespace) -> None:
    from .migrate import migrate

    print("applied:", migrate() or "up to date")


def ensure_users() -> None:
    from .security import hash_password, verify_password

    password = get_settings().demo_password
    with session_scope() as s:
        execute(s, "INSERT INTO organizations (id, name) VALUES (:id, :name) ON CONFLICT DO NOTHING", id=DEMO_ORG[0], name=DEMO_ORG[1])
        for uid, email, name, role, in_org in DEMO_USERS:
            existing = fetch_one(s, "SELECT email, password_hash FROM users WHERE id = :id", id=uid)
            if not existing:
                execute(s, "INSERT INTO users (id, email, display_name, password_hash, role) VALUES (:id, :e, :n, :p, :r)", id=uid, e=email, n=name, p=hash_password(password), r=role)
            elif existing["email"] != email or not verify_password(password, existing["password_hash"]):
                # demo accounts follow the configured demo email/password (e.g. after a rename or a DEMO_PASSWORD change)
                execute(s, "UPDATE users SET email = :e, display_name = :n, role = :r, password_hash = :p WHERE id = :id",
                        id=uid, e=email, n=name, r=role, p=hash_password(password))
            if in_org:
                execute(s, "INSERT INTO organization_members (organization_id, user_id) VALUES (:o, :u) ON CONFLICT DO NOTHING", o=DEMO_ORG[0], u=uid)


def cmd_bootstrap(_: argparse.Namespace) -> None:
    from .bible import loader
    from .migrate import migrate
    from .vocab.service import seed_vocabulary

    print("migrations:", migrate() or "up to date")
    with session_scope() as s:
        print("verses:", loader.load_books_and_verses(s))
    with session_scope() as s:
        print("translations:", loader.load_translations(s))
    with session_scope() as s:
        print("cross references:", loader.load_cross_references(s))
    with session_scope() as s:
        print("vocabulary:", seed_vocabulary(s))
    ensure_users()
    print(f"demo users ready (password: {get_settings().demo_password}): " + ", ".join(u[1] for u in DEMO_USERS))


def _register(manifest_item: dict, owner: str, visibility: str | None = None, transcript_mode: str = "auto") -> str:
    from . import storage
    from .ids import new_id, sha256_text

    m = manifest_item
    rid = new_id("res")
    src_key = src_hash = cap_key = mime = None
    size = None
    filename = None
    if m.get("source_path"):
        path = PROJECT_ROOT / m["source_path"]
        with open(path, "rb") as fh:
            src_key, src_hash, size = storage.save_stream(fh, path.name)
        filename = path.name
        mime = {".mp4": "video/mp4", ".mp3": "audio/mpeg", ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}.get(path.suffix.lower())
    if m.get("captions_path"):
        with open(PROJECT_ROOT / m["captions_path"], "rb") as fh:
            cap_key, _, _ = storage.save_stream(fh, Path(m["captions_path"]).name)
    body = (PROJECT_ROOT / m["body_text_path"]).read_text(encoding="utf-8") if m.get("body_text_path") else None
    rtype = m["type"] if m["type"] != "article" or body is None else "article"
    with session_scope() as s:
        execute(s, """INSERT INTO resources (id, type, category, title, description, source_kind, source_uri, source_hash, original_filename, mime_type, size_bytes,
                          captions_uri, body_text, owner_id, organization_id, visibility, rights_status, allow_clip_export, is_official, language, author, speaker,
                          duration_ms, topic_hints, transcript_mode, status, metadata)
                      VALUES (:id, :type, :cat, :title, :desc, :sk, :su, :sh, :fn, :mime, :size, :cap, :body, :owner, :org, :vis, :rights, :export, :official, :lang,
                          :author, :speaker, :duration, :th, :mode, 'ready', CAST(:meta AS jsonb))""",
                id=rid, type=rtype, cat=m["category"], title=m["title"], desc=m.get("description"), sk="upload" if src_key else "native", su=src_key,
                sh=src_hash or (sha256_text(body) if body else None), fn=filename, mime=mime, size=size, cap=cap_key, body=body, owner=owner,
                org=DEMO_ORG[0] if (visibility or m.get("visibility")) == "organization" else None, vis=visibility or m.get("visibility", "public"),
                rights=m.get("rights_status", "owned"), export=bool(m.get("allow_clip_export")), official=bool(m.get("is_official")), lang=m.get("language", "en"),
                author=m.get("author"), speaker=m.get("speaker"), duration=m.get("duration_ms"), th=m.get("topic_hints") or [], mode=transcript_mode,
                meta=json_dumps({"demo_key": m["key"]}))
    return rid


def cmd_seed_demo(args: argparse.Namespace) -> None:
    from .ai.llm import get_llm
    from .pipeline.orchestrator import create_run, process_resource

    from .vocab.service import seed_vocabulary

    ensure_users()
    with session_scope() as s:
        seed_vocabulary(s)  # idempotent; restores curated topic rows before demo processing
    manifest = json.loads((PROJECT_ROOT / "demo_content" / "manifest.json").read_text())
    mode = args.transcript_mode
    if mode == "auto":
        mode = "gemini" if get_llm().available and not args.captions else "captions"
    created = []
    with session_scope() as s:
        existing = {r["k"] for r in __import__("interactive_bible.db", fromlist=["fetch_all"]).fetch_all(s, "SELECT metadata->>'demo_key' AS k FROM resources WHERE deleted_at IS NULL AND metadata ? 'demo_key'")}
    for item in manifest:
        if item["key"] in existing and not args.force:
            print(f"skip {item['key']} (already registered; use --force to add again)")
            continue
        rid = _register(item, "usr_editor", transcript_mode=mode if item["type"] in ("video", "audio") else "auto")
        created.append((item["key"], rid))
    # an organisation-only and a private resource to demonstrate visibility rules (AC-08)
    if args.visibility_demo and "private_note" not in existing:
        private = {"key": "private_note", "title": "Private Pastoral Note on Romans 8:28", "type": "native", "category": "study", "author": "Mia Member",
                   "visibility": "private", "rights_status": "owned", "body_text_path": None, "description": "Private notes (visible only to their owner)."}
        from .ids import new_id

        rid = new_id("res")
        with session_scope() as s:
            execute(s, """INSERT INTO resources (id, type, category, title, description, source_kind, body_text, owner_id, visibility, rights_status, language, author, status, metadata)
                          VALUES (:id, 'native', 'study', :t, :d, 'native', :b, 'usr_member', 'private', 'owned', 'en', 'Mia Member', 'ready', CAST(:m AS jsonb))""",
                    id=rid, t=private["title"], d=private["description"],
                    b="# Private reflection\n\nRomans 8:28 has carried me through a hard year. I am writing these notes for myself only.", m=json_dumps({"demo_key": "private_note"}))
        created.append(("private_note", rid))
    for key, rid in created:
        with session_scope() as s:
            run = create_run(s, rid, "usr_editor", {"seed": True})
        try:
            res = process_resource(rid, run, {})
            m = res["metrics"]
            print(f"processed {key:<32} {rid}  segments={m.get('segments')} mappings={m.get('mappings_by_status')} degraded={res['degraded']}")
        except Exception as exc:  # noqa: BLE001
            print(f"FAILED {key}: {exc}")
    if args.approve:
        with session_scope() as s:
            n = execute(s, """UPDATE verse_resource_links SET review_status = 'approved', is_human_verified = true, needs_review = false, updated_at = now()
                              WHERE review_status = 'pending_review' AND round(confidence::numeric, 3) >= 0.95 AND resource_id IN (SELECT id FROM resources WHERE metadata ? 'demo_key')""").rowcount
            execute(s, """INSERT INTO review_actions (id, object_type, object_id, reviewer_id, action, note)
                          SELECT 'rev_seed_' || l.id, 'mapping', l.id, 'usr_editor', 'approve', 'Demo seed: editor approval of high-confidence official mappings'
                          FROM verse_resource_links l WHERE l.is_human_verified AND l.resource_id IN (SELECT id FROM resources WHERE metadata ? 'demo_key') ON CONFLICT DO NOTHING""")
            from . import cache

            cache.bump_global(s)
        print(f"approved {n} high-confidence pending mappings as the demo editor")


def cmd_process(args: argparse.Namespace) -> None:
    from .pipeline.orchestrator import create_run, process_resource

    with session_scope() as s:
        run = create_run(s, args.resource_id, None, {"cli": True})
    print(json.dumps(process_resource(args.resource_id, run, {"reset_human": args.reset_human, "force_retranscribe": args.force_retranscribe}), indent=2, default=str))


def cmd_embed(args: argparse.Namespace) -> None:
    from .services.embeddings import embed_bible_batch, embedding_progress

    print(json.dumps(embedding_progress(), default=str))
    while True:
        res = embed_bible_batch(max_batches=args.max_batches)
        print(json.dumps({k: v for k, v in res.items() if k != "progress"}, default=str))
        if res.get("stopped") or res.get("remaining", 0) == 0 or not args.all:
            break


def cmd_check_gemini(_: argparse.Namespace) -> None:
    from .services.metrics import gemini_doctor

    result = gemini_doctor(force=True)
    print(json.dumps(result, indent=2, default=str))
    sys.exit(0 if result.get("ok") else 1)


def cmd_create_user(args: argparse.Namespace) -> None:
    from .ids import new_id
    from .security import hash_password

    with session_scope() as s:
        uid = new_id("usr")
        execute(s, "INSERT INTO users (id, email, display_name, password_hash, role) VALUES (:id, :e, :n, :p, :r)", id=uid, e=args.email, n=args.name, p=hash_password(args.password), r=args.role)
        if args.org:
            execute(s, "INSERT INTO organization_members (organization_id, user_id) VALUES (:o, :u)", o=args.org, u=uid)
    print("created", uid)


def cmd_eval(args: argparse.Namespace) -> None:
    sys.path.insert(0, str(PROJECT_ROOT / "eval"))
    import run_eval  # type: ignore

    run_eval.main(["--mode", args.mode] + (["--limit", str(args.limit)] if args.limit else []))


def main(argv: list[str] | None = None) -> None:
    setup_logging(logging.WARNING)
    parser = argparse.ArgumentParser(prog="interactive-bible")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate").set_defaults(fn=cmd_migrate)
    sub.add_parser("bootstrap").set_defaults(fn=cmd_bootstrap)
    p = sub.add_parser("seed-demo")
    p.add_argument("--force", action="store_true")
    p.add_argument("--approve", action="store_true", help="approve >=0.95 official mappings as the demo editor (others stay in the review queue)")
    p.add_argument("--captions", action="store_true", help="use bundled captions instead of Gemini transcription")
    p.add_argument("--transcript-mode", default="auto", choices=["auto", "gemini", "captions"])
    p.add_argument("--no-visibility-demo", dest="visibility_demo", action="store_false")
    p.set_defaults(fn=cmd_seed_demo)
    p = sub.add_parser("process")
    p.add_argument("resource_id")
    p.add_argument("--reset-human", action="store_true")
    p.add_argument("--force-retranscribe", action="store_true")
    p.set_defaults(fn=cmd_process)
    p = sub.add_parser("embed-bible")
    p.add_argument("--max-batches", type=int, default=20)
    p.add_argument("--all", action="store_true")
    p.set_defaults(fn=cmd_embed)
    sub.add_parser("check-gemini").set_defaults(fn=cmd_check_gemini)
    p = sub.add_parser("create-user")
    p.add_argument("--email", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--role", default="member", choices=["member", "editor", "admin"])
    p.add_argument("--password", required=True)
    p.add_argument("--org")
    p.set_defaults(fn=cmd_create_user)
    p = sub.add_parser("eval")
    p.add_argument("--mode", default="auto", choices=["auto", "deterministic", "ai"])
    p.add_argument("--limit", type=int, default=0)
    p.set_defaults(fn=cmd_eval)
    args = parser.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
