"""Offline Gemini behaviour for the Sermon Studio prompts (S-01..S-07) plus small API helpers for the sermon tests.

``install(fake_llm)`` registers a default handler per prompt with ``fake_llm.on(...)``; tests override single prompts the same
way or queue one-off responses with ``fake_llm.queue(...)``. The handlers read the rendered prompt (``call.section`` /
``call.line``) so their output reflects what the service actually sent.
"""
from __future__ import annotations

import re
from typing import Any

from .fakes import FakeCall, FakeGeminiClient

SERMON_PROMPTS = [f"S-{i:02d}" for i in range(1, 8)]
JOHN_3_16_WEB = "For God so loved the world, that he gave his only born Son, that whoever believes in him should not perish, but have eternal life."
JOHN_15_5_WEB = ("I am the vine. You are the branches. He who remains in me and I in him bears much fruit, for apart from me you can do nothing.")
ROMANS_8_28_WEB = "We know that all things work together for good for those who love God, for those who are called according to his purpose."


def _details(call: FakeCall) -> dict[str, str]:
    return dict(re.findall(r"(?m)^([A-Z_]+): (.*)$", call.section("SERMON_DETAILS")))


def _first_words(text: str, n: int = 12) -> str:
    body = re.sub(r"\[Source[^\]]*\]:?", " ", text)
    return " ".join(body.split()[:n])


def default_s01(call: FakeCall) -> dict[str, Any]:
    """A complete sermon that quotes the start of the sources and cites John 15 references (grounded afterwards)."""
    details = _details(call)
    focus = details.get("SCRIPTURE_FOCUS", "(not set)")
    return {
        "sermon_title": "Rooted in the Vine",
        "theme": "Fruitfulness flows from remaining in Christ.",
        "scripture": focus if focus != "(not set)" else "John 15:1-8",
        "introduction": f"Our notes begin: {_first_words(call.section('SOURCE_MATERIAL'))}.\n\nJesus speaks of the vine and the branches.",
        "main_points": [
            {"heading": "Remain in Christ", "body": "Jesus invites us to stay connected. Apart from him we can do nothing. Suggested illustration: a branch cut from a vine.", "scripture": "John 15:5"},
            {"heading": "Bear fruit that lasts", "body": "Love, joy and peace grow slowly. Fruit is the evidence of life.", "scripture": "Galatians 5:22-23"},
            {"heading": "Trust the Gardener", "body": "Pruning hurts, yet it is purposeful. God works all things for good.", "scripture": None},
        ],
        "applications": ["Spend ten minutes in John 15 each morning", "Name one fruit you are praying for", "Encourage someone who is being pruned",
                         "Join a small group this week", "Write down one way God has sustained you"],
        "conclusion": "Stay close to the Vine. Your fruit will follow.",
        "prayer": "Father, keep us rooted in your Son. Grow lasting fruit in us. Amen.",
    }


def default_s02(call: FakeCall) -> dict[str, Any]:
    """One main point per section of the outline in the prompt (heading = exact section name)."""
    sections = re.findall(r"(?m)^\d+\. (.+?) — ", call.text)
    points = [{"heading": name, "body": f"Content mapped into {name}. {_first_words(call.section('SOURCE_MATERIAL'), 6)}.",
               "scripture": "John 15:5" if i == 0 else None} for i, name in enumerate(sections)]
    return {"sermon_title": "Rooted in the Vine", "theme": "Fruitfulness flows from remaining in Christ.", "scripture": "John 15:1-2",
            "introduction": "We begin where Jesus began: with a vineyard.", "main_points": points,
            "applications": ["Abide daily", "Bear fruit"], "conclusion": "Remain in him.", "prayer": "Lord, prune and grow us. Amen."}


def default_s03(call: FakeCall) -> dict[str, Any]:
    return {
        "illustrations": [{"name": "The grafted branch", "description": "Describe a gardener grafting a branch onto a vine."},
                          {"name": "Seasons of pruning", "description": "Contrast winter pruning with summer harvest."},
                          {"name": "Roots in drought", "description": "Deep roots keep a tree alive in dry seasons."}],
        "applications": [{"point": "Remain in Christ", "suggestion": "Set a daily reminder to pray John 15:5."}],
        "scripture_connections": [{"reference": "Romans 8:28", "connection": "God's purpose in pruning."}, {"reference": "not a reference", "connection": "x"}],
        "opening_hooks": ["What keeps a branch alive?", "Have you ever felt cut off?"],
        "closing_calls": ["Remain in him this week.", "Ask God where he is pruning you."],
        "strengthening_tips": ["Shorten the introduction.", "Tell one story, not three.", "Repeat the big idea."],
    }


