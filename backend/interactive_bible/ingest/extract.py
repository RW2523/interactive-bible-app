"""Local text extraction adapters: PDF (text layer + Tesseract OCR fallback), DOCX, Markdown/TXT, HTML articles."""
from __future__ import annotations

import logging
import re
import shutil
import statistics
import subprocess
import tempfile
from pathlib import Path

import httpx

from .units import Unit
from .validate import UploadRejected, validate_public_url

log = logging.getLogger(__name__)

MD_HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
MD_LIST = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+(.*)$")


def _strip_md_inline(text: str) -> str:
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"(\*\*|__)(.*?)\1", r"\2", text)
    text = re.sub(r"(?<![\w*])([*_])(?!\s)(.+?)(?<!\s)\1(?![\w*])", r"\2", text)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    return text


def extract_markdown(text: str) -> tuple[list[Unit], dict]:
    units: list[Unit] = []
    heading: str | None = None
    para: list[str] = []
    quote: list[str] = []

    def flush() -> None:
        nonlocal para, quote
        if para:
            raw = " ".join(p.strip() for p in para).strip()
            if raw:
                units.append(Unit(id="", kind="paragraph", text_raw=_strip_md_inline(raw), heading=heading, meta={"markdown": raw}))
            para = []
        if quote:
            raw = " ".join(q.strip() for q in quote).strip()
            if raw:
                units.append(Unit(id="", kind="quote", text_raw=_strip_md_inline(raw), heading=heading))
            quote = []

    for line in text.replace("\r\n", "\n").split("\n"):
        if not line.strip():
            flush()
            continue
        m = MD_HEADING.match(line)
        if m:
            flush()
            heading = _strip_md_inline(m.group(2)).strip()
            units.append(Unit(id="", kind="heading", text_raw=heading, heading=heading, meta={"level": len(m.group(1))}))
            continue
        lm = MD_LIST.match(line)
        if lm:
            flush()
            units.append(Unit(id="", kind="list_item", text_raw=_strip_md_inline(lm.group(1)), heading=heading))
            continue
        if line.lstrip().startswith(">"):
            if para:
                flush()
            quote.append(line.lstrip()[1:])
            continue
        if quote:
            flush()
        para.append(line)
    flush()
    return units, {"method": "markdown"}


def extract_docx(path: Path) -> tuple[list[Unit], dict]:
    import docx  # python-docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    document = docx.Document(str(path))
    units: list[Unit] = []
    heading: str | None = None
    body = document.element.body
    for child in body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            p = Paragraph(child, document)
            text = p.text.strip()
            if not text:
                continue
            style = (p.style.name if p.style is not None else "") or ""
            if style.lower().startswith("heading") or style == "Title":
                heading = text
                units.append(Unit(id="", kind="heading", text_raw=text, heading=heading, meta={"style": style}))
            elif "list" in style.lower():
                units.append(Unit(id="", kind="list_item", text_raw=text, heading=heading))
            elif style.lower().startswith("quote") or style.lower() == "intense quote":
                units.append(Unit(id="", kind="quote", text_raw=text, heading=heading))
            else:
                units.append(Unit(id="", kind="paragraph", text_raw=text, heading=heading))
        elif tag == "tbl":
            table = Table(child, document)
            for row in table.rows:
                cells = []
                for cell in row.cells:
                    t = cell.text.strip()
                    if t and (not cells or cells[-1] != t):
                        cells.append(t)
                if cells:
                    units.append(Unit(id="", kind="table", text_raw=" | ".join(cells), heading=heading))
    return units, {"method": "docx"}


def _ocr_page(pdf_path: Path, page_number: int) -> str:
    if not (shutil.which("pdftoppm") and shutil.which("tesseract")):
        return ""
    with tempfile.TemporaryDirectory() as tmp:
        prefix = Path(tmp) / "page"
        subprocess.run(
            ["pdftoppm", "-r", "200", "-f", str(page_number), "-l", str(page_number), "-png", str(pdf_path), str(prefix)],
            check=True, capture_output=True, timeout=120,
        )
        images = sorted(Path(tmp).glob("page*.png"))
        if not images:
            return ""
        out = subprocess.run(["tesseract", str(images[0]), "stdout"], check=True, capture_output=True, timeout=180)
        return out.stdout.decode("utf-8", errors="replace")


def _is_heading_line(line: str, typical_len: float) -> bool:
    s = line.strip()
    if not s or len(s) > 80 or s[-1] in ".?!,;:\"”'":
        return False
    words = s.split()
    if len(words) > 10:
        return False
    capitalised = sum(1 for w in words if w[:1].isupper() or w[:1].isdigit())
    return (s.isupper() and len(s) > 3) or capitalised >= max(1, int(len(words) * 0.6)) and len(s) < typical_len * 0.8


