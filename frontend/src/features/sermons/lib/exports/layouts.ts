import type PptxGenJS from 'pptxgenjs'
import type { SlideSpec } from '../../types'
import { isProgrammatic } from '../visuals'
import { mix } from '../visuals/theme'
import {
  W, H, MARGIN, INK_LIGHT, colX, colSpan,
  type DeckCtx, sizeFor, inkOn, mutedOn,
  rect, fullBleed, framedImage, panel, kicker, accentRule, footer, cornerMarks, newSlide,
} from './deck'

// Each slide receives a resolved visual: `main` is the foreground/hero image or
// programmatic composition (already gradient-baked for hero layouts), and `bg`
// is a soft washed background image placed behind content. Gradients are baked
// into the pixels (no hard scrim rectangles), so images and text never collide
// and every slide can carry imagery.
export interface SlideVisual {
  main: string | null
  bg: string | null
}

const dateLabel = () => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

// Drop a leading "1. " / "2) " / "3 - " enumerator when a separate number
// badge already shows the count (prevents "01  1. The Handover").
const stripLeadNum = (s: string) => (s ?? '').replace(/^\s*\d+\s*[.)\-:]\s+/, '').trim()

// Estimate the rendered height (inches) of a wrapped text block, for vertical
// centering inside fixed panels so sparse content doesn't leave empty boxes.
function estLines(text: string, fontPt: number, boxWin: number): number {
  if (!text?.trim()) return 0
  // Conservative inch-per-char for a proportional serif (word-boundary wrapping
  // wastes the tail of each line, so a too-small constant undercounts lines and
  // overflows the panel). Rounded up rather than down for the same reason.
  const charW = fontPt * 0.0095
  const perLine = Math.max(6, Math.floor(boxWin / charW))
  return Math.max(1, Math.ceil(text.length / perLine))
}

function bodyText(slide: PptxGenJS.Slide, c: DeckCtx, lines: string[], x: number, y: number, w: number, h: number, color: string, size = 18, align: 'left' | 'center' = 'left') {
  if (!lines?.length) return
  slide.addText(
    lines.map((t) => ({ text: t, options: { breakLine: true, paraSpaceAfter: 8 } })),
    { x, y, w, h, fontSize: size, color, fontFace: c.sans, align, valign: 'top', lineSpacingMultiple: 1.28, fit: 'shrink' }
  )
}

// On a washed background image, text is off-white; on a solid theme bg, use the
// theme's own contrast-safe ink. `bg` decides which.
const onBgInk = (c: DeckCtx, bg: string | null) => (bg ? INK_LIGHT : inkOn(c.t.bg))
const onBgMuted = (c: DeckCtx, bg: string | null) => (bg ? 'D8D2C4' : mutedOn(c.t.bg))

// ── Programmatic full-composition slides (the visual IS the slide) ──────────

function scriptureArtSlide(c: DeckCtx, spec: SlideSpec, visual: string): PptxGenJS.Slide {
  const s = newSlide(c, c.vt.bgDeep)
  s.addImage({ data: visual, x: 0, y: 0, w: W, h: H, sizing: { type: 'contain', w: W, h: H } })
  footer(c, s, spec.kicker || 'Scripture')
  return s
}

function featureVisualSlide(c: DeckCtx, spec: SlideSpec, visual: string): PptxGenJS.Slide {
  const s = newSlide(c)
  const ink = inkOn(c.t.bg)
  if (spec.kicker) kicker(c, s, MARGIN, 0.55, 8, spec.kicker)
  s.addText(spec.heading, { x: MARGIN, y: 0.95, w: W - MARGIN * 2, h: 0.9, fontSize: sizeFor(spec.heading, [[40, 30], [70, 26]], 22), color: ink, fontFace: c.serif, bold: true })
  accentRule(c, s, MARGIN, 1.85, 0.9)
  s.addImage({ data: visual, x: MARGIN, y: 2.05, w: W - MARGIN * 2, h: 4.7, sizing: { type: 'contain', w: W - MARGIN * 2, h: 4.7 } })
  footer(c, s, spec.kicker || spec.heading)
  return s
}

// ── Scene-image & text layouts ──────────────────────────────────────────────

