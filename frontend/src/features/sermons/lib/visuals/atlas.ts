// Stylized biblical atlas. Two pure generators — a labeled place map and an
// ordered journey route — share one calm, abstract base (a soft "sea" field
// behind a rounded "land" blob) and a single accent, so they read as part of
// the same hand-made editorial set as the timeline, diagram and scripture
// cards. No external fonts/images: crisp <text> only. Coordinates are baked in
// here (this file owns the gazetteer); projection is plain equirectangular,
// auto-framed to the bbox of whatever places are involved.

import { VISUAL_W, VISUAL_H, esc, wrap } from './svg'
import type { VisualTheme } from './theme'


// ── Gazetteer ──────────────────────────────────────────────────────────────
// Approximate {lat, lng} for ~70 common biblical places. Aliases (lower-cased,
// punctuation-stripped) map many spellings/synonyms onto one canonical point.
interface Place {
  lat: number
  lng: number
}

const PLACES: Record<string, Place> = {
  Jerusalem: { lat: 31.78, lng: 35.23 },
  Bethlehem: { lat: 31.7, lng: 35.2 },
  Nazareth: { lat: 32.7, lng: 35.3 },
  Galilee: { lat: 32.8, lng: 35.5 },
  'Sea of Galilee': { lat: 32.83, lng: 35.59 },
  Capernaum: { lat: 32.88, lng: 35.58 },
  Cana: { lat: 32.75, lng: 35.34 },
  Tiberias: { lat: 32.79, lng: 35.53 },
  Jericho: { lat: 31.86, lng: 35.46 },
  Bethany: { lat: 31.77, lng: 35.27 },
  Emmaus: { lat: 31.84, lng: 35.02 },
  'Jordan River': { lat: 32.0, lng: 35.55 },
  Jordan: { lat: 32.0, lng: 35.55 },
  'Dead Sea': { lat: 31.5, lng: 35.5 },
  Samaria: { lat: 32.28, lng: 35.2 },
  Sychar: { lat: 32.21, lng: 35.28 },
  Shechem: { lat: 32.21, lng: 35.28 },
  Bethel: { lat: 31.93, lng: 35.22 },
  Hebron: { lat: 31.53, lng: 35.1 },
  Gibeah: { lat: 31.82, lng: 35.23 },
  Shiloh: { lat: 32.06, lng: 35.29 },
  Joppa: { lat: 32.05, lng: 34.75 },
  Lydda: { lat: 31.95, lng: 34.89 },
  Caesarea: { lat: 32.5, lng: 34.9 },
  'Caesarea Philippi': { lat: 33.25, lng: 35.69 },
  Megiddo: { lat: 32.58, lng: 35.18 },
  Nain: { lat: 32.63, lng: 35.36 },
  Gilgal: { lat: 31.86, lng: 35.5 },
  'Mount of Olives': { lat: 31.78, lng: 35.25 },
  Gethsemane: { lat: 31.78, lng: 35.24 },
  Golgotha: { lat: 31.78, lng: 35.23 },
  Mediterranean: { lat: 33.5, lng: 33.5 },
  'Red Sea': { lat: 28.0, lng: 34.0 },
  Egypt: { lat: 30.0, lng: 31.2 },
  Goshen: { lat: 30.8, lng: 31.8 },
  Memphis: { lat: 29.85, lng: 31.25 },
  Rameses: { lat: 30.8, lng: 31.9 },
  Sinai: { lat: 28.54, lng: 33.97 },
  'Mount Sinai': { lat: 28.54, lng: 33.97 },
  Horeb: { lat: 28.54, lng: 33.97 },
  Kadesh: { lat: 30.65, lng: 34.42 },
  'Kadesh Barnea': { lat: 30.65, lng: 34.42 },
  Edom: { lat: 30.5, lng: 35.5 },
  Moab: { lat: 31.5, lng: 35.7 },
  'Mount Nebo': { lat: 31.77, lng: 35.73 },
  Midian: { lat: 28.5, lng: 35.5 },
  Damascus: { lat: 33.51, lng: 36.29 },
  Tyre: { lat: 33.27, lng: 35.19 },
  Sidon: { lat: 33.56, lng: 35.37 },
  Antioch: { lat: 36.2, lng: 36.16 },
  'Pisidian Antioch': { lat: 38.3, lng: 31.19 },
  Tarsus: { lat: 36.92, lng: 34.9 },
  Iconium: { lat: 37.87, lng: 32.49 },
  Lystra: { lat: 37.58, lng: 32.45 },
  Derbe: { lat: 37.35, lng: 33.27 },
  Perga: { lat: 36.96, lng: 30.85 },
  Attalia: { lat: 36.88, lng: 30.7 },
  Colossae: { lat: 37.79, lng: 29.26 },
  Laodicea: { lat: 37.83, lng: 29.11 },
  Hierapolis: { lat: 37.92, lng: 29.13 },
  Ephesus: { lat: 37.94, lng: 27.34 },
  Miletus: { lat: 37.53, lng: 27.28 },
  Smyrna: { lat: 38.42, lng: 27.14 },
  Pergamum: { lat: 39.13, lng: 27.18 },
  Sardis: { lat: 38.49, lng: 28.04 },
  Thyatira: { lat: 38.92, lng: 27.84 },
  Philadelphia: { lat: 38.35, lng: 28.52 },
  Troas: { lat: 39.75, lng: 26.16 },
  Assos: { lat: 39.49, lng: 26.34 },
  Patmos: { lat: 37.31, lng: 26.55 },
  Cyprus: { lat: 35.13, lng: 33.43 },
  Salamis: { lat: 35.18, lng: 33.9 },
  Paphos: { lat: 34.77, lng: 32.42 },
  Crete: { lat: 35.24, lng: 24.81 },
  'Fair Havens': { lat: 34.94, lng: 24.81 },
  Malta: { lat: 35.9, lng: 14.5 },
  Philippi: { lat: 41.01, lng: 24.29 },
  Neapolis: { lat: 40.94, lng: 24.41 },
  Amphipolis: { lat: 40.82, lng: 23.84 },
  Thessalonica: { lat: 40.64, lng: 22.94 },
  Berea: { lat: 40.52, lng: 22.2 },
  Athens: { lat: 37.98, lng: 23.73 },
  Corinth: { lat: 37.91, lng: 22.88 },
  Cenchreae: { lat: 37.88, lng: 22.99 },
  Rome: { lat: 41.9, lng: 12.5 },
  Puteoli: { lat: 40.82, lng: 14.12 },
  Syracuse: { lat: 37.07, lng: 15.29 },
  Rhegium: { lat: 38.11, lng: 15.65 },
  Ur: { lat: 30.96, lng: 46.1 },
  Haran: { lat: 36.86, lng: 39.03 },
  Babylon: { lat: 32.54, lng: 44.42 },
  Nineveh: { lat: 36.36, lng: 43.15 },
  Susa: { lat: 32.19, lng: 48.26 },
  Shushan: { lat: 32.19, lng: 48.26 },
  Canaan: { lat: 31.8, lng: 35.2 },
  Beersheba: { lat: 31.25, lng: 34.79 },
  Gerar: { lat: 31.4, lng: 34.6 },
  'Mount Carmel': { lat: 32.73, lng: 35.05 },
  'Mount Hermon': { lat: 33.42, lng: 35.86 },
  'Mount Tabor': { lat: 32.69, lng: 35.39 },
  Bethsaida: { lat: 32.91, lng: 35.63 },
  Magdala: { lat: 32.83, lng: 35.52 },
  Gadara: { lat: 32.65, lng: 35.68 },
  Aenon: { lat: 32.34, lng: 35.5 },
}

