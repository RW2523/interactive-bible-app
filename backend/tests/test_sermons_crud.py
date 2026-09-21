"""Sermon Studio: sermon CRUD, owner-only access, reference lists, deletion of files and the creative AI rate limit."""
from __future__ import annotations

import pytest

from interactive_bible import storage

from . import sermon_fakes as sf
from .support import ADMIN, EDITOR, MEMBER, OUTSIDER, sql, sql_exec, sql_one

SERMON_KEYS = {"id", "title", "status", "current_stage", "scripture_ref", "theme", "tone", "language", "export_template", "created_at", "updated_at"}


@pytest.fixture
def ai(fake_llm):
    return sf.install(fake_llm)


def test_create_list_detail_update_sermon(client, login):
    member = login(MEMBER)
    first = sf.create_sermon(client, member)
    assert set(first) == SERMON_KEYS
    assert (first["title"], first["status"], first["current_stage"], first["tone"], first["language"], first["export_template"]) == \
        ("Untitled Sermon", "draft", 1, "Inspirational", "English", "navy_gold")
    assert first["id"].startswith("srm_") and first["scripture_ref"] is None
    second = sf.create_sermon(client, member, "  The Good Shepherd  ")
    assert second["title"] == "The Good Shepherd"
    assert client.post("/v1/sermons", json={"title": "   "}, headers=member).json()["title"] == "Untitled Sermon"
    assert client.post("/v1/sermons", json={"title": "x" * 201}, headers=member).status_code == 422
    assert client.post("/v1/sermons", json={"title": "x" * 200}, headers=member).status_code == 201

    patched = client.patch(f"/v1/sermons/{first['id']}", json={"title": " Abide ", "scripture_ref": "John 15:1-8", "theme": "Remaining in Christ",
                                                               "status": "polished", "current_stage": 2, "tone": "Teaching", "language": "Spanish",
                                                               "export_template": "warm_sand", "user_id": "usr_outsider"}, headers=member)
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert (body["title"], body["scripture_ref"], body["theme"], body["status"], body["current_stage"], body["tone"], body["language"], body["export_template"]) == \
        ("Abide", "John 15:1-8", "Remaining in Christ", "polished", 2, "Teaching", "Spanish", "warm_sand")
    assert sql_one("SELECT user_id FROM sermons WHERE id = :id", id=first["id"])["user_id"] == "usr_member"  # not whitelisted
    cleared = client.patch(f"/v1/sermons/{first['id']}", json={"scripture_ref": "  ", "theme": None}, headers=member).json()
    assert cleared["scripture_ref"] is None and cleared["theme"] is None

    items = client.get("/v1/sermons", headers=member).json()["items"]
    assert [i["id"] for i in items][0] == first["id"]  # most recently updated first
    assert len(items) == 4 and all(SERMON_KEYS | {"input_count", "draft_version", "media_count", "cover_url", "is_published", "share_path"} == set(i) for i in items)
    assert (items[0]["input_count"], items[0]["draft_version"], items[0]["media_count"], items[0]["cover_url"], items[0]["is_published"], items[0]["share_path"]) == (0, None, 0, None, False, None)

    detail = client.get(f"/v1/sermons/{second['id']}", headers=member).json()
    assert detail == {"sermon": second, "inputs": [], "draft": None, "media": [], "outreach": None}


@pytest.mark.parametrize("body", [
    {}, {"unknown": 1}, {"status": "archived"}, {"current_stage": 0}, {"current_stage": 5}, {"tone": "Angry"}, {"language": "Klingon"},
    {"export_template": "neon"}, {"title": None}, {"status": None}, {"title": "x" * 201}, {"current_stage": "two"},
])
def test_sermon_patch_validation(client, login, body):
    member = login(MEMBER)
    sermon = sf.create_sermon(client, member)
    resp = client.patch(f"/v1/sermons/{sermon['id']}", json=body, headers=member)
    assert resp.status_code == 422, resp.text
    assert client.get(f"/v1/sermons/{sermon['id']}", headers=member).json()["sermon"] == sermon


def test_sermon_patch_requires_a_body(client, login):
    member = login(MEMBER)
    sermon = sf.create_sermon(client, member)
    assert client.patch(f"/v1/sermons/{sermon['id']}", headers=member).status_code == 422


