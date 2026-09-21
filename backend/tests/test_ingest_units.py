"""Pure ingestion units: PII redaction, caption parsing, segmentation rules, transcription repair."""
from __future__ import annotations

import pytest

from interactive_bible.ingest import captions as cap
from interactive_bible.ingest.segment import (
    SPOKEN_MAX_MS,
    SPOKEN_MIN_MS,
    SegmentPlan,
    rule_segments_document,
    rule_segments_spoken,
    validate_plan,
)
from interactive_bible.ingest.transcribe import _repair
from interactive_bible.ingest.units import Unit, finalize_units, normalize_text, redact_pii, split_sentences_with_times

pytestmark = pytest.mark.nodb


# ----------------------------------------------------------------------------- PII redaction (spec §13)
def test_pii_email_and_phone_redacted():
    """ING-04 PII: e-mail addresses and phone numbers are replaced by placeholders."""
    text, n = redact_pii("Email pastor.jane@example.org or call (555) 123-4567 / +1 555.987.6543 today.")
    assert "[email]" in text and "example.org" not in text
    assert text.count("[phone]") == 2 and "123-4567" not in text and "987" not in text
    assert n == 3


@pytest.mark.parametrize("scripture", [
    "Read John 3:16 tonight.", "Romans 8:28-30 is our text.", "See 8:28-30 and 1 Cor 13:4-7; 14:1.",
    "Psalm 119:105 and Isaiah 52:13-53:12.", "We met at 3:16 pm.", "Matthew 5-7 (chapters 5, 6 and 7).",
])
def test_pii_redaction_leaves_scripture_references_untouched(scripture):
    """ING-04 PII: Scripture references and chapter:verse ranges are never redacted."""
    assert redact_pii(scripture) == (scripture, 0)


def test_pii_card_numbers_need_a_valid_luhn_checksum():
    """ING-04 PII: 13-16 digit runs are redacted only when they pass the Luhn check."""
    redacted, n = redact_pii("card 4111 1111 1111 1111")
    assert redacted == "card [number]" and n == 1
    assert redact_pii("order 1234 5678 9012 3456") == ("order 1234 5678 9012 3456", 0)


def test_pii_card_redaction_keeps_the_following_separator():
    """ING-04 PII: redaction must not glue the placeholder to the next word."""
    assert redact_pii("card 4111 1111 1111 1111 ok") == ("card [number] ok", 1)


def test_normalize_text_removes_fillers_and_optionally_redacts():
    """ING-04: fillers are dropped, punctuation spacing fixed; redaction can be disabled per resource."""
    assert normalize_text("Um, so uh John 3:16 , right ?") == ("so John 3:16, right?", 0)
    assert normalize_text("mail me: a@b.co", redact=False) == ("mail me: a@b.co", 0)
    assert normalize_text("mail me: a@b.co", redact=True) == ("mail me: [email]", 1)


def test_finalize_units_offsets_and_speaker_separators():
    """ING-04: normalised full text is built from units with exact char offsets; speaker changes start a new line."""
    units = [Unit("", "sentence", "Hello there.", start_ms=0, end_ms=1000, speaker="HOST"),
             Unit("", "sentence", "Um", start_ms=1000, end_ms=1200, speaker="HOST"),  # filler-only -> dropped
             Unit("", "sentence", "Welcome back.", start_ms=1200, end_ms=2000, speaker="HOST"),
             Unit("", "sentence", "Thanks, call 555-123-4567.", start_ms=2100, end_ms=3000, speaker="GUEST")]
    kept, full, diag = finalize_units(units, spoken=True)
    assert [u.id for u in kept] == ["u0001", "u0002", "u0003"]
    assert full == "Hello there. Welcome back.\nThanks, call [phone]."
    for u in kept:
        assert full[u.char_start:u.char_end] == u.text
    assert diag == {"pii_redactions": 1, "unit_count": 3}


def test_split_sentences_with_times_allocates_proportionally():
    parts = split_sentences_with_times("First sentence here. Second one.", 1000, 4200)
    assert [p[0] for p in parts] == ["First sentence here.", "Second one."]
    assert parts[0][1] == 1000 and parts[-1][2] <= 4200
    assert all(a[2] <= b[1] + 1 for a, b in zip(parts, parts[1:]))


