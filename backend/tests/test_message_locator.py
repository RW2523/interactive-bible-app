"""Finding the message inside a service recording (P-16).

A Sunday recording is welcome, songs, announcements, the sermon and a closing prayer. Only the sermon should be mapped to
verses and clipped; everything else is labelled and left alone. When AI is unavailable or its answer looks wrong, the
pipeline falls back to "everything that is not a song", which is the behaviour it had before.
"""
from __future__ import annotations

import copy
import json

import pytest

from interactive_bible.ai.gemini import GeminiError
from interactive_bible.ingest import youtube as yt

from .support import EDITOR, api_process, create_resource, link_by_ref, reset_mutable_state, sql, sql_one

VIDEO_ID = "SvcRec12345"
WATCH_URL = f"https://www.youtube.com/watch?v={VIDEO_ID}"

# (part, minutes, line said every 2 s)
SERVICE = [
    ("welcome", 2, "good morning and welcome to church we are so glad you are here today"),
    ("worship", 8, "[Music]"),
    ("announcements", 3, "next saturday is the serve day and you can sign up at the welcome desk"),
    ("message", 22, "turn with me to romans 8:28 and see what god promises to those who love him"),
    ("prayer", 2, "father we thank you for your word and we ask you to send us out in peace"),
]


def service_events(parts=SERVICE) -> dict:
    events, t = [], 0
    for _part, minutes, line in parts:
        for _ in range(int(minutes * 30)):  # one 2-second cue at a time
            events.append({"tStartMs": t, "dDurationMs": 1900, "segs": [{"utf8": line}]})
            t += 2000
        t += 3000  # a pause between the parts of the service
    return {"events": events}


@pytest.fixture
def service_video(monkeypatch):
    """A 37-minute service recording served through the YouTube stub (no network, no download)."""
    info = {
        "id": VIDEO_ID, "title": "Sunday service", "uploader": "Grace Community Church", "duration": 2250.0,
        "thumbnail": f"https://i.ytimg.com/vi/{VIDEO_ID}/hqdefault.jpg", "language": "en", "is_live": False, "chapters": [],
        "subtitles": {}, "automatic_captions": {"en": [{"ext": "json3", "url": "https://captions.test/service.json3"}]},
    }
    monkeypatch.setattr(yt, "extractor", lambda url: copy.deepcopy(info))
    monkeypatch.setattr(yt, "track_downloader", lambda url: json.dumps(service_events()))
    return info


def locator_by_text(call) -> dict:
    """Stand-in for the model: label each section from its own words, and return the sermon's span."""
    parts, message = [], []
    for row in call.section("SECTIONS").splitlines():
        if not row.strip().startswith("#"):
            continue
        ordinal = int(row.split("|", 1)[0].strip().lstrip("#"))
        text = row.lower()
        if "[music]" in text:
            part = "worship"
        elif "welcome to church" in text:
            part = "welcome"
        elif "serve day" in text or "sign up" in text:
            part = "announcements"
        elif "father we thank you" in text:
            part = "prayer"
        else:
            part = "message"
        parts.append({"ordinal": ordinal, "part": part})
        if part == "message":
            message.append(ordinal)
    return {"parts": parts, "message_start_ordinal": min(message, default=-1), "message_end_ordinal": max(message, default=-1),
            "confidence": 0.93, "reason": "The teaching runs from the passage reading to the closing appeal."}


def add_and_process(client, headers, **fields):
    res = create_resource(client, headers, type="video", title="Sunday service", url=WATCH_URL, visibility="public",
                          rights_status="unknown", **fields)
    run = api_process(client, headers, res["id"])
    return res, run


def parts_of(resource_id: str) -> dict[str, int]:
    rows = sql("SELECT part, count(*) AS n FROM resource_segments WHERE resource_id = :r AND is_active GROUP BY part", r=resource_id)
    return {r["part"]: r["n"] for r in rows}


