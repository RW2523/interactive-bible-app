#!/usr/bin/env python3
"""Build the offline basemap for the Bible atlas from public-domain Natural Earth data.

Usage (from the project root):
    backend/.venv/bin/python scripts/build_geodata.py [--force-download] [--ref-dir DIR] [--preview PNG]

The app never fetches map tiles at runtime. This script runs at setup time: it downloads
Natural Earth into .data/cache/geodata/ (skipped when already cached) and writes static
files to frontend/public/geo/:

    relief.jpg      Natural Earth II shaded relief with water (1:50m raster), cropped to BBOX
                    and reprojected from EPSG:4326 to Web Mercator (EPSG:3857), so that
                    L.imageOverlay(url, [[south, west], [north, east]]) lines up with Leaflet's
                    default CRS. Native 30 px/degree horizontally, bilinear resampling.
    land.geojson    ne_10m_land                     (scalerank, min_zoom)
    lakes.geojson   ne_10m_lakes                    (name, featurecla, scalerank, min_zoom)
    rivers.geojson  ne_10m_rivers_lake_centerlines  (name, featurecla, scalerank, min_zoom)
    manifest.json   bbox, relief bounds/size/projection, layer URLs, attribution

BBOX = every lat/lng in the reference atlas data (geo/journeyGeo.js, geo/classicJourneys.js,
geo/biblicalRegions.js; data/bibleEvents.json coords are x/y percentages and are ignored),
padded by 4 degrees, unioned with the minimum box W-22 S4 E74 N54 (the atlas maxBounds), snapped outward to whole
degrees, latitude clamped to (-85, 85).

Vectors are clipped to BBOX (Sutherland-Hodgman for rings, Liang-Barsky for lines, split into
parts where a line leaves and re-enters), simplified with Douglas-Peucker, rounded to 4 decimals
and written as minified GeoJSON; rings are closed, have >= 4 points and follow RFC 7946 winding.
Rings cut by BBOX gain edges along the BBOX border, so draw land fills without a stroke.
Rivers: scalerank <= 7 anywhere in BBOX, plus scalerank 8-9 rivers that pass through the
unpadded extent of the reference coordinates. Modern water features are kept: reservoirs have
featurecla "Reservoir" in lakes.geojson; canals are classed "River" and only named "... Canal".
"Lake Centerline" river features run through lakes (e.g. the Jordan through the Sea of Galilee).

Every run re-reads the outputs and verifies them (JPEG size, closed rings, coordinates inside
BBOX) and checks the relief against land.geojson: point samples of known water/land and a
pixel-shift search that must find the best match at zero offset.

Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com (public domain).
"""

from __future__ import annotations

import argparse
import io
import json
import math
import re
import sys
import time
import warnings
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import httpx
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = ROOT / ".data" / "cache" / "geodata"
OUT_DIR = ROOT / "frontend" / "public" / "geo"
URL_PREFIX = "/geo"
DEFAULT_REF_DIR = ROOT / "frontend" / "src" / "features" / "explore"
DEFAULT_EVENTS = ROOT / "data" / "explore" / "bible_events.json"

NE_VECTOR = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson"
SOURCES = {
    "relief": ("https://naciscdn.org/naturalearth/50m/raster/NE2_50M_SR_W.zip", "NE2_50M_SR_W.zip"),
    "land": (f"{NE_VECTOR}/ne_10m_land.geojson", "ne_10m_land.geojson"),
    "lakes": (f"{NE_VECTOR}/ne_10m_lakes.geojson", "ne_10m_lakes.geojson"),
    "rivers": (f"{NE_VECTOR}/ne_10m_rivers_lake_centerlines.geojson", "ne_10m_rivers_lake_centerlines.geojson"),
}
ATTRIBUTION = "Made with Natural Earth (public domain)"

MIN_BOX = (-22.0, 4.0, 74.0, 54.0)  # west, south, east, north; matches the atlas maxBounds in JourneyMap.jsx
PAD_DEG = 4.0
MAX_LAT = 85.0

RELIEF_QUALITIES = (82, 78, 74, 70)  # first one that fits RELIEF_MAX_BYTES wins
RELIEF_MAX_BYTES = 2_500_000
VECTOR_MAX_BYTES = 1_500_000
DECIMALS = 4
LAND_TOLERANCE = 0.01  # Douglas-Peucker tolerances, degrees
LAKE_TOLERANCE = 0.01
RIVER_TOLERANCE = 0.015
RIVER_MAX_SCALERANK = 7  # anywhere in BBOX (Natural Earth min_zoom <= 6)
RIVER_NEAR_SITES_MAX_SCALERANK = 9  # only rivers passing through the reference-coordinate extent
REQUIRED_RIVERS = ("Nile", "Tigris", "Euphrates", "Jordan")
# Output names are name_en (else name). One English label per biblical-world river whose segments
# carry local names, one label per river split across languages, and repairs of lossy ASCII.
RIVER_NAMES = {
    "Al Furat": "Euphrates",
    "Firat": "Euphrates",
    "Dicle": "Tigris",
    "Abay": "Blue Nile",
    "Tajo": "Tagus",
    "Kiz?lirmak": "Kızılırmak",
    "Byk Menderes": "Büyük Menderes",
    "Rhne": "Rhône",
    "Zncara": "Záncara",
    "Truma": "Struma",
}