# ----------------------------------------------------------------------------- captions (ING-03)
VTT = """WEBVTT
Kind: captions

NOTE this is a comment block

intro
00:00:01.000 --> 00:00:04.500 align:start
<v HOST>Welcome back to <b>Grace Notes</b> &amp; friends.

00:00:05.000 --> 00:00:07.000
<v.loud GUEST>Thanks for having me.

00:01:02.250 --> 00:01:05.000
<v GUEST>Turn to John 3:16.
"""

SRT = """1
00:00:01,500 --> 00:00:03,000
Good morning, church.

2
00:00:03,200 --> 00:00:06,750
Please turn with me to
Romans chapter eight.

3
00:00:07,000 --> 00:00:05,000
Broken timing is clamped.
"""


def test_parse_vtt_voice_tags_markup_and_entities():
    """ING-03 captions: WebVTT cues keep timings, voice tags become speakers, markup/entities are cleaned."""
    cues = cap.parse_captions(VTT)
    assert [(c["start_ms"], c["end_ms"]) for c in cues] == [(1000, 4500), (5000, 7000), (62250, 65000)]
    assert cues[0]["text"] == "Welcome back to Grace Notes & friends."
    assert [c["speaker"] for c in cues] == ["HOST", "GUEST", "GUEST"]


def test_parse_srt_multiline_and_comma_milliseconds():
    """ING-03 captions: SRT index lines are ignored, multi-line cues joined, end < start clamped."""
    cues = cap.parse_captions(SRT.replace("\n", "\r\n"))
    assert [(c["start_ms"], c["end_ms"]) for c in cues] == [(1500, 3000), (3200, 6750), (7000, 7000)]
    assert cues[1]["text"] == "Please turn with me to Romans chapter eight."
    assert all(c["speaker"] is None for c in cues)


def test_parse_captions_short_timestamps_and_garbage_blocks():
    cues = cap.parse_captions("WEBVTT\n\n01:02.5 --> 01:04.25\nShort form.\n\nnot a cue\n\n00:00:09.000 --> nonsense\nSkipped.\n")
    assert [(c["start_ms"], c["end_ms"], c["text"]) for c in cues] == [(62500, 64250, "Short form.")]


def test_cues_to_units_merges_until_sentence_end_and_splits_on_speaker_or_gap():
    cues = [
        {"start_ms": 0, "end_ms": 2000, "text": "Please turn with me to", "speaker": "S1"},
        {"start_ms": 2000, "end_ms": 4000, "text": "Romans chapter eight. Paul writes", "speaker": "S1"},
        {"start_ms": 4000, "end_ms": 6000, "text": "about hope.", "speaker": "S1"},
        {"start_ms": 6100, "end_ms": 7000, "text": "Amen.", "speaker": "S2"},
        {"start_ms": 20000, "end_ms": 21000, "text": "after a long pause", "speaker": "S2"},
    ]
    units = cap.cues_to_units(cues)
    assert [u.text_raw for u in units] == ["Please turn with me to Romans chapter eight.", "Paul writes about hope.", "Amen.", "after a long pause"]
    first, second = units[0], units[1]
    assert first.start_ms == 0 and 3000 <= first.end_ms <= 4000  # interpolated inside the second cue
    assert second.start_ms >= first.end_ms - 50 and second.end_ms == 6000
    assert units[2].speaker == "S2" and units[3].start_ms == 20000


def test_units_to_vtt_round_trip():
    units = [{"start_ms": 1000, "end_ms": 2500, "text": "Hello.", "speaker": "HOST"}, {"start_ms": 3000, "end_ms": 3100, "text": "Hi.", "speaker": None},
             {"start_ms": None, "end_ms": None, "text": "untimed"}]
    text = cap.units_to_vtt(units)
    cues = cap.parse_captions(text)
    assert [(c["start_ms"], c["end_ms"], c["text"], c["speaker"]) for c in cues] == [(1000, 2500, "Hello.", "HOST"), (3000, 3300, "Hi.", None)]