// Aliases → canonical key. Keys are normalized (lower-cased, alnum+spaces).
const ALIASES: Record<string, string> = {
  'sea of tiberias': 'Sea of Galilee',
  galilee: 'Galilee',
  'mount of olives': 'Mount of Olives',
  'olivet': 'Mount of Olives',
  calvary: 'Golgotha',
  'the great sea': 'Mediterranean',
  'great sea': 'Mediterranean',
  zion: 'Jerusalem',
  'mount zion': 'Jerusalem',
  salem: 'Jerusalem',
  'jordan river': 'Jordan River',
  'the jordan': 'Jordan River',
  'river jordan': 'Jordan River',
  'mt sinai': 'Mount Sinai',
  sinai: 'Mount Sinai',
  'mt nebo': 'Mount Nebo',
  'mt carmel': 'Mount Carmel',
  'mt hermon': 'Mount Hermon',
  'mt tabor': 'Mount Tabor',
  'pisidian antioch': 'Pisidian Antioch',
  'antioch of syria': 'Antioch',
  'syrian antioch': 'Antioch',
  shushan: 'Susa',
  'land of canaan': 'Canaan',
  'land of egypt': 'Egypt',
  'red sea crossing': 'Red Sea',
}

function normName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Look up a place by name (tolerant of aliases / punctuation). */
function lookup(name: string): Place | null {
  if (PLACES[name]) return PLACES[name]
  const n = normName(name)
  for (const key of Object.keys(PLACES)) {
    if (normName(key) === n) return PLACES[key]
  }
  if (ALIASES[n] && PLACES[ALIASES[n]]) return PLACES[ALIASES[n]]
  return null
}

