"""YouTube links as a library source: the video's details and captions are read from YouTube (never downloaded), the
transcript is mapped to verses, and every verse clip plays inside YouTube's own embed (no physical clip export).

The extractor and the caption download are replaced by stubs, so these tests never touch the network.
"""
from __future__ import annotations

import copy
import json

import pytest

from interactive_bible.ingest import youtube as yt
from interactive_bible.ingest.transcribe import youtube_id
from interactive_bible.ingest.validate import UploadRejected

from .support import (
    ADMIN,
    EDITOR,
    api_process,
    auth_headers,
    create_resource,
    link_by_ref,
    links_for,
    reset_mutable_state,
    sql_one,
)

VIDEO_ID = "aBcDeFgHiJk"
WATCH_URL = f"https://www.youtube.com/watch?v={VIDEO_ID}"

VIDEO_INFO = {
    "id": VIDEO_ID,
    "title": "Hope that holds — an evening study",
    "uploader": "Grace Community Church",
    "channel": "Grace Community Church",
    "duration": 912.0,
    "thumbnail": f"https://i.ytimg.com/vi/{VIDEO_ID}/maxresdefault.jpg",
    "upload_date": "20260412",
    "language": "en-US",
    "description": "Evening study on Romans 8.",
    "is_live": False,
    "chapters": [{"title": "Welcome", "start_time": 0, "end_time": 60}, {"title": "The promise", "start_time": 60, "end_time": 912}],
    "subtitles": {
        "en": [{"ext": "vtt", "url": "https://captions.test/en.vtt"}, {"ext": "json3", "url": "https://captions.test/en.json3", "name": "English"}],
    },
    "automatic_captions": {
        "en": [{"ext": "json3", "url": "https://captions.test/auto-en.json3"}],
        "es": [{"ext": "json3", "url": "https://captions.test/auto-es.json3"}],  # a machine translation: must be ignored
    },
}

CAPTION_EVENTS = {
    "events": [
        {"tStartMs": 0, "dDurationMs": 4000, "segs": [{"utf8": "Good evening, and welcome to our study."}]},
        {"tStartMs": 4200, "dDurationMs": 5200, "segs": [{"utf8": "Our text tonight is "}, {"utf8": "Romans 8:28."}]},
        {"tStartMs": 9000, "dDurationMs": 6000, "segs": [{"utf8": "We know that all things work together for good for those who love God."}]},
        {"tStartMs": 14500, "dDurationMs": 4000, "segs": [{"utf8": "​"}]},  # placeholder cue: dropped
        {"tStartMs": 15000, "dDurationMs": 5000, "segs": [{"utf8": "Hold on to that promise this week."}]},
    ]
}


@pytest.fixture
def youtube_stub(monkeypatch):
    """Replaces yt-dlp and the caption download; records the URLs that were asked for."""
    calls: dict[str, list[str]] = {"extract": [], "track": []}

    def extract(url: str) -> dict:
        calls["extract"].append(url)
        return copy.deepcopy(VIDEO_INFO)

    def download(url: str) -> str:
        calls["track"].append(url)
        return json.dumps(CAPTION_EVENTS)

    monkeypatch.setattr(yt, "extractor", extract)
    monkeypatch.setattr(yt, "track_downloader", download)
    return calls


# ----------------------------------------------------------------------------- link parsing
@pytest.mark.nodb
@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://www.youtube.com/watch?v=aBcDeFgHiJk", VIDEO_ID),
        ("https://www.youtube.com/watch?v=aBcDeFgHiJk&list=PL123&t=42s", VIDEO_ID),
        ("https://youtu.be/aBcDeFgHiJk?si=xyz", VIDEO_ID),
        ("https://www.youtube.com/shorts/aBcDeFgHiJk", VIDEO_ID),
        ("https://www.youtube.com/live/aBcDeFgHiJk", VIDEO_ID),
        ("https://www.youtube-nocookie.com/embed/aBcDeFgHiJk", VIDEO_ID),
        ("https://vimeo.com/123456", None),
        ("not a link", None),
    ],
)
def test_youtube_links_are_recognised(url, expected):
    assert youtube_id(url) == expected


