"""Sermon Studio stage 1: typed and dictated notes, Scripture selections with exact local verse text, recorded audio transcribed
by (fake) Gemini in silence-cut chunks, documents extracted locally, and input deletion."""
from __future__ import annotations

import io

import pytest

from interactive_bible import storage

from . import sermon_fakes as sf
from .support import MEMBER, OUTSIDER, sql, sql_one

INPUT_KEYS = {"id", "kind", "text", "raw_text", "transcription", "original_filename", "meta", "created_at"}


@pytest.fixture
def sermon(client, login):
    return sf.create_sermon(client, login(MEMBER), "Abide")


def post_input(client, headers, sermon_id, **body):
    return client.post(f"/v1/sermons/{sermon_id}/inputs", json=body, headers=headers)


def upload(client, headers, sermon_id, kind, filename, data, mime="application/octet-stream"):
    return client.post(f"/v1/sermons/{sermon_id}/inputs/{kind}", files={"file": (filename, data, mime)}, headers=headers)


# ----------------------------------------------------------------------------- typed text + dictation
def test_text_and_dictation_inputs(client, login, sermon):
    member = login(MEMBER)
    typed = post_input(client, member, sermon["id"], kind="text", text="  I am the vine; you are the branches.  ")
    assert typed.status_code == 201, typed.text
    body = typed.json()
    assert set(body) == INPUT_KEYS and body["id"].startswith("inp_")
    assert (body["kind"], body["text"], body["raw_text"], body["transcription"], body["meta"]) == ("text", "I am the vine; you are the branches.", "I am the vine; you are the branches.", None, {})
    dictated = post_input(client, member, sermon["id"], kind="dictation", raw_text="Remain in me and I in you.").json()  # raw_text alias
    assert (dictated["kind"], dictated["text"]) == ("dictation", "Remain in me and I in you.")
    detail = client.get(f"/v1/sermons/{sermon['id']}", headers=member).json()
    assert [i["id"] for i in detail["inputs"]] == [body["id"], dictated["id"]]  # in the order they were added

    assert post_input(client, member, sermon["id"], kind="text", text="   ").status_code == 422
    assert post_input(client, member, sermon["id"], kind="text").status_code == 422
    too_long = post_input(client, member, sermon["id"], kind="text", text="x" * 50_001)
    assert too_long.status_code == 422 and "50,000" in too_long.json()["detail"]
    assert post_input(client, member, sermon["id"], kind="text", text="x" * 50_000).status_code == 201
    assert post_input(client, member, sermon["id"], kind="audio", text="x").status_code == 422  # uploads have their own endpoints
    assert post_input(client, member, "srm_missing", kind="text", text="x").status_code == 404


# ----------------------------------------------------------------------------- Scripture
def test_bible_reference_input_stores_exact_local_verse_text(client, login, sermon):
    member = login(MEMBER)
    resp = post_input(client, member, sermon["id"], kind="bible_ref", reference="john 3:16", notes="  God's love is the root.  ")
    assert resp.status_code == 201, resp.text
    ref = resp.json()
    assert ref["meta"] == {"reference": "John 3:16", "canonical": "JHN.3.16", "translation": "web", "verse_text": sf.JOHN_3_16_WEB}
    assert ref["raw_text"] == f"Scripture: John 3:16 (WEB)\n{sf.JOHN_3_16_WEB}\n\nStudy notes: God's love is the root."
    assert ref["text"] == ref["raw_text"] and ref["kind"] == "bible_ref"

    kjv = post_input(client, member, sermon["id"], kind="bible_ref", reference="JHN.3.16", translation="KJV").json()
    assert kjv["meta"]["translation"] == "kjv" and "only begotten Son" in kjv["meta"]["verse_text"]
    assert kjv["raw_text"].startswith("Scripture: John 3:16 (KJV)\n") and "Study notes" not in kjv["raw_text"]

    passage = post_input(client, member, sermon["id"], kind="bible_ref", reference="Romans 8:28-30").json()
    assert passage["meta"]["reference"] == "Romans 8:28-30" and passage["meta"]["canonical"] == "ROM.8.28-ROM.8.30"
    assert passage["meta"]["verse_text"].startswith(sf.ROMANS_8_28_WEB + " ") and not passage["meta"]["verse_text"].endswith("…")

    chapter = post_input(client, member, sermon["id"], kind="bible_ref", reference="Psalm 119").json()
    texts = sql("SELECT text FROM bible_verse_texts WHERE translation_id = 'web' AND verse_id BETWEEN 19119001 AND 19119012 ORDER BY verse_id")
    assert chapter["meta"]["reference"] == "Psalms 119" and chapter["meta"]["canonical"] == "PSA.119.1-PSA.119.176"
    assert chapter["meta"]["verse_text"] == " ".join(t["text"] for t in texts) + " …"  # capped at 12 verses

    unknown = post_input(client, member, sermon["id"], kind="bible_ref", reference="Hezekiah 4:2")
    assert unknown.status_code == 422 and unknown.json()["detail"] == "Couldn't recognise that Bible reference"
    for bad in ("", "a lovely verse", "John 99:1"):
        assert post_input(client, member, sermon["id"], kind="bible_ref", reference=bad).status_code == 422
    assert post_input(client, member, sermon["id"], kind="bible_ref").status_code == 422
    assert len(client.get(f"/v1/sermons/{sermon['id']}", headers=member).json()["inputs"]) == 4


