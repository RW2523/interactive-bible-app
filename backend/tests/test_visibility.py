"""AC-08: private and organization resources are never visible to anonymous users or outsiders on any surface;
owners and organization members see them; unlisted resources open by direct link but are not discoverable."""
from __future__ import annotations

import pytest

from interactive_bible.security import media_token

from .support import (
    ADMIN,
    EDITOR,
    MEMBER,
    OUTSIDER,
    auth_headers,
    create_resource,
    process_now,
    reset_mutable_state,
    sql_one,
    upload,
    vtt,
)

pytestmark = pytest.mark.shared_data

ANON = "anonymous"
TEXTS = {
    "public": ("Public sermon notes", "Romans 8:28 reminds the whole church that God is at work for good."),
    "private": ("Private pastoral note", "Romans 8:28 and Romans 12:2 carried me through a hard year of hope and grief."),
    "organization": ("Grace staff devotional", "For our staff retreat: Romans 8:28 anchors our hope."),
    "unlisted": ("Unlisted small group handout", "Unlisted handout for the group studying Romans 8:28."),
    "deleted": ("Deleted old draft", "An old draft about Romans 8:28."),
}


def headers(who: str) -> dict[str, str]:
    return {} if who == ANON else auth_headers(who)


@pytest.fixture(scope="module")
def world(_app_client, silent_mp3):
    reset_mutable_state()
    client = _app_client
    out: dict[str, dict] = {}
    owners = {"public": EDITOR, "private": MEMBER, "organization": EDITOR, "unlisted": MEMBER, "deleted": EDITOR}
    for key, (title, text) in TEXTS.items():
        extra = {"organization_id": "org_grace"} if key == "organization" else {}
        visibility = "public" if key == "deleted" else key
        res = create_resource(client, auth_headers(owners[key]), type="native", title=title, body_text=text, visibility=visibility, **extra)
        assert process_now(res["id"])["status"] == "succeeded"
        out[key] = {"id": res["id"], "title": title}
    assert client.delete(f"/v1/resources/{out['deleted']['id']}", headers=auth_headers(EDITOR)).status_code == 200

    media = create_resource(client, auth_headers(MEMBER), type="audio", title="Private voice memo", visibility="private", transcript_mode="captions")
    assert upload(client, auth_headers(MEMBER), media["id"], silent_mp3, "memo.mp3").status_code == 200
    assert upload(client, auth_headers(MEMBER), media["id"], vtt([(1.0, 6.0, "My private prayer about Romans 8:28 tonight."), (6.5, 15.0, "Amen and amen.")]),
                  "memo.vtt", kind="captions").status_code == 200
    assert process_now(media["id"])["status"] == "succeeded"
    out["private_media"] = {"id": media["id"], "title": "Private voice memo"}
    for item in out.values():
        seg = sql_one("SELECT id FROM resource_segments WHERE resource_id = :r ORDER BY ordinal LIMIT 1", r=item["id"])
        item["segment_id"] = seg["id"]
    yield out
    reset_mutable_state()


# who -> which resources they may discover (verse intelligence, search, map, indicators, lists)
DISCOVERABLE = {
    ANON: {"public"},
    OUTSIDER: {"public"},
    MEMBER: {"public", "private", "organization", "unlisted", "private_media"},  # owner of private/unlisted/media, org member
    EDITOR: {"public", "private", "organization", "unlisted", "private_media"},
}
# direct links (detail, segments, clip) additionally open unlisted resources
DIRECT = {who: keys | {"unlisted"} for who, keys in DISCOVERABLE.items()}
ALL_KEYS = ("public", "private", "organization", "unlisted", "private_media", "deleted")


def titles(world, keys) -> set[str]:
    return {world[k]["title"] for k in keys}