function coverSlide(c: DeckCtx, spec: SlideSpec, v: SlideVisual, closing = false): PptxGenJS.Slide {
  const s = newSlide(c, c.vt.bgDeep)
  if (v.main) fullBleed(c, s, v.main) // gradient baked (heroBottom)
  else { rect(c, s, 0, 0, W, H, c.t.bg); rect(c, s, 0, H - 2.6, W, 2.6, c.t.bgAlt, 18) }
  cornerMarks(c, s)
  const x = MARGIN + 0.3
  const heading = spec.heading?.trim() || spec.subheading?.trim() || 'Sermon'
  if (spec.kicker) kicker(c, s, x, closing ? 4.1 : 4.35, 9, spec.kicker, c.accent)
  accentRule(c, s, x, closing ? 4.5 : 4.75, 0.95)
  s.addText(heading, { x, y: closing ? 4.7 : 4.95, w: W - x - MARGIN, h: 1.5, fontSize: sizeFor(heading, [[20, 46], [40, 38], [70, 30]], 26), color: INK_LIGHT, fontFace: c.serif, bold: true, valign: 'top' })
  if (spec.subheading && spec.subheading.trim() !== heading) s.addText(spec.subheading, { x, y: closing ? 6.2 : 6.45, w: W - x - MARGIN, h: 0.5, fontSize: 16, color: 'E8E3D6', fontFace: c.sans, italic: true })
  if (spec.reference && !closing) s.addText(spec.reference, { x, y: spec.subheading ? 6.9 : 6.5, w: 9, h: 0.4, fontSize: 14, color: c.accent, fontFace: c.serif, italic: true })
  s.addText(dateLabel(), { x: W - MARGIN - 3.5, y: H - 0.62, w: 3.5, h: 0.35, fontSize: 11, color: 'CBD3E0', fontFace: c.sans, align: 'right' })
  return s
}

function fullBleedCaptionSlide(c: DeckCtx, spec: SlideSpec, v: SlideVisual): PptxGenJS.Slide {
  const s = newSlide(c, c.vt.bgDeep)
  if (v.main) fullBleed(c, s, v.main)
  else rect(c, s, 0, 0, W, H, c.t.bgAlt)
  const phrase = spec.heading?.trim() || spec.subheading?.trim() || ''
  if (spec.kicker) kicker(c, s, MARGIN + 0.3, 4.85, 8, spec.kicker, c.accent)
  s.addText(phrase, { x: MARGIN + 0.3, y: 5.25, w: W - MARGIN * 2 - 0.6, h: 1.1, fontSize: sizeFor(phrase, [[40, 34], [80, 28]], 24), color: INK_LIGHT, fontFace: c.serif, italic: true, valign: 'top' })
  footer(c, s, spec.kicker || '')
  return s
}

function splitSlide(c: DeckCtx, spec: SlideSpec, v: SlideVisual): PptxGenJS.Slide {
  const s = newSlide(c)
  if (v.bg) fullBleed(c, s, v.bg) // subtle washed backdrop behind everything
  const right = spec.imageSide !== 'left'
  const hasImg = !!v.main
  const heading = spec.heading?.trim() || spec.kicker?.trim() || ''
  const panelW = 5.2
  const ink = onBgInk(c, v.bg)
  const muted = onBgMuted(c, v.bg)
  if (hasImg) {
    const ix = right ? W - panelW : 0
    s.addImage({ data: v.main!, x: ix, y: 0, w: panelW, h: H, sizing: { type: 'cover', w: panelW, h: H } })
    rect(c, s, right ? ix : panelW - 0.03, 0, 0.03, H, c.accent)
  }
  const tx = hasImg && right ? MARGIN : hasImg ? panelW + 0.6 : MARGIN
  const tw = hasImg ? W - panelW - 0.6 - MARGIN : W - MARGIN * 2
  if (spec.kicker) kicker(c, s, tx, 1.35, tw, spec.kicker)
  if (heading) s.addText(heading, { x: tx, y: 1.75, w: tw, h: 1.5, fontSize: sizeFor(heading, [[36, 32], [64, 27]], 22), color: ink, fontFace: c.serif, bold: true, valign: 'top' })
  accentRule(c, s, tx, 3.25, 0.8)
  bodyText(s, c, spec.body ?? [], tx, 3.55, tw, 2.9, muted, sizeFor((spec.body ?? []).join(' '), [[180, 19], [320, 17]], 15))
  footer(c, s, spec.heading)
  return s
}

