"""Local MP4 export of AI stories (export_story_video job) with the real ffmpeg at a tiny size, plus the scene timing,
filter graph and placeholder-frame helpers."""
from __future__ import annotations

import shutil
import sys

import pytest

from interactive_bible import storage
from interactive_bible.ingest import media
from interactive_bible.services.explore import video

from . import explore_fakes
from .support import EDITOR, MEMBER, OUTSIDER, run_worker_once, sql_exec, sql_one

STORY = "/v1/explore/events/red_sea_crossing/story"
HAVE_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


@pytest.fixture(autouse=True)
def _clean_explore_files(request):
    if request.node.get_closest_marker("nodb"):
        yield
        return
    storage.delete_prefix("explore")  # generated files are not truncated between tests
    yield
    storage.delete_prefix("explore")


@pytest.fixture
def explore_llm(fake_llm):
    return explore_fakes.install(fake_llm)


@pytest.fixture
def tiny_videos(monkeypatch):
    if not HAVE_FFMPEG:
        pytest.skip("ffmpeg/ffprobe are required for video export tests")
    monkeypatch.setattr(video, "VIDEO_SIZES", {"landscape": (160, 90), "portrait": (90, 160)})
    monkeypatch.setattr(video, "VIDEO_PRESET", "ultrafast")


def generate_story(client, headers, **body) -> dict:
    job_id = client.post(STORY, json=body, headers=headers).json()["job_id"]
    assert run_worker_once(("ai",))
    job = client.get(f"/v1/jobs/{job_id}", headers=headers).json()
    assert job["status"] == "succeeded", job["last_error"]
    return job["result"]


def export(client, headers, image_format: str = "landscape") -> dict:
    resp = client.post(f"{STORY}/video", json={"format": image_format}, headers=headers)
    assert resp.status_code == 202, resp.text
    assert run_worker_once(("media",))
    return client.get(f"/v1/jobs/{resp.json()['job_id']}", headers=headers).json()


def test_story_video_is_rendered_to_mp4_and_downloadable(client, login, explore_llm, tiny_videos, monkeypatch):
    member = login(MEMBER)
    generated = generate_story(client, member)
    story = client.get(STORY).json()

    resp = client.post(f"{STORY}/video", json={}, headers=member)
    assert resp.status_code == 202
    job_id = resp.json()["job_id"]
    assert resp.json() == {"job_id": job_id, "status": "queued"}
    queued = sql_one("SELECT queue, max_attempts, dedupe_key, payload FROM jobs WHERE id = :id", id=job_id)
    gen_id = generated["generation_id"]
    assert (queued["queue"], queued["max_attempts"], queued["dedupe_key"]) == ("media", 1, f"story-video:red_sea_crossing:landscape:{gen_id}:usr_member")
    assert queued["payload"] == {"event_id": "red_sea_crossing", "image_format": "landscape", "generation_id": gen_id, "requested_by": "usr_member"}
    assert client.post(f"{STORY}/video", json={"format": "landscape"}, headers=member).json()["job_id"] == job_id  # de-duplicated

    assert run_worker_once(("media",))
    job = client.get(f"/v1/jobs/{job_id}", headers=member).json()
    assert job["status"] == "succeeded", job["last_error"]
    result = job["result"]
    key = f"explore/videos/red_sea_crossing/landscape/{gen_id}.mp4"
    assert (result["storage_key"], result["filename"], result["generation_id"]) == (key, "red_sea_crossing-story.mp4", gen_id)
    assert result["duration_seconds"] == pytest.approx(story["durationSeconds"], abs=0.3)  # slides are timed to the narration
    assert job["progress"] == {"step": "render", "done": 1, "total": 1, "message": "Video ready"}

    download = client.get(job["download_url"], headers=member)
    assert download.status_code == 200 and download.content[4:8] == b"ftyp"
    assert "red_sea_crossing-story.mp4" in download.headers["content-disposition"]
    info = media.probe(storage.path_for(key))
    assert info.has_video and info.has_audio and (info.width, info.height) == (160, 90)
    assert client.get(result["url"]).content == download.content  # also streamable through its signed URL
    assert client.get(job["download_url"], headers=login(OUTSIDER)).status_code == 404  # downloads stay with the requester

    # another user's export of the same generation is their own job, and reuses the rendered file
    def no_render(*_args, **_kwargs):
        raise AssertionError("the cached MP4 should be reused")

    monkeypatch.setattr(video, "render_story_video", no_render)
    editor_job = export(client, login(EDITOR))
    assert editor_job["status"] == "succeeded", editor_job["last_error"]
    assert editor_job["id"] != job_id and editor_job["result"]["storage_key"] == key


def test_story_without_narration_exports_with_a_silent_track_and_placeholder_frames(client, login, explore_llm, tiny_videos):
    explore_fakes.fail_speech(explore_llm)
    explore_fakes.fail_images_matching(explore_llm, "illustration 2 of")
    member = login(MEMBER)
    generated = generate_story(client, member, imageFormat="portrait")
    assert (generated["has_audio"], generated["mode"], generated["images_generated"]) == (False, "partial", 3)
    story = client.get(f"{STORY}?format=portrait").json()
    assert story["audioUrl"] is None and story["scenes"][1]["imageUrl"] is None

    job = export(client, member, "portrait")
    assert job["status"] == "succeeded", job["last_error"]
    info = media.probe(storage.path_for(job["result"]["storage_key"]))
    assert info.has_video and info.has_audio and (info.width, info.height) == (90, 160)
    total = sum(scene["durationSec"] for scene in story["scenes"])  # no narration: the scenes keep their own durations
    assert job["result"]["duration_seconds"] == pytest.approx(total, abs=0.3)
    assert client.get(job["download_url"], headers=member).content[4:8] == b"ftyp"
    assert not list(storage.path_for("work").glob("story-video-*"))  # render work directories are cleaned up


