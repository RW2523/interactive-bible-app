"""Sermon Studio pure helpers (no database): the structured sermon model, the HTML sanitiser, the slide plan port and its
enrichment merge, share slugs and hashtags, transcript paragraphs, output schemas and the S-* prompt pack."""
from __future__ import annotations

import json
import re

import pytest

from interactive_bible.ai import schemas_sermons as S
from interactive_bible.ai.gemini import to_json_schema
from interactive_bible.ai.prompt_pack import load_prompts
from interactive_bible.ingest.units import Unit
from interactive_bible.services.sermons import catalog, slides
from interactive_bible.services.sermons.inputs import join_transcript
from interactive_bible.services.sermons.structured import (
    normalize_structured,
    safe_href,
    sanitize_html,
    structured_to_html,
    structured_to_plain_text,
)
from interactive_bible.services.sermons.writing import clean_hashtags, data, share_slug

pytestmark = pytest.mark.nodb

SHEPHERD = normalize_structured({
    "title": "The Good Shepherd",
    "theme": "Finding rest",
    "scripture": "Psalm 23 (KJV): The Lord is my shepherd; I shall not want.",
    "introduction": "We are restless people. We chase and we strive. Yet rest is offered.",
    "main_points": [
        {"heading": "The Shepherd Provides", "body": "He makes me lie down in green pastures. He leads me beside still waters. He restores my soul. This is His promise to every weary heart that comes."},
        {"heading": "The Shepherd Protects", "body": "Though I walk through the valley of the shadow of death, I will fear no evil. His rod and staff comfort me."},
    ],
    "applications": ["Rest in Him this week", "Trust His leading", "Release your striving"],
    "conclusion": "Come to the Shepherd and find rest for your soul.",
    "prayer": "Lord, be our shepherd. Amen.",
})


# ----------------------------------------------------------------------------- structured sermon model
def test_normalize_structured_passes_through_a_well_formed_sermon():
    s = normalize_structured({"title": "The Good Shepherd", "theme": "Rest", "scripture": "Psalm 23", "introduction": "Intro",
                              "main_points": [{"heading": "Point 1", "body": "Body 1", "scripture": "Ps 23:1"}], "applications": ["Trust Him"],
                              "conclusion": "Conclusion", "prayer": "Amen"})
    assert s == {"title": "The Good Shepherd", "theme": "Rest", "scripture": "Psalm 23", "introduction": "Intro",
                 "main_points": [{"heading": "Point 1", "body": "Body 1", "scripture": "Ps 23:1"}], "applications": ["Trust Him"],
                 "conclusion": "Conclusion", "prayer": "Amen"}


def test_normalize_structured_coerces_aliases_and_garbage():
    s = normalize_structured({"sermon_title": " X ", "verse": "John 3:16", "mainPoints": [{"title": "Heading via title", "content": "Body via content"}, 7, "plain body"],
                              "application": "1. Pray daily 2. Serve others\nGive", "intro": "  Hello  "})
    assert s["title"] == "X" and s["scripture"] == "John 3:16" and s["introduction"] == "Hello"
    assert s["main_points"] == [{"heading": "Heading via title", "body": "Body via content", "scripture": None}, {"heading": "", "body": "plain body", "scripture": None}]
    assert s["applications"] == ["Pray daily", "Serve others", "Give"]
    for garbage in (None, "a string", [1, 2], 42):
        assert normalize_structured(garbage, "Fallback") == {"title": "Fallback", "theme": "", "scripture": "", "introduction": "", "main_points": [],
                                                              "applications": [], "conclusion": "", "prayer": ""}
    kept = normalize_structured({"main_points": [{"heading": "", "body": ""}, {"heading": "Keep", "body": ""}]})
    assert kept["main_points"] == [{"heading": "Keep", "body": "", "scripture": None}] and kept["title"] == "Untitled Sermon"


def test_structured_to_html_escapes_and_structures():
    s = normalize_structured({"title": "T", "scripture": 'John 3:16 — "For God"', "introduction": "Para <one>\nline two\n\nPara two",
                              "main_points": [{"heading": "", "body": "B & C", "scripture": "Ps 1:1"}], "applications": ["<script>x</script>"],
                              "conclusion": "End", "prayer": "Amen's"})
    assert structured_to_html(s) == (
        "<blockquote>John 3:16 — &quot;For God&quot;</blockquote>\n<h2>Introduction</h2>\n<p>Para &lt;one&gt;<br/>line two</p>\n<p>Para two</p>\n"
        "<h2>1. Main Point</h2>\n<blockquote>Ps 1:1</blockquote>\n<p>B &amp; C</p>\n<h2>Application</h2>\n<ul><li>&lt;script&gt;x&lt;/script&gt;</li></ul>\n"
        "<h2>Conclusion</h2>\n<p>End</p>\n<h2>Closing Prayer</h2>\n<blockquote>Amen&#39;s</blockquote>")
    text = structured_to_plain_text(s)
    assert text.startswith('John 3:16 — "For God"\n\nPara <one>') and "B & C" in text and "<script>x</script>" in text and text.endswith("Amen's")