def _page_blocks(text: str) -> list[tuple[str, str]]:
    lines = [ln.rstrip() for ln in text.replace("\r", "").split("\n")]
    content = [ln for ln in lines if ln.strip()]
    if not content:
        return []
    lengths = [len(ln.strip()) for ln in content]
    typical = max(statistics.median(lengths), 40.0)
    widest = max(lengths)
    blocks: list[tuple[str, str]] = []
    current: list[str] = []

    def flush() -> None:
        nonlocal current
        if current:
            blocks.append(("paragraph", re.sub(r"-\s+(?=[a-z])", "", " ".join(c.strip() for c in current))))
            current = []

    for i, ln in enumerate(lines):
        s = ln.strip()
        if not s:
            flush()
            continue
        if _is_heading_line(s, typical) and not current:
            blocks.append(("heading", s))
            continue
        current.append(s)
        if s[-1:] in ".?!\"”" and len(s) < widest * 0.75:
            flush()
    flush()
    return blocks


def extract_pdf(path: Path, ocr: bool = True) -> tuple[list[Unit], dict]:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    units: list[Unit] = []
    heading: str | None = None
    ocr_pages: list[int] = []
    for page_index, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception:  # noqa: BLE001
            text = ""
        if len(text.strip()) < 40 and ocr:
            try:
                ocr_text = _ocr_page(path, page_index)
            except Exception as exc:  # noqa: BLE001
                log.warning("OCR failed on page %s: %s", page_index, exc)
                ocr_text = ""
            if len(ocr_text.strip()) > len(text.strip()):
                text = ocr_text
                ocr_pages.append(page_index)
        for kind, block in _page_blocks(text):
            if kind == "heading":
                heading = block
            units.append(Unit(id="", kind=kind, text_raw=block, page=page_index, heading=heading))
    method = "pdf_ocr" if ocr_pages and len(ocr_pages) == len(reader.pages) else "pdf_text"
    return units, {"method": method, "page_count": len(reader.pages), "ocr_pages": ocr_pages}


def extract_html(html: str) -> tuple[list[Unit], dict]:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    meta = {
        "title": (soup.find("meta", property="og:title") or {}).get("content") if soup.find("meta", property="og:title") else (soup.title.string.strip() if soup.title and soup.title.string else None),
        "author": (soup.find("meta", attrs={"name": "author"}) or {}).get("content") if soup.find("meta", attrs={"name": "author"}) else None,
    }
    for tag in soup(["script", "style", "noscript", "nav", "header", "footer", "aside", "form", "iframe", "svg"]):
        tag.decompose()
    container = soup.find("article") or soup.find("main")
    if container is None:
        best, best_len = soup.body or soup, 0
        for div in soup.find_all(["div", "section"]):
            length = sum(len(p.get_text(" ", strip=True)) for p in div.find_all("p", recursive=False))
            if length > best_len:
                best, best_len = div, length
        container = best
    units: list[Unit] = []
    heading = None
    for el in container.find_all(["h1", "h2", "h3", "h4", "p", "li", "blockquote"]):
        text = el.get_text(" ", strip=True)
        if not text:
            continue
        if el.name in ("h1", "h2", "h3", "h4"):
            heading = text
            units.append(Unit(id="", kind="heading", text_raw=text, heading=heading))
        elif el.name == "li":
            units.append(Unit(id="", kind="list_item", text_raw=text, heading=heading))
        elif el.name == "blockquote":
            units.append(Unit(id="", kind="quote", text_raw=text, heading=heading))
        else:
            if el.find_parent("blockquote"):
                continue
            units.append(Unit(id="", kind="paragraph", text_raw=text, heading=heading))
    return units, {"method": "html", **{k: v for k, v in meta.items() if v}}


def fetch_article(url: str, max_bytes: int = 5 * 1024 * 1024) -> str:
    validate_public_url(url)
    with httpx.Client(timeout=20.0, follow_redirects=True, headers={"User-Agent": "InteractiveBibleApp/1.0"}) as client:
        with client.stream("GET", url) as resp:
            if resp.status_code != 200:
                raise UploadRejected(f"could not fetch article ({resp.status_code})")
            ctype = resp.headers.get("content-type", "")
            if "html" not in ctype and "text" not in ctype:
                raise UploadRejected(f"URL did not return an HTML page ({ctype})")
            chunks = []
            size = 0
            for chunk in resp.iter_bytes():
                size += len(chunk)
                if size > max_bytes:
                    raise UploadRejected("article page is too large")
                chunks.append(chunk)
            validate_public_url(str(resp.url))
    return b"".join(chunks).decode(resp.encoding or "utf-8", errors="replace")
