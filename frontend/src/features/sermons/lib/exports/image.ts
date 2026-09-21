// Browser-side image normalisation for exports. Gemini PNGs are large
// (often 1–2 MB each) and pptxgenjs/jsPDF embed a copy per use, so decks with
// an image on every slide balloon past 40 MB. Downscaling to a sane max width
// and re-encoding as JPEG once keeps exports a few MB while staying crisp on a
// projector. Returns a JPEG data URL plus pixel dimensions.

export interface PreparedImage {
  dataUrl: string
  w: number
  h: number
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = url
  })
}

export async function prepareImage(url: string, maxW = 1600, quality = 0.82): Promise<PreparedImage | null> {
  try {
    const img = await loadImage(url)
    const scale = Math.min(1, maxW / (img.naturalWidth || maxW))
    const w = Math.round((img.naturalWidth || maxW) * scale)
    const h = Math.round((img.naturalHeight || maxW) * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // White matte so any transparency flattens cleanly under JPEG (a black
    // matte turned transparent AI PNGs into black blocks in figure/showcase
    // foregrounds and PDF hero images).
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    return { dataUrl: canvas.toDataURL('image/jpeg', quality), w, h }
  } catch {
    return null
  }
}

export type ScrimMode =
  | 'heroBottom' // smooth dark gradient rising from the bottom (lower-anchored text)
  | 'heroLeft'   // smooth dark gradient from the left (left-anchored text)
  | 'wash'       // heavy, even dark wash + slight blur — a readable BACKDROP for full-slide content
  | 'plain'      // no scrim (crisp foreground / framed image)

function hexToRgbStr(hex: string): string {
  const h = hex.replace('#', '')
  const n = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return `${n[0]},${n[1]},${n[2]}`
}

// Prepare a scene image for a slide by COVER-fitting it to a 16:9 canvas and
// baking a smooth gradient/wash directly into the pixels. This replaces the
// old hard-edged pptxgenjs scrim rectangles (which left ugly seams) with true
// gradients, and lets every slide carry a readable background image.
export async function prepareScene(
  url: string,
  mode: ScrimMode,
  darkHex: string,
  outW = 1600
): Promise<string | null> {
  try {
    const img = await loadImage(url)
    const outH = Math.round((outW * 9) / 16)
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    // cover-fit (guard against zero-dimension images that report onload but
    // have no intrinsic size — otherwise the scale and draw coords go NaN)
    const nw = img.naturalWidth || outW
    const nh = img.naturalHeight || outH
    const s = Math.max(outW / nw, outH / nh)
    const dw = nw * s
    const dh = nh * s
    if (mode === 'wash') ctx.filter = 'blur(3px) saturate(0.9)'
    ctx.drawImage(img, (outW - dw) / 2, (outH - dh) / 2, dw, dh)
    ctx.filter = 'none'

    const rgb = hexToRgbStr(darkHex)
    if (mode === 'wash') {
      // even, heavy wash so titles/panels/body all read on top
      ctx.fillStyle = `rgba(${rgb},0.72)`
      ctx.fillRect(0, 0, outW, outH)
      // gentle vignette for depth
      const v = ctx.createRadialGradient(outW / 2, outH / 2, outH * 0.2, outW / 2, outH / 2, outH * 0.95)
      v.addColorStop(0, 'rgba(0,0,0,0)')
      v.addColorStop(1, `rgba(${rgb},0.35)`)
      ctx.fillStyle = v
      ctx.fillRect(0, 0, outW, outH)
    } else if (mode === 'heroBottom') {
      const g = ctx.createLinearGradient(0, 0, 0, outH)
      g.addColorStop(0, `rgba(${rgb},0.10)`)
      g.addColorStop(0.45, `rgba(${rgb},0.30)`)
      g.addColorStop(0.78, `rgba(${rgb},0.82)`)
      g.addColorStop(1, `rgba(${rgb},0.96)`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, outW, outH)
    } else if (mode === 'heroLeft') {
      const g = ctx.createLinearGradient(0, 0, outW, 0)
      g.addColorStop(0, `rgba(${rgb},0.94)`)
      g.addColorStop(0.42, `rgba(${rgb},0.74)`)
      g.addColorStop(0.72, `rgba(${rgb},0.28)`)
      g.addColorStop(1, `rgba(${rgb},0.10)`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, outW, outH)
    }
    return canvas.toDataURL('image/jpeg', 0.82)
  } catch {
    return null
  }
}
