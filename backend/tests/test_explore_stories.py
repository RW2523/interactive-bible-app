"""AI story videos: the generate_story job (script, scene images, narration), manifests with signed file URLs,
regeneration, partial failures, portrait stories, and the story meta the UI uses to resume polling after a reload."""
from __future__ import annotations

import json
from unittest.mock import ANY

import pytest

from interactive_bible import jobs, storage

from . import explore_fakes
from .support import EDITOR, MEMBER, OUTSIDER, run_worker_once, sql, sql_exec, sql_one

STORY = "/v1/explore/events/red_sea_crossing/story"


@pytest.fixture(autouse=True)
def _clean_explore_files():
    """Tables are truncated between tests but generated files are not: start every test with no Explore files."""
    storage.delete_prefix("explore")
    yield
    storage.delete_prefix("explore")


@pytest.fixture
def explore_llm(fake_llm):
    return explore_fakes.install(fake_llm)


def generate(client, headers, **body) -> dict:
    """POST story -> run the ai worker once -> the finished job status."""
    resp = client.post(STORY, json=body, headers=headers)
    assert resp.status_code == 202, resp.text
    job_id = resp.json()["job_id"]
    assert run_worker_once(("ai",))
    return client.get(f"/v1/jobs/{job_id}", headers=headers).json()


def stored_files(prefix: str) -> list[str]:
    root = storage.path_for(prefix)
    return sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file()) if root.exists() else []