// ── Named journeys ───────────────────────────────────────────────────────────
// Ordered place-name arrays so a route can be drawn from a journey name alone.
export const JOURNEYS: Record<string, string[]> = {
  Exodus: ['Rameses', 'Red Sea', 'Mount Sinai', 'Kadesh Barnea', 'Mount Nebo'],
  'Abraham’s Journey': ['Ur', 'Haran', 'Shechem', 'Bethel', 'Hebron', 'Egypt'],
  'Paul’s First Missionary Journey': [
    'Antioch',
    'Salamis',
    'Paphos',
    'Perga',
    'Pisidian Antioch',
    'Iconium',
    'Lystra',
    'Derbe',
    'Attalia',
  ],
  'Flight to Egypt': ['Bethlehem', 'Egypt', 'Nazareth'],
  'Road to Emmaus': ['Jerusalem', 'Emmaus'],
}

/**
 * Resolve a journey by (loose) name → ordered route stops, or [] if unknown.
 * Matches on shared significant tokens so "paul first missionary journey" and
 * "Paul’s First Missionary Journey" still resolve.
 */
export function journeyStops(name: string): Array<{ name: string; order: number }> {
  const stop = new Set(['the', 'of', 'to', 's', 'a', 'journey'])
  const toks = (s: string) => normName(s).split(' ').filter((t) => t && !stop.has(t))
  const want = toks(name)
  if (want.length === 0) return []
  let best: { key: string; score: number } | null = null
  for (const key of Object.keys(JOURNEYS)) {
    const have = new Set(toks(key))
    const score = want.filter((t) => have.has(t)).length
    if (score > 0 && (!best || score > best.score)) best = { key, score }
  }
  if (!best) return []
  return JOURNEYS[best.key].map((place, i) => ({ name: place, order: i + 1 }))
}

// ── Geometry ─────────────────────────────────────────────────────────────────
const PAD = 90
const SERIF_FALLBACK = 'Georgia, serif'
const SANS_FALLBACK = 'Helvetica, Arial, sans-serif'

interface Resolved {
  name: string
  note?: string
  order?: number
  lat: number
  lng: number
}

interface Projector {
  (lat: number, lng: number): { x: number; y: number }
}

