"""Sermon inputs (stage 1 "Collect"): typed notes and dictation, Scripture selections resolved from the local Bible, recorded
audio (transcribed by Gemini, chunked locally with ffmpeg so long recordings work) and documents (local text extraction).

Uploaded files are stored at ``sermons/{user}/{sermon}/inputs/{input_id}-{name}``; a rejected or failed upload leaves no file.
"""
from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path
from typing import Any, BinaryIO

from sqlalchemy.orm import Session

from ... import storage
from ...ai.llm import AIUnavailable, get_llm
from ...config import get_settings
from ...db import fetch_one, json_dumps
from ...ids import new_id
from ...ingest import extract, media
from ...ingest.transcribe import transcribe_media
from ...ingest.units import Unit
from ...ingest.validate import ALLOWED, UploadRejected, scan_file
from ...security import Viewer
from ..bible import NotFound, resolve_translation
from . import grounding
from .catalog import language_iso
from .store import owned_sermon, sermon_prefix, serialize_input, touch

log = logging.getLogger(__name__)

MAX_TEXT_CHARS = 50_000
MAX_DOCUMENT_CHARS = 200_000
TEXT_KINDS = ("text", "dictation")
AUDIO_TYPES = {**ALLOWED["audio"], ".mp4": "audio/mp4"}  # .mp4: audio recorded by Safari's MediaRecorder
DOCUMENT_TYPES = {**ALLOWED["pdf"], **ALLOWED["document"], ".html": "text/html", ".htm": "text/html"}
NOISE = ("[music]", "[silence]", "[inaudible]")
PARAGRAPH_PAUSE_MS = 2500
PARAGRAPH_SENTENCES = 6
PARAGRAPH_CHARS = 700


def _insert(session: Session, sermon_id: str, input_id: str, kind: str, **fields: Any) -> dict[str, Any]:
    touch(session, sermon_id)  # the sermon row is locked before its children (same lock order as every other writer)
    return fetch_one(session, """INSERT INTO sermon_inputs (id, sermon_id, kind, raw_text, transcription, storage_key, original_filename, mime_type, meta)
                                 VALUES (:id, :s, :kind, :raw, :transcription, :key, :filename, :mime, CAST(:meta AS jsonb)) RETURNING *""",
                     id=input_id, s=sermon_id, kind=kind, raw=fields.get("raw_text"), transcription=fields.get("transcription"), key=fields.get("storage_key"),
                     filename=fields.get("original_filename"), mime=fields.get("mime_type"), meta=json_dumps(fields.get("meta") or {}))


# ---------------------------------------------------------------------------------------------- typed text + Scripture
def add_text_input(session: Session, viewer: Viewer, sermon_id: str, kind: str, text: str | None) -> dict[str, Any]:
    if kind not in TEXT_KINDS:
        raise ValueError("kind must be text, dictation or bible_ref")
    owned_sermon(session, viewer, sermon_id)
    value = (text or "").strip()
    if not value:
        raise ValueError("Enter some text to add")
    if len(value) > MAX_TEXT_CHARS:
        raise ValueError(f"text must be at most {MAX_TEXT_CHARS:,} characters")
    return serialize_input(_insert(session, sermon_id, new_id("inp"), kind, raw_text=value))


def add_bible_ref_input(session: Session, viewer: Viewer, sermon_id: str, reference: str | None, notes: str | None = None,
                        translation: str | None = None) -> dict[str, Any]:
    """A Scripture selection with the exact verse text from the local Bible (capped at 12 verses)."""
    owned_sermon(session, viewer, sermon_id)
    rng = grounding.parse_reference(reference)
    translation_id = resolve_translation(session, translation)
    text = grounding.passage_text(session, *rng, translation_id) if rng else ""
    if not rng or not text:
        raise ValueError("Couldn't recognise that Bible reference")
    notes = (notes or "").strip()
    if len(notes) > MAX_TEXT_CHARS:
        raise ValueError(f"notes must be at most {MAX_TEXT_CHARS:,} characters")
    display = grounding.display(*rng)
    raw = f"Scripture: {display} ({grounding.translation_abbreviation(session, translation_id)})\n{text}"
    if notes:
        raw += f"\n\nStudy notes: {notes}"
    meta = {"reference": display, "canonical": grounding.canonical(*rng), "translation": translation_id, "verse_text": text}
    return serialize_input(_insert(session, sermon_id, new_id("inp"), "bible_ref", raw_text=raw, meta=meta))


