// Programmatic concept/relationship diagram — one of five shapes (hubSpoke,
// flow, compare, pyramid, list) rendered as a self-contained 1600x900 SVG
// string. Shares the deck's VisualTheme so it reads as one hand-crafted,
// editorial set alongside the map, route, timeline, and scripture-card
// generators. Pure: no rasterization, no side effects, no external resources.

import type { VisualTheme } from './theme'
import { VISUAL_W, VISUAL_H, esc, wrap } from './svg'

type Diagram = NonNullable<import('../../types').VisualSpec['diagram']>
type Node = Diagram['nodes'][number]

const PAD = 90 // safe margin
const RX = 14 // one consistent corner radius
const STROKE = 1.5 // one consistent hairline weight

// ── shared atoms ───────────────────────────────────────────────────────────

function defs(vt: VisualTheme): string {
  return `<defs>
    <radialGradient id="dgVig" cx="50%" cy="42%" r="78%">
      <stop offset="0%" stop-color="${vt.bg}" stop-opacity="0"/>
      <stop offset="100%" stop-color="${vt.bgDeep}" stop-opacity="1"/>
    </radialGradient>
    <marker id="dgArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="${vt.accent}"/>
    </marker>
  </defs>`
}

function frame(vt: VisualTheme): string {
  return `<rect width="${VISUAL_W}" height="${VISUAL_H}" fill="${vt.bg}"/>` +
    `<rect width="${VISUAL_W}" height="${VISUAL_H}" fill="url(#dgVig)"/>`
}

/** Tracked-caps eyebrow, top-left on the implied grid. */
function eyebrow(text: string, vt: VisualTheme): string {
  const t = esc(text.toUpperCase())
  return `<text x="${PAD}" y="${PAD + 6}" font-family="${vt.sans}" font-size="22" letter-spacing="4" fill="${vt.accent}">${t}</text>` +
    `<line x1="${PAD}" y1="${PAD + 26}" x2="${PAD + 64}" y2="${PAD + 26}" stroke="${vt.accent}" stroke-width="2"/>`
}

/** Multi-line serif label centered in a box, returns the <text> block. */
function centeredLabel(
  label: string,
  cx: number,
  cy: number,
  size: number,
  maxChars: number,
  vt: VisualTheme,
  fill = vt.heading
): string {
  const lines = wrap(label, maxChars)
  const lh = size * 1.14
  const start = cy - ((lines.length - 1) * lh) / 2
  return lines
    .map(
      (ln, i) =>
        `<text x="${cx}" y="${start + i * lh}" text-anchor="middle" dominant-baseline="middle" font-family="${vt.serif}" font-size="${size}" fill="${fill}">${esc(
          ln
        )}</text>`
    )
    .join('')
}

/** A panel pill with serif label (+ optional muted detail) centered inside. */
function pill(
  node: Node,
  x: number,
  y: number,
  w: number,
  h: number,
  vt: VisualTheme,
  labelSize = 28
): string {
  const cx = x + w / 2
  const hasDetail = !!node.detail
  const labelCy = hasDetail ? y + h * 0.4 : y + h / 2
  const maxChars = Math.max(8, Math.floor(w / (labelSize * 0.54)))
  const label = centeredLabel(node.label, cx, labelCy, labelSize, maxChars, vt)
  const detail = hasDetail
    ? `<text x="${cx}" y="${y + h * 0.72}" text-anchor="middle" dominant-baseline="middle" font-family="${vt.sans}" font-size="20" fill="${vt.inkMuted}">${esc(
        truncate(node.detail as string, Math.floor(w / 11))
      )}</text>`
    : ''
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${RX}" fill="${vt.panel}" stroke="${vt.line}" stroke-width="${STROKE}"/>` +
    label +
    detail
  )
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…'
}

// ── shapes ─────────────────────────────────────────────────────────────────

function hubSpoke(d: Diagram, vt: VisualTheme): string {
  const nodes = d.nodes.slice(0, 6)
  const cx = VISUAL_W / 2
  const cy = VISUAL_H / 2 + 24
  const hubW = 300
  const hubH = 132
  const nodeW = 270
  const nodeH = 96
  const rx = 470
  const ry = 270
  const n = nodes.length
  // Start at top, distribute evenly around the ellipse.
  const connectors: string[] = []
  const pills: string[] = []
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n
    const px = cx + Math.cos(ang) * rx
    const py = cy + Math.sin(ang) * ry
    // Connector from hub edge to node center (drawn under pills).
    connectors.push(
      `<line x1="${cx}" y1="${cy}" x2="${px}" y2="${py}" stroke="${vt.accent}" stroke-width="${STROKE}" stroke-opacity="0.7"/>` +
        `<circle cx="${px}" cy="${py}" r="3.5" fill="${vt.accent}"/>`
    )
    pills.push(pill(nodes[i], px - nodeW / 2, py - nodeH / 2, nodeW, nodeH, vt, 24))
  }
  const hub =
    `<rect x="${cx - hubW / 2}" y="${cy - hubH / 2}" width="${hubW}" height="${hubH}" rx="${RX}" fill="${vt.panel}" stroke="${vt.accent}" stroke-width="2"/>` +
    centeredLabel(d.center || 'Center', cx, cy, 30, 16, vt)
  return connectors.join('') + hub + pills.join('')
}