# ----------------------------------------------------------------------------- captions
@pytest.mark.nodb
def test_caption_events_become_cues_without_placeholders_or_overlaps():
    cues = yt.parse_json3(json.dumps({
        "events": [
            {"tStartMs": 0, "dDurationMs": 3000, "segs": [{"utf8": "first line"}]},
            {"tStartMs": 2500, "dDurationMs": 3000, "segs": [{"utf8": "second"}, {"utf8": " line"}]},  # overlaps the first
            {"tStartMs": 6000, "segs": [{"utf8": "no duration"}]},
            {"tStartMs": 9000, "dDurationMs": 1000, "segs": [{"utf8": " \n "}]},  # whitespace only
            {"tStartMs": 10000, "dDurationMs": 1000, "segs": []},
        ]
    }))
    assert [c["text"] for c in cues] == ["first line", "second line", "no duration"]
    assert cues[0]["end_ms"] == 2500 and cues[1]["start_ms"] == 2500  # trimmed, no overlap
    assert cues[2]["end_ms"] > cues[2]["start_ms"]
    with pytest.raises(UploadRejected, match="unexpected format"):
        yt.parse_json3("<html>nope</html>")


@pytest.mark.nodb
def test_a_human_made_track_wins_and_translations_are_ignored(youtube_stub):
    info = yt.inspect(WATCH_URL)
    assert [(t.language, t.kind) for t in info.tracks] == [("en", "manual"), ("en", "auto")]  # es auto-translation dropped
    best = info.best_track()
    assert (best.kind, best.language, best.url) == ("manual", "en", "https://captions.test/en.json3")
    cues, track = yt.caption_cues(info)
    assert track.kind == "manual" and len(cues) == 4 and youtube_stub["track"] == [best.url]

    auto_only = copy.deepcopy(VIDEO_INFO)
    auto_only.pop("subtitles")
    assert yt.VideoInfo(video_id=VIDEO_ID, url=WATCH_URL, title="x", tracks=yt._tracks_from(auto_only)).best_track().kind == "auto"
    assert yt.VideoInfo(video_id=VIDEO_ID, url=WATCH_URL, title="x").best_track() is None


@pytest.mark.nodb
def test_placeholder_chapter_titles_and_unreliable_stills_are_cleaned(monkeypatch):
    info = {
        **copy.deepcopy(VIDEO_INFO),
        "thumbnail": f"https://i.ytimg.com/vi_webp/{VIDEO_ID}/maxresdefault.webp",
        "thumbnails": [{"url": f"https://i.ytimg.com/vi/{VIDEO_ID}/mqdefault.jpg", "width": 320},
                       {"url": f"https://i.ytimg.com/vi/{VIDEO_ID}/hq720.jpg", "width": 1280}],
        "chapters": [{"title": "<Untitled Chapter 1>", "start_time": 0, "end_time": 30}, {"title": "Welcome", "start_time": 30}],
    }
    monkeypatch.setattr(yt, "extractor", lambda url: info)
    video = yt.inspect(WATCH_URL)
    assert video.thumbnail == f"https://i.ytimg.com/vi/{VIDEO_ID}/hq720.jpg"  # widest real jpg, not the .webp
    assert [c["title"] for c in video.chapters] == ["", "Welcome"]


@pytest.mark.nodb
def test_inspect_reads_the_details_and_explains_failures(youtube_stub, monkeypatch):
    info = yt.inspect(f"https://youtu.be/{VIDEO_ID}")
    assert youtube_stub["extract"] == [WATCH_URL]
    assert (info.video_id, info.title, info.channel) == (VIDEO_ID, "Hope that holds — an evening study", "Grace Community Church")
    assert (info.duration_ms, info.language, info.upload_date) == (912000, "en-US", "20260412")
    assert info.embed_url == f"https://www.youtube-nocookie.com/embed/{VIDEO_ID}" and info.watch_url == WATCH_URL
    assert [c["title"] for c in info.chapters] == ["Welcome", "The promise"] and info.chapters[1]["start_ms"] == 60000
    public = info.public()
    assert public["captions"]["best"] == {"language": "en", "kind": "manual", "name": "English"}
    # maxresdefault 404s for some videos and .webp stills don't load everywhere: a reliable jpg is stored instead
    assert public["provider"] == "youtube" and public["thumbnail"] == f"https://i.ytimg.com/vi/{VIDEO_ID}/hqdefault.jpg"

    with pytest.raises(UploadRejected, match="doesn't look like a YouTube link"):
        yt.inspect("https://example.com/sermon")
    live = {**copy.deepcopy(VIDEO_INFO), "is_live": True}
    monkeypatch.setattr(yt, "extractor", lambda url: live)
    with pytest.raises(UploadRejected, match="live right now"):
        yt.inspect(WATCH_URL)


