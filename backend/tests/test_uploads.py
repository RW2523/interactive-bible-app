"""Upload validation and resource creation rules (spec §13 abuse controls, §9 resources API)."""
from __future__ import annotations

import hashlib
import io
import zipfile

import pytest

from interactive_bible import storage

from .support import EDITOR, MEMBER, OUTSIDER, create_resource, sql_one, upload

PDF_BYTES = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


def stored_original_exists(data: bytes) -> bool:
    digest = hashlib.sha256(data).hexdigest()
    folder = storage.root() / "originals" / digest[:2] / digest
    return folder.exists() and any(p.is_file() for p in folder.iterdir())


def docx_bytes(extra: dict[str, bytes] | None = None, with_document: bool = True) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        if with_document:
            zf.writestr("word/document.xml", "<w:document><w:body><w:p><w:r><w:t>Romans 8:28</w:t></w:r></w:p></w:body></w:document>")
        for name, data in (extra or {}).items():
            zf.writestr(name, data)
    return buf.getvalue()


@pytest.fixture
def audio_resource(client, login):
    return create_resource(client, login(EDITOR), type="audio", title="Upload target", transcript_mode="captions")


@pytest.fixture
def pdf_resource(client, login):
    return create_resource(client, login(EDITOR), type="pdf", title="PDF target")


def test_upload_rejects_content_that_does_not_match_the_extension(client, login, audio_resource):
    """Uploads are scanned: magic bytes must match the declared extension."""
    data = b"this is plain text pretending to be audio" * 10
    resp = upload(client, login(EDITOR), audio_resource["id"], data, "sermon.mp3")
    assert resp.status_code == 400 and "does not match" in resp.json()["detail"]
    assert not stored_original_exists(data)
    assert sql_one("SELECT status, source_uri FROM resources WHERE id = :r", r=audio_resource["id"]) == {"status": "draft", "source_uri": None}


@pytest.mark.parametrize("magic", [b"MZ\x90\x00\x03", b"\x7fELF\x02\x01", b"#!/bin/sh\nrm -rf /\n"])
def test_upload_rejects_executables(client, login, pdf_resource, magic):
    data = magic + b"\x00" * 256
    resp = upload(client, login(EDITOR), pdf_resource["id"], data, "study.pdf")
    assert resp.status_code == 400 and "executable" in resp.json()["detail"]
    assert not stored_original_exists(data)


def test_upload_rejects_unaccepted_extensions(client, login, audio_resource):
    resp = upload(client, login(EDITOR), audio_resource["id"], b"ID3" + b"\x00" * 100, "sermon.exe")
    assert resp.status_code == 400 and "not an accepted audio file" in resp.json()["detail"]


def test_upload_rejects_oversize_files_and_cleans_temp_files(client, login, pdf_resource, monkeypatch):
    import interactive_bible.services.resources as resources

    monkeypatch.setattr(resources, "max_bytes_for", lambda _type: 1024)
    data = PDF_BYTES + b"0" * 4096
    resp = upload(client, login(EDITOR), pdf_resource["id"], data, "big.pdf")
    assert resp.status_code == 422 and "exceeds the maximum allowed size" in resp.json()["detail"]
    assert not stored_original_exists(data)
    assert list((storage.root() / "tmp").glob("*")) == []


def test_upload_size_limits_come_from_settings(monkeypatch):
    from interactive_bible.config import get_settings
    from interactive_bible.ingest.validate import max_bytes_for

    monkeypatch.setattr(get_settings(), "max_upload_mb_media", 3)
    monkeypatch.setattr(get_settings(), "max_upload_mb_document", 1)
    assert max_bytes_for("video") == 3 * 1024 * 1024 and max_bytes_for("audio") == 3 * 1024 * 1024
    assert max_bytes_for("pdf") == 1024 * 1024 and max_bytes_for("document") == 1024 * 1024