# ----------------------------------------------------------------------------- segmentation (ING-05, spec §3.3)
def _spoken_units(durations_s: list[float], texts: list[str] | None = None, speakers: list[str] | None = None, gap_ms: int = 300) -> list[Unit]:
    units, t = [], 0
    for i, d in enumerate(durations_s):
        start, end = t, t + int(d * 1000)
        units.append(Unit(f"u{i + 1:04d}", "sentence", (texts or [])[i] if texts else f"Sentence number {i}.", text=(texts or [])[i] if texts else f"Sentence number {i}.",
                          start_ms=start, end_ms=end, speaker=(speakers or [None] * len(durations_s))[i]))
        t = end + gap_ms
    return units


def test_spoken_segments_respect_15_to_180_second_bounds():
    """ING-05: spoken segments never exceed 180 s and are at least 15 s (short tails are merged)."""
    units = _spoken_units([12.0] * 60)  # 12 min monologue, no cues
    plans = rule_segments_spoken(units, scripture=set())
    assert not validate_plan(plans, len(units))
    durations = [units[p.unit_indices[-1]].end_ms - units[p.unit_indices[0]].start_ms for p in plans]
    assert len(plans) > 3
    assert max(durations) <= SPOKEN_MAX_MS
    assert min(durations) >= SPOKEN_MIN_MS


def test_spoken_segments_break_on_transition_phrase_after_target_minimum():
    texts = [f"Point one detail {i}." for i in range(8)] + ["Now let us look at the second idea."] + [f"More detail {i}." for i in range(8)]
    units = _spoken_units([5.0] * 17, texts=texts)
    plans = rule_segments_spoken(units, scripture=set())
    assert [p.boundary_reason for p in plans][:1] == ["transition_phrase"]
    assert plans[1].unit_indices[0] == 8


def test_spoken_segments_do_not_split_right_after_scripture_and_merge_short_tail():
    texts = ["Intro."] * 7 + ["Now read Romans 8:28."] + ["Now here is what it means."] + ["Tail."]
    units = _spoken_units([5.0] * 9 + [2.0], texts=texts, speakers=["A"] * 10)
    plans = rule_segments_spoken(units, scripture={7})
    # the unit after the scripture unit stays with it (no transition split at index 8); the 2 s tail is merged
    assert all(8 not in p.unit_indices or 7 in p.unit_indices for p in plans)
    assert plans[-1].unit_indices[-1] == 9 and all(len(p.unit_indices) > 1 for p in plans)


def test_spoken_segments_split_on_speaker_change():
    units = _spoken_units([6.0] * 12, speakers=["HOST"] * 6 + ["GUEST"] * 6)
    plans = rule_segments_spoken(units, scripture=set())
    assert [p.boundary_reason for p in plans] == ["speaker_change", "end_of_resource"]
    assert plans[1].unit_indices[0] == 6


def _doc_units(spec: list[tuple[str, str]]) -> list[Unit]:
    return [Unit(f"u{i + 1:04d}", kind, text, text=text) for i, (kind, text) in enumerate(spec)]


def test_document_segments_split_on_headings_and_keep_heading_with_body():
    """ING-05 documents: a heading starts a new segment and never stands alone."""
    units = _doc_units([
        ("heading", "Title"), ("heading", "Session 1"), ("paragraph", "Read Hebrews 11:1."), ("paragraph", "Faith is trust."),
        ("heading", "Session 2"), ("paragraph", "Genesis 22 tells of Abraham."), ("list_item", "Question one"), ("list_item", "Question two"),
    ])
    plans = rule_segments_document(units)
    assert [p.unit_indices for p in plans] == [[0, 1, 2, 3], [4, 5, 6, 7]]
    assert [p.boundary_reason for p in plans] == ["heading", "end_of_resource"]


def test_document_segments_split_long_sections_by_paragraph_and_word_limits():
    long_para = " ".join(["word"] * 200)
    units = _doc_units([("paragraph", long_para)] * 3 + [("paragraph", "short")] * 5)
    plans = rule_segments_document(units)
    assert not validate_plan(plans, len(units))
    assert all(sum(len(units[i].text.split()) for i in p.unit_indices) <= 400 for p in plans)
    assert {p.boundary_reason for p in plans[:-1]} <= {"word_limit", "paragraph_limit"}


