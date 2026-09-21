import { getTheme, type ExportTheme } from '../sermon/templates'

// Color tokens consumed by the programmatic SVG visual generators. Derived
// once from an ExportTheme so maps, timelines, diagrams, and scripture cards
// all share the deck's palette and read as one cohesive, hand-made set.
export interface VisualTheme {
  mode: 'dark' | 'light'
  bg: string       // visual canvas background (panel-like)
  bgDeep: string   // deeper background for vignettes / map sea
  panel: string    // raised card / land fill
  accent: string   // single accent (lines, markers, numerals)
  accentSoft: string
  ink: string      // primary text on bg
  inkMuted: string // secondary text
  heading: string  // headings on bg
  line: string     // hairlines / connectors
  serif: string
  sans: string
}

function hash(hex: string): string {
  return hex.startsWith('#') ? hex : `#${hex}`
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

/** rgba() string from a bare/hashed hex + alpha 0..1 — for soft fills/halos. */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

/** Linear mix of two hex colors, t in 0..1 (0 = a, 1 = b). */
export function mix(aHex: string, bHex: string, t: number): string {
  const a = hexToRgb(aHex)
  const b = hexToRgb(bHex)
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export function getVisualTheme(themeOrId: ExportTheme | string | null | undefined): VisualTheme {
  const t = typeof themeOrId === 'string' || themeOrId == null ? getTheme(themeOrId as string) : themeOrId
  const dark = t.mode === 'dark'
  return {
    mode: t.mode,
    bg: hash(t.panel),
    bgDeep: hash(t.bgAlt),
    panel: dark ? mix(t.panel, '#ffffff', 0.06) : mix(t.panel, '#ffffff', 0.5),
    accent: hash(t.accent),
    accentSoft: rgba(t.accent, 0.18),
    ink: hash(t.text),
    inkMuted: hash(t.textMuted),
    heading: hash(t.heading),
    line: dark ? rgba('#ffffff', 0.16) : rgba('#000000', 0.14),
    serif: t.serif,
    sans: t.sans,
  }
}