@pytest.mark.nodb
@pytest.mark.parametrize(
    ("error", "message"),
    [
        ("ERROR: [youtube] abc: Private video. Sign in if you've been granted access to this video", "private"),
        ("ERROR: [youtube] abc: Video unavailable", "unavailable"),
        ("ERROR: [youtube] abc: Join this channel to get access to members-only content", "members only"),
        ("ERROR: something else entirely", "Could not read"),
    ],
)
def test_extractor_failures_become_readable_messages(monkeypatch, error, message):
    def boom(url: str) -> dict:
        raise RuntimeError(error)

    monkeypatch.setattr(yt, "extractor", boom)
    with pytest.raises(UploadRejected, match=message):
        yt.inspect(WATCH_URL)


# ----------------------------------------------------------------------------- API
def test_inspect_url_endpoint_prefills_the_add_to_library_form(client, login, youtube_stub):
    anonymous = client.post("/v1/resources/inspect-url", json={"url": WATCH_URL})
    assert anonymous.status_code == 401  # accounts mode: signing in required (personal mode makes this the owner)
    resp = client.post("/v1/resources/inspect-url", json={"url": f"https://youtu.be/{VIDEO_ID}"}, headers=login(EDITOR))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["video_id"] == VIDEO_ID and body["captions_available"] is True and body["transcript_source"] == "captions"
    assert body["suggested"] == {
        "type": "video", "category": "sermon", "title": "Hope that holds — an evening study", "author": "Grace Community Church",
        "speaker": None, "duration_ms": 912000, "language": "en", "rights_status": "embed_only",
        "allow_clip_export": False, "url": WATCH_URL,
    }
    other = client.post("/v1/resources/inspect-url", json={"url": "https://example.com/sermon.html"}, headers=login(EDITOR))
    assert other.status_code == 422 and "YouTube" in other.json()["detail"]


def test_creating_a_resource_from_a_link_fills_in_the_video_details(client, login, youtube_stub):
    editor = login(EDITOR)
    res = create_resource(client, editor, type="video", title="Evening study", url=WATCH_URL, category="sermon", speaker="Pastor Ada", rights_status="unknown")
    assert res["status"] == "ready" and res["source_kind"] == "external_embed" and res["source_url"] == WATCH_URL
    assert (res["duration_ms"], res["author"], res["speaker"], res["language"]) == (912000, "Grace Community Church", "Pastor Ada", "en")
    assert res["rights_status"] == "embed_only" and res["allow_clip_export"] is False
    assert res["capabilities"] == {"playback": "embed", "clip_export": False, "download": False}
    assert res["youtube"]["video_id"] == VIDEO_ID and res["thumbnail_url"] == f"https://i.ytimg.com/vi/{VIDEO_ID}/hqdefault.jpg"
    assert len(res["youtube"]["chapters"]) == 2 and res["youtube"]["captions"]["best"]["kind"] == "manual"
    detail = client.get(f"/v1/resources/{res['id']}", headers=editor).json()
    assert detail["playback"] == {"mode": "embed", "media_type": "video", "url": WATCH_URL, "provider": "youtube", "youtube_id": VIDEO_ID}
    assert sql_one("SELECT status, duration_ms FROM resources WHERE id = :r", r=res["id"]) == {"status": "ready", "duration_ms": 912000}


def test_a_broken_link_is_rejected_when_it_is_pasted(client, login, monkeypatch):
    monkeypatch.setattr(yt, "extractor", lambda url: (_ for _ in ()).throw(RuntimeError("ERROR: [youtube] x: Private video")))
    resp = client.post("/v1/resources", json={"type": "video", "title": "Private", "url": WATCH_URL}, headers=login(EDITOR))
    assert resp.status_code == 400 and "private" in resp.json()["detail"].lower()
    assert sql_one("SELECT count(*) AS n FROM resources WHERE title = 'Private'")["n"] == 0