# ----------------------------------------------------------------------------- audio
def test_audio_upload_is_stored_and_transcribed(client, login, sermon, fake_llm, silent_mp3):
    member = login(MEMBER)
    resp = upload(client, member, sermon["id"], "audio", "Sunday talk.mp3", silent_mp3.read_bytes(), "audio/mpeg")
    assert resp.status_code == 201, resp.text
    body = resp.json()
    transcription = body["transcription"]
    assert transcription == "Welcome to this short evening reflection. Tonight we read John 3:16 together."
    audio = body["input"]
    assert (audio["kind"], audio["text"], audio["transcription"], audio["raw_text"], audio["original_filename"]) == ("audio", transcription, transcription, None, "Sunday talk.mp3")
    assert abs(audio["meta"]["duration_seconds"] - 20) < 0.5 and audio["meta"]["chunks"] == 1
    row = sql_one("SELECT storage_key, mime_type FROM sermon_inputs WHERE id = :id", id=audio["id"])
    assert row["storage_key"] == f"sermons/usr_member/{sermon['id']}/inputs/{audio['id']}-Sunday_talk.mp3" and row["mime_type"] == "audio/mpeg"
    assert storage.path_for(row["storage_key"]).read_bytes() == silent_mp3.read_bytes()
    (call,) = fake_llm.calls_for("P-00")
    assert call.parts[0]["inlineData"]["mimeType"] == "audio/mp3" and "LANGUAGE_HINT: en" in call.text
    assert sql_one("SELECT run_id FROM llm_calls WHERE prompt_id = 'P-00'")["run_id"] == sermon["id"]
    assert not list((storage.root() / "work").glob(f"sermon_{audio['id']}*"))  # transcription scratch files are removed


def test_long_audio_is_transcribed_in_chunks_and_joined_in_order(client, login, sermon, fake_llm, silent_mp3, monkeypatch):
    from interactive_bible.config import get_settings

    monkeypatch.setattr(get_settings(), "transcribe_chunk_seconds", 8)
    member = login(MEMBER)
    client.patch(f"/v1/sermons/{sermon['id']}", json={"language": "Spanish"}, headers=member)

    def numbered(call):
        n = len(fake_llm.calls_for("P-00"))
        return {"language": "es", "utterances": [{"start": 0.2, "end": 1.5, "speaker": "S1", "text": f"Parte {n} empieza."},
                                                 {"start": 1.6, "end": 3.0, "speaker": "S1", "text": f"Parte {n} termina."}]}

    fake_llm.on("P-00", numbered)
    resp = upload(client, member, sermon["id"], "audio", "long.mp3", silent_mp3.read_bytes())
    assert resp.status_code == 201, resp.text
    assert resp.json()["input"]["meta"]["chunks"] == 3  # 0-8 s, 8-16 s, 16-20 s
    calls = fake_llm.calls_for("P-00")
    assert all("LANGUAGE_HINT: es" in c.text for c in calls) and calls[0].line("CLIP_DURATION_SECONDS") == "8.0"
    assert abs(float(calls[-1].line("CLIP_DURATION_SECONDS")) - 4.0) < 0.25  # the remainder; MP3 frame padding varies by ffmpeg build
    # one P-00 per chunk; byte-identical chunks (here: silence) may be served from the per-chunk cache instead of paying again
    statuses = [r["status"] for r in sql("SELECT status FROM llm_calls WHERE prompt_id = 'P-00' ORDER BY id")]
    assert len(statuses) == 3 and statuses.count("ok") == len(calls) and set(statuses) <= {"ok", "cached"}
    paragraphs = resp.json()["transcription"].split("\n\n")  # a paragraph per chunk (the pause between them), in audio order
    assert len(paragraphs) == 3 and paragraphs[0] == "Parte 1 empieza. Parte 1 termina." and paragraphs[-1] == f"Parte {len(calls)} empieza. Parte {len(calls)} termina."