# ---------------------------------------------------------------------------------------------- uploads
def _save_upload(head: bytes, stream: BinaryIO, key: str, max_bytes: int) -> int:
    """Stream an upload to its final key (via a .part file), enforcing the size limit."""
    dest = storage.path_for(key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    size = 0
    try:
        with tmp.open("wb") as out:
            chunk = head
            while chunk:
                size += len(chunk)
                if size > max_bytes:
                    raise ValueError(f"file exceeds the maximum allowed size of {max_bytes // (1024 * 1024)} MB")
                out.write(chunk)
                chunk = stream.read(1 << 20)
        if size == 0:
            raise UploadRejected("the uploaded file is empty")
        os.replace(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)
    return size


def _sniff_audio(head: bytes) -> str | None:
    """Extension for audio uploaded without a usable file name (e.g. a browser recording named 'blob')."""
    if head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0 and (head[1] & 0x06)):
        return ".mp3"
    if head.startswith(b"RIFF") and head[8:12] == b"WAVE":
        return ".wav"
    if head.startswith(b"OggS"):
        return ".ogg"
    if head.startswith(b"fLaC"):
        return ".flac"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return ".webm"
    if head[4:8] == b"ftyp":
        return ".m4a"
    if len(head) > 1 and head[0] == 0xFF and (head[1] & 0xF6) == 0xF0:
        return ".aac"
    return None


def _audio_name(filename: str | None, head: bytes) -> str:
    name = storage.safe_filename(filename or "", "recording")
    ext = Path(name).suffix.lower()
    if ext in AUDIO_TYPES:
        return name  # the content must still match the extension (scan_file)
    sniffed = _sniff_audio(head)
    if not sniffed:
        raise UploadRejected(f"'{ext or name}' is not an accepted audio file ({', '.join(sorted(AUDIO_TYPES))})")
    return f"{Path(name).stem or 'recording'}{sniffed}"


def join_transcript(units: list[Unit]) -> str:
    """Transcript sentences -> readable paragraphs (new paragraph at a long pause, a speaker change or every few sentences)."""
    paragraphs: list[list[str]] = []
    current: list[str] = []
    chars = 0
    previous: Unit | None = None
    for unit in units:
        text = (unit.text_raw or "").strip()
        if not text or text.lower() in NOISE:
            continue
        pause = previous is not None and unit.start_ms is not None and previous.end_ms is not None and unit.start_ms - previous.end_ms >= PARAGRAPH_PAUSE_MS
        speaker_change = previous is not None and bool(unit.speaker and previous.speaker and unit.speaker != previous.speaker)
        if current and (pause or speaker_change or len(current) >= PARAGRAPH_SENTENCES or chars >= PARAGRAPH_CHARS):
            paragraphs.append(current)
            current, chars = [], 0
        current.append(text)
        chars += len(text)
        previous = unit
    if current:
        paragraphs.append(current)
    return "\n\n".join(" ".join(p) for p in paragraphs)


def add_audio_input(session: Session, viewer: Viewer, sermon_id: str, stream: BinaryIO, filename: str | None) -> dict[str, Any]:
    """Store a recording and transcribe it with Gemini (long audio is cut at silences into chunks, each cached by content hash)."""
    sermon = owned_sermon(session, viewer, sermon_id)
    if not get_llm().available:
        raise AIUnavailable("Transcribing audio needs the Gemini API key to be configured on the server.")
    session.commit()  # hold no database transaction during the upload and the transcription
    head = stream.read(64)
    name = _audio_name(filename, head)
    input_id = new_id("inp")
    key = f"{sermon_prefix(viewer.user_id, sermon_id)}/inputs/{input_id}-{name}"
    size = _save_upload(head, stream, key, get_settings().max_upload_mb_media * 1024 * 1024)
    path = storage.path_for(key)
    work = storage.work_dir(f"sermon_{input_id}")
    try:
        scan_file(path, name)
        try:
            info = media.probe(path)
        except media.MediaError as exc:
            raise UploadRejected(f"the audio file could not be read: {exc}") from exc
        if not info.has_audio:
            raise UploadRejected("the file has no audio track")
        try:
            units, diagnostics = transcribe_media(path, None, sermon_id, language_iso(sermon["language"]), None, work)  # type: ignore[arg-type]
        except media.MediaError as exc:
            raise UploadRejected(f"the audio file could not be processed: {exc}") from exc
        transcription = join_transcript(units)
        if not transcription.strip():
            raise ValueError("No speech detected in the audio")
        owned_sermon(session, viewer, sermon_id)  # still there after the transcription
        meta = {"duration_seconds": round(info.duration_ms / 1000, 1), "size_bytes": size, "chunks": len(diagnostics.get("chunks") or []),
                "transcriber": diagnostics.get("method_version")}
        row = _insert(session, sermon_id, input_id, "audio", transcription=transcription, storage_key=key, original_filename=(filename or name)[:255],
                      mime_type=AUDIO_TYPES.get(Path(name).suffix.lower()), meta=meta)
        session.commit()
    except BaseException:
        storage.delete_key(key)
        raise
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return {"input": serialize_input(row), "transcription": transcription}