# ----------------------------------------------------------------------------- end to end
def test_a_pasted_link_is_transcribed_from_captions_and_mapped_to_verses(client, login, youtube_stub):
    """The whole flow with no AI: captions -> segments with timings -> verse mappings -> a clip that plays in the embed."""
    reset_mutable_state()
    editor = login(EDITOR)
    res = create_resource(client, editor, type="video", title="Evening study", url=WATCH_URL, category="sermon", visibility="public", rights_status="unknown")
    run = api_process(client, editor, res["id"])
    assert run["status"] == "succeeded", run["error"]

    transcript = sql_one("SELECT method, method_version, diagnostics FROM resource_transcripts WHERE resource_id = :r", r=res["id"])
    assert transcript["method"] == "youtube_captions" and transcript["method_version"] == "youtube-captions-1"
    assert transcript["diagnostics"]["youtube"]["captions"] == {"language": "en", "kind": "manual", "name": "English"}
    assert transcript["diagnostics"]["cues"] == 4 and youtube_stub["track"] == ["https://captions.test/en.json3"]

    mapping = link_by_ref(res["id"], "ROM.8.28")
    assert mapping and mapping["relationship_type"] == "direct_reference" and mapping["review_status"] in ("published", "approved")
    assert all(link["evidence_text"] for link in links_for(res["id"]))
    segment = sql_one("SELECT * FROM resource_segments WHERE id = :s", s=mapping["segment_id"])
    assert 0 <= segment["start_ms"] < segment["end_ms"] <= 912000  # timings come from the caption cues

    clip = client.get(f"/v1/clips/{mapping['segment_id']}").json()
    play = clip["playback"]
    assert (play["mode"], play["provider"], play["youtube_id"], play["url"]) == ("embed", "youtube", VIDEO_ID, WATCH_URL)
    assert play["captions_url"].startswith(f"/v1/resources/{res['id']}/captions.vtt")  # the transcript is served locally
    assert clip["clip"]["virtual"] is True and 0 <= clip["clip"]["start_ms"] < clip["clip"]["end_ms"] <= 912000
    assert clip["can_export"] is False and clip["export_blocked_reason"]  # the video stays on YouTube

    verse = client.get("/v1/verses/ROM.8.28/intelligence").json()
    card = next((c for c in verse["sections"]["watch"] if c["resource"]["id"] == res["id"]), None)
    assert card and card["resource"]["youtube_id"] == VIDEO_ID and card["resource"]["thumbnail_url"]
    assert card["clip"]["start_ms"] <= card["clip"]["core_start_ms"] <= card["clip"]["core_end_ms"] <= card["clip"]["end_ms"]
    reset_mutable_state()


AUTO_EVENTS = {  # what YouTube's speech-to-text returns: fragments, no punctuation
    "events": [
        {"tStartMs": t, "dDurationMs": 1800, "segs": [{"utf8": text}]}
        for t, text in [
            (0, "good evening and welcome to our study"),
            (1900, "tonight we are in romans 8:28"),
            (3800, "we know that all things work together"),
            (5700, "for good for those who love god"),
            (9000, "so hold on to that promise this week"),  # after a 1.5 s pause
            (11000, "and let it steady you when the week is hard"),
        ]
    ]
}


@pytest.mark.nodb
def test_unpunctuated_captions_are_split_into_spoken_units():
    from interactive_bible.ingest import captions as cap

    cues = yt.parse_json3(json.dumps(AUTO_EVENTS))
    assert cap.looks_unpunctuated(cues) is True
    units = cap.cues_to_units(cues)
    assert len(units) == 2  # the 1.5 s pause breaks the stream; without this the whole video is one "sentence"
    assert units[0].text_raw.endswith("love god") and units[1].start_ms == 9000
    assert units[0].start_ms == 0 and units[-1].end_ms == 12800
    assert all(u.end_ms > u.start_ms for u in units) and all(u.kind == "sentence" for u in units)
    joined = " ".join(u.text_raw for u in units)
    assert "romans 8:28" in joined and "." not in joined  # words are grouped, never rewritten


def test_auto_generated_captions_still_map_verses_across_several_segments(client, login, monkeypatch):
    """A long video with speech-to-text captions must become many segments with their own clips, not one block."""
    reset_mutable_state()
    long_events = {"events": [
        {"tStartMs": i * 2000, "dDurationMs": 1900,
         "segs": [{"utf8": "tonight we are in romans 8:28" if i % 9 == 0 else f"and the promise holds for us in part {i}"}]}
        for i in range(120)
    ]}
    monkeypatch.setattr(yt, "extractor", lambda url: {**copy.deepcopy(VIDEO_INFO), "subtitles": {}, "duration": 240.0})
    monkeypatch.setattr(yt, "track_downloader", lambda url: json.dumps(long_events))
    editor = login(EDITOR)
    res = create_resource(client, editor, type="video", title="Auto-captioned study", url=WATCH_URL, visibility="public", rights_status="unknown")
    assert res["youtube"]["captions"]["best"]["kind"] == "auto"
    run = api_process(client, editor, res["id"])
    assert run["status"] == "succeeded", run["error"]
    transcript = sql_one("SELECT diagnostics FROM resource_transcripts WHERE resource_id = :r", r=res["id"])["diagnostics"]
    assert transcript["sentence_split"] == "pauses" and transcript["units"] > 20
    segments = sql_one("""SELECT count(*) AS n, count(clip_start_ms) AS with_clip, max(end_ms - start_ms) AS longest
                          FROM resource_segments WHERE resource_id = :r AND is_active""", r=res["id"])
    assert segments["n"] >= 2 and segments["with_clip"] == segments["n"] and segments["longest"] <= 200_000
    mapping = link_by_ref(res["id"], "ROM.8.28")
    assert mapping and mapping["relationship_type"] == "direct_reference"
    clip = client.get(f"/v1/clips/{mapping['segment_id']}").json()["clip"]
    assert 15_000 <= clip["end_ms"] - clip["start_ms"] <= 180_000  # a short clip, not the whole video
    reset_mutable_state()