@pytest.mark.parametrize("who", [ANON, OUTSIDER, MEMBER, EDITOR])
def test_ac08_verse_intelligence_only_shows_permitted_resources(world, client, who):
    """AC-08 Verse Intelligence never includes private/organization/unlisted resources the viewer may not discover."""
    body = client.get("/v1/verses/ROM.8.28/intelligence", headers=headers(who)).json()
    shown = {c["resource"]["title"] for c in body["top_resources"]}
    assert shown == titles(world, DISCOVERABLE[who])
    sections = {c["resource"]["title"] for group in body["sections"].values() for c in group}
    assert sections == shown
    assert body["counts"]["study"] + body["counts"]["audio"] == len(DISCOVERABLE[who])
    listed = client.get("/v1/verses/ROM.8.28/resources", headers=headers(who)).json()
    assert {c["resource"]["title"] for c in listed["items"]} == shown


@pytest.mark.parametrize("who", [ANON, OUTSIDER, MEMBER])
def test_ac08_chapter_indicators_count_only_permitted_resources(world, client, who):
    """AC-08 Chapter reading indicators do not reveal hidden mappings."""
    verses = client.get("/v1/bible/chapters/ROM/8", headers=headers(who)).json()["verses"]
    ind = next(v for v in verses if v["number"] == 28)["indicators"]
    allowed = DISCOVERABLE[who]
    assert ind["total"] == len(allowed)
    assert ind["listen"] == (1 if "private_media" in allowed else 0)
    assert ind["study"] == len(allowed - {"private_media"})
    rom12 = next(v for v in client.get("/v1/bible/chapters/ROM/12", headers=headers(who)).json()["verses"] if v["number"] == 2)
    assert (rom12["indicators"] is not None) == ("private" in allowed)


@pytest.mark.parametrize("who", [ANON, OUTSIDER, MEMBER])
def test_ac08_search_never_returns_hidden_segments(world, client, who):
    """AC-08 Search results exclude resources the viewer may not discover."""
    body = client.post("/v1/search/scripture", json={"query": "Romans 8:28"}, headers=headers(who)).json()
    assert {s["resource"]["title"] for s in body["segments"]} == titles(world, DISCOVERABLE[who])
    by_keyword = client.post("/v1/search/scripture", json={"query": "retreat handout voice memo grief", "scope": "resources"}, headers=headers(who)).json()
    assert {s["resource"]["title"] for s in by_keyword["segments"]} <= titles(world, DISCOVERABLE[who])


@pytest.mark.parametrize("who", [ANON, OUTSIDER, MEMBER])
def test_ac08_scripture_map_hides_private_resources(world, client, who):
    """AC-08 The Scripture Map neighbourhood of a verse contains only permitted resource nodes."""
    graph = client.get("/v1/scripture-map", params={"root_type": "verse", "root_id": "ROM.8.28"}, headers=headers(who)).json()
    resources = {n["label"] for n in graph["nodes"] if n["type"] == "resource"}
    assert resources == titles(world, DISCOVERABLE[who])
    listed = {i["node"]["label"] for group in graph["list"] if group["type"] == "resource" for i in group["items"]}
    assert listed <= resources
    for key in ("private", "organization"):
        resp = client.get("/v1/scripture-map", params={"root_type": "resource", "root_id": world[key]["id"]}, headers=headers(who))
        assert resp.status_code == (200 if key in DIRECT[who] else 404)


@pytest.mark.parametrize("who", [ANON, OUTSIDER, MEMBER, ADMIN])
@pytest.mark.parametrize("key", ALL_KEYS)
def test_ac08_direct_links_404_unless_permitted(world, client, who, key):
    """AC-08 Resource detail, segments, verse links, status and clips return 404 for resources the viewer may not open (unlisted opens by link)."""
    rid, seg = world[key]["id"], world[key]["segment_id"]
    expected = 200 if key in (DIRECT[EDITOR] if who == ADMIN else DIRECT[who]) else 404
    for url in (f"/v1/resources/{rid}", f"/v1/resources/{rid}/segments", f"/v1/resources/{rid}/verse-links", f"/v1/resources/{rid}/status", f"/v1/clips/{seg}"):
        assert client.get(url, headers=headers(who)).status_code == expected, (url, who, key)


