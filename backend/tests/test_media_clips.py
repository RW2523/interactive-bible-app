"""Media resources end to end through the HTTP API + worker: captions -> mappings with timestamps (AC-01),
virtual clips and ranged playback (AC-05), and rights-checked physical clip export (AC-14)."""
from __future__ import annotations

import pytest

from interactive_bible import storage
from interactive_bible.ingest import media

from .support import (
    EDITOR,
    MEMBER,
    OUTSIDER,
    api_process,
    auth_headers,
    create_resource,
    link_by_ref,
    reset_mutable_state,
    run_worker_once,
    sql,
    sql_one,
    upload,
    vtt,
)

pytestmark = pytest.mark.shared_data

CUES = [
    (1.0, 4.0, "Welcome to our short evening devotion."),
    (4.5, 9.0, "Our memory verse tonight is John 3:16."),
    (9.5, 12.0, "Take a quiet moment and be thankful."),
]


@pytest.fixture(scope="module")
def media_resources(_app_client, silent_mp3):
    """Three processed audio resources sharing the same 20 s file + captions, with different rights."""
    reset_mutable_state()
    client, editor = _app_client, auth_headers(EDITOR)
    captions = vtt(CUES)
    out = {}
    for key, rights, export in (("owned", "owned", True), ("embed_only", "embed_only", True), ("no_export", "owned", False)):
        res = create_resource(client, editor, type="audio", title=f"Evening devotion ({key})", category="podcast", rights_status=rights,
                              allow_clip_export=export, transcript_mode="captions", speaker="Pastor Test")
        assert res["status"] == "draft" and res["capabilities"]["playback"] == "none"
        up = upload(client, editor, res["id"], silent_mp3, "devotion.mp3")
        assert up.status_code == 200, up.text
        cap = upload(client, editor, res["id"], captions, "devotion.vtt", kind="captions")
        assert cap.status_code == 200, cap.text
        run = api_process(client, editor, res["id"])
        assert run["status"] == "succeeded", run["error"]
        segment = sql_one("SELECT * FROM resource_segments WHERE resource_id = :r", r=res["id"])
        out[key] = {"id": res["id"], "upload": up.json(), "segment": segment, "run": run}
    yield out
    reset_mutable_state()


def test_ac01_captioned_media_creates_timestamped_direct_reference(media_resources, _app_client):
    """AC-01 Given a media resource whose captions say "John 3:16", processing creates a direct_reference to JHN.3.16 with evidence text and start/end timestamps."""
    rid = media_resources["owned"]["id"]
    link = link_by_ref(rid, "JHN.3.16")
    assert link is not None
    assert link["relationship_type"] == "direct_reference" and link["review_status"] == "published"
    assert link["confidence"] >= 0.95 and link["primary_flag"] is True
    assert "John 3:16" in link["evidence_text"]
    (offset,) = link["evidence_offsets"]
    assert (offset["start_ms"], offset["end_ms"]) == (4500, 9000)  # the caption cue that says it
    segment = media_resources["owned"]["segment"]
    assert segment["text_normalized"][offset["start"]:offset["end"]] == "John 3:16"
    assert (segment["start_ms"], segment["end_ms"]) == (1000, 12000)

    # the same facts through the public API
    links = _app_client.get(f"/v1/resources/{rid}/verse-links").json()
    api_link = next(l for l in links["links"] if l["verse_ref"] == "JHN.3.16")
    assert api_link["relationship"]["type"] == "direct_reference" and api_link["relationship"]["label"] == "Direct Mention"
    assert api_link["evidence_offsets"][0]["start_ms"] == 4500 and api_link["start_ms"] == 1000 and api_link["end_ms"] == 12000
    transcript = sql_one("SELECT method, diagnostics FROM resource_transcripts WHERE resource_id = :r", r=rid)
    assert transcript["method"] == "captions" and transcript["diagnostics"]["cues"] == 3
    assert abs(transcript["diagnostics"]["duration_ms"] - 20_000) < 200


def test_ac01_upload_probes_media_and_flags_duplicate_files(media_resources):
    """AC-01 Media uploads are probed (duration, audio track) and identical files are flagged as duplicates."""
    first, second = media_resources["owned"]["upload"], media_resources["embed_only"]["upload"]
    assert first["type"] == "audio" and abs(first["duration_ms"] - 20_000) < 200 and first["has_media_file"] and first["status"] == "ready"
    assert "warnings" not in first
    assert media_resources["owned"]["id"] in second["warnings"][0]


