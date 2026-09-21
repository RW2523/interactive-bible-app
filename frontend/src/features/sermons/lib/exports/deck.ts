import type PptxGenJS from 'pptxgenjs'
import type { ExportTheme } from '../sermon/templates'
import { luminance } from '../sermon/templates'
import { getVisualTheme, mix, type VisualTheme } from '../visuals/theme'

// Shared deck context: the 13.33x7.5in / 12-column / 8pt grid, a contrast-safe
// color resolver, length-aware type sizing, and the reusable slide primitives
// (scrims, kickers, rules, footers, corner marks) that every layout composes.
// One place owns spacing and color so the deck reads as a single hand.

export const W = 13.33
export const H = 7.5
export const MARGIN = 0.7
export const GUTTER = 0.22
export const COLW = (W - MARGIN * 2 - GUTTER * 11) / 12
export const INK_LIGHT = 'F7F5EF' // editorial off-white (never pure #fff)

/** Left x of column n (1-based) on the 12-col grid. */
export function colX(n: number): number {
  return MARGIN + (n - 1) * (COLW + GUTTER)
}
/** Width spanning `span` columns starting at column n. */
export function colSpan(span: number): number {
  return span * COLW + (span - 1) * GUTTER
}

export type Surface = 'dark' | 'light' | 'scrim' | 'panel' | 'accent'
export type TextRole = 'display' | 'heading' | 'body' | 'caption' | 'kicker'

export interface DeckCtx {
  pptx: PptxGenJS
  t: ExportTheme
  vt: VisualTheme
  serif: string
  sans: string
  /** accent for FILLS (rules, seams, markers) — branded hue. */
  accent: string
  /** accent for small TEXT (kickers, numerals) — darkened on light themes so
   *  it meets WCAG AA against light backgrounds. */
  accentText: string
  /** muted accent as a SOLID hex (pptxgenjs colors must be 6-hex, not rgba) —
   *  for large ornamental glyphs/numerals behind text. */
  softAccent: string
  /** ink color for the given surface (contrast-safe). */
  ink(surface: Surface): string
  /** muted/secondary ink for the given surface. */
  inkMuted(surface: Surface): string
  slideNo: number
}

export function createDeck(pptx: PptxGenJS, t: ExportTheme): DeckCtx {
  const vt = getVisualTheme(t)
  return {
    pptx, t, vt,
    serif: t.serif, sans: t.sans, accent: t.accent,
    accentText: t.mode === 'light' ? mix(t.accent, '#000000', 0.35).replace('#', '') : t.accent,
    softAccent: mix(t.accent, t.bgAlt, 0.7).replace('#', ''),
    slideNo: 0,
    ink(surface: Surface): string {
      if (surface === 'scrim') return INK_LIGHT
      if (surface === 'accent') return luminance(t.accent) > 0.45 ? '20160B' : INK_LIGHT
      if (surface === 'light') return t.mode === 'light' ? t.heading : '20160B'
      if (surface === 'panel') return luminance(t.panel) > 0.45 ? '241B10' : INK_LIGHT
      return t.mode === 'light' ? t.heading : INK_LIGHT // dark surface
    },
    inkMuted(surface: Surface): string {
      if (surface === 'light') return t.mode === 'light' ? t.textMuted : '5F5648'
      if (surface === 'scrim') return 'D8D2C4'
      return t.textMuted
    },
  }
}

/** Readable ink for any background color (WCAG luminance). Off-white on dark,
 *  warm near-black on light — never pure #fff/#000. */
export function inkOn(bgHex: string): string {
  return luminance(bgHex) > 0.45 ? '241B10' : INK_LIGHT
}
/** Secondary/muted ink for any background color. */
export function mutedOn(bgHex: string): string {
  return luminance(bgHex) > 0.45 ? '6B5E48' : 'C4CBD8'
}

/** Pick a font size from [maxLen, size] tiers based on text length. */
export function sizeFor(text: string, tiers: Array<[number, number]>, fallback: number): number {
  const len = (text ?? '').length
  for (const [maxLen, size] of tiers) if (len <= maxLen) return size
  return fallback
}

// ── Shared slide primitives ────────────────────────────────────────────────

export function rect(c: DeckCtx, slide: PptxGenJS.Slide, x: number, y: number, w: number, h: number, color: string, transparency = 0) {
  slide.addShape(c.pptx.ShapeType.rect, { x, y, w, h, fill: { color, transparency }, line: { type: 'none' } })
}

