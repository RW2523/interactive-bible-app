"""Explore data (no AI): atlas events, the timeline bundle, the verse -> event reference index and the by-verse lookup
behind "See this on the map / timeline" from the reader."""
from __future__ import annotations

import json
import shutil

import pytest

from interactive_bible.bible import books as B
from interactive_bible.config import get_settings
from interactive_bible.services.explore import data


def canonical(ranges) -> list[str]:
    return [B.canonical_range_str(start, end) for start, end in ranges]


# ----------------------------------------------------------------------------- events + timeline
def test_events_list_detail_and_unknown_event(client):
    resp = client.get("/v1/explore/events")
    assert resp.status_code == 200 and resp.headers["content-type"].startswith("application/json")
    items = resp.json()["items"]
    assert len(items) == 50 and items[0]["id"] == "creation"
    red_sea = next(e for e in items if e["id"] == "red_sea_crossing")
    assert (red_sea["title"], red_sea["references"], red_sea["era"], red_sea["coords"]) == ("Crossing the Red Sea", ["Exodus 14"], "Exodus", {"x": 36, "y": 72})
    assert client.get("/v1/explore/events/red_sea_crossing").json() == red_sea
    missing = client.get("/v1/explore/events/no_such_event")
    assert missing.status_code == 404 and missing.json() == {"detail": "Bible event not found"}


def test_timeline_bundle_is_served_as_stored(client):
    body = client.get("/v1/explore/timeline").json()
    stored = json.loads((get_settings().explore_data_dir / data.TIMELINE_FILE).read_text(encoding="utf-8"))
    assert body == stored
    assert len(body["events"]) == 583 and body["eraGroups"][0] == {"name": "Primeval and Early Patriarchal History", "eventCount": 13}


@pytest.mark.parametrize("url", ["/v1/explore/events", "/v1/explore/timeline"])
def test_data_payloads_revalidate_with_etags(client, url):
    first = client.get(url)
    etag = first.headers["etag"]
    assert first.status_code == 200 and first.headers["cache-control"] == "no-cache"
    again = client.get(url, headers={"if-none-match": etag})
    assert again.status_code == 304 and again.content == b"" and again.headers["etag"] == etag
    assert client.get(url, headers={"if-none-match": 'W/"stale"'}).status_code == 200


def test_data_files_are_reloaded_when_they_change(client, tmp_path, monkeypatch):
    source = get_settings().explore_data_dir
    for name in (data.EVENTS_FILE, data.TIMELINE_FILE):
        shutil.copy(source / name, tmp_path / name)
    monkeypatch.setattr(get_settings(), "explore_data_dir", tmp_path)
    before = client.get("/v1/explore/events")
    assert client.get("/v1/explore/events/red_sea_crossing").json()["title"] == "Crossing the Red Sea"

    events = json.loads((tmp_path / data.EVENTS_FILE).read_text(encoding="utf-8"))
    next(e for e in events if e["id"] == "red_sea_crossing")["title"] = "The Sea Is Parted"
    events.append({**events[0], "id": "added_event", "order": 51, "references": ["Acts 9:1-19"]})
    (tmp_path / data.EVENTS_FILE).write_text(json.dumps(events), encoding="utf-8")

    assert client.get("/v1/explore/events/red_sea_crossing").json()["title"] == "The Sea Is Parted"
    after = client.get("/v1/explore/events", headers={"if-none-match": before.headers["etag"]})
    assert after.status_code == 200 and len(after.json()["items"]) == 51
    assert [e["id"] for e in client.get("/v1/explore/by-verse/ACT.9.3").json()["events"]] == ["added_event"]  # the index is rebuilt too

    (tmp_path / data.TIMELINE_FILE).unlink()
    missing = client.get("/v1/explore/timeline")
    assert missing.status_code == 404 and "not installed" in missing.json()["detail"]


# ----------------------------------------------------------------------------- by-verse lookup
def test_by_verse_finds_the_red_sea_crossing(client):
    body = client.get("/v1/explore/by-verse/EXO.14.21").json()
    assert (body["ref"], body["display"]) == ("EXO.14.21", "Exodus 14:21")
    assert body["events"] == [{"id": "red_sea_crossing", "title": "Crossing the Red Sea", "references": ["Exodus 14"], "era": "Exodus"}]
    assert body["timeline"] == [{"id": "evt_0084_the_exodus_begins", "title": "The Exodus Begins", "dateLabel": "1446 BC", "referenceText": "Exodus 13 - 18"}]


@pytest.mark.parametrize("ref", ["LUK.2.7", "Luke 2:7", "luke_2:7"])
def test_by_verse_finds_the_birth_of_jesus_from_canonical_or_display_references(client, ref):
    body = client.get(f"/v1/explore/by-verse/{ref}").json()
    assert body["ref"] == "LUK.2.7"
    assert [e["id"] for e in body["events"]] == ["birth_of_jesus"]  # "Matthew 1-2", "Luke 1-2"
    # "Luke 2:6" marks where the timeline's Birth of Jesus starts (tighter than the chapter-wide "Luke 2" event)
    assert [e["id"] for e in body["timeline"]] == ["evt_0476_birth_of_jesus", "evt_0475_augustus_taxes_the_roman_empire"]


def test_chapter_only_references_cover_whole_chapters(client):
    last_verse = B.verse_count("1SA", 17)
    body = client.get(f"/v1/explore/by-verse/1SA.17.{last_verse}").json()
    assert [e["id"] for e in body["events"]] == ["david_and_goliath"]  # "1 Samuel 17"
    assert [e["id"] for e in body["timeline"]] == ["evt_0174_david_kills_goliath"]
    # chapter ranges ("Genesis 1-2") cover every chapter in the range
    assert [e["id"] for e in client.get("/v1/explore/by-verse/GEN.2.25").json()["events"]] == ["creation"]