function figureSlide(c: DeckCtx, spec: SlideSpec, v: SlideVisual): PptxGenJS.Slide {
  if (!v.main) return splitSlide(c, spec, v)
  const s = newSlide(c)
  if (v.bg) fullBleed(c, s, v.bg) // blurred-dark backdrop of the same scene
  const ink = onBgInk(c, v.bg)
  const muted = onBgMuted(c, v.bg)
  const right = spec.imageSide !== 'left'
  const imgW = 5.4, imgH = 4.3
  const imgX = right ? W - MARGIN - imgW : MARGIN
  const imgY = (H - imgH) / 2 - 0.1
  framedImage(c, s, v.main, imgX, imgY, imgW, imgH, spec.visual.spec)
  const tx = right ? MARGIN : imgX + imgW + 0.7
  const tw = W - imgW - MARGIN * 2 - 0.7
  if (spec.kicker) kicker(c, s, tx, 1.5, tw, spec.kicker)
  s.addText(spec.heading, { x: tx, y: 1.9, w: tw, h: 1.5, fontSize: sizeFor(spec.heading, [[36, 30], [64, 25]], 21), color: ink, fontFace: c.serif, bold: true, valign: 'top' })
  accentRule(c, s, tx, 3.35, 0.8)
  bodyText(s, c, spec.body ?? [], tx, 3.65, tw, 2.9, muted, sizeFor((spec.body ?? []).join(' '), [[160, 18], [300, 16]], 14))
  footer(c, s, spec.heading)
  return s
}

function showcaseSlide(c: DeckCtx, spec: SlideSpec, v: SlideVisual): PptxGenJS.Slide {
  if (!v.main) return fullBleedCaptionSlide(c, spec, v)
  const s = newSlide(c)
  if (v.bg) fullBleed(c, s, v.bg)
  const ink = onBgInk(c, v.bg)
  if (spec.kicker) kicker(c, s, MARGIN, 0.55, 9, spec.kicker, v.bg ? c.accent : c.accentText, 'center')
  s.addText(spec.heading?.trim() || spec.subheading?.trim() || '', { x: MARGIN, y: 0.9, w: W - MARGIN * 2, h: 0.85, fontSize: sizeFor(spec.heading, [[35, 26], [70, 22]], 18), color: ink, fontFace: c.serif, bold: true, align: 'center', valign: 'top' })
  const imgW = 8.4, imgH = 4.15
  framedImage(c, s, v.main, (W - imgW) / 2, 1.95, imgW, imgH, spec.visual.spec || spec.subheading)
  footer(c, s, spec.heading)
  return s
}

function scriptureSlide(c: DeckCtx, spec: SlideSpec, v: SlideVisual): PptxGenJS.Slide {
  if (v.main) return scriptureArtSlide(c, spec, v.main)
  const s = newSlide(c, c.vt.bgDeep)
  if (v.bg) fullBleed(c, s, v.bg)
  s.addText('“', { x: 0.5, y: 0.2, w: 3, h: 2.4, fontSize: 200, color: c.softAccent, fontFace: c.serif, bold: true })
  const verse = spec.heading?.trim() || spec.subheading?.trim() || spec.reference || 'Scripture'
  s.addText(verse, { x: 1.6, y: 1.9, w: W - 3.2, h: 3.4, fontSize: sizeFor(verse, [[120, 30], [240, 24]], 20), color: INK_LIGHT, fontFace: c.serif, italic: true, align: 'center', valign: 'middle', lineSpacingMultiple: 1.3 })
  accentRule(c, s, W / 2 - 0.45, 5.6, 0.9)
  if (spec.reference) s.addText(spec.reference.toUpperCase(), { x: 1, y: 5.85, w: W - 2, h: 0.5, fontSize: 15, color: c.accent, fontFace: c.sans, align: 'center', charSpacing: 4, bold: true })
  footer(c, s, spec.kicker || 'Scripture')
  return s
}