/** Full-bleed cover image + readability scrim, anchored to where text sits. */
export function coverImage(c: DeckCtx, slide: PptxGenJS.Slide, data: string, anchor: 'bottom' | 'full' | 'left' | 'none' = 'bottom') {
  slide.addImage({ data, x: 0, y: 0, w: W, h: H, sizing: { type: 'cover', w: W, h: H } })
  // Image slides always carry off-white text, so the scrim must be DARK even on
  // light themes (a light scrim would leave off-white text unreadable).
  const scrim = c.t.mode === 'dark' ? c.t.bgAlt : mix(c.t.text, '#000000', 0.25).replace('#', '')
  if (anchor === 'full') {
    rect(c, slide, 0, 0, W, H, scrim, 38)
  } else if (anchor === 'bottom') {
    rect(c, slide, 0, 0, W, H, scrim, 34) // base wash
    rect(c, slide, 0, H - 3.4, W, 3.4, scrim, 16) // stronger toward the text
    rect(c, slide, 0, H - 1.7, W, 1.7, scrim, 4)
  } else if (anchor === 'left') {
    rect(c, slide, 0, 0, W, H, scrim, 30)
    rect(c, slide, 0, 0, W * 0.62, H, scrim, 12)
  }
}

/** Place a pre-prepared image full-bleed (its gradient/wash is already baked in
 *  — no scrim rect, so there are no hard seams). */
export function fullBleed(c: DeckCtx, slide: PptxGenJS.Slide, data: string) {
  slide.addImage({ data, x: 0, y: 0, w: W, h: H, sizing: { type: 'cover', w: W, h: H } })
}

/** A FRAMED content image: soft drop shadow, the photo, then a thin gold-tinted
 *  hairline frame — so the image reads as a deliberate object, not a backdrop.
 *  Caption (optional) sits just beneath. */
export function framedImage(c: DeckCtx, slide: PptxGenJS.Slide, data: string, x: number, y: number, w: number, h: number, caption?: string) {
  rect(c, slide, x + 0.07, y + 0.09, w, h, c.t.mode === 'dark' ? '000000' : '6B5E48', 64) // shadow
  slide.addImage({ data, x, y, w, h, sizing: { type: 'cover', w, h } })
  slide.addShape(c.pptx.ShapeType.rect, { x, y, w, h, fill: { color: c.t.bg, transparency: 100 }, line: { color: c.softAccent, width: 1.25 } })
  if (caption?.trim()) {
    slide.addText(caption.trim(), { x, y: y + h + 0.08, w, h: 0.45, fontSize: 11.5, italic: true, color: c.t.mode === 'dark' ? 'C4CBD8' : '6B5E48', fontFace: c.serif, align: 'center' })
  }
}

/** Rounded panel behind a text block (imagePanelHybrid recipe). */
export function panel(c: DeckCtx, slide: PptxGenJS.Slide, x: number, y: number, w: number, h: number, color?: string, transparency = 14) {
  slide.addShape(c.pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.12, fill: { color: color ?? c.t.panel, transparency }, line: { type: 'none' } })
}

export function kicker(c: DeckCtx, slide: PptxGenJS.Slide, x: number, y: number, w: number, text: string, color?: string, align: 'left' | 'center' = 'left') {
  if (!text?.trim()) return
  slide.addText(text.toUpperCase(), { x, y, w, h: 0.34, fontSize: 12.5, color: color ?? c.accentText, fontFace: c.sans, charSpacing: 4, bold: true, align })
}

export function accentRule(c: DeckCtx, slide: PptxGenJS.Slide, x: number, y: number, w = 0.85, thickness = 0.035) {
  rect(c, slide, x, y, w, thickness, c.accent)
}

export function footer(c: DeckCtx, slide: PptxGenJS.Slide, title: string) {
  slide.addText(title, { x: MARGIN, y: H - 0.46, w: 8, h: 0.3, fontSize: 9.5, color: c.inkMuted('dark'), fontFace: c.sans, italic: true })
  slide.addText(String(c.slideNo), { x: W - MARGIN - 0.6, y: H - 0.46, w: 0.6, h: 0.3, fontSize: 9.5, color: c.inkMuted('dark'), fontFace: c.sans, align: 'right' })
}

/** Subtle corner registration marks for an editorial, hand-set feel. */
export function cornerMarks(c: DeckCtx, slide: PptxGenJS.Slide, inset = 0.4, len = 0.5, th = 0.02) {
  const pos: Array<[number, number, boolean, boolean]> = [
    [inset, inset, false, false], [W - inset - len, inset, true, false],
    [inset, H - inset, false, true], [W - inset - len, H - inset, true, true],
  ]
  for (const [x, y, right, bottom] of pos) {
    rect(c, slide, x, bottom ? y - th : y, len, th, c.accent)
    rect(c, slide, right ? x + len - th : x, bottom ? y - len : y, th, len, c.accent)
  }
}

export function newSlide(c: DeckCtx, bg?: string): PptxGenJS.Slide {
  const s = c.pptx.addSlide()
  s.background = { color: bg ?? c.t.bg }
  c.slideNo += 1
  return s
}
