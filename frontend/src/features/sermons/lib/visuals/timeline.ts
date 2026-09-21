// Programmatic editorial timeline visual. Renders <=5 events along a calm spine —
// horizontal with alternating above/below labels for <=4 events, or a vertical
// spine on the left third when there are 5. Pure function: returns one
// self-contained 1600x900 SVG string sharing the deck's VisualTheme. No external
// fonts/images, single accent, generous whitespace — part of one hand-made set.

import type { VisualTheme } from './theme'
import { VISUAL_W, VISUAL_H, esc, wrap } from './svg'

type TimelineEvent = { label: string; date?: string; note?: string }

/** Hard-truncate a single line so it never overflows its column. */
function clamp(s: string, max: number): string {
  const t = s.trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

function vignette(vt: VisualTheme): string {
  return `
  <defs>
    <radialGradient id="tlVig" cx="50%" cy="42%" r="78%">
      <stop offset="0%" stop-color="${vt.bg}" stop-opacity="0"/>
      <stop offset="100%" stop-color="${vt.bgDeep}" stop-opacity="0.9"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="${VISUAL_W}" height="${VISUAL_H}" fill="${vt.bg}"/>
  <rect x="0" y="0" width="${VISUAL_W}" height="${VISUAL_H}" fill="url(#tlVig)"/>`
}

function eyebrow(vt: VisualTheme, x: number, y: number): string {
  return `
  <text x="${x}" y="${y}" font-family="${vt.sans}" font-size="20" letter-spacing="4"
    font-weight="600" fill="${vt.accent}">TIMELINE</text>
  <line x1="${x}" y1="${y + 18}" x2="${x + 74}" y2="${y + 18}" stroke="${vt.accent}" stroke-width="2"/>`
}

/** Filled accent dot with a thin bg ring sitting on the spine. */
function node(vt: VisualTheme, cx: number, cy: number): string {
  return `
  <circle cx="${cx}" cy="${cy}" r="11" fill="${vt.bg}"/>
  <circle cx="${cx}" cy="${cy}" r="8" fill="${vt.accent}"/>
  <circle cx="${cx}" cy="${cy}" r="8" fill="none" stroke="${vt.bg}" stroke-width="2.5"/>`
}

function horizontal(events: TimelineEvent[], vt: VisualTheme): string {
  const margin = 90
  const spineY = VISUAL_H / 2 + 8
  const left = margin + 70
  const right = VISUAL_W - margin - 70
  const n = events.length
  const span = right - left
  const step = n > 1 ? span / (n - 1) : 0
  const colW = Math.min(320, n > 1 ? step - 36 : 360)
  const maxChars = Math.max(14, Math.floor(colW / 13))

  const parts: string[] = []
  parts.push(eyebrow(vt, margin, margin + 14))
  parts.push(`<line x1="${left}" y1="${spineY}" x2="${right}" y2="${spineY}" stroke="${vt.line}" stroke-width="2"/>`)

  events.forEach((ev, i) => {
    const cx = n > 1 ? left + step * i : (left + right) / 2
    const above = i % 2 === 0
    parts.push(node(vt, cx, spineY))
    // Tick from spine toward the label block.
    const tickEnd = above ? spineY - 30 : spineY + 30
    parts.push(`<line x1="${cx}" y1="${spineY}" x2="${cx}" y2="${tickEnd}" stroke="${vt.line}" stroke-width="1.5"/>`)

    const tx = cx
    const date = ev.date ? clamp(ev.date, 22) : ''
    const labelLines = wrap(ev.label || '', maxChars).slice(0, 2)
    const noteLines = ev.note ? wrap(ev.note, maxChars + 4).slice(0, 1) : []

    if (above) {
      let y = spineY - 52
      const noteH = noteLines.length ? 28 : 0
      const labelH = labelLines.length * 38
      y = spineY - 52 - noteH - labelH + 32
      const cursor = y
      if (date) {
        parts.push(`<text x="${tx}" y="${cursor - labelLines.length * 38 - noteH - 14}" text-anchor="middle" font-family="${vt.sans}" font-size="17" letter-spacing="3" font-weight="600" fill="${vt.accent}">${esc(date.toUpperCase())}</text>`)
      }
      labelLines.forEach((ln, li) => {
        const ly = cursor - (labelLines.length - 1 - li) * 38 - noteH
        parts.push(`<text x="${tx}" y="${ly}" text-anchor="middle" font-family="${vt.serif}" font-size="32" fill="${vt.heading}">${esc(ln)}</text>`)
      })
      noteLines.forEach((ln) => {
        parts.push(`<text x="${tx}" y="${cursor + 26}" text-anchor="middle" font-family="${vt.serif}" font-size="22" fill="${vt.inkMuted}">${esc(ln)}</text>`)
      })
    } else {
      let cursor = spineY + 66
      if (date) {
        parts.push(`<text x="${tx}" y="${cursor}" text-anchor="middle" font-family="${vt.sans}" font-size="17" letter-spacing="3" font-weight="600" fill="${vt.accent}">${esc(date.toUpperCase())}</text>`)
        cursor += 38
      }
      labelLines.forEach((ln) => {
        parts.push(`<text x="${tx}" y="${cursor}" text-anchor="middle" font-family="${vt.serif}" font-size="32" fill="${vt.heading}">${esc(ln)}</text>`)
        cursor += 38
      })
      noteLines.forEach((ln) => {
        parts.push(`<text x="${tx}" y="${cursor - 4}" text-anchor="middle" font-family="${vt.serif}" font-size="22" fill="${vt.inkMuted}">${esc(ln)}</text>`)
      })
    }
  })

  return parts.join('')
}

function vertical(events: TimelineEvent[], vt: VisualTheme): string {
  const margin = 90
  const spineX = margin + 56
  const top = margin + 78
  const bottom = VISUAL_H - margin - 24
  const n = events.length
  const span = bottom - top
  const step = n > 1 ? span / (n - 1) : 0
  const textX = spineX + 60
  const colRight = VISUAL_W - margin
  const maxChars = Math.max(28, Math.floor((colRight - textX) / 18))

  const parts: string[] = []
  parts.push(eyebrow(vt, margin, margin + 14))
  parts.push(`<line x1="${spineX}" y1="${top}" x2="${spineX}" y2="${bottom}" stroke="${vt.line}" stroke-width="2"/>`)

  events.forEach((ev, i) => {
    const cy = n > 1 ? top + step * i : (top + bottom) / 2
    parts.push(node(vt, spineX, cy))

    const date = ev.date ? clamp(ev.date, 28) : ''
    const labelLines = wrap(ev.label || '', maxChars).slice(0, 1)
    const noteLines = ev.note ? wrap(ev.note, maxChars + 6).slice(0, 1) : []

    let cursor = cy - (date ? 18 : 4)
    if (date) {
      parts.push(`<text x="${textX}" y="${cursor}" font-family="${vt.sans}" font-size="17" letter-spacing="3" font-weight="600" fill="${vt.accent}">${esc(date.toUpperCase())}</text>`)
      cursor += 32
    } else {
      cursor = cy + 9
    }
    labelLines.forEach((ln) => {
      parts.push(`<text x="${textX}" y="${cursor}" font-family="${vt.serif}" font-size="30" fill="${vt.heading}">${esc(ln)}</text>`)
      cursor += 32
    })
    noteLines.forEach((ln) => {
      parts.push(`<text x="${textX}" y="${cursor}" font-family="${vt.serif}" font-size="22" fill="${vt.inkMuted}">${esc(ln)}</text>`)
    })
  })

  return parts.join('')
}

/**
 * Render up to 5 timeline events as a cohesive editorial SVG string.
 * Horizontal spine with alternating labels for <=4 events; vertical spine for 5.
 */
export function timelineSvg(events: TimelineEvent[], vt: VisualTheme): string {
  const items = (events || []).filter((e) => e && (e.label || e.date)).slice(0, 5)
  const body = items.length > 4 ? vertical(items, vt) : horizontal(items, vt)
  return `<svg viewBox="0 0 ${VISUAL_W} ${VISUAL_H}" xmlns="http://www.w3.org/2000/svg">${vignette(vt)}${body}</svg>`
}