// Build an equirectangular projector from the bbox of the resolved points,
// fit inside an inset frame with comfortable interior margin. Latitude is
// scaled by cos(meanLat) so east–west spacing looks natural, then inverted
// for screen y. Degenerate (single-point / zero-span) cases get a fallback span.
function makeProjector(points: Resolved[]): Projector {
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  let minLat = Math.min(...lats)
  let maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)

  const meanLat = (minLat + maxLat) / 2
  const k = Math.max(0.2, Math.cos((meanLat * Math.PI) / 180))

  // Pad the geographic bbox a little so markers don't sit on the frame edge.
  let spanLat = Math.max(maxLat - minLat, 0.001)
  let spanLng = Math.max((maxLng - minLng) * k, 0.001)
  const padLat = spanLat * 0.18 + 0.4
  const padLng = spanLng * 0.18 + 0.4
  minLat -= padLat
  maxLat += padLat
  const minX = (minLng * k) - padLng
  const maxX = (maxLng * k) + padLng
  spanLat = maxLat - minLat
  spanLng = maxX - minX

  // Interior drawing frame (leave room for the eyebrow/title band up top).
  const fx = PAD + 40
  const fy = PAD + 96
  const fw = VISUAL_W - (PAD + 40) * 2
  const fh = VISUAL_H - (PAD + 96) - (PAD + 30)

  // Preserve aspect: scale uniformly by the tighter axis, then center.
  const sx = fw / spanLng
  const sy = fh / spanLat
  const s = Math.min(sx, sy)
  const drawnW = spanLng * s
  const drawnH = spanLat * s
  const offX = fx + (fw - drawnW) / 2
  const offY = fy + (fh - drawnH) / 2

  return (lat: number, lng: number) => {
    const gx = lng * k
    const x = offX + (gx - minX) * s
    const y = offY + (maxLat - lat) * s // invert lat for screen space
    return { x, y }
  }
}

// ── Shared chrome ────────────────────────────────────────────────────────────
function defs(vt: VisualTheme): string {
  return `
  <defs>
    <radialGradient id="atlasSea" cx="50%" cy="42%" r="78%">
      <stop offset="0%" stop-color="${esc(vt.bg)}"/>
      <stop offset="100%" stop-color="${esc(vt.bgDeep)}"/>
    </radialGradient>
    <marker id="atlasArrow" viewBox="0 0 10 10" refX="8" refY="5"
      markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 L3,5 Z" fill="${esc(vt.accent)}"/>
    </marker>
  </defs>`
}

function frame(vt: VisualTheme): string {
  return `
  <rect x="0" y="0" width="${VISUAL_W}" height="${VISUAL_H}" fill="${esc(vt.bg)}"/>
  <rect x="0" y="0" width="${VISUAL_W}" height="${VISUAL_H}" fill="url(#atlasSea)"/>`
}

function header(eyebrow: string, title: string, vt: VisualTheme): string {
  const serif = `${vt.serif}, ${SERIF_FALLBACK}`
  const sans = `${vt.sans}, ${SANS_FALLBACK}`
  const tx = PAD
  return `
  <g>
    <text x="${tx}" y="${PAD + 6}" font-family="${esc(sans)}" font-size="20"
      letter-spacing="4" fill="${esc(vt.accent)}">${esc(eyebrow.toUpperCase())}</text>
    <text x="${tx}" y="${PAD + 54}" font-family="${esc(serif)}" font-size="42"
      fill="${esc(vt.heading)}">${esc(title)}</text>
    <line x1="${tx}" y1="${PAD + 74}" x2="${tx + 360}" y2="${PAD + 74}"
      stroke="${esc(vt.line)}" stroke-width="1.5"/>
  </g>`
}

// A soft rounded "land" blob behind the markers — abstract, not a coastline.
// Sized to the convex-ish bounds of the projected points with generous bleed.
function landBlob(pts: Array<{ x: number; y: number }>, vt: VisualTheme): string {
  if (pts.length === 0) return ''
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const bx = Math.min(...xs) - 70
  const by = Math.min(...ys) - 70
  const bw = Math.max(...xs) - Math.min(...xs) + 140
  const bh = Math.max(...ys) - Math.min(...ys) + 140
  const r = Math.min(120, bw / 2, bh / 2)
  return `
  <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}"
    height="${bh.toFixed(1)}" rx="${r.toFixed(1)}" fill="${esc(vt.panel)}"
    stroke="${esc(vt.line)}" stroke-width="1.5"/>`
}