def _service_events() -> dict:
    """A church service recording: teaching, then a worship song, then teaching again (auto-captions, no punctuation)."""
    events = []
    t = 0

    def add(text: str, seconds: float = 2.0) -> None:
        nonlocal t
        events.append({"tStartMs": t, "dDurationMs": int(seconds * 1000) - 100, "segs": [{"utf8": text}]})
        t += int(seconds * 1000)

    for i in range(20):  # ~40 s of preaching
        add("tonight we are in romans 8:28 and i want you to see this promise" if i == 4 else f"and that is the heart of it friends part {i}")
    t += 2000
    for i in range(30):  # ~60 s of singing, marked by the captions
        add("[Music]" if i % 4 == 0 else f"we sing together placeholder worship line {i}")
    t += 2000
    for i in range(20):  # ~40 s of preaching again
        add("look with me at hebrews 11:1 where faith is described" if i == 5 else f"so we hold on together in this part {i}")
    return {"events": events}


def test_worship_songs_are_separated_from_the_teaching(client, login, monkeypatch, fake_llm):
    """Verse links come from the preaching; sung sections are marked and skipped (no paid AI, no lyric mappings)."""
    reset_mutable_state()
    monkeypatch.setattr(yt, "extractor", lambda url: {**copy.deepcopy(VIDEO_INFO), "subtitles": {}, "duration": 150.0})
    monkeypatch.setattr(yt, "track_downloader", lambda url: json.dumps(_service_events()))
    editor = login(EDITOR)
    res = create_resource(client, editor, type="video", title="Sunday service", url=WATCH_URL, visibility="public", rights_status="unknown")
    run = api_process(client, editor, res["id"])
    assert run["status"] == "succeeded", run["error"]

    segments = client.get(f"/v1/resources/{res['id']}/segments?include_mappings=true", headers=editor).json()["segments"]
    sung = [sg for sg in segments if (sg.get("non_speech_ratio") or 0) >= 0.6]
    spoken = [sg for sg in segments if (sg.get("non_speech_ratio") or 0) < 0.6]
    assert sung and spoken, [sg.get("non_speech_ratio") for sg in segments]
    assert not [m for sg in sung for m in (sg.get("mappings") or [])], "sung sections must not produce verse links"

    refs = {m.get("verse_ref") for sg in spoken for m in (sg.get("mappings") or [])}
    assert "ROM.8.28" in refs and "HEB.11.1" in refs  # both passages named in the teaching are mapped
    assert all(sg["part"] == "worship" for sg in sung) and all(sg["part"] == "message" for sg in spoken)
    stages = {st["id"]: st for st in run["stages"]}
    assert (stages["ING-09"]["detail"] or {}).get("skipped_sections", {}).get("worship", 0) >= 1
    assert (stages["ING-10"]["detail"] or {}).get("skipped_sections", {}).get("worship", 0) >= 1
    assert (stages["ING-05B"]["detail"] or {}).get("parts", {}).get("worship", 0) >= 1
    reset_mutable_state()


def test_captions_only_mode_explains_a_video_without_captions(client, login, monkeypatch):
    monkeypatch.setattr(yt, "extractor", lambda url: {k: v for k, v in copy.deepcopy(VIDEO_INFO).items() if k not in ("subtitles", "automatic_captions")})
    editor = login(ADMIN)
    res = create_resource(client, editor, type="video", title="No captions", url=WATCH_URL, transcript_mode="captions", rights_status="unknown")
    assert res["youtube"]["captions"]["best"] is None
    run = api_process(client, editor, res["id"])
    assert run["status"] == "failed" and "no captions" in (run["error"] or "").lower()
    reset_mutable_state()
