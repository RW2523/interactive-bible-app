"""The structured sermon model (source of truth for the editor, slides, exports and the share page).

Port of sermon-builder ``lib/sermon/structured.ts`` (normalizeStructured, structuredToHtml, structuredToPlainText) plus the
server-side allow-list sanitiser for editor HTML (``lib/sanitize.ts`` ran sanitize-html in the browser).
"""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from .catalog import DEFAULT_TITLE


def empty_structured(title: str = DEFAULT_TITLE) -> dict[str, Any]:
    return {"title": title, "theme": "", "scripture": "", "introduction": "", "main_points": [], "applications": [], "conclusion": "", "prayer": ""}


def _first(obj: dict[str, Any], *keys: str) -> Any:
    """JavaScript ``a ?? b ?? c`` over dict keys: the first value that is not None/missing."""
    for key in keys:
        value = obj.get(key)
        if value is not None:
            return value
    return None


def as_string(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, dict):
        return " ".join(as_string(v) for v in value.values() if isinstance(v, (str, int, float))).strip()
    if isinstance(value, list):
        return " ".join(s for s in (as_string(v) for v in value) if s)
    return str(value).strip()


def as_string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [s for s in (as_string(v) for v in value) if s]
    text = as_string(value)
    if not text:
        return []
    # split a paragraph of numbered or line-separated items ("1. Pray daily 2. Serve") into items
    return [p.strip() for p in re.split(r"\n+|(?:^|\s)\d+[.)]\s+", text) if p and p.strip()]