// Label with a legibility halo: paint a thick bg stroke under the fill so the
// name reads over land or sea. `anchor` flips the side to keep labels in-frame.
function label(
  text: string,
  x: number,
  y: number,
  vt: VisualTheme,
  size = 26,
  anchor: 'start' | 'end' | 'middle' = 'start'
): string {
  const serif = `${vt.serif}, ${SERIF_FALLBACK}`
  const safe = esc(text)
  const common = `x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${esc(serif)}" font-size="${size}" text-anchor="${anchor}"`
  return `
    <text ${common} fill="none" stroke="${esc(vt.bg)}" stroke-width="6"
      stroke-linejoin="round" paint-order="stroke">${safe}</text>
    <text ${common} fill="${esc(vt.heading)}">${safe}</text>`
}

// Choose a label side/offset that keeps text inside the safe frame.
function labelPlacement(x: number, y: number, chars: number, size: number) {
  const approxW = chars * size * 0.54
  const right = x + 22
  if (right + approxW <= VISUAL_W - PAD) {
    return { lx: right, ly: y + size * 0.34, anchor: 'start' as const }
  }
  return { lx: x - 22, ly: y + size * 0.34, anchor: 'end' as const }
}

// ── Fallback panel (used when < 2 places resolve) ─────────────────────────────
function fallbackPanel(
  items: Array<{ name: string; note?: string }>,
  eyebrow: string,
  title: string,
  vt: VisualTheme
): string {
  const serif = `${vt.serif}, ${SERIF_FALLBACK}`
  const sans = `${vt.sans}, ${SANS_FALLBACK}`
  const x = PAD
  const y = PAD + 150
  const rowH = 76
  const rows = items.slice(0, 7).map((it, i) => {
    const cy = y + i * rowH
    const noteText = it.note ? wrap(it.note, 64)[0] : ''
    const note = noteText
      ? `<text x="${x + 56}" y="${cy + 30}" font-family="${esc(sans)}" font-size="20"
          fill="${esc(vt.inkMuted)}">${esc(noteText)}</text>`
      : ''
    return `
    <g>
      <circle cx="${x + 18}" cy="${cy}" r="9" fill="${esc(vt.accent)}"
        stroke="${esc(vt.bg)}" stroke-width="3"/>
      <text x="${x + 56}" y="${cy + 8}" font-family="${esc(serif)}" font-size="28"
        fill="${esc(vt.heading)}">${esc(it.name)}</text>
      ${note}
    </g>`
  })
  return `<svg viewBox="0 0 ${VISUAL_W} ${VISUAL_H}" xmlns="http://www.w3.org/2000/svg">
  ${defs(vt)}
  ${frame(vt)}
  ${header(eyebrow, title, vt)}
  <rect x="${x - 30}" y="${PAD + 110}" width="${VISUAL_W - (x - 30) * 2}"
    height="${VISUAL_H - (PAD + 110) - PAD}" rx="14" fill="${esc(vt.panel)}"
    stroke="${esc(vt.line)}" stroke-width="1.5"/>
  ${rows.join('')}
</svg>`
}

// ── Public: place map ─────────────────────────────────────────────────────────
/**
 * A labeled biblical place map. Resolves each name against the gazetteer,
 * auto-frames the known points, and draws accent markers with haloed labels.
 * If fewer than 2 places resolve, renders a clean labeled marker-list panel.
 */