def test_story_is_generated_by_a_job_and_served_with_signed_urls(client, login, explore_llm, monkeypatch):
    progress: list[tuple] = []
    report = jobs.report_progress
    monkeypatch.setattr(jobs, "report_progress", lambda step, done=None, total=None, message=None: (progress.append((step, done, total)), report(step, done, total, message)))
    member = login(MEMBER)
    assert client.get(STORY).status_code == 404

    resp = client.post(STORY, json={"sceneCount": 4, "imageFormat": "landscape"}, headers=member)
    assert resp.status_code == 202, resp.text
    job_id = resp.json()["job_id"]
    assert resp.json() == {"status": "queued", "job_id": job_id}
    assert sql_one("SELECT type, queue, dedupe_key, payload FROM jobs WHERE id = :id", id=job_id) == {
        "type": "generate_story", "queue": "ai", "dedupe_key": "story:red_sea_crossing:landscape",
        "payload": {"event_id": "red_sea_crossing", "image_format": "landscape", "scene_count": 4, "force": False, "requested_by": "usr_member"},
    }
    assert client.post(STORY, json={"sceneCount": 5}, headers=member).json()["job_id"] == job_id  # already queued: same job
    meta = client.get(f"{STORY}/meta", headers=member).json()
    assert meta["job"] == {"job_id": job_id, "format": "landscape", "status": "queued", "progress": None}
    assert meta["generating"] is True and meta["formats"]["landscape"]["generating"] is True and meta["formats"]["portrait"]["generating"] is False

    assert run_worker_once(("ai",))
    job = client.get(f"/v1/jobs/{job_id}", headers=member).json()
    assert job["status"] == "succeeded", job["last_error"]
    assert job["result"] == {"event_id": "red_sea_crossing", "image_format": "landscape", "scene_count": 4, "has_audio": True, "mode": "gemini",
                             "generation_id": ANY, "images_generated": 4}
    assert [step for step, _, _ in progress] == ["script", "images", "images", "images", "images", "images", "narration", "saving"]
    assert [(done, total) for step, done, total in progress if step == "images"] == [(0, 4), (1, 4), (2, 4), (3, 4), (4, 4)]
    assert job["progress"] == {"step": "saving", "done": None, "total": None, "message": "Saving the story"}

    meta = client.get(f"{STORY}/meta").json()  # public
    assert (meta["eventId"], meta["job"], meta["generating"]) == ("red_sea_crossing", None, False)
    assert meta["formats"]["landscape"] == {"cached": True, "sceneCount": 4, "hasAudio": True, "generatedAt": ANY, "mode": "gemini", "generating": False}
    assert meta["formats"]["portrait"] == {"cached": False, "sceneCount": 0, "hasAudio": False, "generatedAt": None, "mode": None, "generating": False}

    story = client.get(STORY).json()  # public
    assert set(story) == {"mode", "eventId", "generatedAt", "imageFormat", "title", "reference", "narration", "audioUrl", "durationSeconds", "scenes", "quiz", "event"}
    assert (story["mode"], story["eventId"], story["imageFormat"], story["title"], story["reference"]) == \
        ("gemini", "red_sea_crossing", "landscape", "The story of Crossing the Red Sea", "Exodus 14")
    assert story["generatedAt"] == meta["formats"]["landscape"]["generatedAt"]
    assert story["event"] == {"id": "red_sea_crossing", "title": "Crossing the Red Sea", "references": ["Exodus 14"], "era": "Exodus", "mapLocation": "Red Sea / Sea of Reeds region"}
    assert story["quiz"] == [{"question": "Where did Crossing the Red Sea happen?", "answer": "Red Sea / Sea of Reeds region"}]
    assert [s["title"] for s in story["scenes"]] == [f"Crossing the Red Sea, part {i}" for i in range(1, 5)]
    assert story["scenes"][0]["durationSec"] == 5 and story["scenes"][0]["imagePrompt"] == "landscape illustration 1 of Crossing the Red Sea"
    assert story["durationSeconds"] > 0
    for scene in story["scenes"]:
        image = client.get(scene["imageUrl"])
        assert image.status_code == 200 and image.content.startswith(b"\x89PNG") and image.headers["content-type"] == "image/png"
    audio = client.get(story["audioUrl"])
    assert audio.status_code == 200 and audio.content[:4] == b"RIFF" and audio.headers["content-type"].startswith("audio/")

    row = sql_one("SELECT title, manifest, scene_count, has_audio, mode, generated_by FROM explore_stories WHERE event_id = 'red_sea_crossing'")
    assert (row["scene_count"], row["has_audio"], row["mode"], row["generated_by"]) == (4, True, "gemini", "usr_member")
    gen_id = job["result"]["generation_id"]
    assert row["manifest"]["genId"] == gen_id and "Url" not in json.dumps(row["manifest"])  # keys only; URLs are signed at read time
    assert stored_files(f"explore/stories/red_sea_crossing/landscape/{gen_id}") == ["narration.wav", "scene-1.png", "scene-2.png", "scene-3.png", "scene-4.png"]

    script_call = explore_llm.calls_for("E-02")[0]
    assert (script_call.line("SCENE_COUNT"), script_call.line("IMAGE_FORMAT")) == ("4", "landscape")
    assert "imagePrompt, a detailed 16:9 widescreen illustrated scene prompt" in script_call.text
    assert json.loads(script_call.section("EVENT"))["videoIdea"].startswith("Show Israelites at the sea")
    image_prompts = sorted(call[0] for call in explore_llm.image_calls)
    assert len(image_prompts) == 4 and {call[2] for call in explore_llm.image_calls} == {"16:9"}
    assert all("Art direction: premium illustrated Bible storybook" in p and "16:9 widescreen horizontal composition" in p for p in image_prompts)
    (spoken, _models, _voice, style), = explore_llm.speech_calls
    assert spoken == story["narration"] and style == "Narrate in a warm, calm, reverent Bible documentary narrator voice"
    assert {r["prompt_id"] for r in sql("SELECT prompt_id FROM llm_calls WHERE status = 'ok'")} == {"E-02", "IMG:explore", "TTS:explore"}


def test_existing_story_is_returned_ready_unless_forced(client, login, explore_llm):
    generate(client, login(MEMBER))
    ready = client.post(STORY, json={"sceneCount": 3}, headers=login(EDITOR))
    assert ready.status_code == 200
    assert ready.json() == {"status": "ready", "story": client.get(STORY).json()}
    assert sql_one("SELECT count(*) AS n FROM jobs")["n"] == 1