function bigStatSlide(c: DeckCtx, spec: SlideSpec, v: SlideVisual): PptxGenJS.Slide {
  const s = newSlide(c, v.main ? c.vt.bgDeep : c.t.bg)
  if (v.main) fullBleed(c, s, v.main) // wash baked
  const onImg = !!v.main
  const ink = onImg ? INK_LIGHT : inkOn(c.t.bg)
  const muted = onImg ? 'D8D2C4' : mutedOn(c.t.bg)
  if (spec.kicker) kicker(c, s, MARGIN + 0.2, 1.6, 9, spec.kicker, onImg ? c.accent : c.accentText)
  const value = spec.stat?.value ?? spec.heading
  const hasBody = !!spec.body?.[0]?.trim()
  s.addText(value, { x: MARGIN, y: 2.0, w: W - MARGIN * 2, h: 2.7, fontSize: sizeFor(value, [[3, 150], [6, 120], [14, 80], [28, 50]], 34), color: onImg ? c.accent : c.accentText, fontFace: c.serif, bold: true, valign: 'top' })
  s.addText(spec.stat?.label ?? spec.subheading ?? spec.heading, { x: MARGIN + 0.2, y: 4.85, w: W - MARGIN * 2, h: 0.9, fontSize: 22, color: ink, fontFace: c.serif, valign: 'top' })
  if (hasBody) s.addText(spec.body![0], { x: MARGIN + 0.2, y: 5.6, w: W - MARGIN * 2, h: 0.7, fontSize: 16, color: muted, fontFace: c.sans, valign: 'top' })
  footer(c, s, spec.heading)
  return s
}

function bentoSlide(c: DeckCtx, spec: SlideSpec, v: SlideVisual): PptxGenJS.Slide {
  const s = newSlide(c)
  if (v.bg) fullBleed(c, s, v.bg)
  const ink = onBgInk(c, v.bg)
  if (spec.kicker) kicker(c, s, MARGIN, 0.6, 9, spec.kicker, v.bg ? c.accent : c.accentText)
  s.addText(spec.heading, { x: MARGIN, y: 0.95, w: W - MARGIN * 2, h: 0.8, fontSize: sizeFor(spec.heading, [[36, 30], [60, 26]], 22), color: ink, fontFace: c.serif, bold: true })
  const items = (spec.body ?? []).slice(0, 5).map(stripLeadNum).filter(Boolean)
  // Tiles get a SOLID panel so they read over any background.
  const tileBg = c.t.mode === 'dark' ? mix(c.t.panel, '#000000', 0.1) : c.t.panel
  const tileInk = inkOn(tileBg)
  const tileMuted = mutedOn(tileBg)
  const numCol = inkOn(tileBg) === INK_LIGHT ? c.accent : c.accentText
  const top = 2.1, gridH = 4.5
  const heroW = colSpan(6)
  const rest = items.slice(1)
  if (items[0]) {
    panel(c, s, colX(1), top, heroW, gridH, tileBg, 0)
    // Center the number + item as a group inside the hero tile.
    const nLines = estLines(items[0], 22, heroW - 0.7)
    const gH = 0.8 + nLines * 0.42
    const sy = top + Math.max(0.4, (gridH - gH) / 2)
    s.addText('01', { x: colX(1) + 0.35, y: sy, w: 1.5, h: 0.6, fontSize: 26, color: numCol, fontFace: c.serif, bold: true })
    s.addText(items[0], { x: colX(1) + 0.35, y: sy + 0.75, w: heroW - 0.7, h: gridH - (sy - top) - 0.75, fontSize: sizeFor(items[0], [[80, 24], [160, 20]], 17), color: tileInk, fontFace: c.serif, valign: 'top', lineSpacingMultiple: 1.2, fit: 'shrink' })
  }
  const rx = colX(7), rw = colSpan(6)
  const rh = rest.length ? (gridH - (rest.length - 1) * 0.18) / rest.length : gridH
  rest.forEach((it, i) => {
    const y = top + i * (rh + 0.18)
    panel(c, s, rx, y, rw, rh, tileBg, 0)
    // Number and text both vertically centered in the tile, aligned as a row.
    s.addText(String(i + 2).padStart(2, '0'), { x: rx + 0.3, y, w: 0.85, h: rh, fontSize: 16, color: numCol, fontFace: c.serif, bold: true, valign: 'middle' })
    s.addText(it, { x: rx + 1.2, y, w: rw - 1.45, h: rh, fontSize: sizeFor(it, [[70, 16], [130, 14]], 12.5), color: tileMuted, fontFace: c.sans, valign: 'middle', lineSpacingMultiple: 1.15 })
  })
  footer(c, s, spec.heading)
  return s
}

