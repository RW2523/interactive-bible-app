"""Quote index (ING-07) and the deterministic detectors/merge rules on the real corpus loaded in the test database."""
from __future__ import annotations

import pytest

from interactive_bible.bible import books as B
from interactive_bible.bible.text import sentence_split
from interactive_bible.pipeline import detectors, merge
from interactive_bible.pipeline.types import Detection, SegmentWork
from interactive_bible.retrieval.quotes import quote_confidence

RESOURCE = {"id": "res_unit", "is_official": False, "requires_review": False, "visibility": "public"}


def ref(value: int) -> str:
    return B.ref_from_ordinal(value)


def segment(text: str, preceding: str = "") -> SegmentWork:
    offsets = [{"id": f"u{i}", "start": s, "end": e, "start_ms": None, "end_ms": None, "page": None, "speaker": None, "kind": "sentence"}
               for i, (s, e) in enumerate(sentence_split(text) or [(0, len(text))])]
    return SegmentWork(id="seg_unit", ordinal=0, text=text, transcript_raw=text, unit_ids=[o["id"] for o in offsets], unit_offsets=offsets,
                       start_ms=None, end_ms=None, page_start=None, page_end=None, char_start=0, char_end=len(text), heading=None, speaker=None,
                       context_before=preceding, context_after="", preceding_text=preceding)


# ----------------------------------------------------------------------------- quote index
def test_quote_index_exact_full_verse(quote_index):
    """Quote index: an exact WEB quotation scores ~full containment with evidence offsets inside the text."""
    text = "Grandma's favourite verse: For God so loved the world, that he gave his only born Son, that whoever believes in him should not perish, but have eternal life."
    top = quote_index.search(text, min_containment=0.3)[0]
    assert ref(top.verse_id) == "JHN.3.16" and top.translation_id == "web" and top.kind == "shingle"
    assert top.containment >= 0.95 and top.longest_run >= 15
    assert text[top.start:top.end] == top.evidence and top.evidence.startswith("For God so loved the world")
    assert quote_confidence(top.containment, top.matched, top.longest_run, top.kind) >= 0.96


def test_quote_index_kjv_and_apostrophe_normalisation(quote_index):
    kjv = quote_index.search("Thy word is a lamp unto my feet, and a light unto my path.")[0]
    assert ref(kjv.verse_id) == "PSA.119.105" and kjv.translation_id in ("kjv", "asv") and kjv.containment >= 0.9
    curly = quote_index.search("Therefore don’t be anxious for tomorrow, for tomorrow will be anxious for itself.")[0]
    straight = quote_index.search("Therefore don't be anxious for tomorrow, for tomorrow will be anxious for itself.")[0]
    assert ref(curly.verse_id) == ref(straight.verse_id) == "MAT.6.34" and curly.containment == pytest.approx(straight.containment)


def test_quote_index_partial_quote_with_a_long_run(quote_index):
    """Quote index: a partial quotation from the middle of a verse is found through a long exact run."""
    text = "Coach taped a card inside every locker: they shall mount up with wings as eagles; they shall run, and not be weary."
    top = quote_index.search(text, min_containment=0.2)[0]
    assert ref(top.verse_id) == "ISA.40.31" and top.longest_run >= 10 and 0.4 <= top.containment < 0.85
    dets, _, _ = detectors.detect_quotes(segment(text), quote_index, RESOURCE, "run_unit", ai=False)
    (det,) = dets
    assert (ref(det.start), det.type, det.confidence) == ("ISA.40.31", "scripture_quote", 0.9) and det.review_reasons == ["partial_verse_quote"]


def test_quote_index_short_verse_exact_phrase(quote_index):
    """Quote index: very short verses ("Jesus wept.") match as exact normalised phrases."""
    text = "At the tomb the shortest verse says it all: Jesus wept."
    hits = {ref(c.verse_id): c for c in quote_index.search(text)}
    wept = hits["JHN.11.35"]
    assert wept.kind == "short_exact" and wept.containment == 1.0 and wept.evidence == "Jesus wept"
    assert quote_confidence(1.0, 2, 2, "short_exact") == 0.9
    assert "JHN.11.35" not in {ref(c.verse_id) for c in quote_index.search("Jesus and the disciples wept together")}


