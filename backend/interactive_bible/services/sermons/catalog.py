"""Sermon Studio reference data: tones, languages, sermon formats (TEMPLATE_STRUCTURES), export themes and statuses.

Ported from sermon-builder ``lib/sermon/templates.ts`` (TONES, LANGUAGES), ``lib/sermon/templateStructures.ts`` and the
STYLE_HINTS of ``app/api/polish/route.ts``.
"""
from __future__ import annotations

from typing import Any

STATUSES = ("draft", "polished", "multimedia", "exported", "published")
EXPORT_THEMES = ("navy_gold", "light_classic", "royal_purple", "minimal_slate", "warm_sand")
DEFAULT_THEME = "navy_gold"
DEFAULT_TITLE = "Untitled Sermon"

TONES: list[dict[str, str]] = [
    {"id": "Inspirational", "label": "Inspirational", "hint": "Uplifting, hope-filled, encouraging"},
    {"id": "Teaching", "label": "Teaching", "hint": "Expository, clear, instructional"},
    {"id": "Evangelistic", "label": "Evangelistic", "hint": "Bold gospel invitation, urgency"},
    {"id": "Devotional", "label": "Devotional", "hint": "Intimate, reflective, personal"},
    {"id": "Youth", "label": "Youth", "hint": "Energetic, relatable, contemporary"},
    {"id": "Prophetic", "label": "Prophetic", "hint": "Weighty, exhortational, scripture-saturated"},
]
TONE_IDS = tuple(t["id"] for t in TONES)
DEFAULT_TONE = "Inspirational"

# code = the value stored on the sermon; complex_script => the print path renders these most faithfully; iso = transcription hint
LANGUAGES: list[dict[str, Any]] = [
    {"code": "English", "label": "English", "complex_script": False, "iso": "en"},
    {"code": "Spanish", "label": "Español", "complex_script": False, "iso": "es"},
    {"code": "French", "label": "Français", "complex_script": False, "iso": "fr"},
    {"code": "Portuguese", "label": "Português", "complex_script": False, "iso": "pt"},
    {"code": "German", "label": "Deutsch", "complex_script": False, "iso": "de"},
    {"code": "Swahili", "label": "Kiswahili", "complex_script": False, "iso": "sw"},
    {"code": "Hindi", "label": "हिन्दी", "complex_script": True, "iso": "hi"},
    {"code": "Tamil", "label": "தமிழ்", "complex_script": True, "iso": "ta"},
    {"code": "Telugu", "label": "తెలుగు", "complex_script": True, "iso": "te"},
    {"code": "Malayalam", "label": "മലയാളം", "complex_script": True, "iso": "ml"},
]
LANGUAGE_CODES = tuple(lang["code"] for lang in LANGUAGES)
DEFAULT_LANGUAGE = "English"