function threeColSlide(c: DeckCtx, spec: SlideSpec, v: SlideVisual): PptxGenJS.Slide {
  const s = newSlide(c)
  if (v.bg) fullBleed(c, s, v.bg)
  const ink = onBgInk(c, v.bg)
  const muted = onBgMuted(c, v.bg)
  const acc = v.bg ? c.accent : c.accentText
  if (spec.kicker) kicker(c, s, MARGIN, 0.7, 9, spec.kicker, acc, 'center')
  s.addText(spec.heading, { x: MARGIN, y: 1.05, w: W - MARGIN * 2, h: 0.8, fontSize: sizeFor(spec.heading, [[40, 28], [70, 24]], 20), color: ink, fontFace: c.serif, bold: true, align: 'center' })
  const cols = (spec.body ?? []).slice(0, 3).map(stripLeadNum)
  const cw = colSpan(4)
  cols.forEach((text, i) => {
    const x = colX(1 + i * 4)
    s.addText(String(i + 1), { x, y: 2.5, w: cw, h: 0.9, fontSize: 40, color: acc, fontFace: c.serif, bold: true, align: 'center' })
    accentRule(c, s, x + cw / 2 - 0.3, 3.45, 0.6)
    s.addText(text, { x, y: 3.7, w: cw, h: 2.6, fontSize: sizeFor(text, [[90, 18], [170, 16]], 14), color: muted, fontFace: c.sans, align: 'center', valign: 'middle', lineSpacingMultiple: 1.25 })
  })
  footer(c, s, spec.heading)
  return s
}

function timelineSlide(c: DeckCtx, spec: SlideSpec, v: SlideVisual): PptxGenJS.Slide {
  if (v.main) return featureVisualSlide(c, spec, v.main)
  const s = newSlide(c)
  if (v.bg) fullBleed(c, s, v.bg)
  const ink = onBgInk(c, v.bg)
  if (spec.kicker) kicker(c, s, MARGIN, 0.6, 9, spec.kicker, v.bg ? c.accent : c.accentText)
  s.addText(spec.heading, { x: MARGIN, y: 0.95, w: W - MARGIN * 2, h: 0.8, fontSize: 26, color: ink, fontFace: c.serif, bold: true })
  bodyText(s, c, spec.body ?? [], MARGIN + 0.4, 2.2, W - MARGIN * 2 - 0.4, 4.5, onBgMuted(c, v.bg), 18)
  footer(c, s, spec.heading)
  return s
}

function pullQuoteSlide(c: DeckCtx, spec: SlideSpec, v: SlideVisual): PptxGenJS.Slide {
  const s = newSlide(c, c.vt.bgDeep)
  if (v.bg) fullBleed(c, s, v.bg)
  else rect(c, s, 0, 0, W, H, c.t.bgAlt)
  s.addText('“', { x: 0.5, y: 0.55, w: 3, h: 2.2, fontSize: 220, color: c.softAccent, fontFace: c.serif, bold: true, valign: 'top' })
  const quote = spec.heading?.trim() || spec.subheading?.trim() || ''
  const qlen = quote.length
  s.addText(quote, { x: 0.9, y: 2.0, w: 11.5, h: 3.0, fontSize: sizeFor(quote, [[60, 40], [120, 32], [200, 26]], 22), color: INK_LIGHT, fontFace: c.serif, italic: qlen < 120, valign: 'middle', lineSpacingMultiple: 1.3 })
  if (spec.reference) s.addText(`— ${spec.reference}`, { x: 0.9, y: 5.35, w: 8, h: 0.45, fontSize: 15, color: c.accent, fontFace: c.sans })
  footer(c, s, spec.kicker || '')
  return s
}