# ----------------------------------------------------------------------------- sanitiser
@pytest.mark.parametrize("dirty,clean", [
    ('<p onclick="x()">Hi <b style="color:red">there</b></p><script>alert(1)</script>', "<p>Hi <b>there</b></p>"),
    ('<a href="javascript:alert(1)">x</a>', '<a rel="noopener noreferrer">x</a>'),
    ('<a href="java&#x09;script:alert(1)">x</a>', '<a rel="noopener noreferrer">x</a>'),
    ('<a href=" JAVASCRIPT:alert(1)">x</a>', '<a rel="noopener noreferrer">x</a>'),
    ('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', '<a rel="noopener noreferrer">x</a>'),
    ('<a href="/relative">x</a>', '<a rel="noopener noreferrer">x</a>'),
    ('<a href="https://example.org/a?b=1" target="_blank" rel="opener">x</a>', '<a href="https://example.org/a?b=1" rel="noopener noreferrer">x</a>'),
    ('<a href="mailto:pastor@example.org">mail</a>', '<a href="mailto:pastor@example.org" rel="noopener noreferrer">mail</a>'),
    ('<img src=x onerror=alert(1)><svg onload=alert(1)><script>1</script></svg><iframe src=x></iframe>ok', "ok"),
    ("<!-- secret --><style>p{}</style><form><input value=1>text</form><p>kept</p>", "<p>kept</p>"),
    ("<div><h5>Head</h5><table><tr><td>cell</td><td>two</td></tr></table></div><div>inline <em>only</em></div>",
     "<h4>Head</h4><p>cell</p><p>two</p><p>inline <em>only</em></p>"),
    ("<h1>A</h1><h3>B</h3><ol><li><u>u</u> <s>s</s> <i>i</i> <strong>st</strong></li></ol><blockquote>q</blockquote><pre><code>x &lt; y</code></pre><hr><br>",
     "<h1>A</h1><h3>B</h3><ol><li><u>u</u> <s>s</s> <i>i</i> <strong>st</strong></li></ol><blockquote>q</blockquote><pre><code>x &lt; y</code></pre><hr/><br/>"),
    ("<span data-x=1>plain</span> &amp; <mark>marked</mark>", "plain &amp; marked"),
    ("", ""),
])
def test_sanitize_html_allow_list(dirty, clean):
    assert sanitize_html(dirty) == clean


def test_safe_href():
    assert safe_href("https://example.org") == "https://example.org"
    assert safe_href("  http://example.org/a b  ") == "http://example.org/a b"
    assert safe_href("ht\ntps://example.org") == "https://example.org"
    for bad in ("javascript:alert(1)", "vbscript:x", "java\x00script:x", "//evil.example", "#top", None, 3):
        assert safe_href(bad) is None


# ----------------------------------------------------------------------------- slide plan port (contentPlan.test.ts + fixes)
def test_content_plan_opens_with_a_cover_and_ends_with_a_prayer():
    plan = slides.build_content_plan(SHEPHERD, "navy_gold")
    assert plan["meta"] == {"title": "The Good Shepherd", "theme": "navy_gold", "generatedFor": "content"}
    assert plan["slides"][0]["layout"] == "cover" and plan["slides"][0]["visual"] == {
        "type": "scene", "spec": "Finding rest", "prompt": "A reverent, cinematic fine-art scene evoking Finding rest. No text, no letters, no words.", "highQuality": True}
    last = plan["slides"][-1]
    assert (last["layout"], last["role"], last["heading"], last["body"]) == ("closing", "prayer", "Let Us Pray", ["Lord, be our shepherd.", "Amen."])
    no_prayer = slides.build_content_plan({**SHEPHERD, "prayer": ""}, "navy_gold")["slides"][-1]
    assert (no_prayer["role"], no_prayer["kicker"], no_prayer["heading"], "body" in no_prayer) == ("closing", "Benediction", "Go in Peace", False)