def _as_points(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    points = []
    for item in value:
        if isinstance(item, str):
            point = {"heading": "", "body": item.strip(), "scripture": None}
        elif isinstance(item, dict):
            point = {
                "heading": as_string(_first(item, "heading", "title", "point")),
                "body": as_string(_first(item, "body", "content", "text")),
                "scripture": as_string(_first(item, "scripture", "verse")) or None,
            }
        else:
            continue
        if point["heading"] or point["body"]:
            points.append(point)
    return points


def normalize_structured(raw: Any, fallback_title: str = DEFAULT_TITLE) -> dict[str, Any]:
    """Coerce arbitrary model or client JSON into a valid structured sermon. Defensive: never raises."""
    o = raw if isinstance(raw, dict) else {}
    return {
        "title": as_string(_first(o, "title", "sermon_title")) or fallback_title,
        "theme": as_string(o.get("theme")),
        "scripture": as_string(_first(o, "scripture", "verse", "scripture_ref")),
        "introduction": as_string(_first(o, "introduction", "intro")),
        "main_points": _as_points(_first(o, "main_points", "points", "mainPoints")),
        "applications": as_string_list(_first(o, "applications", "application")),
        "conclusion": as_string(o.get("conclusion")),
        "prayer": as_string(o.get("prayer")),
    }


def is_empty(structured: dict[str, Any]) -> bool:
    return not structured.get("introduction") and not structured.get("main_points")


# ---------------------------------------------------------------------------------------------- rendering
def escape_html(text: Any) -> str:
    """Full quote-escaping: safe in text content and attribute positions."""
    return (str(text if text is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&#39;"))


def _paras(text: str) -> str:
    return "\n".join(f"<p>{escape_html(p).replace(chr(10), '<br/>')}</p>" for p in (x.strip() for x in re.split(r"\n{2,}", text)) if p)


def structured_to_html(s: dict[str, Any]) -> str:
    """Semantic HTML for the editor preview, the share page and the print view (all content escaped)."""
    out: list[str] = []
    if s.get("scripture"):
        out.append(f"<blockquote>{escape_html(s['scripture'])}</blockquote>")
    if s.get("introduction"):
        out.append("<h2>Introduction</h2>")
        out.append(_paras(s["introduction"]))
    for i, point in enumerate(s.get("main_points") or [], start=1):
        out.append(f"<h2>{i}. {escape_html(point.get('heading') or 'Main Point')}</h2>")
        if point.get("scripture"):
            out.append(f"<blockquote>{escape_html(point['scripture'])}</blockquote>")
        if point.get("body"):
            out.append(_paras(point["body"]))
    if s.get("applications"):
        out.append("<h2>Application</h2>")
        out.append("<ul>" + "".join(f"<li>{escape_html(a)}</li>" for a in s["applications"]) + "</ul>")
    if s.get("conclusion"):
        out.append("<h2>Conclusion</h2>")
        out.append(_paras(s["conclusion"]))
    if s.get("prayer"):
        out.append("<h2>Closing Prayer</h2>")
        out.append(f"<blockquote>{escape_html(s['prayer'])}</blockquote>")
    return "\n".join(out)


def structured_to_plain_text(s: dict[str, Any]) -> str:
    """Plain text for prompts, word counts and chunking."""
    parts = [s.get("scripture"), s.get("introduction")]
    for point in s.get("main_points") or []:
        parts += [point.get("heading"), point.get("scripture") or "", point.get("body")]
    parts += list(s.get("applications") or [])
    parts += [s.get("conclusion"), s.get("prayer")]
    return "\n\n".join(p for p in parts if p)


def html_to_text(html: str | None) -> str:
    if not html:
        return ""
    from bs4 import BeautifulSoup

    text = BeautifulSoup(html, "html.parser").get_text("\n")
    lines = [re.sub(r"[ \t\r\f\v]+", " ", line).strip() for line in text.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def draft_text(draft: dict[str, Any] | None) -> str:
    """Plain text of a draft: its structured sermon, else its (edited) HTML."""
    if not draft:
        return ""
    if draft.get("structured"):
        return structured_to_plain_text(normalize_structured(draft["structured"]))
    return html_to_text(draft.get("polished_html"))


# ---------------------------------------------------------------------------------------------- sanitising editor HTML
ALLOWED_TAGS = frozenset({"p", "br", "h1", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "strong", "b", "em", "i", "u", "s", "a", "code", "pre", "hr"})
# removed together with everything inside them
DROPPED_TAGS = frozenset({
    "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "noscript", "template", "svg", "math", "head", "title",
    "textarea", "select", "option", "button", "form", "input", "link", "meta", "base", "audio", "video", "source", "track", "canvas", "portal",
})
SAFE_SCHEMES = frozenset({"http", "https", "mailto"})
# disallowed block containers keep their paragraph boundary (become <p> when they only hold inline content)
BLOCK_CONTAINERS = frozenset({
    "div", "section", "article", "header", "footer", "main", "aside", "nav", "figure", "figcaption", "address", "center", "details", "summary",
    "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "dl", "dt", "dd", "h5", "h6",
})
_BLOCKS = ALLOWED_TAGS - {"br", "strong", "b", "em", "i", "u", "s", "a", "code"} | BLOCK_CONTAINERS


def safe_href(value: Any) -> str | None:
    """Absolute http(s)/mailto links only. Tabs/newlines are ignored by browsers anywhere in a URL (so they are removed before the
    scheme check); any other control character makes the link invalid."""
    if not isinstance(value, str):
        return None
    href = re.sub(r"[\t\n\r]", "", value).strip("".join(chr(c) for c in range(0x21)) + "\x7f")
    if not href or re.search(r"[\x00-\x1f\x7f]", href):
        return None
    try:
        scheme = urlparse(href).scheme.lower()
    except ValueError:
        return None
    return href if scheme in SAFE_SCHEMES else None


def sanitize_html(html: str | None) -> str:
    """Allow-list sanitiser: p, br, h1-h4, lists, blockquote, inline emphasis, code/pre, hr and safe links. Every attribute is
    removed except a link's http(s)/mailto ``href``; links get ``rel="noopener noreferrer"``. Dangerous elements (script, style,
    iframe, svg, forms, media...) are removed with their content; any other element is unwrapped and its text kept."""
    if not html:
        return ""
    from bs4 import BeautifulSoup, Comment, Doctype, Tag
    from bs4.element import CData, Declaration, ProcessingInstruction

    soup = BeautifulSoup(html, "html.parser")
    for node in soup.find_all(string=lambda s: isinstance(s, (Comment, Doctype, CData, Declaration, ProcessingInstruction))):
        node.extract()
    for tag in soup.find_all(True):
        if not isinstance(tag, Tag) or tag.decomposed:
            continue
        name = (tag.name or "").lower()
        if name in DROPPED_TAGS:
            tag.decompose()
        elif name in ("h5", "h6"):
            tag.name, tag.attrs = "h4", {}
        elif name in BLOCK_CONTAINERS:
            if any(isinstance(d, Tag) and (d.name or "").lower() in _BLOCKS for d in tag.descendants):
                tag.unwrap()
            else:
                tag.name, tag.attrs = "p", {}
        elif name not in ALLOWED_TAGS:
            tag.unwrap()
        elif name == "a":
            href = safe_href(tag.get("href"))
            tag.attrs = {"href": href, "rel": "noopener noreferrer"} if href else {"rel": "noopener noreferrer"}
        else:
            tag.attrs = {}
    return str(soup).strip()