def test_ac05_clip_endpoint_returns_bounded_clip_with_signed_playback(media_resources, _app_client):
    """AC-05 The clip endpoint returns clip start/end within the segment/media and a signed playback url that serves HTTP 206 for Range requests; media continues beyond the clip end."""
    rid = media_resources["owned"]["id"]
    seg = media_resources["owned"]["segment"]
    body = _app_client.get(f"/v1/clips/{seg['id']}").json()
    clip, duration = body["clip"], body["resource"]["duration_ms"]
    assert body["segment_id"] == seg["id"] and body["clip"]["virtual"] is True
    assert 0 <= clip["start_ms"] < clip["end_ms"] <= duration
    assert clip["start_ms"] <= body["segment"]["end_ms"] and clip["end_ms"] >= body["segment"]["start_ms"]
    assert clip["start_ms"] <= clip["core_start_ms"] <= clip["core_end_ms"] <= clip["end_ms"]
    assert (clip["core_start_ms"], clip["core_end_ms"]) == (4500, 9000)
    assert clip["end_ms"] < duration  # there is more media after the clip
    assert body["primary_verse"]["ref"] == "JHN.3.16" and body["can_export"] is True

    playback = body["playback"]
    assert playback["mode"] == "local" and playback["url"].startswith(f"/v1/media/{rid}?token=")
    file_size = storage.path_for(sql_one("SELECT source_uri FROM resources WHERE id = :r", r=rid)["source_uri"]).stat().st_size

    ranged = _app_client.get(playback["url"], headers={"Range": "bytes=0-99"})
    assert ranged.status_code == 206
    assert ranged.headers["content-range"] == f"bytes 0-99/{file_size}" and len(ranged.content) == 100

    tail = _app_client.get(playback["url"], headers={"Range": f"bytes={file_size - 512}-"})
    assert tail.status_code == 206 and len(tail.content) == 512  # bytes after the clip end are served

    full = _app_client.get(playback["url"])
    assert full.status_code == 200 and len(full.content) == file_size and full.headers.get("accept-ranges") == "bytes"

    captions = _app_client.get(playback["captions_url"])
    assert captions.status_code == 200 and "John 3:16" in captions.text and "00:00:04.500 --> 00:00:09.000" in captions.text


def test_ac05_media_requires_valid_token_or_view_rights(media_resources, _app_client):
    """AC-05 Media playback requires view rights or a valid signed token for that resource."""
    rid = media_resources["owned"]["id"]
    other = media_resources["no_export"]["id"]
    from interactive_bible.security import media_token

    assert _app_client.get(f"/v1/media/{rid}").status_code == 200  # public resource: viewer may see it anyway
    # make it private: tokens are then the only way in for anonymous players
    from .support import sql_exec

    sql_exec("UPDATE resources SET visibility = 'private' WHERE id = :r", r=rid)
    try:
        assert _app_client.get(f"/v1/media/{rid}").status_code == 404
        assert _app_client.get(f"/v1/media/{rid}?token=garbage").status_code == 404
        assert _app_client.get(f"/v1/media/{rid}?token={media_token(other)}").status_code == 404
        assert _app_client.get(f"/v1/media/{rid}?token={media_token(rid)}").status_code == 200
        assert _app_client.get(f"/v1/media/{rid}", headers=auth_headers(EDITOR)).status_code == 200
        assert _app_client.get(f"/v1/media/{rid}", headers=auth_headers(OUTSIDER)).status_code == 404
    finally:
        sql_exec("UPDATE resources SET visibility = 'public' WHERE id = :r", r=rid)


def test_ac05_embed_only_media_is_not_streamed_locally(media_resources, _app_client):
    """AC-05 embed_only media is never streamed from local storage."""
    rid = media_resources["embed_only"]["id"]
    detail = _app_client.get(f"/v1/resources/{rid}").json()
    assert detail["capabilities"] == {"playback": "none", "clip_export": False, "download": False}
    assert "url" not in detail["playback"]
    from interactive_bible.security import media_token

    assert _app_client.get(f"/v1/media/{rid}?token={media_token(rid)}").status_code == 403


