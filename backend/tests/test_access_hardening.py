"""Access hardening: demo-account passwords, the address share links use, and AI features that need an account."""
from __future__ import annotations

import argparse

from interactive_bible import cli
from interactive_bible.api import deps
from interactive_bible.config import get_settings
from interactive_bible.security import verify_password

from .support import DEMO_USER_IDS, sql, sql_one


def demo_hashes() -> dict[str, str]:
    return {r["id"]: r["password_hash"] for r in sql("SELECT id, password_hash FROM users WHERE id = ANY(:ids)", ids=DEMO_USER_IDS)}


def test_demo_accounts_never_use_the_published_password(client):
    assert get_settings().demo_password not in cli.PUBLISHED_DEMO_PASSWORDS
    assert not any(verify_password("bible-demo", h) for h in demo_hashes().values())


def test_without_a_demo_password_existing_accounts_keep_theirs(client, monkeypatch):
    before = demo_hashes()
    monkeypatch.setattr(get_settings(), "demo_password", "")
    cli.ensure_users()
    assert demo_hashes() == before


def test_new_demo_accounts_without_a_password_get_an_unguessable_one(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "demo_password", "")
    monkeypatch.setattr(cli, "DEMO_USERS", [*cli.DEMO_USERS, ("usr_demo_new", "new@interactivebible.local", "Nia New", "member", False)])
    cli.ensure_users()  # the extra account is removed by the next test's state reset
    row = sql_one("SELECT password_hash FROM users WHERE id = 'usr_demo_new'")
    assert row and not any(verify_password(p, row["password_hash"]) for p in ("", "bible-demo", "test-demo-password"))


def test_changing_the_demo_password_keeps_the_owners_profile(client):
    settings = get_settings()
    original = settings.demo_password
    sql("UPDATE users SET display_name = 'Pastor Sam' WHERE id = 'usr_admin' RETURNING id")
    try:
        settings.demo_password = "a-new-demo-password"
        cli.ensure_users()
        row = sql_one("SELECT display_name, password_hash FROM users WHERE id = 'usr_admin'")
        assert row["display_name"] == "Pastor Sam" and verify_password("a-new-demo-password", row["password_hash"])
    finally:
        settings.demo_password = original
        cli.ensure_users()
        sql("UPDATE users SET display_name = 'Ada Admin' WHERE id = 'usr_admin' RETURNING id")


def test_share_links_use_the_configured_public_address(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "public_base_url", "https://bible.example.org/")
    me = client.get("/v1/auth/me").json()
    assert (me["share_base_url"], me["share_base_url_source"]) == ("https://bible.example.org", "config")


def test_share_links_default_to_this_computers_network_address(client, monkeypatch):
    monkeypatch.setattr(deps, "lan_address", lambda: "192.168.1.20")
    me = client.get("/v1/auth/me").json()
    assert (me["share_base_url"], me["share_base_url_source"]) == ("http://192.168.1.20", "lan")
    monkeypatch.setattr(deps, "lan_address", lambda: None)  # offline: links fall back to the address in the browser
    me = client.get("/v1/auth/me").json()
    assert (me["share_base_url"], me["share_base_url_source"]) == (None, None)


def test_demo_password_command_replaces_a_published_default_and_applies_it(client, tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("SECRET_KEY=kept\n# a comment\nDEMO_PASSWORD=bible-demo\n")
    monkeypatch.setattr(cli, "ENV_FILE", env)
    settings = get_settings()
    original = settings.demo_password
    try:
        settings.demo_password = "bible-demo"  # as loaded from that .env
        cli.cmd_demo_password(argparse.Namespace(new=False))
        saved = dict(line.split("=", 1) for line in env.read_text().splitlines() if "=" in line)
        assert saved["SECRET_KEY"] == "kept" and "# a comment" in env.read_text()
        assert saved["DEMO_PASSWORD"] not in ("", "bible-demo", original) and len(saved["DEMO_PASSWORD"]) >= 12
        assert verify_password(saved["DEMO_PASSWORD"], sql_one("SELECT password_hash FROM users WHERE id = 'usr_member'")["password_hash"])
        cli.cmd_demo_password(argparse.Namespace(new=True))  # rotate on request
        rotated = dict(line.split("=", 1) for line in env.read_text().splitlines() if "=" in line)["DEMO_PASSWORD"]
        assert rotated != saved["DEMO_PASSWORD"] and env.read_text().count("DEMO_PASSWORD=") == 1
    finally:
        settings.demo_password = original
        cli.ensure_users()