def test_force_regenerates_and_removes_the_previous_generation(client, login, explore_llm):
    member = login(MEMBER)
    first = generate(client, member)
    old_gen = first["result"]["generation_id"]
    old_story = client.get(STORY).json()
    storage.put_bytes(f"explore/videos/red_sea_crossing/landscape/{old_gen}.mp4", b"previously exported video")
    storage.put_bytes("explore/stories/red_sea_crossing/landscape/gen_00000000000000000000/scene-1.png", b"left behind by a killed worker")
    storage.put_bytes("explore/stories/red_sea_crossing/portrait/gen_00000000000000000000/scene-1.png", b"another format: untouched")

    resp = client.post(STORY, json={"force": True}, headers=login(EDITOR))
    assert resp.status_code == 202
    assert sql_one("SELECT payload FROM jobs WHERE id = :id", id=resp.json()["job_id"])["payload"]["force"] is True
    assert run_worker_once(("ai",))
    second = client.get(f"/v1/jobs/{resp.json()['job_id']}", headers=login(EDITOR)).json()
    assert second["status"] == "succeeded", second["last_error"]
    new_gen = second["result"]["generation_id"]
    assert new_gen != old_gen

    new_story = client.get(STORY).json()
    assert all(client.get(scene["imageUrl"]).status_code == 200 for scene in new_story["scenes"])
    assert all(client.get(scene["imageUrl"]).status_code == 404 for scene in old_story["scenes"])
    assert client.get(old_story["audioUrl"]).status_code == 404 and client.get(new_story["audioUrl"]).status_code == 200
    assert stored_files("explore/stories/red_sea_crossing/landscape") == sorted(f"{new_gen}/{name}" for name in ("narration.wav", "scene-1.png", "scene-2.png", "scene-3.png", "scene-4.png"))
    assert not storage.exists(f"explore/videos/red_sea_crossing/landscape/{old_gen}.mp4")
    assert storage.exists("explore/stories/red_sea_crossing/portrait/gen_00000000000000000000/scene-1.png")
    assert len(explore_llm.calls_for("E-02")) == 2  # a forced story gets a fresh script
    assert sql_one("SELECT generated_by FROM explore_stories")["generated_by"] == "usr_editor"


def test_scene_image_failure_is_retried_once_then_the_story_is_partial(client, login, explore_llm):
    explore_fakes.fail_images_matching(explore_llm, "illustration 2 of")
    job = generate(client, login(MEMBER))
    assert job["status"] == "succeeded", job["last_error"]
    assert (job["result"]["mode"], job["result"]["images_generated"], job["result"]["has_audio"]) == ("partial", 3, True)
    assert sum("illustration 2 of" in call[0] for call in explore_llm.image_calls) == 2
    story = client.get(STORY).json()
    assert story["mode"] == "partial" and story["audioUrl"]
    assert [scene["imageUrl"] is None for scene in story["scenes"]] == [False, True, False, False]
    assert client.get(f"{STORY}/meta").json()["formats"]["landscape"]["mode"] == "partial"
    assert sql_one("SELECT count(*) AS n FROM llm_calls WHERE prompt_id = 'IMG:explore' AND status LIKE 'error%'")["n"] == 2


def test_narration_failure_keeps_the_images(client, login, explore_llm):
    explore_fakes.fail_speech(explore_llm)
    job = generate(client, login(MEMBER))
    assert job["status"] == "succeeded" and (job["result"]["mode"], job["result"]["has_audio"]) == ("partial", False)
    story = client.get(STORY).json()
    assert (story["audioUrl"], story["durationSeconds"]) == (None, None) and all(scene["imageUrl"] for scene in story["scenes"])
    assert client.get(f"{STORY}/meta").json()["formats"]["landscape"]["hasAudio"] is False


def test_story_fails_clearly_and_leaves_no_files_when_nothing_could_be_generated(client, login, explore_llm):
    explore_fakes.fail_images_matching(explore_llm, "illustration")
    explore_fakes.fail_speech(explore_llm)
    member = login(MEMBER)
    job_id = client.post(STORY, json={}, headers=member).json()["job_id"]
    assert run_worker_once(("ai",))
    row = sql_one("SELECT status, attempts, last_error FROM jobs WHERE id = :id", id=job_id)
    assert row["status"] == "queued" and row["attempts"] == 1  # provider trouble is transient: retried later with backoff
    assert "no scene image or narration could be generated" in row["last_error"]
    assert client.get(STORY).status_code == 404 and sql("SELECT event_id FROM explore_stories") == []
    assert stored_files("explore/stories/red_sea_crossing") == []


def test_script_with_too_few_scenes_fails_and_extra_scenes_are_dropped(client, login, explore_llm):
    member = login(MEMBER)

    def scenes(n):
        return lambda call: {**explore_fakes.story_script(call), "scenes": explore_fakes.story_script(call)["scenes"][:1] * n}

    explore_llm.on("E-02", scenes(2))
    job_id = client.post(STORY, json={}, headers=member).json()["job_id"]
    run_worker_once(("ai",))
    row = sql_one("SELECT status, last_error FROM jobs WHERE id = :id", id=job_id)
    assert row["status"] == "queued" and "AIInvalidOutput" in row["last_error"] and explore_llm.image_calls == []

    sql_exec("UPDATE jobs SET status = 'dead' WHERE id = :id", id=job_id)
    explore_llm.on("E-02", scenes(6))
    job = generate(client, member, sceneCount=3)
    assert job["status"] == "succeeded" and job["result"]["scene_count"] == 3
    assert len(client.get(STORY).json()["scenes"]) == 3 and len(explore_llm.image_calls) == 3