WATER_THRESHOLD = 40  # blue minus red: NE2 water is about +95, land stays below +10
# (label, lat, lng, expected water, must match)
ALIGNMENT_SAMPLES = (
    ("Mediterranean", 34.0, 18.0, True, True),
    ("Red Sea", 20.0, 38.5, True, True),
    ("Persian Gulf", 27.0, 51.0, True, True),
    ("Dead Sea", 31.5, 35.5, True, False),  # a few pixels wide; not drawn as water at 1:50m
    ("Syrian Desert", 34.0, 39.0, False, True),
    ("Egyptian Desert", 26.0, 30.0, False, True),
)
ALIGN_SEARCH_PX = 3
ALIGN_SUPERSAMPLE = 4
PREVIEW_ZOOM = 4
PREVIEW_CROPS = {"levant": (30.5, 29.0, 37.0, 34.0), "aegean": (22.0, 35.5, 29.5, 41.0)}  # W, S, E, N

BBox = tuple[float, float, float, float]


class BuildError(SystemExit):
    pass


def check(condition: object, message: str) -> None:
    if not condition:
        raise BuildError(f"verification failed: {message}")


def _human(n: float) -> str:
    if n < 1024:
        return f"{n:.0f} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n / 1024 / 1024:.2f} MB"


def _num(value):
    return int(value) if isinstance(value, float) and value.is_integer() else value


def _write(path: Path, data: bytes) -> None:
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


# ----------------------------------------------------------------------------------- downloads