function flow(d: Diagram, vt: VisualTheme): string {
  const nodes = d.nodes.slice(0, 6)
  const n = nodes.length
  const top = n > 4 ? Math.ceil(n / 2) : n
  const rows: Node[][] = [nodes.slice(0, top)]
  if (n > 4) rows.push(nodes.slice(top))
  const innerW = VISUAL_W - PAD * 2
  const nodeH = rows.length > 1 ? 150 : 188
  const gapX = 56
  const rowGapY = 96
  const totalH = rows.length * nodeH + (rows.length - 1) * rowGapY
  const startY = (VISUAL_H - totalH) / 2 + 28

  const out: string[] = []
  rows.forEach((row, ri) => {
    const count = row.length
    const nodeW = (innerW - gapX * (count - 1)) / count
    const y = startY + ri * (nodeH + rowGapY)
    const xs: number[] = []
    row.forEach((node, ci) => {
      const x = PAD + ci * (nodeW + gapX)
      xs.push(x)
      out.push(pill(node, x, y, nodeW, nodeH, vt, 28))
      if (ci < count - 1) {
        const ax = x + nodeW + 6
        const ay = y + nodeH / 2
        out.push(
          `<line x1="${ax}" y1="${ay}" x2="${ax + gapX - 12}" y2="${ay}" stroke="${vt.accent}" stroke-width="2" marker-end="url(#dgArrow)"/>`
        )
      }
    })
    // Elbow arrow wrapping from end of row to start of next row.
    if (ri < rows.length - 1) {
      const lastX = xs[xs.length - 1]
      const endRightX = lastX + nodeW
      const midX = endRightX - nodeW / 2
      const fromY = y + nodeH
      const toY = y + nodeH + rowGapY
      out.push(
        `<path d="M${midX} ${fromY} L${midX} ${toY - 6}" fill="none" stroke="${vt.accent}" stroke-width="2" marker-end="url(#dgArrow)"/>`
      )
    }
  })
  return out.join('')
}

function compare(d: Diagram, vt: VisualTheme): string {
  const midX = VISUAL_W / 2
  const colW = (VISUAL_W - PAD * 2 - 120) / 2
  const leftX = PAD
  const rightX = midX + 60
  const headY = PAD + 130
  const ruleTop = PAD + 60
  const ruleBot = VISUAL_H - PAD
  const out: string[] = []

  // Divider rule with centered accent label.
  out.push(
    `<line x1="${midX}" y1="${ruleTop}" x2="${midX}" y2="${ruleBot}" stroke="${vt.line}" stroke-width="${STROKE}"/>`
  )
  const cLabel = (d.center || 'vs').toUpperCase()
  const labelMidY = (ruleTop + ruleBot) / 2
  out.push(
    `<circle cx="${midX}" cy="${labelMidY}" r="34" fill="${vt.bg}" stroke="${vt.accent}" stroke-width="2"/>` +
      `<text x="${midX}" y="${labelMidY}" text-anchor="middle" dominant-baseline="middle" font-family="${vt.sans}" font-size="20" letter-spacing="2" fill="${vt.accent}">${esc(
        truncate(cLabel, 4)
      )}</text>`
  )

  const column = (x: number, header: string | undefined, items: string[]) => {
    if (header) {
      out.push(
        `<text x="${x}" y="${headY}" font-family="${vt.serif}" font-size="38" fill="${vt.heading}">${esc(
          truncate(header, Math.floor(colW / 19))
        )}</text>`
      )
      out.push(
        `<line x1="${x}" y1="${headY + 26}" x2="${x + colW}" y2="${headY + 26}" stroke="${vt.line}" stroke-width="${STROKE}"/>`
      )
    }
    let cy = headY + 92
    const maxChars = Math.max(14, Math.floor(colW / 13))
    items.slice(0, 6).forEach((raw) => {
      const lines = wrap(raw, maxChars)
      out.push(`<circle cx="${x + 7}" cy="${cy - 8}" r="4" fill="${vt.accent}"/>`)
      lines.forEach((ln, li) => {
        out.push(
          `<text x="${x + 30}" y="${cy + li * 30}" font-family="${vt.sans}" font-size="24" fill="${
            li === 0 ? vt.ink : vt.inkMuted
          }">${esc(ln)}</text>`
        )
      })
      cy += lines.length * 30 + 26
    })
  }

  column(leftX, d.leftHeader, d.leftItems || [])
  column(rightX, d.rightHeader, d.rightItems || [])
  return out.join('')
}