export function mapSvg(
  places: Array<{ name: string; note?: string }>,
  vt: VisualTheme
): string {
  const resolved: Resolved[] = []
  for (const p of places || []) {
    const hit = lookup(p.name)
    if (hit) resolved.push({ name: p.name, note: p.note, lat: hit.lat, lng: hit.lng })
  }

  if (resolved.length < 2) {
    return fallbackPanel(places || [], 'Map', 'Places', vt)
  }

  const project = makeProjector(resolved)
  const pts = resolved.map((r) => ({ ...r, ...project(r.lat, r.lng) }))
  const sans = `${vt.sans}, ${SANS_FALLBACK}`

  const markers = pts
    .map((p) => {
      const place = labelPlacement(p.x, p.y, p.name.length, 26)
      const note =
        p.note && wrap(p.note, 40)[0]
          ? `<text x="${place.lx.toFixed(1)}" y="${(place.ly + 26).toFixed(1)}"
              text-anchor="${place.anchor}" font-family="${esc(sans)}" font-size="18"
              fill="${esc(vt.inkMuted)}">${esc(wrap(p.note, 40)[0])}</text>`
          : ''
      return `
    <g>
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="14"
        fill="${esc(vt.accent)}" stroke="${esc(vt.bg)}" stroke-width="4"/>
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5"
        fill="${esc(vt.bg)}"/>
      ${label(p.name, place.lx, place.ly, vt, 26, place.anchor)}
      ${note}
    </g>`
    })
    .join('')

  return `<svg viewBox="0 0 ${VISUAL_W} ${VISUAL_H}" xmlns="http://www.w3.org/2000/svg">
  ${defs(vt)}
  ${frame(vt)}
  ${landBlob(pts, vt)}
  ${header('Map', 'Places of the Text', vt)}
  ${markers}
</svg>`
}

// ── Public: journey route ─────────────────────────────────────────────────────
/**
 * An ordered journey route: same calm base, but an accent path (gentle curve)
 * threads the stops in order with an arrowhead, numbered waypoint badges, and
 * haloed labels. Falls back to a marker-list panel if < 2 stops resolve.
 */
export function routeSvg(
  stops: Array<{ name: string; order: number; note?: string }>,
  vt: VisualTheme
): string {
  const ordered = [...(stops || [])].sort((a, b) => a.order - b.order)
  const resolved: Resolved[] = []
  for (const s of ordered) {
    const hit = lookup(s.name)
    if (hit) resolved.push({ name: s.name, note: s.note, order: s.order, lat: hit.lat, lng: hit.lng })
  }

  if (resolved.length < 2) {
    return fallbackPanel(ordered, 'Journey', 'Route', vt)
  }

  const project = makeProjector(resolved)
  const pts = resolved.map((r) => ({ ...r, ...project(r.lat, r.lng) }))
  const sans = `${vt.sans}, ${SANS_FALLBACK}`

  // Build a gently curved path through the waypoints (quadratic midpoints).
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    // Perpendicular bow for a hand-drawn feel; small and consistent.
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const bow = Math.min(36, len * 0.12)
    const cx = mx + (-dy / len) * bow
    const cy = my + (dx / len) * bow
    d += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`
  }

  const path = `
    <path d="${d}" fill="none" stroke="${esc(vt.accent)}" stroke-width="2.5"
      stroke-linecap="round" stroke-linejoin="round"
      marker-end="url(#atlasArrow)"/>`

  const badges = pts
    .map((p, i) => {
      const n = i + 1
      const place = labelPlacement(p.x, p.y, p.name.length, 26)
      const note =
        p.note && wrap(p.note, 40)[0]
          ? `<text x="${place.lx.toFixed(1)}" y="${(place.ly + 26).toFixed(1)}"
              text-anchor="${place.anchor}" font-family="${esc(sans)}" font-size="18"
              fill="${esc(vt.inkMuted)}">${esc(wrap(p.note, 40)[0])}</text>`
          : ''
      return `
    <g>
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="17"
        fill="${esc(vt.accent)}" stroke="${esc(vt.bg)}" stroke-width="4"/>
      <text x="${p.x.toFixed(1)}" y="${(p.y + 7).toFixed(1)}" text-anchor="middle"
        font-family="${esc(sans)}" font-size="20" font-weight="600"
        fill="${esc(vt.bg)}">${n}</text>
      ${label(p.name, place.lx, place.ly, vt, 26, place.anchor)}
      ${note}
    </g>`
    })
    .join('')

  return `<svg viewBox="0 0 ${VISUAL_W} ${VISUAL_H}" xmlns="http://www.w3.org/2000/svg">
  ${defs(vt)}
  ${frame(vt)}
  ${landBlob(pts, vt)}
  ${header('Journey', 'The Route Traced', vt)}
  ${path}
  ${badges}
</svg>`
}