def test_content_plan_carries_scripture_points_applications_and_conclusion():
    plan = slides.build_content_plan(SHEPHERD, "navy_gold", 16)
    scripture = next(s for s in plan["slides"] if s["role"] == "scripture")
    assert scripture["visual"] == {"type": "scriptureArt", "scripture": {"text": "The Lord is my shepherd; I shall not want.", "reference": "Psalm 23"}}
    assert scripture["heading"] == "Psalm 23" and plan["slides"][0]["reference"] == "Psalm 23"
    headings = [s["heading"] for s in plan["slides"]]
    assert "The Shepherd Provides" in headings and "The Shepherd Protects" in headings
    teaching = [s for s in plan["slides"] if s["role"] == "teaching"]
    assert "green pastures" in " ".join(" ".join(s["body"]) for s in teaching)
    intro = next(s for s in plan["slides"] if s.get("kicker") == "Introduction")
    assert (intro["layout"], intro["heading"], intro["imageSide"], intro["body"]) == ("figure", "Where We Begin", "right", ["We are restless people.", "We chase and we strive.", "Yet rest is offered."])
    application = next(s for s in plan["slides"] if s["role"] == "application")
    assert application["body"] == ["Rest in Him this week", "Trust His leading", "Release your striving"] and application["visual"] == {"type": "none"}
    conclusion = next(s for s in plan["slides"] if s.get("kicker") == "Conclusion")
    assert conclusion["heading"] == "Bringing It Home" and conclusion["visual"]["spec"] == "Finding rest, resolution"
    assert 6 < len(plan["slides"]) <= 60
    assert all("subheading" not in s for s in slides.build_content_plan({**SHEPHERD, "theme": ""}, "x")["slides"])  # unset fields are omitted


def test_content_plan_budget_follows_the_target_and_keeps_every_application():
    long_point = {**SHEPHERD, "main_points": [{"heading": "Long", "body": " ".join(f"Sentence number {i} carries a little more teaching content." for i in range(40)), "scripture": None}],
                  "applications": [f"Application {i}" for i in range(12)]}
    dense = slides.build_content_plan(long_point, "t", 10)   # target clamps to 10 -> 420 characters per slide
    sparse = slides.build_content_plan(long_point, "t", 99)  # target clamps to 40 -> 280 characters per slide
    count = lambda plan: sum(1 for s in plan["slides"] if s.get("kicker") == "Point 1" and s["role"] == "teaching")  # noqa: E731
    assert count(sparse) > count(dense) > 1
    continued = [s for s in dense["slides"] if s.get("kicker") == "Point 1" and s["role"] == "teaching"]
    assert continued[0]["heading"] == "Long" and continued[1]["heading"] == "Long (continued)" and continued[1]["imageSide"] == "left" and continued[1]["visual"] == {"type": "none"}
    apps = [s for s in dense["slides"] if s["role"] == "application"]
    assert [len(s["body"]) for s in apps] == [5, 5, 2] and apps[1]["heading"] == "Living It Out (more)"
    assert [a for s in apps for a in s["body"]] == [f"Application {i}" for i in range(12)]
    assert slides.build_content_plan(long_point, "t", None) == slides.build_content_plan(long_point, "t", 16)


@pytest.mark.parametrize("scripture,ref,text", [
    ("John 3:16 — For God so loved the world.", "John 3:16", "For God so loved the world."),
    ("Romans 8:28 (NIV): And we know", "Romans 8:28", "And we know"),
    ("Psalm 23 (KJV): The Lord is my shepherd", "Psalm 23", "The Lord is my shepherd"),
    ("1 Corinthians 13:4-7 — Love is patient", "1 Corinthians 13:4-7", "Love is patient"),
    ("The vine and the branches (John 15:5)", "John 15:5", "The vine and the branches (John 15:5)"),
    ('"Be still, and know that I am God"', None, "Be still, and know that I am God"),
    ("Jesus said: Come to me", None, "Jesus said: Come to me"),
    ("", None, ""),
])
def test_reference_and_verse_text_of_scripture_fields(scripture, ref, text):
    assert slides.ref_of(scripture) == ref
    assert slides.verse_text(scripture) == text


def test_sentence_split_and_character_chunks():
    assert slides.sentences('He said "Go." Then “Stay!” he replied.\n\n Next one?  yes. OK') == ['He said "Go."', "Then “Stay!” he replied.", "Next one? yes.", "OK"]
    assert slides.sentences(None) == [] and slides.sentences("   ") == []
    assert slides.chunk_by_chars(["aaaa", "bbbb", "cc", "dddddddd"], 10) == [["aaaa", "bbbb", "cc"], ["dddddddd"]]
    assert slides.chunk_by_chars(["x" * 30], 10) == [["x" * 30]] and slides.chunk_by_chars([], 10) == []