function pyramid(d: Diagram, vt: VisualTheme): string {
  const nodes = d.nodes.slice(0, 5)
  const n = nodes.length
  const baseW = 1080
  const apexW = 360
  const tierH = 122
  const gap = 16
  const totalH = n * tierH + (n - 1) * gap
  const cx = VISUAL_W / 2
  const startY = (VISUAL_H - totalH) / 2 + 30
  const out: string[] = []
  // Bottom (widest) tier is the first node; stack upward to the apex.
  for (let i = 0; i < n; i++) {
    const topW = baseW + (apexW - baseW) * ((i + 1) / n)
    const botW = baseW + (apexW - baseW) * (i / n)
    const y = startY + (n - 1 - i) * (tierH + gap)
    const yb = y + tierH
    const tlx = cx - topW / 2
    const trx = cx + topW / 2
    const blx = cx - botW / 2
    const brx = cx + botW / 2
    out.push(
      `<path d="M${tlx} ${y} L${trx} ${y} L${brx} ${yb} L${blx} ${yb} z" fill="${vt.panel}" stroke="${vt.line}" stroke-width="${STROKE}"/>`
    )
    const midW = (topW + botW) / 2
    const maxChars = Math.max(10, Math.floor(midW / 16))
    out.push(
      `<text x="${cx}" y="${y + tierH / 2}" text-anchor="middle" dominant-baseline="middle" font-family="${vt.serif}" font-size="28" fill="${vt.heading}">${esc(
        truncate(nodes[i].label, maxChars)
      )}</text>`
    )
  }
  return out.join('')
}

function list(d: Diagram, vt: VisualTheme): string {
  const nodes = d.nodes.slice(0, 7)
  const n = nodes.length
  const innerW = VISUAL_W - PAD * 2
  const topY = PAD + 110
  const avail = VISUAL_H - topY - PAD
  const rowH = Math.min(120, avail / n)
  const out: string[] = []
  const numSize = n > 5 ? 30 : 36
  nodes.forEach((node, i) => {
    const y = topY + i * rowH
    const cy = y + rowH / 2
    // Accent numeral.
    out.push(
      `<text x="${PAD}" y="${cy}" dominant-baseline="middle" font-family="${vt.serif}" font-size="${numSize}" fill="${vt.accent}">${String(
        i + 1
      ).padStart(2, '0')}</text>`
    )
    const tx = PAD + 86
    const labelMax = Math.floor((innerW - 96) / 16)
    if (node.detail) {
      out.push(
        `<text x="${tx}" y="${cy - 14}" dominant-baseline="middle" font-family="${vt.serif}" font-size="30" fill="${vt.heading}">${esc(
          truncate(node.label, labelMax)
        )}</text>`
      )
      out.push(
        `<text x="${tx}" y="${cy + 18}" dominant-baseline="middle" font-family="${vt.sans}" font-size="22" fill="${vt.inkMuted}">${esc(
          truncate(node.detail, Math.floor((innerW - 96) / 12))
        )}</text>`
      )
    } else {
      out.push(
        `<text x="${tx}" y="${cy}" dominant-baseline="middle" font-family="${vt.serif}" font-size="30" fill="${vt.heading}">${esc(
          truncate(node.label, labelMax)
        )}</text>`
      )
    }
    if (i < n - 1) {
      out.push(
        `<line x1="${PAD}" y1="${y + rowH}" x2="${VISUAL_W - PAD}" y2="${y + rowH}" stroke="${vt.line}" stroke-width="${STROKE}" stroke-opacity="0.6"/>`
      )
    }
  })
  return out.join('')
}

// ── entry ──────────────────────────────────────────────────────────────────

const TITLES: Record<Diagram['shape'], string> = {
  hubSpoke: 'Relationship',
  flow: 'Sequence',
  compare: 'Comparison',
  pyramid: 'Hierarchy',
  list: 'Framework',
}

export function diagramSvg(
  diagram: NonNullable<import('../../types').VisualSpec['diagram']>,
  vt: VisualTheme
): string {
  let body = ''
  switch (diagram.shape) {
    case 'hubSpoke':
      body = hubSpoke(diagram, vt)
      break
    case 'flow':
      body = flow(diagram, vt)
      break
    case 'compare':
      body = compare(diagram, vt)
      break
    case 'pyramid':
      body = pyramid(diagram, vt)
      break
    case 'list':
      body = list(diagram, vt)
      break
    default:
      body = list(diagram, vt)
  }
  const eb = eyebrow(TITLES[diagram.shape] || 'Diagram', vt)
  return (
    `<svg viewBox="0 0 ${VISUAL_W} ${VISUAL_H}" xmlns="http://www.w3.org/2000/svg">` +
    defs(vt) +
    frame(vt) +
    eb +
    body +
    `</svg>`
  )
}