def test_portrait_story_is_generated_separately(client, login, explore_llm):
    member = login(MEMBER)
    job = generate(client, member, imageFormat="portrait", sceneCount=3)
    assert job["status"] == "succeeded", job["last_error"]
    assert sql_one("SELECT dedupe_key FROM jobs")["dedupe_key"] == "story:red_sea_crossing:portrait"
    portrait = client.get(f"{STORY}?format=portrait").json()
    assert portrait["imageFormat"] == "portrait" and len(portrait["scenes"]) == 3
    assert all(client.get(scene["imageUrl"]).status_code == 200 for scene in portrait["scenes"])
    assert client.get(STORY).status_code == 404  # landscape has not been generated
    assert {call[2] for call in explore_llm.image_calls} == {"9:16"}
    assert all("9:16 VERTICAL portrait composition" in call[0] for call in explore_llm.image_calls)
    script_call = explore_llm.calls_for("E-02")[0]
    assert script_call.line("IMAGE_FORMAT") == "portrait" and "detailed 9:16 VERTICAL portrait illustrated scene prompt" in script_call.text
    formats = client.get(f"{STORY}/meta").json()["formats"]
    assert (formats["portrait"]["cached"], formats["portrait"]["sceneCount"], formats["landscape"]["cached"]) == (True, 3, False)
    assert stored_files("explore/stories/red_sea_crossing/portrait")[0].endswith("/narration.wav")


def test_story_jobs_are_only_exposed_to_their_requester(client, login, explore_llm):
    job_id = client.post(STORY, json={}, headers=login(MEMBER)).json()["job_id"]
    other = client.post(STORY, json={}, headers=login(OUTSIDER))
    assert other.status_code == 202 and other.json() == {"status": "queued", "job_id": None, "generating": True}
    for headers in ({}, login(OUTSIDER)):
        meta = client.get(f"{STORY}/meta", headers=headers).json()
        assert meta["job"] is None and meta["generating"] is True and meta["formats"]["landscape"]["generating"] is True
    assert client.get(f"{STORY}/meta", headers=login(MEMBER)).json()["job"]["job_id"] == job_id
    assert client.get(f"{STORY}/meta", headers=login(EDITOR)).json()["job"]["job_id"] == job_id  # staff can follow any job
    assert client.get(f"/v1/jobs/{job_id}", headers=login(OUTSIDER)).status_code == 404
    assert sql_one("SELECT count(*) AS n FROM jobs")["n"] == 1


@pytest.mark.parametrize("body", [{"sceneCount": 2}, {"sceneCount": 7}, {"imageFormat": "square"}, {"force": "sometimes"}])
def test_story_request_validation(client, login, explore_llm, body):
    assert client.post(STORY, json=body, headers=login(MEMBER)).status_code == 422
    assert sql("SELECT id FROM jobs") == []


def test_story_requests_need_sign_in_ai_and_a_known_event(client, login, no_llm):
    assert client.post(STORY, json={}).status_code == 401
    assert client.post("/v1/explore/events/no_such_event/story", json={}, headers=login(MEMBER)).status_code == 404
    unavailable = client.post(STORY, json={}, headers=login(MEMBER))
    assert unavailable.status_code == 503 and sql("SELECT id FROM jobs") == []
    assert client.get(f"{STORY}?format=square").status_code == 422
    assert client.get("/v1/explore/events/no_such_event/story").status_code == 404
    assert client.get("/v1/explore/events/no_such_event/story/meta").status_code == 404


def test_existing_story_is_served_without_ai(client, login, explore_llm):
    generate(client, login(MEMBER))
    from interactive_bible.ai.llm import set_llm_client

    from .fakes import UnconfiguredClient

    set_llm_client(UnconfiguredClient())
    assert client.post(STORY, json={}, headers=login(MEMBER)).json()["status"] == "ready"
    assert client.post(STORY, json={"force": True}, headers=login(MEMBER)).status_code == 503
