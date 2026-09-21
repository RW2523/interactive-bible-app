"""Personal (single-user) mode: no sign-in on this computer; the owner account has full access. Other devices still sign in."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from interactive_bible.api.main import app
from interactive_bible.config import get_settings

from .support import MEMBER


@pytest.fixture
def personal_mode(client, monkeypatch):  # client: test database + clean state
    settings = get_settings()
    monkeypatch.setattr(settings, "single_user_mode", True)
    monkeypatch.setattr(settings, "single_user_trust_network", False)
    return settings


def local_client(host: str = "127.0.0.1") -> TestClient:
    return TestClient(app, client=(host, 50000))


def test_requests_from_this_computer_act_as_the_owner_without_signing_in(personal_mode):
    for host in ("127.0.0.1", "::1"):
        with local_client(host) as c:
            me = c.get("/v1/auth/me").json()
            assert me["authenticated"] is True and me["id"] == "usr_admin" and me["role"] == "admin"
            assert me["auth_mode"] == "single_user"
            created = c.post("/v1/sermons", json={"title": "No sign-in needed"})
            assert created.status_code == 201, created.text
            assert c.get("/v1/admin/metrics").status_code == 200  # highest access: admin routes
            assert c.delete(f"/v1/sermons/{created.json()['id']}").status_code == 200


def test_a_token_for_another_account_does_not_downgrade_the_owner(personal_mode, login):
    with local_client() as c:
        me = c.get("/v1/auth/me", headers=login(MEMBER)).json()
        assert me["id"] == "usr_admin" and me["auth_mode"] == "single_user"


def test_other_devices_still_need_an_account(personal_mode, login):
    with local_client("10.0.0.23") as c:
        me = c.get("/v1/auth/me").json()
        assert me["authenticated"] is False and me["auth_mode"] == "accounts"
        assert c.post("/v1/sermons", json={"title": "x"}).status_code == 401
        signed_in = c.get("/v1/auth/me", headers=login(MEMBER)).json()
        assert signed_in["id"] == "usr_member" and signed_in["auth_mode"] == "accounts"


def test_trusting_the_network_gives_every_device_owner_access(personal_mode, monkeypatch):
    monkeypatch.setattr(personal_mode, "single_user_trust_network", True)
    with local_client("10.0.0.23") as c:
        me = c.get("/v1/auth/me").json()
        assert me["id"] == "usr_admin" and me["auth_mode"] == "single_user"


def test_accounts_mode_requires_signing_in_even_on_this_computer(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "single_user_mode", False)
    with local_client() as c:
        me = c.get("/v1/auth/me").json()
        assert me["authenticated"] is False and me["auth_mode"] == "accounts"
        assert c.post("/v1/sermons", json={"title": "x"}).status_code == 401
