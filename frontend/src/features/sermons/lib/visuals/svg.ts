// Browser-side SVG → PNG rasterization. The export engine runs in the browser,
// so programmatic, label-bearing visuals (maps, routes, timelines, diagrams,
// scripture cards) are authored as self-contained SVG strings and rasterized
// via an offscreen canvas — crisp vector text, no native deps, and the exact
// same PNG flows into both the PPT and PDF exporters.

import { escapeHtml as esc } from '../sanitize'

export const VISUAL_W = 1600
export const VISUAL_H = 900

/** Escape text for safe inclusion in SVG markup (shared app-wide escaper). */
export { esc }

/** Wrap a string into <= maxChars lines on word boundaries (greedy). */
export function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > maxChars) {
      lines.push(cur)
      cur = w
    } else {
      cur = cur ? `${cur} ${w}` : w
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/**
 * Rasterize an SVG string to a JPEG data URL via canvas. JPEG (not PNG) keeps
 * embedded deck visuals small; a matte background is painted first so the
 * visual is opaque. Returns null if the SVG can't be decoded.
 */
export async function svgToDataUrl(
  svg: string,
  width = VISUAL_W,
  height = VISUAL_H,
  matte = '#000000'
): Promise<string | null> {
  try {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.decoding = 'async'
    const loaded = new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true)
      img.onerror = () => resolve(false)
    })
    img.src = url
    const ok = await loaded
    URL.revokeObjectURL(url)
    if (!ok) return null

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = matte
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', 0.86)
  } catch {
    return null
  }
}