function twoUpSlide(c: DeckCtx, spec: SlideSpec, v: SlideVisual): PptxGenJS.Slide {
  const s = newSlide(c)
  if (v.bg) fullBleed(c, s, v.bg)
  const ink = onBgInk(c, v.bg)
  if (spec.kicker) kicker(c, s, MARGIN, 0.6, 9, spec.kicker, v.bg ? c.accent : c.accentText, 'center')
  s.addText(spec.heading, { x: MARGIN, y: 0.95, w: W - MARGIN * 2, h: 0.7, fontSize: 24, color: ink, fontFace: c.serif, bold: true, align: 'center' })
  const halfW = colSpan(6)
  const lx = colX(1), rxx = colX(7)
  const lighter = mix(c.t.panel, '#ffffff', c.t.mode === 'dark' ? 0.16 : 0.55)
  const darker = c.t.mode === 'dark' ? c.t.bgAlt : mix(c.t.bgAlt, '#000000', 0.12)
  const panelY = 2.0, panelH = 4.5
  panel(c, s, lx, panelY, halfW, panelH, lighter, 0)
  panel(c, s, rxx, panelY, halfW, panelH, darker, 0)
  rect(c, s, W / 2 - 0.01, panelY, 0.02, panelH, c.accent)
  const lines = spec.body ?? []
  const mid = Math.ceil(lines.length / 2)

  // Vertically center the header + body group inside each panel.
  const col = (px: number, header: string, items: string[], bgHex: string) => {
    const bodyStr = items.join('  ')
    const nLines = estLines(bodyStr, 16, halfW - 0.8)
    const groupH = 0.65 + nLines * 0.33
    const startY = panelY + Math.max(0.35, (panelH - groupH) / 2)
    s.addText(header, { x: px + 0.4, y: startY, w: halfW - 0.8, h: 0.55, fontSize: 20, color: inkOn(bgHex), fontFace: c.serif, bold: true })
    bodyText(s, c, items, px + 0.4, startY + 0.7, halfW - 0.8, panelH - 1.2, mutedOn(bgHex), 16)
  }
  col(lx, spec.subheading?.split('|')[0] ?? 'Before', lines.slice(0, mid), lighter)
  col(rxx, spec.subheading?.split('|')[1] ?? 'After', lines.slice(mid), darker)
  footer(c, s, spec.heading)
  return s
}

function sectionDividerSlide(c: DeckCtx, spec: SlideSpec, v: SlideVisual, index: number): PptxGenJS.Slide {
  const s = newSlide(c, c.t.bgAlt)
  if (v.main) fullBleed(c, s, v.main) // heroLeft gradient baked
  const num = String(index).padStart(2, '0')
  s.addText(num, { x: W - 4.9, y: 0.9, w: 4.7, h: 5.2, fontSize: 280, color: c.softAccent, fontFace: c.serif, bold: true, align: 'right' })
  rect(c, s, 0, 0, 0.18, H, c.accent)
  if (spec.kicker) kicker(c, s, MARGIN + 0.1, 2.7, 9, spec.kicker, c.accent)
  accentRule(c, s, MARGIN + 0.15, 3.15, 0.9)
  s.addText(spec.heading?.trim() || spec.kicker?.trim() || '', { x: MARGIN + 0.1, y: 3.4, w: 7.0, h: 1.8, fontSize: sizeFor(spec.heading, [[30, 40], [60, 32]], 26), color: INK_LIGHT, fontFace: c.serif, bold: true, valign: 'top' })
  footer(c, s, spec.heading)
  return s
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

export function renderSlide(c: DeckCtx, spec: SlideSpec, v: SlideVisual, sectionIndex: number): PptxGenJS.Slide {
  if (spec.visual.type === 'scriptureArt' && v.main) return scriptureArtSlide(c, spec, v.main)
  if (isProgrammatic(spec.visual.type) && v.main) return featureVisualSlide(c, spec, v.main)

  switch (spec.layout) {
    case 'cover': return coverSlide(c, spec, v)
    case 'closing': return coverSlide(c, spec, v, true)
    case 'fullBleedCaption': return fullBleedCaptionSlide(c, spec, v)
    case 'figure': return figureSlide(c, spec, v)
    case 'showcase': return showcaseSlide(c, spec, v)
    case 'scripture': return scriptureSlide(c, spec, v)
    case 'bigStat': return bigStatSlide(c, spec, v)
    case 'bento': return bentoSlide(c, spec, v)
    case 'threeCol': return threeColSlide(c, spec, v)
    case 'timelineSlide': return timelineSlide(c, spec, v)
    case 'pullQuote': return pullQuoteSlide(c, spec, v)
    case 'twoUp': return twoUpSlide(c, spec, v)
    case 'sectionDivider': return sectionDividerSlide(c, spec, v, sectionIndex)
    case 'split':
    default: return splitSlide(c, spec, v)
  }
}