def test_quote_index_ignores_generic_keyword_overlap(quote_index):
    for text in ("Some people have more faith in the stock market than in anything else.",
                 "The shepherd moved his sheep to the lower field before the storm rolled in.",
                 "Honestly, my patience with the printer ran out long before my love for coffee did."):
        assert quote_index.search(text, min_containment=0.3) == []


def test_quote_index_verse_text_lookup(quote_index):
    assert quote_index.verse_text(43011035, "web") == "Jesus wept."
    assert quote_index.verse_text(45008028, "kjv").startswith("And we know that all things work together")
    assert quote_index.verse_text(99999999) is None


@pytest.mark.nodb
def test_quote_confidence_rules():
    assert quote_confidence(1.0, 20, 18, "shingle") == 0.97
    assert quote_confidence(0.5, 3, 3, "shingle") == pytest.approx(0.695)
    assert quote_confidence(0.9, 10, 9, "shingle") > quote_confidence(0.9, 10, 7, "shingle")


def test_deterministic_quote_filter_requires_strong_lexical_evidence(quote_index):
    weak = "We know that God works all things together for good for those who love him."
    dets, _, raw = detectors.detect_quotes(segment(weak), quote_index, RESOURCE, "run_unit", ai=False)
    assert dets == [] and "ROM.8.28" in {ref(c.verse_id) for c in raw}  # candidate kept for contextual inheritance only
    exact = "Therefore don’t be anxious for tomorrow, for tomorrow will be anxious for itself. Each day’s own evil is sufficient."
    (det,), _, _ = detectors.detect_quotes(segment(exact), quote_index, RESOURCE, "run_unit", ai=False)
    assert ref(det.start) == "MAT.6.34" and det.confidence == 0.96 and det.review_reasons == [] and det.subtype == "lexical_match"


# ----------------------------------------------------------------------------- explicit + contextual detectors
def test_detect_explicit_uses_preceding_text_for_context(test_database):
    seg = segment("Now look at verse thirty-one.", preceding="Earlier we read Romans 8:28 together.")
    (det,) = detectors.detect_explicit(seg, RESOURCE, "run_unit", ai=False)
    assert ref(det.start) == "ROM.8.31" and det.confidence == 0.84 and det.review_reasons == ["unverified_reference_form"]
    assert det.signals["parser"]["flags"] == ["context_chapter"] and det.evidence_text == "Now look at verse thirty-one."
    written = detectors.detect_explicit(segment("Read Rom 8:28-30 tonight."), RESOURCE, "run_unit", ai=False)
    assert [(ref(d.start), ref(d.end), d.subtype, d.review_reasons) for d in written] == [("ROM.8.28", "ROM.8.30", "range", [])]
    assert detectors.detect_explicit(segment("My friend John called me last week."), RESOURCE, "run_unit", ai=False) == []


@pytest.mark.parametrize("text,expected,confidence,reasons", [
    ("The parable of the prodigal son shows a father running toward his child.", "LUK.15.11-LUK.15.32", 0.9, []),
    ("The kids acted out David and Goliath with a cardboard sling.", "1SA.17.1-1SA.17.58", 0.9, []),
    ("If you want to know what Jesus expects, start with the Sermon on the Mount.", "MAT.5.1-MAT.7.27", 0.9, []),
    ("Pentecost changed everything for the early church.", "ACT.2.1-ACT.2.41", 0.78, ["generic_passage_alias"]),
])
def test_detect_contextual_named_passages(test_database, text, expected, confidence, reasons):
    (det,) = detectors.detect_contextual(segment(text), [], [], set())
    assert B.canonical_range_str(det.start, det.end) == expected and det.type == "contextual_reference"
    assert det.confidence == confidence and det.review_reasons == reasons and det.subtype == "named_passage"