def _cached_ok(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size == 0:
        return False
    if path.suffix == ".zip":
        return zipfile.is_zipfile(path)
    with path.open("rb") as f:  # a complete GeoJSON document ends with "}"
        f.seek(max(0, path.stat().st_size - 64))
        return f.read().rstrip().endswith(b"}")


def download(url: str, dest: Path, *, force: bool = False, attempts: int = 3) -> None:
    if not force and _cached_ok(dest):
        print(f"  cached   {dest.name} ({_human(dest.stat().st_size)})")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    for attempt in range(1, attempts + 1):
        try:
            started = time.monotonic()
            with (
                httpx.Client(follow_redirects=True, timeout=httpx.Timeout(60.0, connect=20.0)) as client,
                client.stream("GET", url) as resp,
            ):
                resp.raise_for_status()
                expected = None if resp.headers.get("content-encoding") else resp.headers.get("content-length")
                written = 0
                with part.open("wb") as f:
                    for chunk in resp.iter_bytes(1 << 20):
                        f.write(chunk)
                        written += len(chunk)
            if expected is not None and written != int(expected):
                raise OSError(f"short read: {written} of {expected} bytes")
            part.replace(dest)
            if not _cached_ok(dest):
                raise OSError("downloaded file failed validation")
            print(f"  fetched  {dest.name} ({_human(written)} in {time.monotonic() - started:.1f}s)")
            return
        except (httpx.HTTPError, OSError) as exc:
            part.unlink(missing_ok=True)
            if attempt == attempts:
                raise BuildError(f"download failed: {url}: {exc}") from exc
            print(f"  retry    {dest.name} ({exc}); attempt {attempt + 1}/{attempts}")
            time.sleep(2 * attempt)


def load_geojson(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise BuildError(f"{path} is not valid JSON ({exc}); re-run with --force-download") from exc


# ---------------------------------------------------------------------------------------- bbox

_NUM = r"(-?\d+(?:\.\d+)?)"
_PAIR_RE = re.compile(rf"\[\s*{_NUM}\s*,\s*{_NUM}\s*\]")
_LATLNG_RE = re.compile(rf"\blat\s*:\s*{_NUM}\s*,\s*lng\s*:\s*{_NUM}")


def _js_latlngs(text: str) -> list[tuple[float, float]]:
    pairs = [(float(a), float(b)) for a, b in _PAIR_RE.findall(text) + _LATLNG_RE.findall(text)]
    return [(lat, lng) for lat, lng in pairs if abs(lat) <= 90 and abs(lng) <= 180]


def _is_num(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _json_latlngs(node: object) -> tuple[list[tuple[float, float]], int]:
    """Collect {lat, lng}-style objects; count {x, y} objects (percentages, not coordinates)."""
    found: list[tuple[float, float]] = []
    xy = 0
    stack = [node]
    while stack:
        cur = stack.pop()
        if isinstance(cur, dict):
            lat = cur.get("lat", cur.get("latitude"))
            lng = cur.get("lng", cur.get("lon", cur.get("longitude")))
            if _is_num(lat) and _is_num(lng):
                found.append((float(lat), float(lng)))
            elif _is_num(cur.get("x")) and _is_num(cur.get("y")):
                xy += 1
            stack.extend(cur.values())
        elif isinstance(cur, list):
            stack.extend(cur)
    return found, xy


def compute_bbox(ref_dir: Path) -> tuple[BBox, BBox]:
    """Return (bbox, extent of the reference coordinates), both as (west, south, east, north)."""
    try:
        journey = (ref_dir / "geo" / "journeyGeo.js").read_text(encoding="utf-8")
        journeys = (ref_dir / "geo" / "classicJourneys.js").read_text(encoding="utf-8")
        regions = (ref_dir / "geo" / "biblicalRegions.js").read_text(encoding="utf-8")
        events_path = ref_dir / "data" / "bibleEvents.json"
        if not events_path.exists():
            events_path = DEFAULT_EVENTS
        events = json.loads(events_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise BuildError(f"reference atlas data not found: {exc.filename} (pass --ref-dir)") from exc
    block = re.search(r"PLACE_COORDS\s*=\s*\{(.*?)\};", journey, re.S)
    place = _js_latlngs(block.group(1)) if block else []
    if not block or not place:
        raise BuildError("no PLACE_COORDS entries found in journeyGeo.js")
    event_latlngs, xy_count = _json_latlngs(events)
    groups = {
        "journeyGeo.js PLACE_COORDS": place,
        "journeyGeo.js other": _js_latlngs(journey[: block.start()] + journey[block.end() :]),
        "classicJourneys.js": _js_latlngs(journeys),
        "biblicalRegions.js": _js_latlngs(regions),
        "bibleEvents.json": event_latlngs,
    }
    lats = [lat for pts in groups.values() for lat, _ in pts]
    lngs = [lng for pts in groups.values() for _, lng in pts]
    extent = (min(lngs), min(lats), max(lngs), max(lats))
    bbox = (
        max(-180.0, float(math.floor(min(extent[0] - PAD_DEG, MIN_BOX[0])))),
        max(-MAX_LAT, float(math.floor(min(extent[1] - PAD_DEG, MIN_BOX[1])))),
        min(180.0, float(math.ceil(max(extent[2] + PAD_DEG, MIN_BOX[2])))),
        min(MAX_LAT, float(math.ceil(max(extent[3] + PAD_DEG, MIN_BOX[3])))),
    )
    print("Reference lat/lng: " + ", ".join(f"{name} {len(pts)}" for name, pts in groups.items()))
    print(f"  bibleEvents.json: {xy_count} x/y percentage coords ignored")
    print(
        f"  extent W{extent[0]:g} S{extent[1]:g} E{extent[2]:g} N{extent[3]:g}; "
        f"+{PAD_DEG:g} deg = W{extent[0] - PAD_DEG:g} S{extent[1] - PAD_DEG:g} "
        f"E{extent[2] + PAD_DEG:g} N{extent[3] + PAD_DEG:g}; union with minimum box "
        f"W{MIN_BOX[0]:g} S{MIN_BOX[1]:g} E{MIN_BOX[2]:g} N{MIN_BOX[3]:g}"
    )
    print(f"BBOX  west={bbox[0]:g} south={bbox[1]:g} east={bbox[2]:g} north={bbox[3]:g}")
    return bbox, extent


# -------------------------------------------------------------------------------------- relief


def merc_y(lat_deg):
    """Spherical Mercator northing in radians, the projection behind Leaflet's EPSG:3857."""
    return np.log(np.tan(np.pi / 4 + np.radians(lat_deg) / 2))


class Grid:
    """Pixel grid of the Web Mercator relief. Pixel-edge coordinates: x=0 is BBOX west, y=0 is north."""

    def __init__(self, bbox: BBox, width: int, height: int) -> None:
        self.west, self.south, self.east, self.north = bbox
        self.width, self.height = width, height
        self.y_north = float(merc_y(self.north))
        self.y_south = float(merc_y(self.south))

    def to_px(self, lng, lat):
        x = (np.asarray(lng, dtype=float) - self.west) / (self.east - self.west) * self.width
        y = (self.y_north - merc_y(np.asarray(lat, dtype=float))) / (self.y_north - self.y_south) * self.height
        return x, y

    def pixel_centres(self) -> tuple[np.ndarray, np.ndarray]:
        lng = self.west + (np.arange(self.width) + 0.5) * (self.east - self.west) / self.width
        northing = self.y_north - (np.arange(self.height) + 0.5) * (self.y_north - self.y_south) / self.height
        return lng, np.degrees(np.arctan(np.sinh(northing)))  # inverse Mercator

    def row_lat(self, row: float) -> float:
        return float(np.degrees(np.arctan(np.sinh(self.y_north - row * (self.y_north - self.y_south) / self.height))))


def build_relief(zip_path: Path, bbox: BBox) -> tuple[bytes, Grid, int]:
    Image.MAX_IMAGE_PIXELS = None  # 10800 x 5400 world raster
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        tif = next((n for n in names if n.lower().endswith((".tif", ".tiff"))), None)
        if tif is None:
            raise BuildError(f"no GeoTIFF in {zip_path.name}; re-run with --force-download")
        tfw = next((n for n in names if n.lower().endswith(".tfw")), None)
        raw = zf.read(tif)
        world = [float(v) for v in zf.read(tfw).split()] if tfw else None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # Pillow warns about a malformed IPTC tag in this TIFF
        src = Image.open(io.BytesIO(raw))
        src_w, src_h = src.size
        if world:  # world file: x scale, y skew, x skew, y scale, x/y of the upper-left pixel centre
            check(world[1] == 0 and world[2] == 0, "relief world file has rotation terms")
            sx, sy, x0, y0 = world[0], world[3], world[4], world[5]
        else:  # plain global equirectangular raster
            sx, sy, x0, y0 = 360 / src_w, -180 / src_h, -180 + 180 / src_w, 90 - 90 / src_h
        west, south, east, north = bbox
        width = round((east - west) / sx)
        height = round(width * (float(merc_y(north)) - float(merc_y(south))) / math.radians(east - west))
        grid = Grid(bbox, width, height)

        # Source pixel coordinates (pixel-centre index space) of every output pixel centre.
        lng, lat = grid.pixel_centres()
        col = (lng - x0) / sx
        row = (lat - y0) / sy
        c0, c1 = max(int(np.floor(col.min())), 0), min(int(np.floor(col.max())) + 1, src_w - 1)
        r0, r1 = max(int(np.floor(row.min())), 0), min(int(np.floor(row.max())) + 1, src_h - 1)
        region = src.crop((c0, r0, c1 + 1, r1 + 1))
        if region.mode != "RGB":
            region = region.convert("RGB")
        window = np.asarray(region, dtype=np.float32)
    del raw, src

    # Separable bilinear sampling: columns first, then rows.
    x = np.clip(col - c0, 0, window.shape[1] - 1)
    y = np.clip(row - r0, 0, window.shape[0] - 1)
    x_lo = np.floor(x).astype(np.intp)
    y_lo = np.floor(y).astype(np.intp)
    x_hi = np.minimum(x_lo + 1, window.shape[1] - 1)
    y_hi = np.minimum(y_lo + 1, window.shape[0] - 1)
    fx = (x - x_lo).astype(np.float32)[None, :, None]
    fy = (y - y_lo).astype(np.float32)[:, None, None]
    by_col = window[:, x_lo] * (1 - fx) + window[:, x_hi] * fx
    out = by_col[y_lo] * (1 - fy) + by_col[y_hi] * fy
    image = Image.fromarray(np.clip(np.rint(out), 0, 255).astype(np.uint8))

    for quality in RELIEF_QUALITIES:
        buf = io.BytesIO()
        image.save(buf, "JPEG", quality=quality, progressive=True, optimize=True)
        if buf.tell() <= RELIEF_MAX_BYTES:
            break
    return buf.getvalue(), grid, quality


# ------------------------------------------------------------------------------------- vectors


def clip_ring(pts: np.ndarray, bbox: BBox) -> np.ndarray:
    """Sutherland-Hodgman: clip an open ring (N x 2, first vertex not repeated) to the rectangle."""
    west, south, east, north = bbox
    for axis, bound, keep_greater in ((0, west, True), (0, east, False), (1, south, True), (1, north, False)):
        if len(pts) == 0:
            break
        inside = pts[:, axis] >= bound if keep_greater else pts[:, axis] <= bound
        if inside.all():
            continue
        if not inside.any():
            return pts[:0]
        prev = np.roll(pts, 1, axis=0)
        crossing = inside != np.roll(inside, 1)
        # Each vertex emits [intersection with the edge from its predecessor] then [itself if inside].
        counts = crossing.astype(np.intp) + inside
        ends = np.cumsum(counts)
        out = np.empty((int(ends[-1]), 2))
        ci = np.flatnonzero(crossing)
        p, c = prev[ci], pts[ci]
        t = (bound - p[:, axis]) / (c[:, axis] - p[:, axis])
        cut = p + (c - p) * t[:, None]
        cut[:, axis] = bound
        out[ends[ci] - counts[ci]] = cut
        ii = np.flatnonzero(inside)
        out[ends[ii] - 1] = pts[ii]
        pts = out
    return pts


def _liang_barsky(x0: float, y0: float, x1: float, y1: float, bbox: BBox) -> tuple[float, float] | None:
    west, south, east, north = bbox
    dx, dy = x1 - x0, y1 - y0
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x0 - west), (dx, east - x0), (-dy, y0 - south), (dy, north - y0)):
        if p == 0.0:
            if q < 0.0:
                return None
        else:
            r = q / p
            if p < 0.0:
                if r > t1:
                    return None
                t0 = max(t0, r)
            else:
                if r < t0:
                    return None
                t1 = min(t1, r)
    return t0, t1


def clip_line(pts: np.ndarray, bbox: BBox) -> list[np.ndarray]:
    """Liang-Barsky per segment; the line is split into parts where it leaves and re-enters."""
    west, south, east, north = bbox
    inside = (pts[:, 0] >= west) & (pts[:, 0] <= east) & (pts[:, 1] >= south) & (pts[:, 1] <= north)
    if inside.all():
        return [pts]
    parts: list[np.ndarray] = []
    current: list[tuple[float, float]] = []

    def at(k: int, t: float) -> tuple[float, float]:
        if t == 0.0:
            return float(pts[k, 0]), float(pts[k, 1])
        if t == 1.0:
            return float(pts[k + 1, 0]), float(pts[k + 1, 1])
        x = pts[k, 0] + t * (pts[k + 1, 0] - pts[k, 0])
        y = pts[k, 1] + t * (pts[k + 1, 1] - pts[k, 1])
        return float(min(max(x, west), east)), float(min(max(y, south), north))

    for k in range(len(pts) - 1):
        if inside[k] and inside[k + 1]:
            if not current:
                current.append(at(k, 0.0))
            current.append(at(k, 1.0))
            continue
        hit = _liang_barsky(float(pts[k, 0]), float(pts[k, 1]), float(pts[k + 1, 0]), float(pts[k + 1, 1]), bbox)
        if hit is None:
            if len(current) >= 2:
                parts.append(np.array(current))
            current = []
            continue
        t0, t1 = hit
        if t0 > 0.0 or not current:  # entering the box starts a new part
            if len(current) >= 2:
                parts.append(np.array(current))
            current = [at(k, t0)]
        current.append(at(k, t1))
        if t1 < 1.0:  # leaving the box ends the part
            parts.append(np.array(current))
            current = []
    if len(current) >= 2:
        parts.append(np.array(current))
    return parts


def simplify(pts: np.ndarray, tolerance: float) -> np.ndarray:
    """Douglas-Peucker with point-to-segment distance; endpoints are always kept."""
    n = len(pts)
    if n < 3:
        return pts
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    tol2 = tolerance * tolerance
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        if j - i < 2:
            continue
        a = pts[i]
        d = pts[j] - a
        rel = pts[i + 1 : j] - a
        len2 = float(d @ d)
        if len2 > 0.0:  # distance to the segment; a closed ring's first pass measures from the start point
            t = np.clip(rel @ d / len2, 0.0, 1.0)
            rel = rel - t[:, None] * d
        dist2 = np.einsum("ij,ij->i", rel, rel)
        k = int(dist2.argmax())
        if dist2[k] > tol2:
            m = i + 1 + k
            keep[m] = True
            stack.append((i, m))
            stack.append((m, j))
    return pts[keep]


def _round_dedupe(pts: np.ndarray) -> np.ndarray:
    pts = np.round(pts, DECIMALS) + 0.0  # + 0.0 turns -0.0 into 0.0
    if len(pts) < 2:
        return pts
    keep = np.ones(len(pts), dtype=bool)
    keep[1:] = np.any(pts[1:] != pts[:-1], axis=1)
    return pts[keep]


def signed_area(ring: np.ndarray) -> float:
    rel = ring - ring[0]
    return 0.5 * float(np.dot(rel[:-1, 0], rel[1:, 1]) - np.dot(rel[1:, 0], rel[:-1, 1]))


def _bbox_relation(pts: np.ndarray, bbox: BBox) -> str:
    west, south, east, north = bbox
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    if hi[0] < west or lo[0] > east or hi[1] < south or lo[1] > north:
        return "outside"
    if lo[0] >= west and hi[0] <= east and lo[1] >= south and hi[1] <= north:
        return "inside"
    return "crossing"


def process_ring(coords: list, bbox: BBox, tolerance: float, *, exterior: bool) -> list | None:
    if len(coords) < 4:
        return None
    pts = np.asarray(coords, dtype=float)[:, :2]
    if np.array_equal(pts[0], pts[-1]):
        pts = pts[:-1]
    relation = _bbox_relation(pts, bbox)
    if relation == "outside":
        return None
    if relation == "crossing":
        pts = clip_ring(pts, bbox)
    if len(pts) < 3:
        return None
    ring = _round_dedupe(simplify(np.vstack([pts, pts[:1]]), tolerance))
    if len(ring) < 4 or not np.array_equal(ring[0], ring[-1]):
        return None
    area = signed_area(ring)
    if abs(area) < 1e-9:
        return None
    if (area > 0) != exterior:  # RFC 7946: exterior rings counterclockwise, holes clockwise
        ring = ring[::-1]
    return ring.tolist()


def _polygon_parts(geometry: dict | None) -> list:
    if not geometry:
        return []
    coords = geometry.get("coordinates") or []
    return {"Polygon": [coords], "MultiPolygon": coords}.get(geometry.get("type"), [])


def _line_parts(geometry: dict | None) -> list:
    if not geometry:
        return []
    coords = geometry.get("coordinates") or []
    return {"LineString": [coords], "MultiLineString": coords}.get(geometry.get("type"), [])


def process_polygons(geometry: dict | None, bbox: BBox, tolerance: float) -> dict | None:
    polygons = []
    for rings in _polygon_parts(geometry):
        outer = process_ring(rings[0], bbox, tolerance, exterior=True) if rings else None
        if outer is None:
            continue
        holes = (process_ring(hole, bbox, tolerance, exterior=False) for hole in rings[1:])
        polygons.append([outer, *(h for h in holes if h is not None)])
    if not polygons:
        return None
    if len(polygons) == 1:
        return {"type": "Polygon", "coordinates": polygons[0]}
    return {"type": "MultiPolygon", "coordinates": polygons}


def process_lines(parts: list[np.ndarray], bbox: BBox, tolerance: float) -> dict | None:
    lines = []
    for pts in parts:
        if _bbox_relation(pts, bbox) == "outside":
            continue
        for clipped in clip_line(pts, bbox):
            line = _round_dedupe(simplify(clipped, tolerance))
            if len(line) >= 2:
                lines.append(line.tolist())
    if not lines:
        return None
    if len(lines) == 1:
        return {"type": "LineString", "coordinates": lines[0]}
    return {"type": "MultiLineString", "coordinates": lines}


def _props(src: dict, keys: tuple[str, ...]) -> dict:
    return {key: _num(src[key]) for key in keys if src.get(key) is not None}


def _collection(features: list[dict], bbox: BBox) -> dict:
    return {"type": "FeatureCollection", "bbox": [_num(v) for v in bbox], "features": features}


def build_polygon_layer(src: dict, bbox: BBox, tolerance: float, keys: tuple[str, ...]) -> dict:
    features = []
    for feature in src.get("features", []):
        geometry = process_polygons(feature.get("geometry"), bbox, tolerance)
        if geometry:
            props = _props(feature.get("properties") or {}, keys)
            features.append({"type": "Feature", "properties": props, "geometry": geometry})
    return _collection(features, bbox)


def river_name(props: dict) -> str | None:
    raw = props.get("name_en") or props.get("name")
    if not raw:
        return None
    name = " ".join(str(raw).split())
    return RIVER_NAMES.get(name, name)


def build_rivers(src: dict, bbox: BBox, sites: BBox) -> tuple[dict, dict[str, set[str]]]:
    features = []
    kept: dict[str, set[str]] = {"major": set(), "near_sites": set()}
    s_west, s_south, s_east, s_north = sites
    for feature in src.get("features", []):
        props = feature.get("properties") or {}
        rank = props.get("scalerank")
        if not _is_num(rank) or rank > RIVER_NEAR_SITES_MAX_SCALERANK:
            continue
        parts = [np.asarray(c, dtype=float)[:, :2] for c in _line_parts(feature.get("geometry")) if len(c) >= 2]
        if not parts:
            continue
        if rank > RIVER_MAX_SCALERANK and not any(
            np.any((p[:, 0] >= s_west) & (p[:, 0] <= s_east) & (p[:, 1] >= s_south) & (p[:, 1] <= s_north))
            for p in parts
        ):
            continue
        geometry = process_lines(parts, bbox, RIVER_TOLERANCE)
        if not geometry:
            continue
        name = river_name(props)
        props_out = ({"name": name} if name else {}) | _props(props, ("featurecla", "scalerank", "min_zoom"))
        features.append({"type": "Feature", "properties": props_out, "geometry": geometry})
        if name:
            kept["major" if rank <= RIVER_MAX_SCALERANK else "near_sites"].add(name)
    missing = [r for r in REQUIRED_RIVERS if r not in kept["major"] | kept["near_sites"]]
    check(not missing, f"required rivers missing from rivers.geojson: {', '.join(missing)}")
    return _collection(features, bbox), kept


def _dumps(obj: dict) -> bytes:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _rings_and_lines(fc: dict):
    for feature in fc["features"]:
        geometry = feature["geometry"]
        for polygon in _polygon_parts(geometry):
            yield from polygon
        yield from _line_parts(geometry)


def _vertex_count(fc: dict) -> int:
    return sum(len(part) for part in _rings_and_lines(fc))


# ---------------------------------------------------------------------------------- verification


def verify_layer(path: Path, bbox: BBox, kinds: set[str]) -> dict:
    try:
        fc = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise BuildError(f"verification failed: {path.name} does not parse: {exc}") from exc
    check(fc.get("type") == "FeatureCollection" and fc.get("features"), f"{path.name}: empty or not a FeatureCollection")
    coords = []
    for feature in fc["features"]:
        geometry = feature.get("geometry") or {}
        check(geometry.get("type") in kinds, f"{path.name}: unexpected geometry {geometry.get('type')}")
        for polygon in _polygon_parts(geometry):
            check(polygon, f"{path.name}: empty polygon")
            for ring in polygon:
                check(len(ring) >= 4 and ring[0] == ring[-1], f"{path.name}: ring not closed or < 4 points")
                coords.extend(ring)
        for line in _line_parts(geometry):
            check(len(line) >= 2, f"{path.name}: line part with < 2 points")
            coords.extend(line)
    arr = np.asarray(coords, dtype=float)
    west, south, east, north = bbox
    eps = 1e-6
    check(
        arr[:, 0].min() >= west - eps
        and arr[:, 0].max() <= east + eps
        and arr[:, 1].min() >= south - eps
        and arr[:, 1].max() <= north + eps,
        f"{path.name}: coordinates outside bbox",
    )
    return fc


def verify_alignment(rgb: np.ndarray, grid: Grid, land: dict, lakes: dict) -> None:
    blue_minus_red = rgb[..., 2].astype(np.int16) - rgb[..., 0].astype(np.int16)
    print("Alignment samples (pixel from the overlay's Mercator math, 3x3 px mean):")
    failures = []
    for label, lat, lng, expect_water, strict in ALIGNMENT_SAMPLES:
        x, y = grid.to_px(lng, lat)
        col, row = int(math.floor(x)), int(math.floor(y))
        r, g, b = rgb[max(row - 1, 0) : row + 2, max(col - 1, 0) : col + 2].reshape(-1, 3).mean(axis=0)
        is_water = b - r > WATER_THRESHOLD
        if is_water == expect_water:
            status = "ok"
        elif strict:
            status = "MISMATCH"
            failures.append(label)
        else:
            status = "too small to be drawn as water at 1:50m"
        kind = "water" if is_water else "land"
        print(
            f"  {label:<15} {lat:4.1f}N {lng:4.1f}E  px({col:4d},{row:4d})  "
            f"rgb({r:3.0f},{g:3.0f},{b:3.0f})  {kind:<5} [{status}]"
        )
    check(not failures, f"relief samples misclassified: {', '.join(failures)}")

    # Compare the relief's own water/land split with land-minus-lakes rasterised on the same grid,
    # for every whole-pixel shift within ALIGN_SEARCH_PX, per latitude band (a projection error would
    # show up as a shift that changes with latitude). Pillow floors vertex coordinates, so unshifted
    # pixel-edge coordinates rasterise without bias; 4x supersampling keeps edge pixels honest.
    ss = ALIGN_SUPERSAMPLE
    mask = Image.new("1", (grid.width * ss, grid.height * ss), 0)
    draw = ImageDraw.Draw(mask)
    for fc, fill in ((land, 1), (lakes, 0)):
        for feature in fc["features"]:
            for polygon in _polygon_parts(feature["geometry"]):
                for i, ring in enumerate(polygon):
                    arr = np.asarray(ring)
                    xs, ys = grid.to_px(arr[:, 0], arr[:, 1])
                    outline = list(zip((xs * ss).tolist(), (ys * ss).tolist(), strict=True))
                    draw.polygon(outline, fill=fill if i == 0 else 1 - fill)
    coverage = np.asarray(mask).reshape(grid.height, ss, grid.width, ss).sum(axis=(1, 3), dtype=np.uint8)
    vector_land = coverage * 2 >= ss * ss
    relief_land = blue_minus_red <= WATER_THRESHOLD
    s = ALIGN_SEARCH_PX
    h, w = relief_land.shape
    core = relief_land[s : h - s, s : w - s]
    bands = np.array_split(np.arange(core.shape[0]), 3)
    scores: dict[tuple[int, int], np.ndarray] = {}
    for dy in range(-s, s + 1):
        for dx in range(-s, s + 1):  # relief pixel (x, y) against vector pixel (x + dx, y + dy)
            per_row = np.count_nonzero(core != vector_land[s + dy : h - s + dy, s + dx : w - s + dx], axis=1)
            scores[(dx, dy)] = np.array([per_row.sum()] + [per_row[band].sum() for band in bands], dtype=float)

    def vertex(minus: float, zero: float, plus: float) -> float:  # parabola through three scores
        curvature = minus - 2 * zero + plus
        return 0.5 * (minus - plus) / curvature if curvature > 0 else 0.0

    labels = ["all"] + [f"N{grid.row_lat(b[0] + s):.0f}-{grid.row_lat(b[-1] + s + 1):.0f}" for b in bands]
    misaligned, estimates = [], []
    for i, label in enumerate(labels):
        dx, dy = min(scores, key=lambda k: scores[k][i])
        if (dx, dy) != (0, 0):
            misaligned.append(f"{label} best at ({dx:+d},{dy:+d}) px")
            continue
        # The relief is displaced by minus the best vector shift.
        ex = -vertex(scores[(-1, 0)][i], scores[(0, 0)][i], scores[(1, 0)][i])
        ey = -vertex(scores[(0, -1)][i], scores[(0, 0)][i], scores[(0, 1)][i])
        estimates.append(f"{label} {ex:+.2f},{ey:+.2f}")
    total = core.size
    one_px = min(scores[k][0] for k in ((1, 0), (-1, 0), (0, 1), (0, -1)))
    print(
        f"Alignment vs land.geojson: water/land differs on {scores[(0, 0)][0] / total:.2%} of pixels at zero shift, "
        f">= {one_px / total:.2%} at any 1 px shift; best whole-pixel shift is (0,0) in "
        f"{len(labels) - len(misaligned)}/{len(labels)} checks"
    )
    if estimates:
        print(f"  sub-pixel relief offset (px, +x east, +y south): {'; '.join(estimates)}")
    check(not misaligned, f"relief is misaligned with the vectors: {'; '.join(misaligned)}")


# ------------------------------------------------------------------------------------- preview


def render_preview(path: Path, out_dir: Path, grid: Grid, layers: dict[str, dict]) -> list[Path]:
    relief = Image.open(out_dir / "relief.jpg").convert("RGB")
    styles = (("land", (220, 20, 60)), ("lakes", (140, 0, 200)), ("rivers", (0, 40, 220)))

    def draw_layers(img: Image.Image, scale: int, x_off: int, y_off: int) -> None:
        draw = ImageDraw.Draw(img)  # Pillow floors coordinates: pixel-edge coordinates go in unshifted
        for name, colour in styles:
            for part in _rings_and_lines(layers[name]):
                arr = np.asarray(part)
                xs, ys = grid.to_px(arr[:, 0], arr[:, 1])
                pts = list(zip(((xs - x_off) * scale).tolist(), ((ys - y_off) * scale).tolist(), strict=True))
                draw.line(pts, fill=colour, width=1)

    path.parent.mkdir(parents=True, exist_ok=True)
    full = relief.copy()
    draw_layers(full, 1, 0, 0)
    full.save(path)
    written = [path]
    for label, (west, south, east, north) in PREVIEW_CROPS.items():
        x0, y1 = grid.to_px(west, south)
        x1, y0 = grid.to_px(east, north)
        box = (int(math.floor(x0)), int(math.floor(y0)), int(math.ceil(x1)), int(math.ceil(y1)))
        size = ((box[2] - box[0]) * PREVIEW_ZOOM, (box[3] - box[1]) * PREVIEW_ZOOM)
        crop = relief.crop(box).resize(size, Image.Resampling.NEAREST)
        draw_layers(crop, PREVIEW_ZOOM, box[0], box[1])
        crop_path = path.with_name(f"{path.stem}_{label}{path.suffix}")
        crop.save(crop_path)
        written.append(crop_path)
    return written


# ---------------------------------------------------------------------------------------- main


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force-download", action="store_true", help="re-download sources even when cached")
    parser.add_argument("--ref-dir", type=Path, default=DEFAULT_REF_DIR, help="explore feature directory (geo/*.js reference coordinates)")
    parser.add_argument("--preview", type=Path, metavar="PNG", help="also write an overlay preview (and zoomed crops)")
    args = parser.parse_args(argv)
    started = time.monotonic()

    print(f"Sources -> {CACHE_DIR.relative_to(ROOT)}/")
    for url, filename in SOURCES.values():
        download(url, CACHE_DIR / filename, force=args.force_download)

    bbox, extent = compute_bbox(args.ref_dir)

    relief_jpg, grid, quality = build_relief(CACHE_DIR / SOURCES["relief"][1], bbox)
    land = build_polygon_layer(load_geojson(CACHE_DIR / SOURCES["land"][1]), bbox, LAND_TOLERANCE, ("scalerank", "min_zoom"))
    lakes = build_polygon_layer(
        load_geojson(CACHE_DIR / SOURCES["lakes"][1]), bbox, LAKE_TOLERANCE, ("name", "featurecla", "scalerank", "min_zoom")
    )
    rivers, kept_rivers = build_rivers(load_geojson(CACHE_DIR / SOURCES["rivers"][1]), bbox, extent)
    layers = {"land": land, "lakes": lakes, "rivers": rivers}

    west, south, east, north = (_num(v) for v in bbox)
    manifest = {
        "bbox": {"west": west, "south": south, "east": east, "north": north},
        "relief": {
            "url": f"{URL_PREFIX}/relief.jpg",
            "bounds": [[south, west], [north, east]],
            "width": grid.width,
            "height": grid.height,
            "projection": "EPSG:3857",
        },
        "layers": {name: f"{URL_PREFIX}/{name}.geojson" for name in layers},
        "attribution": ATTRIBUTION,
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    _write(OUT_DIR / "relief.jpg", relief_jpg)
    for name, fc in layers.items():
        _write(OUT_DIR / f"{name}.geojson", _dumps(fc))
    _write(OUT_DIR / "manifest.json", (json.dumps(manifest, indent=2) + "\n").encode("utf-8"))

    # Verify what is on disk, not what is in memory.
    written = json.loads((OUT_DIR / "manifest.json").read_text(encoding="utf-8"))
    check(written["relief"]["bounds"] == [[south, west], [north, east]], "manifest bounds")
    with Image.open(OUT_DIR / "relief.jpg") as im:
        im.load()
        check(im.format == "JPEG" and im.mode == "RGB", "relief.jpg is not an RGB JPEG")
        check(im.size == (written["relief"]["width"], written["relief"]["height"]), "relief size != manifest")
        check(1000 <= im.width <= 4096 and 500 <= im.height <= 4096, f"relief dimensions {im.size}")
        check(im.info.get("progressive"), "relief.jpg is not progressive")
        rgb = np.asarray(im)
    check((OUT_DIR / "relief.jpg").stat().st_size <= RELIEF_MAX_BYTES, "relief.jpg exceeds 2.5 MB")
    reread = {
        "land": verify_layer(OUT_DIR / "land.geojson", bbox, {"Polygon", "MultiPolygon"}),
        "lakes": verify_layer(OUT_DIR / "lakes.geojson", bbox, {"Polygon", "MultiPolygon"}),
        "rivers": verify_layer(OUT_DIR / "rivers.geojson", bbox, {"LineString", "MultiLineString"}),
    }
    vector_bytes = sum((OUT_DIR / f"{name}.geojson").stat().st_size for name in layers)
    check(vector_bytes <= VECTOR_MAX_BYTES, f"vector layers total {_human(vector_bytes)} > 1.5 MB")
    verify_alignment(rgb, grid, reread["land"], reread["lakes"])

    print(f"Rivers kept, scalerank <= {RIVER_MAX_SCALERANK} ({len(kept_rivers['major'])} named):")
    print("  " + ", ".join(sorted(kept_rivers["major"])))
    print(f"Rivers kept, scalerank 8-9 through the reference extent ({len(kept_rivers['near_sites'])} named):")
    print("  " + ", ".join(sorted(kept_rivers["near_sites"])))
    print(f"  required present: {', '.join(REQUIRED_RIVERS)}")

    if args.preview:
        for path in render_preview(args.preview, OUT_DIR, grid, reread):
            print(f"Preview  {path}")

    print(f"Wrote {OUT_DIR.relative_to(ROOT)}/ in {time.monotonic() - started:.1f}s")
    print(f"  {'relief.jpg':<16} {grid.width}x{grid.height} EPSG:3857 q{quality:<22} {_human((OUT_DIR / 'relief.jpg').stat().st_size):>9}")
    for name, fc in layers.items():
        detail = f"{len(fc['features'])} features, {_vertex_count(fc):,} points"
        print(f"  {name + '.geojson':<16} {detail:<37} {_human((OUT_DIR / f'{name}.geojson').stat().st_size):>9}")
    print(f"  {'manifest.json':<16} {'':<37} {_human((OUT_DIR / 'manifest.json').stat().st_size):>9}")
    print(f"  {'vectors total':<16} {'(target <= 1.5 MB)':<37} {_human(vector_bytes):>9}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