def test_audio_without_speech_is_rejected_and_not_kept(client, login, sermon, fake_llm, silent_mp3):
    member = login(MEMBER)
    fake_llm.on("P-00", {"language": "en", "utterances": [{"start": 0.0, "end": 19.0, "speaker": "S1", "text": "[silence]"}]})
    resp = upload(client, member, sermon["id"], "audio", "quiet.mp3", silent_mp3.read_bytes())
    assert resp.status_code == 422 and resp.json()["detail"] == "No speech detected in the audio"
    assert sf.files_under(f"sermons/usr_member/{sermon['id']}") == []
    assert sql("SELECT id FROM sermon_inputs WHERE sermon_id = :s", s=sermon["id"]) == []


def test_audio_upload_validation(client, login, sermon, fake_llm, silent_mp3):
    member = login(MEMBER)
    not_audio = upload(client, member, sermon["id"], "audio", "talk.mp3", b"this is plain text pretending to be audio" * 10)
    assert not_audio.status_code == 400 and "does not match" in not_audio.json()["detail"]
    pdf = upload(client, member, sermon["id"], "audio", "talk.pdf", b"%PDF-1.4\n" + b"0" * 100)
    assert pdf.status_code == 400 and "not an accepted audio file" in pdf.json()["detail"]
    empty = upload(client, member, sermon["id"], "audio", "talk.mp3", b"")
    assert empty.status_code == 400
    # a browser recording without a usable name is recognised by its content
    recording = upload(client, member, sermon["id"], "audio", "blob", silent_mp3.read_bytes())
    assert recording.status_code == 201, recording.text
    key = sql_one("SELECT storage_key FROM sermon_inputs WHERE id = :id", id=recording.json()["input"]["id"])["storage_key"]
    assert key.endswith("-blob.mp3")
    assert sf.files_under(f"sermons/usr_member/{sermon['id']}") == [key]
    assert not list((storage.root() / "tmp").glob("*.part"))


def test_audio_upload_size_limit(client, login, sermon, fake_llm, silent_mp3, monkeypatch):
    from interactive_bible.config import get_settings

    monkeypatch.setattr(get_settings(), "max_upload_mb_media", 0)
    resp = upload(client, login(MEMBER), sermon["id"], "audio", "talk.mp3", silent_mp3.read_bytes())
    assert resp.status_code == 422 and "maximum allowed size" in resp.json()["detail"]
    assert sf.files_under(f"sermons/usr_member/{sermon['id']}") == [] and fake_llm.calls_for("P-00") == []


def test_audio_transcription_needs_ai(client, login, sermon, no_llm, silent_mp3):
    resp = upload(client, login(MEMBER), sermon["id"], "audio", "talk.mp3", silent_mp3.read_bytes())
    assert resp.status_code == 503
    assert sf.files_under(f"sermons/usr_member/{sermon['id']}") == []


def test_audio_upload_for_someone_elses_sermon_stores_nothing(client, login, sermon, fake_llm, silent_mp3):
    resp = upload(client, login(OUTSIDER), sermon["id"], "audio", "talk.mp3", silent_mp3.read_bytes())
    assert resp.status_code == 404 and fake_llm.calls_for("P-00") == []
    assert not (storage.root() / "sermons" / "usr_outsider").exists()


# ----------------------------------------------------------------------------- documents
def docx_bytes(*paragraphs: tuple[str, str | None]) -> bytes:
    import docx

    document = docx.Document()
    for text, style in paragraphs:
        document.add_paragraph(text, style=style)
    buf = io.BytesIO()
    document.save(buf)
    return buf.getvalue()