def test_sermons_are_private_to_their_author_even_for_admins(client, login, ai):
    member = login(MEMBER)
    sermon, draft = sf.polished_sermon(client, member, "Private notes")
    media = client.post(f"/v1/sermons/{sermon['id']}/media/generate", json={"prompt": "a vineyard"}, headers=member).json()["media"]
    input_id = client.get(f"/v1/sermons/{sermon['id']}", headers=member).json()["inputs"][0]["id"]
    sid = sermon["id"]
    requests = [
        ("GET", f"/v1/sermons/{sid}", None), ("PATCH", f"/v1/sermons/{sid}", {"title": "Mine now"}), ("DELETE", f"/v1/sermons/{sid}", None),
        ("POST", f"/v1/sermons/{sid}/inputs", {"kind": "text", "text": "x"}), ("DELETE", f"/v1/sermons/{sid}/inputs/{input_id}", None),
        ("POST", f"/v1/sermons/{sid}/polish", {}), ("POST", f"/v1/sermons/{sid}/template", {"draft_id": draft["id"], "template_type": "youth"}),
        ("POST", f"/v1/sermons/{sid}/suggestions", {}), ("PATCH", f"/v1/sermons/{sid}/drafts/{draft['id']}", {"speaker_notes": "x"}),
        ("POST", f"/v1/sermons/{sid}/speaker-notes", {"draft_id": draft["id"]}), ("POST", f"/v1/sermons/{sid}/plan", {}),
        ("POST", f"/v1/sermons/{sid}/media/generate", {"prompt": "x"}), ("POST", f"/v1/sermons/{sid}/media/set", {}),
        ("PATCH", f"/v1/sermons/{sid}/media/{media['id']}", {"caption": "x"}), ("DELETE", f"/v1/sermons/{sid}/media/{media['id']}", None),
        ("POST", f"/v1/sermons/{sid}/outreach", None), ("PATCH", f"/v1/sermons/{sid}/outreach", {"is_public": True}),
    ]
    calls_before = len(ai.calls) + len(ai.image_calls)
    for who in (OUTSIDER, ADMIN, EDITOR):
        headers = login(who)
        assert client.get("/v1/sermons", headers=headers).json() == {"items": []}
        for method, path, body in requests:
            resp = client.request(method, path, json=body, headers=headers)
            assert resp.status_code == 404, (who, method, path, resp.status_code, resp.text)
        files = client.post(f"/v1/sermons/{sid}/inputs/document", files={"file": ("n.txt", b"hello", "text/plain")}, headers=headers)
        assert files.status_code == 404
    for method, path, body in requests:
        assert client.request(method, path, json=body).status_code == 401  # anonymous
    assert client.get("/v1/sermons").status_code == 401 and client.post("/v1/sermons", json={}).status_code == 401
    assert len(ai.calls) + len(ai.image_calls) == calls_before  # nobody else spent AI on this sermon
    # nothing changed
    after = client.get(f"/v1/sermons/{sid}", headers=member).json()
    assert after["sermon"]["title"] == "Private notes" and len(after["inputs"]) == 1 and len(after["media"]) == 1 and after["outreach"] is None


def test_meta_lists_tones_languages_formats_and_export_themes(client):
    meta = client.get("/v1/sermons/meta")
    assert meta.status_code == 200
    body = meta.json()
    assert [t["id"] for t in body["tones"]] == ["Inspirational", "Teaching", "Evangelistic", "Devotional", "Youth", "Prophetic"]
    assert all(set(t) == {"id", "label", "hint"} and t["hint"] for t in body["tones"])
    languages = {lang["code"]: lang for lang in body["languages"]}
    assert len(languages) == 10 and languages["Tamil"] == {"code": "Tamil", "label": "தமிழ்", "complex_script": True}
    assert languages["English"]["complex_script"] is False
    templates = {t["value"]: t for t in body["templates"]}
    assert list(templates) == ["message", "prayer", "story", "devotional", "teaching", "testimony", "youth", "small_group", "storytelling", "custom"]
    assert templates["message"]["label"] == "Sunday Message" and templates["message"]["sections"][0] == {
        "name": "Opening Hook", "subtopics": ["Engaging story, question, or image", "Why this matters today"]}
    assert all(t["summary"] and t["sections"] for t in body["templates"])
    assert body["export_themes"] == ["navy_gold", "light_classic", "royal_purple", "minimal_slate", "warm_sand"]


def test_list_summarises_inputs_drafts_media_and_publication(client, login, ai):
    member = login(MEMBER)
    sermon, _ = sf.polished_sermon(client, member)
    sf.polish(client, member, sermon["id"])
    first = client.post(f"/v1/sermons/{sermon['id']}/media/generate", json={"prompt": "a vineyard"}, headers=member).json()["media"]
    client.post(f"/v1/sermons/{sermon['id']}/media/generate", json={"prompt": "a harvest"}, headers=member)
    client.post(f"/v1/sermons/{sermon['id']}/outreach", headers=member)
    client.patch(f"/v1/sermons/{sermon['id']}/outreach", json={"is_public": True}, headers=member)
    (item,) = client.get("/v1/sermons", headers=member).json()["items"]
    assert (item["input_count"], item["draft_version"], item["media_count"], item["is_published"], item["status"]) == (1, 2, 2, True, "published")
    assert item["cover_url"] == first["url"] and client.get(item["cover_url"]).status_code == 200
    slug = client.get(f"/v1/sermons/{sermon['id']}", headers=member).json()["outreach"]["share_slug"]
    assert item["share_path"] == f"/share/{slug}"
    client.patch(f"/v1/sermons/{sermon['id']}/outreach", json={"is_public": False}, headers=member)
    assert client.get("/v1/sermons", headers=member).json()["items"][0]["share_path"] is None  # unpublished: no public link