def test_enrichment_merge_positions_and_payload_validation():
    plan = slides.build_content_plan(SHEPHERD, "navy_gold")
    items = [
        {"point": 2, "kind": "diagram", "heading": "Rod and staff", "caption": "Two tools", "diagram": {"shape": "compare", "left_header": "Rod", "left_items": ["protects"], "right_items": ["guides"], "nodes": []}},
        {"point": 1, "kind": "map", "heading": "", "caption": None, "places": [{"name": "Bethlehem", "note": None}, {"name": " "}]},
        {"point": 0, "kind": "timeline", "heading": "David", "events": [{"label": "Shepherd boy"}, {"label": "King", "date": "1010 BC"}]},
        {"point": 1, "kind": "route", "heading": "Too short", "route_stops": [{"name": "Ur", "order": 1}]},
    ]
    merged = slides.merge_enrichments(plan, items)
    assert len(merged["slides"]) == len(plan["slides"]) + 3 and len(plan["slides"]) == len(slides.build_content_plan(SHEPHERD, "navy_gold")["slides"])  # input untouched
    roles = [(s["role"], s.get("kicker"), s["heading"]) for s in merged["slides"]]
    assert roles[2] == ("illustration", "Context", "David") and merged["slides"][2]["layout"] == "timelineSlide"
    divider_1 = roles.index(("section", "Point 1", "The Shepherd Provides"))
    divider_2 = roles.index(("section", "Point 2", "The Shepherd Protects"))
    assert roles[divider_1 + 1] == ("illustration", "Point 1", "A Closer Look") and merged["slides"][divider_1 + 1]["visual"] == {"type": "map", "places": [{"name": "Bethlehem"}]}
    assert roles[divider_2 + 1] == ("illustration", "Point 2", "Rod and staff") and merged["slides"][divider_2 + 1]["layout"] == "threeCol"
    assert merged["slides"][divider_2 + 1]["visual"] == {"type": "diagram", "spec": "Two tools", "diagram": {"shape": "compare", "nodes": [], "leftHeader": "Rod", "leftItems": ["protects"], "rightItems": ["guides"]}}
    assert slides.merge_enrichments(plan, []) is plan
    assert slides.visual_from_enrichment({"kind": "diagram", "diagram": {"shape": "star", "nodes": [{"label": "a"}, {"label": "b"}]}})["diagram"]["shape"] == "list"
    assert slides.visual_from_enrichment({"kind": "diagram", "diagram": {"shape": "flow", "nodes": [{"label": "only one"}]}}) is None
    assert slides.visual_from_enrichment({"kind": "timeline", "events": [{"label": str(i)} for i in range(9)]})["events"] == [{"label": str(i)} for i in range(5)]
    assert slides.visual_from_enrichment({"kind": "chart"}) is None
    over_limit = slides.merge_enrichments(plan, [items[2]] * 5)
    assert len(over_limit["slides"]) == len(plan["slides"]) + 3  # at most 3 enrichment slides


def test_scene_key():
    assert slides.scene_key({"heading": "Heading", "visual": {"type": "scene", "spec": "  The Vine "}}) == "the vine"
    assert slides.scene_key({"heading": "Heading", "visual": {"type": "scene"}}) == "heading"


# ----------------------------------------------------------------------------- outreach helpers, prompt data, transcripts
def test_share_slug_and_hashtags():
    assert re.fullmatch(r"the-good-shepherd-rest-renewal-[a-z0-9]{10}", share_slug("The Good Shepherd: Rest & Renewal!"))
    assert re.fullmatch(r"sermon-[a-z0-9]{10}", share_slug("தமிழ் பிரசங்கம்"))
    long = share_slug("A" * 30 + " " + "B" * 30)
    assert re.fullmatch(r"a{30}-b{9}-[a-z0-9]{10}", long) and len(long) <= 80
    assert "--" not in share_slug("word " * 20) and "--" not in share_slug("a-" * 30)
    assert share_slug("Same") != share_slug("Same")
    assert clean_hashtags(["#Faith", "Hope", "faith", "John 15", "", "#", "Grâce"]) == ["Faith", "Hope", "John15", "Grâce"]
    assert len(clean_hashtags([f"tag{i}" for i in range(20)])) == 10


def test_untrusted_prompt_data_cannot_close_its_block():
    assert data("a >>> b <<< c") == "a ››› b ‹‹‹ c" and data(None) == ""