# Each sermon format has its OWN outline: the named sections (and their subtopics) the content is organised into, so choosing a
# format restructures the message instead of restyling it. Order = the order shown in the format picker.
TEMPLATE_STRUCTURES: dict[str, dict[str, Any]] = {
    "message": {
        "label": "Sunday Message",
        "summary": "A classic expository message with a hook, three developed points, and a call to action.",
        "sections": [
            {"name": "Opening Hook", "subtopics": ["Engaging story, question, or image", "Why this matters today"]},
            {"name": "Scripture in Context", "subtopics": ["Read the passage", "Historical / literary setting", "The big idea"]},
            {"name": "Point One", "subtopics": ["Truth from the text", "Illustration", "Application"]},
            {"name": "Point Two", "subtopics": ["Truth from the text", "Illustration", "Application"]},
            {"name": "Point Three", "subtopics": ["Truth from the text", "Illustration", "Application"]},
            {"name": "Call to Action", "subtopics": ["What to do this week", "A memorable closing line"]},
        ],
    },
    "prayer": {
        "label": "Prayer Focus",
        "summary": "A guided prayer message moving through adoration, confession, thanksgiving, and supplication.",
        "sections": [
            {"name": "Invocation", "subtopics": ["Inviting God’s presence", "Grounding scripture"]},
            {"name": "Adoration & Praise", "subtopics": ["Who God is", "Attributes worth praising"]},
            {"name": "Confession", "subtopics": ["Honest repentance", "Receiving grace"]},
            {"name": "Thanksgiving", "subtopics": ["Gratitude for specific gifts"]},
            {"name": "Supplication", "subtopics": ["Personal", "Family", "Church", "Nation & world"]},
            {"name": "Benediction", "subtopics": ["Sending blessing", "Closing scripture"]},
        ],
    },
    "story": {
        "label": "Story-Driven",
        "summary": "A narrative sermon built around a biblical character or scene, weaving ancient and modern.",
        "sections": [
            {"name": "Opening Scene", "subtopics": ["Set the scene vividly", "Emotional entry point"]},
            {"name": "The Character", "subtopics": ["Who they are", "Their struggle or longing"]},
            {"name": "Rising Action", "subtopics": ["The turning tension", "The encounter with God"]},
            {"name": "The Climax", "subtopics": ["The decisive moment", "What changes"]},
            {"name": "Resolution", "subtopics": ["How it ends", "The parallel to our lives"]},
            {"name": "Spiritual Takeaway", "subtopics": ["The one truth to carry home"]},
        ],
    },
    "devotional": {
        "label": "Devotional",
        "summary": "A short, intimate daily reflection on a single verse with one application and a prayer.",
        "sections": [
            {"name": "The Verse", "subtopics": ["A focal passage"]},
            {"name": "Reflection", "subtopics": ["What it means", "Why it matters to the heart"]},
            {"name": "Application", "subtopics": ["One concrete step or question"]},
            {"name": "Prayer", "subtopics": ["A short guided prayer"]},
        ],
    },
    "teaching": {
        "label": "Bible Teaching",
        "summary": "An in-depth expository study with context, verse-by-verse exposition, and discussion.",
        "sections": [
            {"name": "Learning Objectives", "subtopics": ["What the listener will understand"]},
            {"name": "Historical & Cultural Context", "subtopics": ["Author, audience, setting"]},
            {"name": "Verse-by-Verse Exposition", "subtopics": ["Walk the passage", "Key phrases explained"]},
            {"name": "Word Studies", "subtopics": ["Greek / Hebrew insight", "Original meaning"]},
            {"name": "Cross-References", "subtopics": ["Where Scripture interprets Scripture"]},
            {"name": "Application", "subtopics": ["Living the text"]},
            {"name": "Discussion Questions", "subtopics": ["For reflection or small groups"]},
        ],
    },
    "testimony": {
        "label": "Testimony",
        "summary": "A personal-witness arc: the before, the turning point, the after, anchored in scripture.",
        "sections": [
            {"name": "Before — The Struggle", "subtopics": ["Life before the change", "The need or pain"]},
            {"name": "The Turning Point", "subtopics": ["How God intervened", "The decisive encounter"]},
            {"name": "After — The Transformation", "subtopics": ["What changed", "The new reality"]},
            {"name": "Scripture Backing", "subtopics": ["Verses that frame the story"]},
            {"name": "Invitation", "subtopics": ["Encouraging others to trust God"]},
        ],
    },
    "youth": {
        "label": "Youth Message",
        "summary": "A high-energy, relatable message with punchy points and a real-world challenge.",
        "sections": [
            {"name": "High-Energy Opener", "subtopics": ["Culturally relevant hook", "A relatable question"]},
            {"name": "Big Idea", "subtopics": ["One clear truth in plain language"]},
            {"name": "Real-Life Points", "subtopics": ["2–3 short, punchy points", "Modern illustrations"]},
            {"name": "The Challenge", "subtopics": ["A dare for the week"]},
            {"name": "Closing", "subtopics": ["An inspiring, action-oriented send-off"]},
        ],
    },
    "small_group": {
        "label": "Small Group Guide",
        "summary": "A facilitator-ready discussion guide with an icebreaker, study, questions, and prayer.",
        "sections": [
            {"name": "Icebreaker", "subtopics": ["An opening question to warm up"]},
            {"name": "Read the Passage", "subtopics": ["The text to study together"]},
            {"name": "Teaching Context", "subtopics": ["Brief background for the leader"]},
            {"name": "Discussion Questions", "subtopics": ["Observation", "Interpretation", "Application"]},
            {"name": "Application Challenge", "subtopics": ["A practical step or homework"]},
            {"name": "Prayer Focus", "subtopics": ["Group prayer points"]},
        ],
    },
    "storytelling": {
        "label": "Storytelling",
        "summary": "A cinematic, spoken-aloud narrative with sensory language and a returning motif.",
        "sections": [
            {"name": "The Hook", "subtopics": ["A gripping first 90 seconds"]},
            {"name": "Interwoven Narrative", "subtopics": ["Biblical and modern stories in parallel"]},
            {"name": "Sensory Build", "subtopics": ["Vivid, descriptive imagery"]},
            {"name": "The Turn", "subtopics": ["Setup, conflict, climax"]},
            {"name": "Resolution & Motif", "subtopics": ["Return to the opening image", "The lasting truth"]},
        ],
    },
    "custom": {
        "label": "Custom Polish",
        "summary": "Keep the sermon’s own structure; strengthen clarity, transitions, and scripture.",
        "sections": [
            {"name": "Introduction", "subtopics": ["Sharpen the opening"]},
            {"name": "Main Points", "subtopics": ["Preserve and strengthen the existing points"]},
            {"name": "Application", "subtopics": ["Make it concrete"]},
            {"name": "Conclusion", "subtopics": ["A strong close"]},
        ],
    },
}
TEMPLATE_TYPES = tuple(TEMPLATE_STRUCTURES)