def test_deleting_a_sermon_removes_its_rows_and_files(client, login, ai, silent_mp3):
    member = login(MEMBER)
    sermon, _ = sf.polished_sermon(client, member)
    sid = sermon["id"]
    doc = client.post(f"/v1/sermons/{sid}/inputs/document", files={"file": ("notes.txt", b"Abide in me.", "text/plain")}, headers=member)
    audio = client.post(f"/v1/sermons/{sid}/inputs/audio", files={"file": ("talk.mp3", silent_mp3.read_bytes(), "audio/mpeg")}, headers=member)
    media = client.post(f"/v1/sermons/{sid}/media/generate", json={"prompt": "a vineyard"}, headers=member).json()["media"]
    plan = client.post(f"/v1/sermons/{sid}/plan", json={}, headers=member).json()
    assert doc.status_code == 201 and audio.status_code == 201 and plan["scenes_generated"] > 0
    prefix = f"sermons/usr_member/{sid}"
    stored = sf.files_under(prefix)
    assert any("/inputs/" in f and f.endswith("-notes.txt") for f in stored) and any(f.endswith("-talk.mp3") for f in stored)
    assert any("/media/" in f for f in stored) and any("/plan/" in f for f in stored)
    other = sf.create_sermon(client, member, "Keep me")
    sf.add_text(client, member, other["id"])

    assert client.delete(f"/v1/sermons/{sid}", headers=member).json() == {"ok": True}
    assert sf.files_under(prefix) == [] and not (storage.root() / prefix).exists()
    assert client.get(media["url"]).status_code == 404
    assert client.get(f"/v1/sermons/{sid}", headers=member).status_code == 404
    for table in ("sermon_inputs", "sermon_drafts", "sermon_media", "sermon_outreach"):
        assert sql(f"SELECT id FROM {table} WHERE sermon_id = :s", s=sid) == []
    assert [i["id"] for i in client.get("/v1/sermons", headers=member).json()["items"]] == [other["id"]]
    assert client.delete(f"/v1/sermons/{sid}", headers=member).status_code == 404


def test_creative_ai_endpoints_have_an_hourly_limit(client, login, ai, monkeypatch):
    from interactive_bible import security
    from interactive_bible.config import get_settings

    member = login(MEMBER)
    sermon, draft = sf.polished_sermon(client, member)
    monkeypatch.setattr(get_settings(), "ai_creative_calls_per_hour", 1)
    with security.rate_limiter._lock:
        security.rate_limiter._hits.clear()
    assert client.post(f"/v1/sermons/{sermon['id']}/suggestions", json={}, headers=member).status_code == 200
    limited = client.post(f"/v1/sermons/{sermon['id']}/speaker-notes", json={"draft_id": draft["id"]}, headers=login(MEMBER))
    assert limited.status_code == 429 and "hourly limit" in limited.json()["detail"]
    assert client.post(f"/v1/sermons/{sermon['id']}/polish", json={}, headers=member).status_code == 429
    # non-AI editing is not limited, and the limit is per user
    assert client.patch(f"/v1/sermons/{sermon['id']}", json={"current_stage": 3}, headers=member).status_code == 200
    other = sf.create_sermon(client, login(OUTSIDER))
    assert client.post(f"/v1/sermons/{other['id']}/suggestions", json={}, headers=login(OUTSIDER)).status_code == 422  # allowed, but no draft yet
    assert client.post(f"/v1/sermons/{other['id']}/suggestions", json={}, headers=login(OUTSIDER)).status_code == 429


def test_status_values_and_touching_updated_at(client, login, ai):
    member = login(MEMBER)
    sermon = sf.create_sermon(client, member)
    sql_exec("UPDATE sermons SET updated_at = now() - interval '1 day' WHERE id = :id", id=sermon["id"])
    before = sql_one("SELECT updated_at FROM sermons WHERE id = :id", id=sermon["id"])["updated_at"]
    sf.add_text(client, member, sermon["id"])
    assert sql_one("SELECT updated_at FROM sermons WHERE id = :id", id=sermon["id"])["updated_at"] > before