def test_detect_contextual_inherits_passage_from_previous_segment(quote_index):
    previous = [Detection(start=B.ordinal("PSA", 23, 1), end=B.ordinal("PSA", 23, 6), type="direct_reference", subtype="chapter", confidence=0.95,
                          evidence_text="Psalm 23", spans=[(0, 8)], detectors=["refparser"])]
    text = "He leads me beside still waters and restores my soul."
    seg = segment(text)
    quotes, _, raw = detectors.detect_quotes(seg, quote_index, RESOURCE, "run_unit", ai=False)
    assert quotes == []  # too little lexical evidence for a quote on its own
    dets = detectors.detect_contextual(seg, previous, raw, {(q.start, q.end) for q in quotes})
    inherited = [d for d in dets if d.subtype == "inherited_passage_context"]
    assert [ref(d.start) for d in inherited] == ["PSA.23.2"] and inherited[0].confidence == 0.82 and inherited[0].review_reasons == ["inherited_context"]
    assert inherited[0].signals["context_ref"] == "PSA.23.1-PSA.23.6"
    assert detectors.detect_contextual(seg, [], raw, set()) == []  # no passage context -> nothing inherited


# ----------------------------------------------------------------------------- merge
def test_merge_corroborated_reference_and_consecutive_quote_runs(quote_index):
    text = ("Romans 8:28 is the promise: We know that all things work together for good for those who love God, for those who are called according to his purpose. "
            "For whom he foreknew, he also predestined to be conformed to the image of his Son, that he might be the firstborn among many brothers.")
    seg = segment(text)
    dets = detectors.detect_explicit(seg, RESOURCE, "run_unit", ai=False)
    quotes, _, _ = detectors.detect_quotes(seg, quote_index, RESOURCE, "run_unit", ai=False)
    mappings = merge.merge_detections(seg, dets + quotes)
    by_ref = {B.canonical_range_str(m.start, m.end): m for m in mappings}
    assert set(by_ref) == {"ROM.8.28", "ROM.8.28-ROM.8.29"}
    passage = by_ref["ROM.8.28-ROM.8.29"]  # consecutive verbatim quotes collapse into one passage quote
    assert passage.type == "scripture_quote" and passage.signals["scripture_quote"]["collapsed_verses"] == ["ROM.8.29"]
    direct = by_ref["ROM.8.28"]  # a higher-priority explicit citation is never absorbed by a lower-priority range
    assert direct.type == "direct_reference" and direct.detectors == ["refparser"] and direct.confidence == 0.99


def test_merge_keeps_highest_priority_type_per_verse_and_counts_mentions(test_database):
    seg = segment("John 3:16 matters. Later: John 3:16 again.")
    a = Detection(43003016, 43003016, "ai_related", "thematic", 0.93, "x", [(0, 9)], ["P-04"], why_related="because")
    b = Detection(43003016, 43003016, "direct_reference", "verse", 0.98, "John 3:16 matters.", [(0, 9)], ["refparser"])
    c = Detection(43003016, 43003016, "direct_reference", "verse", 0.97, "Later: John 3:16 again.", [(26, 35)], ["refparser"])
    (m,) = merge.merge_detections(seg, [a, b, c])
    assert m.type == "direct_reference" and m.mention_count == 2 and m.confidence == pytest.approx(0.99)
    assert m.detectors == ["P-04", "refparser"] and m.why_related == "because"
    merge.classify_and_select_primary(seg, [m], RESOURCE, "run_unit", ai=False, media=False)
    assert m.primary is True


def test_deterministic_primary_needs_a_clear_focus_for_documents(test_database):
    seg = segment("x")
    one = Detection(1, 1, "direct_reference", "verse", 0.99, "a", [(0, 1)], ["refparser"])
    two = Detection(2, 2, "direct_reference", "verse", 0.99, "b", [(2, 3)], ["refparser"])
    mappings = merge.merge_detections(seg, [Detection(**{**one.__dict__, "start": 45008028, "end": 45008028}), Detection(**{**two.__dict__, "start": 45012002, "end": 45012002})])
    assert merge.deterministic_primary(seg, mappings, media=False) is None  # two equal explicit citations: no primary for documents
    assert merge.deterministic_primary(seg, mappings, media=True) is not None  # media clips always need one