def test_validate_plan_detects_gaps_and_empty_segments():
    assert validate_plan([SegmentPlan([0, 1]), SegmentPlan([2])], 3) == []
    assert validate_plan([SegmentPlan([0]), SegmentPlan([2])], 3) == ["units not covered exactly once in order"]
    assert "empty segment" in validate_plan([SegmentPlan([0, 1, 2]), SegmentPlan([])], 3)


# ----------------------------------------------------------------------------- transcription repair (P-00 output validation)
def _u(start: float, end: float, text: str = "some spoken words here") -> dict:
    return {"start": start, "end": end, "speaker": "S1", "text": text}


def test_repair_fixes_overlaps_and_pads_zero_length_utterances():
    """ING-03 transcription: overlapping and zero-length utterances are repaired, order is non-decreasing."""
    items, notes = _repair([_u(0.0, 5.0), _u(4.0, 8.0), _u(8.0, 8.0, "short"), _u(9.0, 12.0)], clip_s=60.0, regions=[])
    assert "overlap_fixed" in notes and "duration_padded" in notes
    assert items[1]["start"] == pytest.approx(5.0)
    assert items[2]["end"] > items[2]["start"]
    starts = [u["start"] for u in items]
    assert starts == sorted(starts)
    assert all(u["end"] <= 60.0 for u in items)


def test_repair_clamps_to_clip_and_drops_empty_text():
    items, notes = _repair([_u(-1.0, 3.0), _u(3.0, 30.5), _u(4.0, 5.0, "   ")], clip_s=30.0, regions=[])
    assert len(items) == 2
    assert items[0]["start"] == 0.0 and items[-1]["end"] == 30.0
    assert _repair([_u(1, 2, " ")], 10.0, []) == ([], ["empty"])


def test_repair_reallocates_degenerate_timestamps_over_speech_regions():
    """ING-03 transcription: timestamps squeezed into a fraction of the clip are re-allocated over detected speech."""
    utterances = [_u(0.0, 1.0, "one two three four"), _u(1.0, 2.0, "five six"), _u(2.0, 3.0, "seven eight nine ten eleven twelve")]
    regions = [(10.0, 40.0), (50.0, 110.0)]
    items, notes = _repair(utterances, clip_s=120.0, regions=regions)
    assert notes == ["timestamps_reallocated"]
    assert items[0]["start"] == pytest.approx(10.0) and items[-1]["end"] == pytest.approx(110.0)
    assert all(a["end"] == pytest.approx(b["start"]) for a, b in zip(items, items[1:]))
    # proportional to word counts: 4 of 12 words -> a third of the 90 s of speech
    assert items[0]["end"] == pytest.approx(40.0)


def test_repair_reallocates_when_most_timestamps_exceed_the_clip():
    utterances = [_u(100.0, 105.0), _u(106.0, 110.0), _u(111.0, 115.0)]
    items, notes = _repair(utterances, clip_s=20.0, regions=[])
    assert notes == ["timestamps_reallocated"]
    assert items[0]["start"] == pytest.approx(0.0) and items[-1]["end"] == pytest.approx(20.0)


@pytest.mark.parametrize("value,seconds", [(12.5, 12.5), ("12.5", 12.5), ("00:12.5", 12.5), ("1:02", 62.0), ("1:02:03", 3723.0), ("4.2s", 4.2), (-3, 0.0)])
def test_p00_utterance_timestamps_accept_clock_strings(value, seconds):
    """ING-03 P-00 output: utterance start/end may be seconds or MM:SS / HH:MM:SS strings."""
    from interactive_bible.ai.schemas import TranscriptOut

    out = TranscriptOut.model_validate({"utterances": [{"start": value, "end": value, "text": "Amen."}]})
    assert out.utterances[0].start == pytest.approx(seconds) and out.utterances[0].end == pytest.approx(seconds)


def test_p00_utterance_rejects_non_time_strings():
    from pydantic import ValidationError

    from interactive_bible.ai.schemas import TranscriptOut

    with pytest.raises(ValidationError):
        TranscriptOut.model_validate({"utterances": [{"start": "soon", "end": 1, "text": "x"}]})
