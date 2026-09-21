// Programmatic "featured verse" card — a quiet, high-whitespace slide visual.
// Pure SVG string (1600x900), no external fonts/images. One large low-opacity
// quotation glyph is the only ornament; the verse is auto-sized to its length,
// the reference is tracked-caps in the single accent above a short rule.

import { VISUAL_W, VISUAL_H, esc, wrap } from './svg'
import type { VisualTheme } from './theme'
import { rgba } from './theme'

export function scriptureCardSvg(
  verse: { text: string; reference: string },
  vt: VisualTheme
): string {
  const text = (verse.text || '').trim()
  const reference = (verse.reference || '').trim()

  // Auto-size the verse by length so nothing overflows the 1600x900 frame.
  const len = text.length
  const size = len < 90 ? 64 : len < 180 ? 52 : len < 300 ? 42 : 34
  const measure = len < 90 ? 30 : len < 180 ? 38 : len < 300 ? 46 : 56
  const lineGap = Math.round(size * 1.3)

  let lines = text ? wrap(text, measure) : []
  const cx = VISUAL_W / 2

  // Hard clamp: never let the verse block (plus the reference) exceed the frame.
  // A very long passage is truncated with an ellipsis on the last visible line.
  const maxLines = Math.max(1, Math.floor((VISUAL_H - 320) / lineGap))
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines)
    lines[lines.length - 1] = lines[lines.length - 1].replace(/[.,;:!?\s]+$/, '') + '…'
  }

  // Vertically center the verse block; sit the reference beneath it.
  const blockH = lines.length * lineGap
  const refBlockH = 120
  const totalH = blockH + refBlockH
  const y = Math.round((VISUAL_H - totalH) / 2 + size)

  const verseTspans = lines
    .map((ln, i) => {
      const dy = i === 0 ? 0 : lineGap
      return `<tspan x="${cx}" dy="${dy}">${esc(ln)}</tspan>`
    })
    .join('')

  const lastVerseY = y + (lines.length - 1) * lineGap
  const ruleY = lastVerseY + 70
  const refY = ruleY + 48
  const ruleHalf = 60

  return `<svg viewBox="0 0 ${VISUAL_W} ${VISUAL_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="scVignette" cx="50%" cy="42%" r="78%">
      <stop offset="0%" stop-color="${vt.bg}"/>
      <stop offset="100%" stop-color="${vt.bgDeep}"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="${VISUAL_W}" height="${VISUAL_H}" fill="${vt.bg}"/>
  <rect x="0" y="0" width="${VISUAL_W}" height="${VISUAL_H}" fill="url(#scVignette)"/>

  <text x="118" y="360" font-family="${vt.serif}" font-size="340" font-weight="700"
        fill="${rgba(vt.accent, 0.1)}">“</text>

  <text text-anchor="middle" font-family="${vt.serif}" font-size="${size}"
        font-style="italic" fill="${vt.ink}" y="${y}">${verseTspans}</text>

  <line x1="${cx - ruleHalf}" y1="${ruleY}" x2="${cx + ruleHalf}" y2="${ruleY}"
        stroke="${vt.accent}" stroke-width="2"/>

  <text x="${cx}" y="${refY}" text-anchor="middle" font-family="${vt.sans}"
        font-size="30" letter-spacing="5" fill="${vt.accent}">${esc(reference.toUpperCase())}</text>
</svg>`
}