def test_docx_with_macros_or_without_document_is_rejected(client, login):
    doc = create_resource(client, login(EDITOR), type="document", title="Docx target")
    macro = docx_bytes({"word/vbaProject.bin": b"\x00macro"})
    resp = upload(client, login(EDITOR), doc["id"], macro, "notes.docx")
    assert resp.status_code == 400 and "macros" in resp.json()["detail"]
    resp = upload(client, login(EDITOR), doc["id"], docx_bytes(with_document=False), "notes.docx")
    assert resp.status_code == 400 and "not a valid DOCX" in resp.json()["detail"]
    resp = upload(client, login(EDITOR), doc["id"], b"PK\x03\x04" + b"garbage" * 20, "notes.docx")
    assert resp.status_code == 400 and "corrupt" in resp.json()["detail"]
    ok = upload(client, login(EDITOR), doc["id"], docx_bytes(), "notes.docx")
    assert ok.status_code == 200 and ok.json()["status"] == "ready" and ok.json()["original_filename"] == "notes.docx"


def test_real_demo_documents_are_accepted(client, login, project_root):
    pdf = create_resource(client, login(EDITOR), type="pdf", title="Hebrews study")
    resp = upload(client, login(EDITOR), pdf["id"], project_root / "demo_content/docs/study_faith_hebrews11.pdf", "study_faith_hebrews11.pdf")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["mime_type"] == "application/pdf" and body["status"] == "ready" and body["source_hash"]


def test_media_that_cannot_be_probed_is_rejected(client, login, audio_resource):
    data = b"ID3" + bytes(range(256)) * 4  # right magic bytes, not decodable audio
    resp = upload(client, login(EDITOR), audio_resource["id"], data, "broken.mp3")
    assert resp.status_code == 400 and "could not be read" in resp.json()["detail"]


def test_captions_must_be_text(client, login, audio_resource):
    resp = upload(client, login(EDITOR), audio_resource["id"], b"\xff\xfe\x00\x00binary" * 50, "captions.vtt", kind="captions")
    assert resp.status_code == 400
    resp = upload(client, login(EDITOR), audio_resource["id"], b"WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi.\n", "captions.txt", kind="captions")
    assert resp.status_code == 400 and "not an accepted captions file" in resp.json()["detail"]
    assert client.post(f"/v1/resources/{audio_resource['id']}/upload", files={"file": ("a.vtt", b"WEBVTT", "text/vtt")}, data={"kind": "thumbnail"}, headers=login(EDITOR)).status_code == 422


@pytest.mark.parametrize("case", ["captions", "unprobeable_media"])
def test_rejected_uploads_leave_no_stored_file(client, login, audio_resource, case):
    if case == "captions":
        data, name, kind = b"\xff\xfe\x00\x00binary" * 50, "captions.vtt", "captions"
    else:
        data, name, kind = b"ID3" + bytes(range(256)) * 4, "broken.mp3", "source"
    assert upload(client, login(EDITOR), audio_resource["id"], data, name, kind=kind).status_code == 400
    assert not stored_original_exists(data)


def test_upload_permissions(client, login):
    public = create_resource(client, login(MEMBER), type="pdf", title="Member public pdf")
    private = create_resource(client, login(MEMBER), type="pdf", title="Member private pdf", visibility="private")
    assert upload(client, {}, public["id"], PDF_BYTES, "x.pdf").status_code == 401
    assert upload(client, login(OUTSIDER), public["id"], PDF_BYTES, "x.pdf").status_code == 403  # can see, cannot edit
    assert upload(client, login(OUTSIDER), private["id"], PDF_BYTES, "x.pdf").status_code == 404  # cannot even see
    assert upload(client, login(EDITOR), private["id"], PDF_BYTES, "x.pdf").status_code == 200
    assert upload(client, login(MEMBER), public["id"], PDF_BYTES, "x.pdf").status_code == 200


def test_native_resources_do_not_take_file_uploads(client, login):
    native = create_resource(client, login(EDITOR), type="native", title="Native", body_text="Romans 8:28")
    resp = upload(client, login(EDITOR), native["id"], PDF_BYTES, "x.pdf")
    assert resp.status_code == 400 and "do not take file uploads" in resp.json()["detail"]


