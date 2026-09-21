"""Local accounts (sign-up, profile), signed URLs for generated files, job progress, and LLM image/speech logging."""
from __future__ import annotations

import pytest

from interactive_bible import jobs, storage
from interactive_bible.ai.llm import AIUnavailable, get_llm

from .support import MEMBER, sql, sql_one


def test_signup_creates_a_member_and_signs_in(client):
    resp = client.post("/v1/auth/signup", json={"email": "Pastor.Ruth@Example.org", "password": "grace-and-truth", "display_name": "Ruth Adeyemi", "church": "Hope Chapel"})
    assert resp.status_code == 201, resp.text
    token = resp.json()["token"]
    me = client.get("/v1/auth/me", headers={"authorization": f"Bearer {token}"}).json()
    assert (me["authenticated"], me["email"], me["role"], me["display_name"], me["church"]) == (True, "pastor.ruth@example.org", "member", "Ruth Adeyemi", "Hope Chapel")
    login = client.post("/v1/auth/login", json={"email": "pastor.ruth@example.org", "password": "grace-and-truth"})
    assert login.status_code == 200
    duplicate = client.post("/v1/auth/signup", json={"email": "pastor.ruth@example.org", "password": "another-pass", "display_name": "Ruth"})
    assert duplicate.status_code == 409


@pytest.mark.parametrize("body,status", [
    ({"email": "not-an-email", "password": "long-enough-pw", "display_name": "X"}, 422),
    ({"email": "short@example.org", "password": "short", "display_name": "X"}, 422),
    ({"email": "noname@example.org", "password": "long-enough-pw", "display_name": ""}, 422),
])
def test_signup_validation(client, body, status):
    assert client.post("/v1/auth/signup", json=body).status_code == status


def test_signup_can_be_disabled(client, monkeypatch):
    from interactive_bible.config import get_settings

    monkeypatch.setattr(get_settings(), "allow_signup", False)
    assert client.post("/v1/auth/signup", json={"email": "a@example.org", "password": "long-enough-pw", "display_name": "A"}).status_code == 403


def test_profile_update_and_password_change(client, login):
    headers = login(MEMBER)
    out = client.patch("/v1/auth/me", json={"display_name": "Mia M.", "church": "Grace Community"}, headers=headers).json()
    assert (out["display_name"], out["church"]) == ("Mia M.", "Grace Community")
    bad = client.patch("/v1/auth/me", json={"current_password": "wrong", "new_password": "new-password-1"}, headers=headers)
    assert bad.status_code == 400
    from interactive_bible.cli import ensure_users
    from interactive_bible.config import get_settings

    try:
        ok = client.patch("/v1/auth/me", json={"current_password": get_settings().demo_password, "new_password": "new-password-1"}, headers=headers)
        assert ok.status_code == 200
        assert client.post("/v1/auth/login", json={"email": MEMBER, "password": "new-password-1"}).status_code == 200
    finally:
        ensure_users()  # restore the demo password for the rest of the suite
        sql("UPDATE users SET display_name = 'Mia Member' WHERE id = 'usr_member' RETURNING id")
    client.cookies.clear()  # /auth/login set a session cookie
    assert client.patch("/v1/auth/me", json={"church": "x"}).status_code == 401


def test_signed_file_urls_serve_only_signed_generated_files(client):
    key = storage.put_bytes("sermons/usr_x/srm_x/visual.png", b"\x89PNG fake")
    url = storage.signed_url(key)
    resp = client.get(url)
    assert resp.status_code == 200 and resp.content == b"\x89PNG fake"
    assert resp.headers["content-type"] == "image/png" and "immutable" in resp.headers["cache-control"]
    assert "sandbox" in resp.headers["content-security-policy"]
    tampered = url.replace("sig=", "sig=x")
    assert client.get(tampered).status_code == 404
    # a valid signature for a key outside the generated namespaces is still refused
    import base64

    from interactive_bible.security import file_signature

    outside = "originals/ab/abc/secret.pdf"
    token = base64.urlsafe_b64encode(outside.encode()).rstrip(b"=").decode()
    assert client.get(f"/v1/files/{token}/secret.pdf?sig={file_signature(outside)}").status_code == 404
    storage.delete_prefix("sermons/usr_x")
    assert client.get(url).status_code == 404


def test_storage_prefix_deletion_rejects_traversal():
    with pytest.raises(ValueError):
        storage.delete_prefix("../outside")


def test_job_progress_is_reported_for_the_running_job_and_visible_to_its_requester(client, login):
    from interactive_bible.db import session_scope

    with session_scope() as s:
        user_id = sql_one("SELECT id FROM users WHERE email = :e", e=MEMBER)["id"]
        job_id = jobs.enqueue(s, "generate_story", {"event_id": "creation", "requested_by": user_id})
    jobs.report_progress("outside a job is ignored")
    token = jobs.current_job_id.set(job_id)
    try:
        jobs.report_progress("images", 2, 4, "Painting scene 2 of 4")
    finally:
        jobs.current_job_id.reset(token)
    body = client.get(f"/v1/jobs/{job_id}", headers=login(MEMBER)).json()
    assert body["progress"] == {"step": "images", "done": 2, "total": 4, "message": "Painting scene 2 of 4"}


def test_llm_image_and_speech_calls_are_logged_with_cost(fake_llm):
    img = get_llm().image("a quiet lake at dawn", "IMG:test")
    audio = get_llm().speech("Peace, be still.", "TTS:test")
    assert img.mime_type == "image/png" and audio.mime_type == "audio/wav"
    rows = {r["prompt_id"]: r for r in sql("SELECT prompt_id, prompt_version, status, output_tokens, cost_usd FROM llm_calls")}
    assert rows["IMG:test"]["status"] == "ok" and rows["IMG:test"]["prompt_version"] == "image" and rows["IMG:test"]["cost_usd"] > 0
    assert rows["TTS:test"]["status"] == "ok" and rows["TTS:test"]["prompt_version"] == "speech"


def test_llm_image_failure_is_logged_and_raised_as_unavailable(fake_llm):
    from interactive_bible.ai.gemini import GeminiError

    fake_llm.image_failures.append(GeminiError("quota", status=429, kind="quota"))
    with pytest.raises(AIUnavailable):
        get_llm().image("x", "IMG:test")
    assert sql_one("SELECT status FROM llm_calls WHERE prompt_id = 'IMG:test'")["status"] == "error:quota"


def test_media_generation_requires_a_configured_key(no_llm):
    with pytest.raises(AIUnavailable):
        get_llm().image("x", "IMG:test")
    with pytest.raises(AIUnavailable):
        get_llm().speech("x", "TTS:test")