@pytest.mark.parametrize("key", ["embed_only", "no_export"])
def test_ac14_clip_export_is_refused_without_rights(media_resources, _app_client, key):
    """AC-14 A resource with rights_status embed_only or allow_clip_export=false refuses clip export with 403 and queues no export job."""
    seg_id = media_resources[key]["segment"]["id"]
    clip = _app_client.get(f"/v1/clips/{seg_id}").json()
    assert clip["can_export"] is False and clip["export_blocked_reason"]
    resp = _app_client.post(f"/v1/clips/{seg_id}/export", headers=auth_headers(EDITOR))
    assert resp.status_code == 403 and "rights" in resp.json()["detail"]
    assert sql("SELECT id FROM jobs WHERE type = 'export_clip' AND payload->>'segment_id' = :s", s=seg_id) == []
    # the worker-side guard refuses as well
    from interactive_bible.services.clips import export_clip_file
    from interactive_bible.services.resources import Forbidden

    with pytest.raises(Forbidden):
        export_clip_file(seg_id, "usr_editor")


def test_ac14_denied_clip_export_is_audited(media_resources, _app_client):
    """AC-14 A refused clip export is recorded in the audit trail."""
    seg_id = media_resources["embed_only"]["segment"]["id"]
    assert _app_client.post(f"/v1/clips/{seg_id}/export", headers=auth_headers(EDITOR)).status_code == 403
    denied = sql("SELECT action, new_value FROM review_actions WHERE object_type = 'clip' AND object_id = :s", s=seg_id)
    assert denied and denied[-1]["action"] == "export_denied"
    assert denied[-1]["new_value"] == {"rights_status": "embed_only", "allow_clip_export": True}


def test_ac14_owned_exportable_clip_is_exported_by_the_worker(media_resources, _app_client, media_dir):
    """AC-14 An owned resource with allow_clip_export queues a 202 export job whose worker handler produces a clip file."""
    seg_id = media_resources["owned"]["segment"]["id"]
    assert _app_client.post(f"/v1/clips/{seg_id}/export").status_code == 401
    resp = _app_client.post(f"/v1/clips/{seg_id}/export", headers=auth_headers(EDITOR))
    assert resp.status_code == 202, resp.text
    job_id = resp.json()["job_id"]
    assert resp.json()["status"] == "queued"
    # a second request while queued is de-duplicated
    assert _app_client.post(f"/v1/clips/{seg_id}/export", headers=auth_headers(EDITOR)).json()["job_id"] == job_id

    assert run_worker_once(("media",))
    job = _app_client.get(f"/v1/jobs/{job_id}", headers=auth_headers(EDITOR)).json()
    assert job["status"] == "succeeded", job.get("last_error")
    result = job["result"]
    assert (result["start_ms"], result["end_ms"], result["format"]) == (1000, 12000, "mp3")
    exported = storage.path_for(result["storage_key"])
    assert exported.exists() and exported.stat().st_size > 0
    info = media.probe(exported)
    assert 10_000 <= info.duration_ms <= 12_500 and info.has_audio

    download = _app_client.get(job["download_url"], headers=auth_headers(EDITOR))
    assert download.status_code == 200 and download.content == exported.read_bytes()
    # other members cannot see or download someone else's export
    assert _app_client.get(f"/v1/jobs/{job_id}", headers=auth_headers(MEMBER)).status_code == 404
    assert _app_client.get(job["download_url"], headers=auth_headers(MEMBER)).status_code == 404


def test_resource_status_reports_progress_and_counts(media_resources, _app_client):
    rid = media_resources["owned"]["id"]
    public = _app_client.get(f"/v1/resources/{rid}/status").json()
    assert public["status"] == "processed" and public["progress"] == 1.0
    assert public["counts"] == {"mappings": 1, "visible": 1, "in_review": 0}
    assert set(public["run"]) == {"id", "status", "current_stage", "started_at", "completed_at"}
    owner = _app_client.get(f"/v1/resources/{rid}/status", headers=auth_headers(EDITOR)).json()
    stages = {s["id"]: s["status"] for s in owner["run"]["stages"]}
    assert stages["ING-03"] == "completed" and stages["ING-08"] == "skipped" and stages["ING-12"] == "completed"
    assert owner["job"]["status"] == "succeeded"


@pytest.mark.nodb
def test_clip_reason_shown_to_viewers_never_leaks_timing_internals():
    from interactive_bible.pipeline.enrich import viewer_clip_reason

    assert viewer_clip_reason("The speaker reads Romans 8:28 and explains how God works through suffering.") == \
        "The speaker reads Romans 8:28 and explains how God works through suffering."
    for leaked in ("The core reference occurs between 25000ms and 36000ms.", "Starts at unit u3 for context.", "Chosen from the timestamps given.", "", None):
        assert viewer_clip_reason(leaked) is None
