"""Upload validation (spec §13 Abuse: validate file type/size, scan uploads)."""
from __future__ import annotations

import ipaddress
import socket
import zipfile
from pathlib import Path
from urllib.parse import urlparse

from ..config import get_settings

MEDIA_TYPES = {"video", "audio"}
ALLOWED = {
    "video": {".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/mp4", ".webm": "video/webm"},
    "audio": {".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".flac": "audio/flac", ".webm": "audio/webm"},
    "pdf": {".pdf": "application/pdf"},
    "document": {
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".txt": "text/plain", ".md": "text/markdown", ".markdown": "text/markdown",
    },
    "captions": {".vtt": "text/vtt", ".srt": "application/x-subrip"},
}
EXECUTABLE_MAGIC = [b"MZ", b"\x7fELF", b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"#!"]


class UploadRejected(ValueError):
    pass


def max_bytes_for(resource_type: str) -> int:
    s = get_settings()
    mb = s.max_upload_mb_media if resource_type in MEDIA_TYPES else s.max_upload_mb_document
    return mb * 1024 * 1024


def check_extension(resource_type: str, filename: str) -> str:
    ext = Path(filename).suffix.lower()
    allowed = ALLOWED.get(resource_type, {})
    if ext not in allowed:
        raise UploadRejected(f"'{ext or filename}' is not an accepted {resource_type} file ({', '.join(sorted(allowed))})")
    return allowed[ext]


def _looks_like(ext: str, head: bytes) -> bool:
    if ext == ".pdf":
        return head.startswith(b"%PDF")
    if ext == ".docx":
        return head.startswith(b"PK\x03\x04")
    if ext in (".mp4", ".mov", ".m4v", ".m4a"):
        return head[4:8] in (b"ftyp", b"moov", b"wide", b"mdat", b"free", b"skip")
    if ext == ".mp3":
        return head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0)
    if ext == ".wav":
        return head.startswith(b"RIFF") and head[8:12] == b"WAVE"
    if ext == ".ogg":
        return head.startswith(b"OggS")
    if ext == ".flac":
        return head.startswith(b"fLaC")
    if ext == ".webm":
        return head.startswith(b"\x1a\x45\xdf\xa3")
    if ext == ".aac":
        return len(head) > 1 and head[0] == 0xFF and (head[1] & 0xF0) == 0xF0
    if ext in (".txt", ".md", ".markdown", ".vtt", ".srt", ".html", ".htm"):
        try:
            head.decode("utf-8")
        except UnicodeDecodeError:
            try:
                head[:-3].decode("utf-8")
            except UnicodeDecodeError:
                return False
        return b"\x00" not in head
    return False


def scan_file(path: Path, filename: str) -> None:
    """Content checks: magic bytes match the extension, no executables, DOCX zip-bomb guard."""
    ext = Path(filename).suffix.lower()
    with path.open("rb") as fh:
        head = fh.read(4096)
    if any(head.startswith(m) for m in EXECUTABLE_MAGIC) and ext not in (".txt", ".md", ".markdown", ".html", ".htm"):
        raise UploadRejected("executable content is not allowed")
    if not _looks_like(ext, head):
        raise UploadRejected(f"file content does not match its '{ext}' extension")
    if ext == ".docx":
        try:
            with zipfile.ZipFile(path) as zf:
                total = sum(i.file_size for i in zf.infolist())
                compressed = max(1, sum(i.compress_size for i in zf.infolist()))
                if total > 200 * 1024 * 1024 or total / compressed > 100:
                    raise UploadRejected("document archive expands suspiciously (possible zip bomb)")
                if "word/document.xml" not in zf.namelist():
                    raise UploadRejected("not a valid DOCX document")
                if any(n.lower().endswith((".bin", ".exe", ".dll")) or "vbaproject" in n.lower() for n in zf.namelist()):
                    raise UploadRejected("documents with macros or embedded binaries are not accepted")
        except zipfile.BadZipFile as exc:
            raise UploadRejected("corrupt DOCX file") from exc


def validate_public_url(url: str) -> str:
    """SSRF guard for article/media URLs."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise UploadRejected("only http(s) URLs are accepted")
    if get_settings().allow_private_url_fetch:
        return url
    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror as exc:
        raise UploadRejected(f"cannot resolve host {parsed.hostname}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise UploadRejected("URLs pointing to private or local networks are not allowed")
    return url