def _units_text(units: list[Unit]) -> str:
    out: list[str] = []
    previous_kind = None
    for unit in units:
        text = (unit.text_raw or "").strip()
        if not text:
            continue
        if unit.kind == "list_item":
            text = f"- {text}"
        if out:
            out.append("\n" if unit.kind == "list_item" and previous_kind == "list_item" else "\n\n")
        out.append(text)
        previous_kind = unit.kind
    return "".join(out)


def _extract_document(path: Path, ext: str) -> tuple[str, dict[str, Any]]:
    try:
        if ext == ".pdf":
            units, diag = extract.extract_pdf(path)
            return _units_text(units), {"method": diag.get("method"), "page_count": diag.get("page_count"), "ocr_pages": diag.get("ocr_pages") or []}
        if ext == ".docx":
            units, diag = extract.extract_docx(path)
            return _units_text(units), {"method": "docx"}
        raw = path.read_text(encoding="utf-8-sig", errors="replace").replace("\r\n", "\n").replace("\r", "\n")
        if ext in (".html", ".htm"):
            units, diag = extract.extract_html(raw)
            return _units_text(units), {"method": "html"}
        if ext in (".md", ".markdown"):
            units, diag = extract.extract_markdown(raw)
            return _units_text(units), {"method": "markdown"}
        return raw.strip(), {"method": "text"}
    except UploadRejected:
        raise
    except Exception as exc:  # noqa: BLE001 - corrupt or unusual files from users
        log.warning("document extraction failed for %s: %s", path.name, exc)
        raise UploadRejected(f"the document could not be read ({type(exc).__name__})") from exc


def add_document_input(session: Session, viewer: Viewer, sermon_id: str, stream: BinaryIO, filename: str | None) -> dict[str, Any]:
    """Store a PDF / DOCX / TXT / Markdown / HTML document and extract its text locally (PDF pages without text are OCR'd)."""
    owned_sermon(session, viewer, sermon_id)
    name = storage.safe_filename(filename or "", "document")
    ext = Path(name).suffix.lower()
    if ext not in DOCUMENT_TYPES:
        raise UploadRejected(f"'{ext or name}' is not an accepted document ({', '.join(sorted(DOCUMENT_TYPES))})")
    session.commit()
    input_id = new_id("inp")
    key = f"{sermon_prefix(viewer.user_id, sermon_id)}/inputs/{input_id}-{name}"
    size = _save_upload(stream.read(64), stream, key, get_settings().max_upload_mb_document * 1024 * 1024)
    path = storage.path_for(key)
    try:
        scan_file(path, name)
        text, meta = _extract_document(path, ext)
        if not text.strip():
            raise ValueError("No text could be extracted from this document")
        meta.update(size_bytes=size, chars=len(text), truncated=len(text) > MAX_DOCUMENT_CHARS)
        owned_sermon(session, viewer, sermon_id)
        row = _insert(session, sermon_id, input_id, "document", raw_text=text[:MAX_DOCUMENT_CHARS], storage_key=key, original_filename=(filename or name)[:255],
                      mime_type=DOCUMENT_TYPES[ext], meta=meta)
        session.commit()
    except BaseException:
        storage.delete_key(key)
        raise
    return {"input": serialize_input(row)}


def delete_input(session: Session, viewer: Viewer, sermon_id: str, input_id: str) -> dict[str, Any]:
    owned_sermon(session, viewer, sermon_id, lock=True)
    row = fetch_one(session, "DELETE FROM sermon_inputs WHERE id = :id AND sermon_id = :s RETURNING storage_key", id=input_id, s=sermon_id)
    if not row:
        raise NotFound("input not found")
    touch(session, sermon_id)
    session.commit()
    storage.delete_key(row["storage_key"])
    return {"ok": True}