def pdf_bytes(lines: list[str]) -> bytes:
    from fpdf import FPDF

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=12)
    for line in lines:
        pdf.multi_cell(0, 8, line, new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


def test_document_uploads_are_extracted_locally(client, login, sermon, no_llm):
    member = login(MEMBER)
    txt = upload(client, member, sermon["id"], "document", "notes.txt", "Abide in me.\r\nFruit follows.\n".encode(), "text/plain")
    assert txt.status_code == 201, txt.text
    doc = txt.json()["input"]
    assert set(doc) == INPUT_KEYS and (doc["kind"], doc["text"], doc["original_filename"]) == ("document", "Abide in me.\nFruit follows.", "notes.txt")
    assert doc["meta"]["method"] == "text" and doc["meta"]["truncated"] is False

    md = upload(client, member, sermon["id"], "document", "outline.md", b"# The Vine\n\n- **Remain** in Christ\n- Bear fruit\n\nSee [John 15](https://example.org).").json()["input"]
    assert md["text"] == "The Vine\n\n- Remain in Christ\n- Bear fruit\n\nSee John 15."

    word = upload(client, member, sermon["id"], "document", "Sermon draft.docx",
                  docx_bytes(("The True Vine", "Heading 1"), ("Jesus said, I am the vine.", None), ("Remain in me", "List Bullet"))).json()["input"]
    assert word["text"] == "The True Vine\n\nJesus said, I am the vine.\n\n- Remain in me" and word["meta"]["method"] == "docx"

    pdf = upload(client, member, sermon["id"], "document", "handout.pdf",
                 pdf_bytes(["Remaining in the vine means staying close to Jesus every day of the week.", "Fruit is the evidence of that life."]))
    assert pdf.status_code == 201, pdf.text
    assert "Remaining in the vine means staying close to Jesus" in pdf.json()["input"]["text"] and pdf.json()["input"]["meta"]["page_count"] == 1

    html = upload(client, member, sermon["id"], "document", "page.html",
                  b"<html><body><script>alert(1)</script><h1>Grace</h1><p>Grace is a gift.</p></body></html>").json()["input"]
    assert html["text"] == "Grace\n\nGrace is a gift."

    keys = [r["storage_key"] for r in sql("SELECT storage_key FROM sermon_inputs WHERE sermon_id = :s ORDER BY created_at", s=sermon["id"])]
    assert keys[0] == f"sermons/usr_member/{sermon['id']}/inputs/{doc['id']}-notes.txt" and all(storage.exists(k) for k in keys)


def test_document_upload_rejections_leave_no_files(client, login, sermon):
    member = login(MEMBER)
    wrong_type = upload(client, member, sermon["id"], "document", "slides.pptx", b"PK\x03\x04whatever")
    assert wrong_type.status_code == 400 and "not an accepted document" in wrong_type.json()["detail"]
    fake_pdf = upload(client, member, sermon["id"], "document", "notes.pdf", b"not really a pdf")
    assert fake_pdf.status_code == 400
    blank = upload(client, member, sermon["id"], "document", "blank.txt", b"   \n\n  ")
    assert blank.status_code == 422 and blank.json()["detail"] == "No text could be extracted from this document"
    broken = upload(client, member, sermon["id"], "document", "broken.pdf", b"%PDF-1.4\n%%EOF garbage")
    assert broken.status_code in (400, 422)
    assert sf.files_under(f"sermons/usr_member/{sermon['id']}") == []
    assert sql("SELECT id FROM sermon_inputs WHERE sermon_id = :s", s=sermon["id"]) == []


def test_document_size_limit(client, login, sermon, monkeypatch):
    from interactive_bible.config import get_settings

    monkeypatch.setattr(get_settings(), "max_upload_mb_document", 0)
    resp = upload(client, login(MEMBER), sermon["id"], "document", "notes.txt", b"hello")
    assert resp.status_code == 422 and "maximum allowed size" in resp.json()["detail"]
    assert sf.files_under(f"sermons/usr_member/{sermon['id']}") == []


# ----------------------------------------------------------------------------- deletion
def test_deleting_an_input_removes_its_file(client, login, sermon):
    member = login(MEMBER)
    doc = upload(client, member, sermon["id"], "document", "notes.txt", b"Abide in me.").json()["input"]
    typed = sf.add_text(client, member, sermon["id"])
    key = sql_one("SELECT storage_key FROM sermon_inputs WHERE id = :id", id=doc["id"])["storage_key"]
    assert storage.exists(key)
    assert client.delete(f"/v1/sermons/{sermon['id']}/inputs/{doc['id']}", headers=member).json() == {"ok": True}
    assert not storage.exists(key)
    assert client.delete(f"/v1/sermons/{sermon['id']}/inputs/{typed['id']}", headers=member).json() == {"ok": True}
    assert client.get(f"/v1/sermons/{sermon['id']}", headers=member).json()["inputs"] == []
    assert client.delete(f"/v1/sermons/{sermon['id']}/inputs/{typed['id']}", headers=member).status_code == 404
    other = sf.create_sermon(client, member)
    theirs = sf.add_text(client, member, other["id"])
    assert client.delete(f"/v1/sermons/{sermon['id']}/inputs/{theirs['id']}", headers=member).status_code == 404  # input of another sermon