def test_ac08_private_media_needs_a_valid_token(world, client):
    """AC-08 Media of a private resource is 404 without a valid token (or view rights)."""
    rid = world["private_media"]["id"]
    assert client.get(f"/v1/media/{rid}").status_code == 404
    assert client.get(f"/v1/media/{rid}", headers=auth_headers(OUTSIDER)).status_code == 404
    assert client.get(f"/v1/media/{rid}?token=forged.token").status_code == 404
    assert client.get(f"/v1/media/{rid}?token={media_token(world['public']['id'])}").status_code == 404
    assert client.get(f"/v1/resources/{rid}/captions.vtt").status_code == 404
    assert client.get(f"/v1/media/{rid}", headers=auth_headers(MEMBER)).status_code == 200
    detail = client.get(f"/v1/resources/{rid}", headers=auth_headers(MEMBER)).json()
    assert client.get(detail["playback"]["url"]).status_code == 200  # the owner's signed URL works in a plain <audio> element
    assert client.get(detail["playback"]["captions_url"]).status_code == 200


@pytest.mark.parametrize("who", [ANON, OUTSIDER, MEMBER])
def test_ac08_resource_lists(world, client, who):
    """AC-08 Resource lists only include discoverable resources; ?mine=true lists the viewer's own private/unlisted resources."""
    listed = client.get("/v1/resources", headers=headers(who)).json()
    assert {i["title"] for i in listed["items"]} == titles(world, DISCOVERABLE[who])
    if who != ANON:
        mine = client.get("/v1/resources?mine=true", headers=headers(who)).json()
        expected = {"private", "unlisted", "private_media"} if who == MEMBER else set()
        assert {i["title"] for i in mine["items"]} == titles(world, expected)


@pytest.mark.parametrize("who", [ANON, OUTSIDER, MEMBER])
def test_ac08_related_verses_do_not_leak_private_co_discussion(world, client, who):
    """AC-08 'Discussed together' related verses derived from a private resource are only shown to viewers who may see it."""
    related = client.get("/v1/verses/ROM.8.28/related?limit=60", headers=headers(who)).json()
    co = [r for r in related if "co_discussed" in r["sources"] and r["ref"] == "ROM.12.2"]
    assert bool(co) == ("private" in DISCOVERABLE[who])
    for item in co:
        assert "Private pastoral note" in item["why"]


@pytest.mark.parametrize("who", [ANON, MEMBER])
def test_ac08_topic_map_hides_private_segments(world, client, who):
    """AC-08 Topic-rooted Scripture Maps hide segments of private resources."""
    graph = client.get("/v1/scripture-map", params={"root_type": "topic", "root_id": "hope"}, headers=headers(who)).json()
    shown = {n["label"] for n in graph["nodes"] if n["type"] == "resource"}
    assert ("Private pastoral note" in shown) == (who == MEMBER)
    assert shown <= titles(world, DISCOVERABLE[who])


def test_ac08_deleted_resources_are_hidden_even_from_staff(world, client):
    """AC-08 Deleted resources are hidden everywhere, including from staff."""
    body = client.get("/v1/verses/ROM.8.28/intelligence", headers=auth_headers(ADMIN)).json()
    assert world["deleted"]["title"] not in {c["resource"]["title"] for c in body["top_resources"]}
    assert client.get(f"/v1/resources/{world['deleted']['id']}", headers=auth_headers(ADMIN)).status_code == 404


def test_ac08_intelligence_cache_is_scoped_per_viewer(world, client):
    """AC-08 Cached Verse Intelligence is scoped per viewer, so a member's view never leaks into the anonymous cache."""
    anon_first = client.get("/v1/verses/ROM.8.28/intelligence").json()
    member = client.get("/v1/verses/ROM.8.28/intelligence", headers=auth_headers(MEMBER)).json()
    anon_again = client.get("/v1/verses/ROM.8.28/intelligence").json()
    assert anon_again["provenance"]["cache"] == "hit"
    assert len(member["top_resources"]) > len(anon_again["top_resources"]) == len(anon_first["top_resources"])