# the voice of the first polish, per format (polish/route.ts)
STYLE_HINTS: dict[str, str] = {
    "message": "a classic expository Sunday message with a hook, 3 main points, and a call to action",
    "prayer": "a prayer-focused message with invocation, scripture-based petitions, and a benediction",
    "story": "a story-driven narrative sermon built around a biblical character or scene",
    "devotional": "a concise, intimate daily devotional under 600 words",
    "teaching": "an in-depth Bible teaching with context, exposition, and discussion-ready points",
    "testimony": "a testimony-style message: the struggle, the turning point, the transformation",
    "youth": "a high-energy youth message with relatable, contemporary illustrations",
    "small_group": "a small-group discussion guide with reflective questions",
    "storytelling": "a vivid storytelling sermon written to be spoken aloud",
    "custom": "a well-structured sermon faithful to the source content",
}


def tone_hint(tone: str) -> str:
    return next((t["hint"] for t in TONES if t["id"] == tone), "")


def language_iso(language: str) -> str:
    return next((lang["iso"] for lang in LANGUAGES if lang["code"] == language), "auto")


def structure_outline(template_type: str) -> str:
    """A compact, prompt-ready outline of a format: ``1. Opening Hook — Engaging story, question, or image; Why this matters today``."""
    structure = TEMPLATE_STRUCTURES.get(template_type) or TEMPLATE_STRUCTURES["custom"]
    return "\n".join(f"{i}. {sec['name']} — {'; '.join(sec['subtopics'])}" for i, sec in enumerate(structure["sections"], start=1))


def meta() -> dict[str, Any]:
    """Reference lists for the Sermon Studio UI."""
    return {
        "tones": [dict(t) for t in TONES],
        "languages": [{"code": lang["code"], "label": lang["label"], "complex_script": lang["complex_script"]} for lang in LANGUAGES],
        "templates": [
            {"value": value, "label": s["label"], "summary": s["summary"], "sections": [{"name": sec["name"], "subtopics": list(sec["subtopics"])} for sec in s["sections"]]}
            for value, s in TEMPLATE_STRUCTURES.items()
        ],
        "export_themes": list(EXPORT_THEMES),
    }