def default_s04(call: FakeCall) -> dict[str, Any]:
    headings = ["1. OPENING (30-60 seconds)", "2. KEY TRANSITIONS", "3. DELIVERY TIPS", "4. ILLUSTRATION CUES", "5. ALTAR CALL / CLOSING", "6. TIME CHECK"]
    return {"notes": "\n\n".join(f"{h}\nYou should keep this section focused on the sermon." for h in headings)}


def default_s05(call: FakeCall) -> dict[str, Any]:
    """A map for main point 1 plus a sermon-wide timeline (only when the sermon has main points)."""
    if not re.search(r"(?m)^1\. ", call.section("MAIN_POINTS")):
        return {"visuals": []}
    return {"visuals": [
        {"point": 1, "kind": "map", "heading": "The vineyards of Judea", "caption": "Where the imagery comes from",
         "places": [{"name": "Jerusalem", "note": "Temple vine carving"}], "route_stops": [], "events": [], "diagram": None},
        {"point": 0, "kind": "timeline", "heading": "The Upper Room", "caption": "The night Jesus spoke John 15", "places": [], "route_stops": [],
         "events": [{"label": "Last Supper", "date": "AD 30"}, {"label": "Walk to Gethsemane", "date": "AD 30"}], "diagram": None},
    ]}


def default_s06(call: FakeCall) -> dict[str, Any]:
    focus = call.section("FOCUS")
    subject = focus if focus and focus != "(none)" else "a vineyard at dawn"
    return {"prompt": f"\"A gardener tending {subject} with golden light over the hills\""}


def default_s07(call: FakeCall) -> dict[str, Any]:
    return {
        "summary": "A message about remaining in Christ and bearing lasting fruit.",
        "social_caption": "Stay rooted, bear fruit 🌿 Join us as we explore John 15.",
        "hashtags": ["#Faith", "Hope", "faith", "John 15"],
        "instagram_caption": "Stay rooted 🌿\nBear fruit 🍇",
        "facebook_post": "This Sunday we opened John 15.\n\nCome and see.",
        "twitter_thread": ["Remain in the Vine.", "Fruit takes time.", "Join us Sunday."],
    }


DEFAULTS = {"S-01": default_s01, "S-02": default_s02, "S-03": default_s03, "S-04": default_s04, "S-05": default_s05, "S-06": default_s06, "S-07": default_s07}


def install(fake: FakeGeminiClient) -> FakeGeminiClient:
    for prompt_id, handler in DEFAULTS.items():
        fake.on(prompt_id, handler)
    return fake


# ----------------------------------------------------------------------------- API helpers for the sermon tests
def create_sermon(client, headers: dict[str, str], title: str | None = None, **fields: Any) -> dict[str, Any]:
    resp = client.post("/v1/sermons", json={"title": title} if title is not None else None, headers=headers)
    assert resp.status_code == 201, resp.text
    sermon = resp.json()
    if fields:
        resp = client.patch(f"/v1/sermons/{sermon['id']}", json=fields, headers=headers)
        assert resp.status_code == 200, resp.text
        sermon = resp.json()
    return sermon


def add_text(client, headers: dict[str, str], sermon_id: str, text: str = "Jesus is the true vine and we are the branches.", kind: str = "text") -> dict[str, Any]:
    resp = client.post(f"/v1/sermons/{sermon_id}/inputs", json={"kind": kind, "text": text}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def polish(client, headers: dict[str, str], sermon_id: str, **body: Any) -> dict[str, Any]:
    resp = client.post(f"/v1/sermons/{sermon_id}/polish", json=body or None, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def polished_sermon(client, headers: dict[str, str], title: str | None = None, **fields: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    """A sermon with one text input and a polished draft (needs the sermon fakes installed). Returns (sermon, draft)."""
    sermon = create_sermon(client, headers, title, **fields)
    add_text(client, headers, sermon["id"])
    out = polish(client, headers, sermon["id"])
    return out["sermon"], out["draft"]


def files_under(prefix: str) -> list[str]:
    from interactive_bible import storage

    base = storage.root() / prefix
    return sorted(str(p.relative_to(storage.root())) for p in base.rglob("*") if p.is_file()) if base.exists() else []