def test_only_the_message_is_mapped_and_the_other_parts_are_labelled(client, login, fake_llm, service_video):
    fake_llm.on("P-16", locator_by_text)
    editor = login(EDITOR)
    res, run = add_and_process(client, editor)
    assert run["status"] == "succeeded", run["error"]

    labels = parts_of(res["id"])
    assert labels.get("message", 0) >= 1 and labels.get("worship", 0) >= 1
    assert {"welcome", "announcements", "prayer"} & set(labels), labels

    mapped_parts = sql("""SELECT DISTINCT s.part FROM verse_resource_links l JOIN resource_segments s ON s.id = l.segment_id
                          WHERE l.resource_id = :r AND s.is_active""", r=res["id"])
    assert [row["part"] for row in mapped_parts] == ["message"], "only the sermon may produce verse links"
    assert link_by_ref(res["id"], "ROM.8.28"), "the passage named in the sermon is mapped"

    clipped = sql("""SELECT part, count(*) AS n FROM resource_segments WHERE resource_id = :r AND is_active AND clip_start_ms IS NOT NULL
                     GROUP BY part""", r=res["id"])
    assert [row["part"] for row in clipped] == ["message"], "clips are cut from the sermon only"

    stage = next(st for st in run["stages"] if st["id"] == "ING-05B")
    assert stage["detail"]["method"] == "P-16" and stage["detail"]["confidence"] == 0.93
    assert stage["detail"]["parts"].get("worship", 0) >= 1 and stage["detail"]["message_at"]

    detail = client.get(f"/v1/resources/{res['id']}", headers=editor).json()
    span = detail["message"]
    assert span["start_ms"] < span["end_ms"] and span["confidence"] == 0.93 and "teaching" in span["reason"]
    sections = client.get(f"/v1/resources/{res['id']}/segments", headers=editor).json()["segments"]
    assert {sg["part"] for sg in sections} >= {"message", "worship"}
    reset_mutable_state()


def test_without_ai_everything_but_the_songs_is_analysed(client, login, no_llm, service_video):
    editor = login(EDITOR)
    res, run = add_and_process(client, editor)
    assert run["status"] in ("succeeded", "degraded"), run["error"]
    stage = next(st for st in run["stages"] if st["id"] == "ING-05B")
    assert stage["detail"]["method"] == "songs only (AI not configured)"
    labels = parts_of(res["id"])
    assert set(labels) <= {"message", "worship"} and labels.get("worship", 0) >= 1
    assert link_by_ref(res["id"], "ROM.8.28")  # the parser still finds the reference in the sermon
    reset_mutable_state()


def test_a_failed_locator_call_degrades_instead_of_dropping_the_recording(client, login, fake_llm, service_video):
    def down(_call):
        raise GeminiError("provider down", status=503, retryable=True)

    fake_llm.on("P-16", down)
    editor = login(EDITOR)
    res, run = add_and_process(client, editor)
    assert run["status"] in ("succeeded", "degraded"), run["error"]
    stage = next(st for st in run["stages"] if st["id"] == "ING-05B")
    assert stage["status"] == "degraded" and stage["detail"]["method"] == "songs only (AI failed)"
    assert set(parts_of(res["id"])) <= {"message", "worship"}
    assert link_by_ref(res["id"], "ROM.8.28")
    reset_mutable_state()


def test_an_answer_that_would_erase_the_sermon_is_not_trusted(client, login, fake_llm, service_video):
    fake_llm.on("P-16", lambda call: {"parts": [], "message_start_ordinal": 0, "message_end_ordinal": 0, "confidence": 0.4,
                                      "reason": "only the first section"})
    editor = login(EDITOR)
    res, run = add_and_process(client, editor)
    assert run["status"] == "succeeded", run["error"]
    stage = next(st for st in run["stages"] if st["id"] == "ING-05B")
    assert stage["detail"]["method"] == "songs only (message answer not trusted)"
    assert link_by_ref(res["id"], "ROM.8.28")  # the sermon is still mapped
    reset_mutable_state()


def test_a_short_recording_is_treated_as_the_message(client, login, fake_llm, service_video, monkeypatch):
    short = [("message", 4, "turn with me to romans 8:28 and hold on to this promise this week")]
    monkeypatch.setattr(yt, "track_downloader", lambda url: json.dumps(service_events(short)))
    editor = login(EDITOR)
    res, run = add_and_process(client, editor)
    assert run["status"] == "succeeded", run["error"]
    stage = next(st for st in run["stages"] if st["id"] == "ING-05B")
    assert stage["detail"]["method"] == "whole recording"
    assert not [c for c in fake_llm.calls if c.prompt_id == "P-16"], "no AI call for a short recording"
    assert sql_one("SELECT count(*) AS n FROM resource_segments WHERE resource_id = :r AND part <> 'message'", r=res["id"])["n"] == 0
    reset_mutable_state()