def test_regenerated_story_is_exported_again(client, login, explore_llm, tiny_videos):
    member = login(MEMBER)
    first = generate_story(client, member)
    first_export = export(client, member)
    assert first_export["status"] == "succeeded"
    second = client.post(STORY, json={"force": True}, headers=member).json()
    assert run_worker_once(("ai",))
    new_gen = sql_one("SELECT manifest->>'genId' AS g FROM explore_stories")["g"]
    assert second["status"] == "queued" and new_gen != first["generation_id"]
    assert not storage.exists(first_export["result"]["storage_key"])  # the old generation's video went with it
    assert client.get(first_export["download_url"], headers=member).status_code == 404
    again = export(client, member)
    assert again["status"] == "succeeded" and again["result"]["storage_key"].endswith(f"/{new_gen}.mp4")


def test_video_export_requires_sign_in_and_an_existing_story(client, login, no_llm):
    assert client.post(f"{STORY}/video", json={}).status_code == 401
    missing = client.post(f"{STORY}/video", json={}, headers=login(MEMBER))
    assert missing.status_code == 404 and missing.json() == {"detail": "no story has been generated for this event yet"}
    assert client.post("/v1/explore/events/no_such_event/story/video", json={}, headers=login(MEMBER)).status_code == 404
    assert client.post(f"{STORY}/video", json={"format": "square"}, headers=login(MEMBER)).status_code == 422
    assert sql_one("SELECT count(*) AS n FROM jobs")["n"] == 0


def test_export_fails_clearly_when_ffmpeg_is_missing(client, login, explore_llm, monkeypatch):
    member = login(MEMBER)
    generate_story(client, member)
    job_id = client.post(f"{STORY}/video", json={}, headers=member).json()["job_id"]
    which = shutil.which
    monkeypatch.setattr(shutil, "which", lambda cmd, *args, **kwargs: None if cmd in ("ffmpeg", "ffprobe") else which(cmd, *args, **kwargs))
    assert run_worker_once(("media",))
    row = sql_one("SELECT status, last_error FROM jobs WHERE id = :id", id=job_id)
    assert row["status"] == "dead" and "ffmpeg is not installed" in row["last_error"]


def test_export_of_a_story_deleted_meanwhile_fails(client, login, explore_llm):
    member = login(MEMBER)
    generate_story(client, member)
    job_id = client.post(f"{STORY}/video", json={}, headers=member).json()["job_id"]
    sql_exec("DELETE FROM explore_stories")
    assert run_worker_once(("media",))
    row = sql_one("SELECT status, last_error FROM jobs WHERE id = :id", id=job_id)
    assert row["status"] == "dead" and "the story no longer exists" in row["last_error"]


# ----------------------------------------------------------------------------- pure helpers
@pytest.mark.nodb
def test_scene_durations_follow_the_weights_and_fill_the_narration():
    durations, xfade = video.plan_scene_durations([6, 8, 7, 7], 30.0)
    assert xfade == pytest.approx(0.55)
    assert sum(durations) - 3 * xfade == pytest.approx(30.0)  # crossfades overlap: the video lasts exactly as long as the narration
    assert durations[1] / durations[0] == pytest.approx(8 / 6)
    single, _ = video.plan_scene_durations([6], 5.0)
    assert single == [pytest.approx(5.0)]


@pytest.mark.nodb
def test_very_short_videos_shrink_the_crossfade_consistently():
    durations, xfade = video.plan_scene_durations([2, 2, 2], 1.0)
    assert 0.08 <= xfade < 0.2 and all(d > xfade for d in durations)
    assert sum(durations) - 2 * xfade == pytest.approx(1.0)


@pytest.mark.nodb
def test_filter_graph_chains_crossfades_between_scenes():
    graph = video.build_filter_graph([4.0, 5.0, 6.0], 160, 90, 30, 0.5)
    assert graph.startswith("[0:v]scale=160:90:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=160:90:(ow-iw)/2:(oh-ih)/2,")
    assert "fps=30,trim=duration=4.0000,setpts=PTS-STARTPTS[v0]" in graph
    assert "[v0][v1]xfade=transition=fade:duration=0.5000:offset=3.5000[x1]" in graph
    assert graph.endswith("[x1][v2]xfade=transition=fade:duration=0.5000:offset=8.0000[outv]")
    assert video.build_filter_graph([3.0], 160, 90, 30, 0.2).endswith(";[v0]setpts=PTS-STARTPTS[outv]")


@pytest.mark.nodb
def test_placeholder_frames_are_drawn_locally(tmp_path, monkeypatch):
    from PIL import Image

    path = video.placeholder_frame("Moses lifts his staff over the sea " * 6, "Scene 2", (320, 180), tmp_path / "frame.png")
    with Image.open(path) as frame:
        assert frame.size == (320, 180) and frame.mode == "RGB"
        top, middle = frame.getpixel((160, 2)), frame.getpixel((160, 90))
    assert sum(top) < 150  # deep navy sky
    assert middle[0] > 200 or sum(frame_pixel for frame_pixel in middle) < 150  # parchment card or its navy title text
    # without Pillow a plain gradient frame is still a valid PNG
    monkeypatch.setitem(sys.modules, "PIL", None)
    fallback = video.placeholder_frame("Title", "Scene 1", (64, 36), tmp_path / "fallback.png")
    data = fallback.read_bytes()
    assert data.startswith(b"\x89PNG\r\n\x1a\n") and data[16:24] == (64).to_bytes(4, "big") + (36).to_bytes(4, "big")