def test_passages_match_every_overlapping_event_tightest_first(client):
    body = client.get("/v1/explore/by-verse/Genesis 1-3").json()
    assert (body["ref"], body["display"]) == ("GEN.1.1-GEN.3.24", "Genesis 1-3")
    assert [e["id"] for e in body["events"]] == ["fall_of_man", "creation"]  # Genesis 3 (24 verses) before Genesis 1-2 (56)
    assert [e["id"] for e in body["timeline"]] == ["evt_0004_the_fall_of_man", "evt_0003_the_garden_of_eden", "evt_0002_the_creation"]
    assert len(client.get("/v1/explore/by-verse/Genesis 1-3?limit=1").json()["timeline"]) == 1


def test_by_verse_edge_cases(client):
    assert client.get("/v1/explore/by-verse/ROM.8.28").json()["events"] == []  # no atlas event covers Romans
    assert [e["id"] for e in client.get("/v1/explore/by-verse/OBA.1.5").json()["timeline"]] == ["evt_0308_the_vision_of_obadiah"]  # "Obadiah 1"
    unknown = client.get("/v1/explore/by-verse/not a verse")
    assert unknown.status_code == 404 and "could not understand" in unknown.json()["detail"]
    assert client.get("/v1/explore/by-verse/ROM.8.28?limit=0").status_code == 422


# ----------------------------------------------------------------------------- reference parsing
@pytest.mark.nodb
@pytest.mark.parametrize("text,expected", [
    ("Genesis 1-2", ["GEN.1.1-GEN.2.25"]),
    ("Exodus 14", ["EXO.14.1-EXO.14.31"]),
    ("Luke 2:1-20", ["LUK.2.1-LUK.2.20"]),
    ("1 Samuel 17", ["1SA.17.1-1SA.17.58"]),
    ("Acts 9:1-19", ["ACT.9.1-ACT.9.19"]),
    ("Leviticus 8, 9", ["LEV.8.1-LEV.8.36", "LEV.9.1-LEV.9.24"]),
    ("Psalm 50, 73, 75 - 78, 89", ["PSA.50.1-PSA.50.23", "PSA.73.1-PSA.73.28", "PSA.75.1-PSA.78.72", "PSA.89.1-PSA.89.52"]),
    ("Deuteronomy 4:44 - 31", ["DEU.4.44-DEU.31.30"]),
    ("Songs 1 - 8", ["SNG.1.1-SNG.8.14"]),
    ("Psalms 2 - 145 (Assorted)", ["PSA.2.1-PSA.145.21"]),
    ("Obadiah 1", ["OBA.1.1-OBA.1.21"]),
    ("Jude 3", ["JUD.1.3"]),
    ("1 Thess. 1 - 5", ["1TH.1.1-1TH.5.28"]),
    ("Genesis 12:10", ["GEN.12.10"]),
    ("2 Samuel 5, 1 Chronicles 11", ["2SA.5.1-2SA.5.25", "1CH.11.1-1CH.11.47"]),
    ("not a reference", []),
])
def test_data_reference_strings_parse_to_verse_ranges(text, expected):
    assert canonical((r.start, r.end) for r in data.parse_reference(text)) == expected


@pytest.mark.nodb
def test_every_reference_in_the_data_files_is_understood():
    for dataset in (data.atlas(), data.timeline()):
        for item in dataset.items:
            assert dataset.ranges[item["id"]], item["id"]
            for text in item["references"]:
                assert data.parse_reference(text), (item["id"], text)


@pytest.mark.nodb
def test_timeline_verse_references_mark_where_a_passage_starts():
    ranges = data.timeline().ranges
    assert canonical(ranges["evt_0032_birth_of_jacob_and_esau"]) == ["GEN.25.1-GEN.25.34"]  # chapter references are untouched
    assert canonical(ranges["evt_0033_death_of_abraham"]) == ["GEN.25.5-GEN.25.28"]  # up to the next start in the chapter (25:29)
    assert canonical(ranges["evt_0034_esau_sells_his_birthright"]) == ["GEN.25.29-GEN.25.34"]  # to the end of the chapter
    assert canonical(ranges["evt_0476_birth_of_jesus"]) == ["MAT.1.1-MAT.1.25", "MRK.1.1-MRK.1.45", "LUK.2.6-LUK.2.40", "JHN.1.14"]


@pytest.mark.nodb
def test_verse_references_are_literal_in_the_atlas_index():
    items = [{"id": "a", "references": ["John 3:16"]}, {"id": "b", "references": ["John 3:18", "Romans 8"]}]
    assert {k: canonical(v) for k, v in data.reference_index(items, verse_refs_start_passages=False).items()} == \
        {"a": ["JHN.3.16"], "b": ["JHN.3.18", "ROM.8.1-ROM.8.39"]}
    assert {k: canonical(v) for k, v in data.reference_index(items, verse_refs_start_passages=True).items()} == \
        {"a": ["JHN.3.16-JHN.3.17"], "b": ["JHN.3.18-JHN.3.36", "ROM.8.1-ROM.8.39"]}


@pytest.mark.nodb
def test_verse_span_counts_across_chapters_and_books():
    assert data.verse_span(B.ordinal("GEN", 1, 1), B.ordinal("GEN", 1, 1)) == 1
    assert data.verse_span(B.ordinal("GEN", 1, 31), B.ordinal("GEN", 2, 2)) == 3
    assert data.verse_span(B.ordinal("GEN", 50, 26), B.ordinal("EXO", 1, 1)) == 2
