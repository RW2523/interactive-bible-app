import pytest

from interactive_bible.bible import books as B
from interactive_bible.bible.numbers import parse_number
from interactive_bible.bible.refparser import parse_query_reference, parse_references, tokenize


def refs(text, context_before="", lenient=False):
    return [r.canonical for r in parse_references(text, context_before=context_before, lenient=lenient)]


@pytest.mark.parametrize(
    "text,value",
    [
        ("twenty-eight", 28), ("twenty eight", 28), ("one hundred and nineteen", 119), ("a hundred and fifty", 150),
        ("thirteen", 13), ("eighth", 8), ("twenty-eighth", 28), ("28", 28), ("3rd", 3), ("one hundred five", 105),
    ],
)
def test_numbers(text, value):
    toks = tokenize(text)
    m = parse_number(toks, 0)
    assert m is not None and m.value == value and m.end == len(toks)


def test_three_sixteen_is_two_numbers():
    toks = tokenize("three sixteen")
    m = parse_number(toks, 0)
    assert m.value == 3 and m.end == 1


@pytest.mark.parametrize(
    "text,expected",
    [
        ("For God so loved the world, John 3:16 says", ["JHN.3.16"]),
        ("Read Rom 8:28-30 tonight.", ["ROM.8.28-ROM.8.30"]),
        ("Love is patient (1 Cor. 13:4-7).", ["1CO.13.4-1CO.13.7"]),
        ("Psalm 23 is a favourite.", ["PSA.23.1-PSA.23.6"]),
        ("Jude 3 urges us to contend for the faith.", ["JUD.1.3"]),
        ("See Romans 8:28; 12:2 for context.", ["ROM.8.28", "ROM.12.2"]),
        ("The sermon series covers Matthew 5-7.", ["MAT.5.1-MAT.7.29"]),
        ("Gen 50:20 is the key.", ["GEN.50.20"]),
        ("Heb. 11:1 defines faith.", ["HEB.11.1"]),
        ("2 Tim 3:16-17 speaks of Scripture.", ["2TI.3.16-2TI.3.17"]),
        ("John 3:16 and 17", ["JHN.3.16-JHN.3.17"]),
        ("Romans 8:28, 31", ["ROM.8.28", "ROM.8.31"]),
        ("John 3:16-4:2", ["JHN.3.16-JHN.4.2"]),
        ("Philemon 6", ["PHM.1.6"]),
        ("1 John 4:8 says God is love", ["1JN.4.8"]),
        ("Song of Solomon 2:4", ["SNG.2.4"]),
        ("Revelation 21:4", ["REV.21.4"]),
    ],
)
def test_written(text, expected):
    assert refs(text) == expected


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Turn with me to first Corinthians chapter thirteen.", ["1CO.13.1-1CO.13.13"]),
        ("Romans eight twenty-eight is a promise.", ["ROM.8.28"]),
        ("In the eighth chapter of Romans, verse twenty-eight, Paul writes", ["ROM.8.28"]),
        ("Psalm one hundred and nineteen, verse one hundred and five says", ["PSA.119.105"]),
        ("second Timothy three sixteen", ["2TI.3.16"]),
        ("John chapter three verse sixteen", ["JHN.3.16"]),
        ("Isaiah forty verse thirty-one", ["ISA.40.31"]),
        ("Philippians four thirteen", ["PHP.4.13"]),
        ("Micah six eight", ["MIC.6.8"]),
        ("Proverbs three, verses five and six", ["PRO.3.5-PRO.3.6"]),
        ("Romans chapter eight verse twenty-eight", ["ROM.8.28"]),
        ("James chapter one, verses two through four", ["JAS.1.2-JAS.1.4"]),
        ("Matthew eighteen, twenty-one and twenty-two", ["MAT.18.21-MAT.18.22"]),
        ("Ephesians four thirty-two", ["EPH.4.32"]),
        ("verse 28 of Romans 8", ["ROM.8.28"]),
    ],
)
def test_spoken(text, expected):
    assert refs(text) == expected


def test_context_inferred_verse():
    out = parse_references("Look at verse thirty-one.", context_before="We are reading Romans 8 today.")
    assert [r.canonical for r in out] == ["ROM.8.31"]
    assert "context_chapter" in out[0].flags
    assert out[0].confidence < 0.9


def test_context_inferred_within_text():
    out = refs("Romans chapter eight verse twenty-eight is famous. Paul goes on in verse thirty-seven: we are more than conquerors.")
    assert out == ["ROM.8.28", "ROM.8.37"]


def test_context_chapter_and_verse():
    out = parse_references("In chapter three verse sixteen we read", context_before="Today we open the Gospel of John.")
    assert [r.canonical for r in out] == ["JHN.3.16"]
    assert "context_book" in out[0].flags


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Roman's 8 28 tells us", ["ROM.8.28"]),
        ("Philippines 4:13 says I can do all things", ["PHP.4.13"]),
        ("John 316 is the gospel in a nutshell", ["JHN.3.16"]),
        ("Revelations 21:4", ["REV.21.4"]),
        ("Galations 5:22", ["GAL.5.22"]),
        ("Habbakuk 2:4", ["HAB.2.4"]),
    ],
)
def test_asr_errors(text, expected):
    assert refs(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "My friend John called me last week.",
        "I had only been at that job one day.",
        "Mark my words, this will change.",
        "Acts of kindness 2 times a week matter.",
        "Numbers 5 and 6 on the list are done.",
        "I have faith in the stock market.",
        "We met at 3:16 pm near the church.",
        "Ruth 2 years ago moved to Ohio.",
        "John 3 times asked the question.",
        "is 5:24 the time?",
        "The job 1 priority is safety.",
        "I John went there",
        "Peter and James went fishing.",
        "He will mark 10 papers.",
        "Daniel 2 kids and a dog",
        "Romans 17:3",
        "John 3:99",
    ],
)
def test_hard_negatives(text):
    assert refs(text) == []


def test_ambiguous_chapter_with_cue():
    assert refs("Please turn to John 3 in your Bibles.") == ["JHN.3.1-JHN.3.36"]


def test_ambiguous_chapter_without_cue_rejected():
    assert refs("John 3 was a good day.") == []


def test_offsets_and_raw_text():
    text = "As Romans 8:28 says, all things work together."
    r = parse_references(text)[0]
    assert text[r.start : r.end] == "Romans 8:28" == r.raw_text


def test_confidence_ordering():
    written = parse_references("John 3:16")[0].confidence
    spoken = parse_references("John three sixteen")[0].confidence
    asr = parse_references("John 316")[0].confidence
    assert written > spoken > asr


def test_query_reference_parsing():
    assert parse_query_reference("ROM.8.28") == (45008028, 45008028)
    assert parse_query_reference("rom 8:28-30") == (45008028, 45008030)
    assert parse_query_reference("psalm 23") == (B.ordinal("PSA", 23, 1), B.ordinal("PSA", 23, 6))
    assert parse_query_reference("jn 3:16") == (43003016, 43003016)
    assert parse_query_reference("hello world") is None


def test_display_ref():
    assert B.display_ref(45008028) == "Romans 8:28"
    assert B.display_ref(45008028, 45008030) == "Romans 8:28-30"
    assert B.display_ref(B.ordinal("PSA", 23, 1), B.ordinal("PSA", 23, 6)) == "Psalms 23"