def test_transcript_paragraphs():
    units = [Unit(id="", kind="sentence", text_raw=t, start_ms=s, end_ms=e, speaker=sp) for t, s, e, sp in [
        ("One.", 0, 1000, "S1"), ("Two.", 1100, 2000, "S1"), ("[music]", 2000, 9000, "S1"), ("After a pause.", 9000, 10000, "S1"),
        ("Another voice.", 10100, 11000, "S2"), ("", 11000, 11500, "S2"),
    ]]
    assert join_transcript(units) == "One. Two.\n\nAfter a pause.\n\nAnother voice."
    many = [Unit(id="", kind="sentence", text_raw=f"Sentence {i}.", start_ms=i * 1000, end_ms=i * 1000 + 900) for i in range(8)]
    assert join_transcript(many).count("\n\n") == 1 and join_transcript([]) == ""


# ----------------------------------------------------------------------------- output schemas + prompt pack
def test_output_schemas_are_lenient_and_their_json_schema_is_consistent():
    sermon = S.StructuredSermonOut.model_validate({"title": "T", "points": [{"title": "H", "content": "B", "verse": "null"}, "body only"], "application": "1. a 2. b", "prayer": None})
    assert sermon.structured()["title"] == "T" and sermon.main_points[0].scripture is None and sermon.applications == ["a", "b"] and sermon.prayer == ""
    enrichment = S.SlideEnrichmentOut.model_validate({"visuals": [{"point": "2", "kind": "route", "heading": "x", "routeStops": [{"name": "Ur", "order": "1"}]},
                                                                  {"kind": "chart"}, {"kind": "diagram", "diagram": {"shape": "hub-spoke", "nodes": ["a", "b"]}}]})
    assert [v.kind for v in enrichment.visuals] == ["route", "diagram"] and enrichment.visuals[0].route_stops[0].order == 1
    assert enrichment.visuals[1].diagram.shape == "hubSpoke" and [n.label for n in enrichment.visuals[1].diagram.nodes] == ["a", "b"]
    outreach = S.OutreachOut.model_validate({"summary": " s ", "social_caption": "c", "hashtags": "#a #b, c", "twitter_thread": "one"})
    assert (outreach.summary, outreach.hashtags, outreach.twitter_thread) == ("s", ["#a", "#b", "c"], ["one"])
    with pytest.raises(ValueError):
        S.OutreachOut.model_validate({"social_caption": "missing summary"})
    assert S.ImagePromptOut.model_validate({"prompt": ' "A vineyard" '}).prompt == "A vineyard"
    assert S.SpeakerNotesOut.model_validate({"notes": ["1. OPENING", "2. KEY TRANSITIONS"]}).notes == "1. OPENING\n\n2. KEY TRANSITIONS"
    suggestions = S.SuggestionsOut.model_validate({"illustrations": [{"title": "A", "description": "d"}], "opening_hooks": "1. Why? 2. How?"})
    assert suggestions.illustrations[0].name == "A" and suggestions.opening_hooks == ["Why?", "How?"]

    def check(node):
        if isinstance(node, dict):
            if isinstance(node.get("required"), list) and "properties" in node:
                assert set(node["required"]) <= set(node["properties"]), node
            for value in node.values():
                check(value)
        elif isinstance(node, list):
            for value in node:
                check(value)

    for model in (S.StructuredSermonOut, S.SuggestionsOut, S.SpeakerNotesOut, S.SlideEnrichmentOut, S.ImagePromptOut, S.OutreachOut):
        schema = to_json_schema(model)
        check(schema)  # every required property survives the schema conversion (no property may be named "title")
        assert '"title"' not in json.dumps(schema)


def test_sermon_prompts_are_in_the_pack_with_the_sermon_system_rules():
    prompts = {pid: p for pid, p in load_prompts().items() if pid.startswith("S-")}
    assert sorted(prompts) == [f"S-{i:02d}" for i in range(1, 8)]
    for prompt in prompts.values():
        assert prompt.system.startswith("SYSTEM RULES") and "sermon-preparation assistant" in prompt.system
        assert "OUTPUT SCHEMA" in prompt.body and "<<<" in prompt.body and prompt.role in ("analysis", "fast")
    assert {"verse_texts", "sources", "details", "style_hint"} <= prompts["S-01"].placeholders
    assert {"outline", "current_sermon", "sources"} <= prompts["S-02"].placeholders


def test_catalog_is_consistent():
    assert set(catalog.STYLE_HINTS) == set(catalog.TEMPLATE_STRUCTURES) == set(catalog.TEMPLATE_TYPES)
    assert catalog.structure_outline("devotional") == ("1. The Verse — A focal passage\n2. Reflection — What it means; Why it matters to the heart\n"
                                                       "3. Application — One concrete step or question\n4. Prayer — A short guided prayer")
    assert catalog.structure_outline("unknown").startswith("1. Introduction — ") and catalog.language_iso("Tamil") == "ta" and catalog.language_iso("x") == "auto"