# ----------------------------------------------------------------------------- resource creation rules
def test_create_resource_validation_rules(client, login):
    editor, member, outsider = login(EDITOR), login(MEMBER), login(OUTSIDER)
    assert client.post("/v1/resources", json={"type": "native", "title": "x", "body_text": "y"}).status_code == 401
    assert client.post("/v1/resources", json={"type": "native", "title": "x"}, headers=editor).status_code == 400
    resp = client.post("/v1/resources", json={"type": "generated", "title": "AI devotional", "body_text": "Romans 8:28"}, headers=editor)
    assert resp.status_code == 400 and "generation_provenance" in resp.json()["detail"]
    ok = client.post("/v1/resources", json={"type": "generated", "title": "AI devotional", "body_text": "Romans 8:28",
                                              "generation_provenance": {"source": "interactive_bible", "model": "gemini", "prompt": "P-x"}}, headers=editor)
    assert ok.status_code == 201 and ok.json()["generation_provenance"]["model"] == "gemini"
    assert client.post("/v1/resources", json={"type": "native", "title": "x", "body_text": "y", "is_official": True}, headers=member).status_code == 403
    resp = client.post("/v1/resources", json={"type": "native", "title": "x", "body_text": "y", "visibility": "organization"}, headers=outsider)
    assert resp.status_code == 400 and "organization" in resp.json()["detail"]
    org = client.post("/v1/resources", json={"type": "native", "title": "x", "body_text": "y", "visibility": "organization"}, headers=member)
    assert org.status_code == 201 and org.json()["organization_id"] == "org_grace"
    foreign = client.post("/v1/resources", json={"type": "native", "title": "x", "body_text": "y", "organization_id": "org_other"}, headers=member)
    assert foreign.status_code == 403
    assert client.post("/v1/resources", json={"type": "sculpture", "title": "x"}, headers=editor).status_code == 422
    created = sql_one("SELECT action, new_value FROM review_actions WHERE object_id = :id", id=org.json()["id"])
    assert created["action"] == "create" and created["new_value"]["visibility"] == "organization"


@pytest.mark.parametrize("url,message", [("http://127.0.0.1/admin", "private or local"), ("http://localhost:8000/v1/system/status", "private or local"),
                                         ("ftp://example.org/file.html", "only http(s)"), ("http://10.1.2.3/article", "private or local")])
def test_article_urls_are_ssrf_guarded(client, login, url, message):
    resp = client.post("/v1/resources", json={"type": "article", "title": "Article", "url": url}, headers=login(EDITOR))
    assert resp.status_code == 400 and message in resp.json()["detail"]


def test_member_cannot_change_editorial_flags_but_owner_can_edit(client, login):
    res = create_resource(client, login(MEMBER), type="native", title="Mine", body_text="Romans 8:28")
    assert client.patch(f"/v1/resources/{res['id']}", json={"is_official": True}, headers=login(MEMBER)).status_code == 403
    assert client.patch(f"/v1/resources/{res['id']}", json={"title": "Renamed"}, headers=login(OUTSIDER)).status_code == 403
    patched = client.patch(f"/v1/resources/{res['id']}", json={"title": "Renamed", "visibility": "unlisted"}, headers=login(MEMBER))
    assert patched.status_code == 200 and patched.json()["title"] == "Renamed" and patched.json()["visibility"] == "unlisted"
    audit = sql_one("SELECT previous_value, new_value FROM review_actions WHERE object_id = :id AND action = 'update'", id=res["id"])
    assert audit == {"previous_value": {"title": "Mine", "visibility": "public"}, "new_value": {"title": "Renamed", "visibility": "unlisted"}}
    assert client.delete(f"/v1/resources/{res['id']}", headers=login(OUTSIDER)).status_code == 403  # unlisted: viewable by link, not editable
    assert client.delete(f"/v1/resources/{res['id']}", headers=login(MEMBER)).json() == {"deleted": True, "id": res["id"]}
    assert client.get(f"/v1/resources/{res['id']}", headers=login(MEMBER)).status_code == 404


def test_article_html_upload_is_accepted_and_processed(client, login):
    article = create_resource(client, login(EDITOR), type="article", title="Saved article")
    html = b"<html><head><title>Prayer</title></head><body><article><h1>Prayer</h1><p>Read Luke 11:1-4 today.</p></article></body></html>"
    resp = upload(client, login(EDITOR), article["id"], html, "prayer.html")
    assert resp.status_code == 200, resp.text
