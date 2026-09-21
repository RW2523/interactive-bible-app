"""Text normalisation shared by the corpus, quote matching and keyword retrieval."""
from __future__ import annotations

import re
import unicodedata

WORD_RE = re.compile(r"[A-Za-z]+")
WORD_SPAN_RE = re.compile(r"[A-Za-z]+")

ARCHAIC = {
    "thee": "you", "thou": "you", "ye": "you", "thy": "your", "thine": "your", "hath": "has", "hast": "have",
    "doth": "does", "dost": "do", "art": "are", "unto": "to", "saith": "says", "shalt": "shall", "wilt": "will",
    "didst": "did", "thyself": "yourself", "wast": "were", "wert": "were", "canst": "can", "couldest": "could",
    "shouldest": "should", "wouldest": "would", "mayest": "may", "spake": "spoke", "sware": "swore",
    "nigh": "near", "whoso": "whoever", "whosoever": "whoever", "wherefore": "therefore", "hither": "here",
    "thither": "there", "yea": "yes", "nay": "no", "shew": "show", "shewed": "showed", "ere": "before",
    "verily": "truly", "brethren": "brothers", "lo": "behold", "jehovah": "lord", "o": "oh",
}
STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for", "from", "had", "has", "have", "he",
    "her", "him", "his", "i", "if", "in", "into", "is", "it", "its", "me", "my", "no", "not", "of", "on", "or",
    "our", "shall", "she", "so", "that", "the", "their", "them", "then", "there", "they", "this", "to", "us",
    "was", "we", "were", "what", "when", "which", "who", "whom", "will", "with", "you", "your", "yours", "do",
    "does", "did", "all", "also", "am", "can", "may", "might", "must", "should", "would", "could", "these",
    "those", "than", "because", "upon", "out", "up", "down", "over", "about", "said", "says", "say", "even",
    "every", "one", "own", "such", "very", "just", "how", "why", "where", "here", "now", "yes", "oh", "let",
    "s", "t", "ll", "re", "ve", "d", "m", "don", "didn", "doesn", "isn", "wasn", "aren", "won", "into", "unto",
    "behold", "therefore", "thus", "like", "being", "any", "some", "more", "most", "other", "only", "same",
}


def nfkc(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    return (
        text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
        .replace("—", " - ").replace("–", "-").replace(" ", " ")
    )


def clean_kjv(text: str) -> str:
    """KJV (eBible) marks translator-supplied words with [brackets]; keep the words, drop the marks."""
    return re.sub(r"\s{2,}", " ", text.replace("[", "").replace("]", "")).strip()


def stem(word: str) -> str:
    w = word
    if len(w) <= 3:
        return w
    if w.endswith("ies") and len(w) > 4:
        return w[:-3] + "y"
    for suffix in ("eth", "est"):
        if w.endswith(suffix) and len(w) - 3 >= 3:
            w = w[:-3]
            return w[:-1] if w.endswith("e") and len(w) > 3 else w
    if w.endswith("ing") and len(w) - 3 >= 3:
        w = w[:-3]
    elif w.endswith("ed") and len(w) - 2 >= 3:
        w = w[:-2]
    elif w.endswith("es") and len(w) - 2 >= 3:
        w = w[:-2]
    elif w.endswith("s") and not w.endswith("ss") and len(w) - 1 >= 3:
        w = w[:-1]
    if w.endswith("e") and len(w) > 3:
        w = w[:-1]
    return w


def norm_word(word: str) -> str:
    low = word.lower()
    low = ARCHAIC.get(low, low)
    return stem(low)


def match_tokens(text: str) -> list[tuple[str, int, int]]:
    """Normalised tokens with char spans: [(token, start, end)]."""
    text = text.replace("’", "'")
    out = []
    for m in WORD_SPAN_RE.finditer(text):
        raw = m.group(0).lower()
        mapped = ARCHAIC.get(raw, raw)
        out.append((stem(mapped), m.start(), m.end()))
    return out


def is_stop(token: str) -> bool:
    return token in _STEMMED_STOPWORDS


_STEMMED_STOPWORDS = {stem(ARCHAIC.get(w, w)) for w in STOPWORDS} | STOPWORDS


def content_words(text: str) -> list[str]:
    return [w.lower() for w in WORD_RE.findall(text) if w.lower() not in STOPWORDS and len(w) > 2]


def normalize_whitespace(text: str) -> str:
    return re.sub(r"[ \t]+", " ", re.sub(r"\s*\n\s*", "\n", text)).strip()


def sentence_split(text: str) -> list[tuple[int, int]]:
    """Split text into sentence spans (start, end) without breaking inside quotes or references like 3:16."""
    spans: list[tuple[int, int]] = []
    start = 0
    i = 0
    n = len(text)
    quote_depth = 0
    while i < n:
        ch = text[i]
        if ch in "\"“":
            quote_depth = 1 - quote_depth if ch == '"' else quote_depth + 1
        elif ch == "”":
            quote_depth = max(0, quote_depth - 1)
        if ch in ".!?":
            j = i + 1
            while j < n and text[j] in ".!?\"'”)":
                j += 1
            nxt = text[j] if j < n else " "
            prev_word = re.search(r"([A-Za-z]+)\.$", text[max(0, i - 12) : i + 1])
            abbrev = prev_word and prev_word.group(1).lower() in {
                "dr", "mr", "mrs", "ms", "st", "vs", "cf", "ch", "v", "vv", "rev", "gen", "ex", "lev", "num", "deut",
                "rom", "cor", "gal", "eph", "phil", "col", "thess", "tim", "heb", "jas", "pet", "matt", "mk", "lk",
                "jn", "ps", "prov", "isa", "jer", "ezek", "dan", "e.g", "i.e", "etc", "no",
            }
            if (nxt.isspace() or j >= n) and not abbrev and (quote_depth == 0 or text[j - 1] in "\"”"):
                if text[start:j].strip():
                    spans.append((start, j))
                start = j
                quote_depth = 0
            i = j
            continue
        if ch == "\n" and i + 1 < n and text[i + 1] == "\n":
            if text[start:i].strip():
                spans.append((start, i))
            start = i + 1
        i += 1
    if text[start:].strip():
        spans.append((start, n))
    # trim whitespace
    trimmed = []
    for s, e in spans:
        while s < e and text[s].isspace():
            s += 1
        while e > s and text[e - 1].isspace():
            e -= 1
        if e > s:
            trimmed.append((s, e))
    return trimmed
