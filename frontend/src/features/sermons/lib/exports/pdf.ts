import jsPDF from 'jspdf'
import type { Sermon, StructuredSermon, SermonMedia, ExportTemplateId, SlidePlan } from '../../types'
import { getTheme, withHash, contrastText } from '../sermon/templates'
import { prepareImage } from './image'

// Ported from the original sermon builder's manuscript exporter (formatting kept as-is).

interface ExportOpts {
  templateId?: ExportTemplateId | string | null
  formatLabel?: string
  slidePlan?: SlidePlan | null
}

// A polished A4 sermon MANUSCRIPT (portrait document) rendered from the
// polished, structured content. The section headings are the chosen format's
// sections, so the document reflects the template. Justified serif body, a
// refined title block, a hero image, interleaved visuals, a themed scripture
// panel, running headers, and page numbers — a print-ready sermon sheet.
export async function generatePDF(
  sermon: Sermon,
  structured: StructuredSermon,
  media: SermonMedia[],
  opts: ExportOpts = {}
): Promise<Blob> {
  const t = getTheme(opts.templateId ?? sermon.export_template)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 20
  const contentW = pageW - margin * 2
  const bottom = pageH - 18

  const accent = withHash(t.accent)
  const heading = withHash(t.mode === 'light' ? t.heading : '1B2A4A')
  const body = withHash(t.mode === 'light' ? t.text : '23272E')
  const muted = withHash(t.textMuted)
  const title = structured.title || sermon.title

  let y = 0
  let page = 1

  function runningHeader() {
    // pages 2+ get a discreet running header
    doc.setFont('times', 'italic')
    doc.setFontSize(8.5)
    doc.setTextColor(muted)
    doc.text(title, margin, 12, { maxWidth: contentW * 0.7 })
    doc.setDrawColor(accent)
    doc.setLineWidth(0.3)
    doc.line(margin, 14, pageW - margin, 14)
  }

  function footer(pageNum: number) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(muted)
    doc.text('Interactive Bible App', margin, pageH - 10)
    doc.text(`Page ${pageNum}`, pageW - margin, pageH - 10, { align: 'right' })
  }

  function newPage() {
    footer(page)
    doc.addPage()
    page += 1
    runningHeader()
    y = 22
  }

  function checkPage(needed = 10) {
    if (y + needed > bottom) newPage()
  }

  // ── Title block ──
  doc.setFillColor(accent)
  doc.rect(0, 0, pageW, 5, 'F')
  y = margin + 6

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(accent)
  doc.setCharSpace(0.8)
  doc.text((sermon.tone || 'Sermon').toUpperCase(), margin, y)
  doc.setCharSpace(0)
  y += 9

  doc.setFont('times', 'bold')
  doc.setFontSize(28)
  doc.setTextColor(heading)
  const titleLines = doc.splitTextToSize(title, contentW)
  doc.text(titleLines, margin, y)
  y += titleLines.length * 11 + 1

  if (structured.theme) {
    doc.setFont('times', 'italic')
    doc.setFontSize(12.5)
    doc.setTextColor(muted)
    const themeLines = doc.splitTextToSize(structured.theme, contentW)
    doc.text(themeLines, margin, y)
    y += themeLines.length * 6.2 + 1
  }

  // meta row: scripture ref · format · date
  const metaParts: string[] = []
  if (sermon.scripture_ref) metaParts.push(sermon.scripture_ref)
  if (opts.formatLabel) metaParts.push(opts.formatLabel)
  metaParts.push(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(muted)
  doc.text(metaParts.join('   ·   '), margin, y + 2)
  y += 6
  doc.setDrawColor(accent)
  doc.setLineWidth(0.6)
  doc.line(margin, y, pageW - margin, y)
  y += 8

  // ── Helpers ──
  function sectionHeading(label: string) {
    checkPage(16)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(accent)
    doc.setCharSpace(0.6)
    doc.text(label.toUpperCase(), margin, y)
    doc.setCharSpace(0)
    doc.setDrawColor(accent)
    doc.setLineWidth(0.3)
    doc.line(margin, y + 1.6, margin + 16, y + 1.6)
    y += 7
  }

  function paragraph(text: string, size = 10.8) {
    doc.setFont('times', 'normal')
    doc.setFontSize(size)
    doc.setTextColor(body)
    const lh = size * 0.5
    for (const para of text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
      const lines = doc.splitTextToSize(para, contentW) as string[]
      lines.forEach((line, li) => {
        checkPage(lh + 2)
        // justify every line except the last of the paragraph
        if (li < lines.length - 1) doc.text(line, margin, y, { align: 'justify', maxWidth: contentW })
        else doc.text(line, margin, y)
        y += lh
      })
      y += 3
    }
  }

  // White-paper scripture panel: always light tint, contrast-safe dark text.
  const scripturePanel = t.mode === 'light' ? t.panel : 'F2ECDE'
  const scriptureText = withHash(contrastText(scripturePanel))

  function scriptureBlock(text: string) {
    const lines = doc.splitTextToSize(text, contentW - 10) as string[]
    const lineH = 5.4
    doc.setFont('times', 'italic')
    doc.setFontSize(10.5)
    // Draw the tinted panel one page-segment at a time so a verse taller than
    // the printable column splits across pages instead of running off the page
    // and through the footer.
    let idx = 0
    while (idx < lines.length) {
      checkPage(lineH + 7) // guarantee room for at least one line + padding
      const avail = bottom - (y - 1) - 7
      const fit = Math.min(lines.length - idx, Math.max(1, Math.floor(avail / lineH)))
      const seg = lines.slice(idx, idx + fit)
      const segH = seg.length * lineH + 7
      doc.setFillColor(withHash(scripturePanel))
      doc.rect(margin, y - 1, contentW, segH, 'F')
      doc.setFillColor(accent)
      doc.rect(margin, y - 1, 1.8, segH, 'F')
      doc.setTextColor(scriptureText)
      let yy = y + 4.5
      for (const line of seg) { doc.text(line, margin + 7, yy); yy += lineH }
      y += segH + 5
      idx += fit
    }
  }

  // ── Preload + compress images ──
  // Use the media library AND any images the planner generated (so the
  // manuscript has a hero + section images even without a Stage-3 visual set).
  const planImgs = (opts.slidePlan?.slides ?? [])
    .map((s) => ({ url: s.visual?.imageUrl, caption: s.visual?.spec ?? null }))
    .filter((x): x is { url: string; caption: string | null } => !!x.url)
  const mediaImgs = media.filter((m) => m.url).map((m) => ({ url: m.url as string, caption: m.caption }))
  const seen = new Set<string>()
  const sources = [...mediaImgs, ...planImgs].filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)))

  const prepared = await Promise.all(
    sources.map(async (src) => {
      const p = await prepareImage(src.url)
      return p ? { data: p.dataUrl, w: p.w, h: p.h, caption: src.caption } : null
    })
  )
  const imgData = prepared.filter(Boolean) as { data: string; w: number; h: number; caption: string | null }[]

  function placeImage(img: { data: string; w: number; h: number; caption: string | null }, widthMm: number) {
    const imgW = Math.min(widthMm, contentW)
    const imgH = (img.h / img.w) * imgW
    checkPage(imgH + (img.caption ? 9 : 4))
    const x = margin + (contentW - imgW) / 2
    doc.addImage(img.data, 'JPEG', x, y, imgW, imgH)
    // thin frame
    doc.setDrawColor(accent)
    doc.setLineWidth(0.2)
    doc.rect(x, y, imgW, imgH)
    y += imgH + 3
    if (img.caption) {
      doc.setFont('times', 'italic')
      doc.setFontSize(8.5)
      doc.setTextColor(muted)
      for (const line of doc.splitTextToSize(img.caption, imgW) as string[]) { checkPage(5); doc.text(line, pageW / 2, y, { align: 'center' }); y += 4 }
      y += 2
    }
  }

  // ── Hero image + key scripture ──
  if (imgData[0]) placeImage(imgData[0], contentW * 0.82)
  if (structured.scripture) scriptureBlock(structured.scripture)

  // ── Introduction ──
  if (structured.introduction) {
    sectionHeading('Introduction')
    paragraph(structured.introduction)
    y += 2
  }

  // ── Sections (the chosen format's sections) ──
  structured.main_points.forEach((pt, i) => {
    checkPage(20)
    doc.setFont('times', 'bold')
    doc.setFontSize(15)
    doc.setTextColor(accent)
    doc.text(`${i + 1}.`, margin, y)
    doc.setTextColor(heading)
    const headLines = doc.splitTextToSize(pt.heading || `Section ${i + 1}`, contentW - 9) as string[]
    headLines.forEach((line, li) => { checkPage(8); doc.text(line, margin + 9, y); if (li < headLines.length - 1) y += 7 })
    y += 8
    if (pt.scripture) scriptureBlock(pt.scripture)
    if (pt.body) paragraph(pt.body)
    const img = imgData[i + 1]
    if (img) placeImage(img, contentW * 0.6)
    y += 3
  })

  // ── Application ──
  if (structured.applications.length) {
    sectionHeading('Application')
    doc.setFont('times', 'normal')
    doc.setFontSize(10.8)
    structured.applications.forEach((a) => {
      const lines = doc.splitTextToSize(a, contentW - 7) as string[]
      const blockH = lines.length * 5.4
      checkPage(blockH + 2)
      doc.setFillColor(accent)
      doc.circle(margin + 1.4, y - 1.4, 1, 'F')
      doc.setTextColor(body)
      lines.forEach((line, li) => { checkPage(6); doc.text(line, margin + 6, y); if (li < lines.length - 1) y += 5.4 })
      y += 6.4
    })
    y += 2
  }

  // ── Conclusion ──
  if (structured.conclusion) {
    sectionHeading('Conclusion')
    paragraph(structured.conclusion)
    y += 2
  }

  // ── Closing prayer ──
  if (structured.prayer) {
    checkPage(24)
    doc.setDrawColor(accent)
    doc.setLineWidth(0.4)
    doc.line(margin, y, pageW - margin, y)
    y += 7
    sectionHeading('Closing Prayer')
    doc.setFont('times', 'italic')
    doc.setFontSize(10.8)
    doc.setTextColor(body)
    for (const line of doc.splitTextToSize(structured.prayer, contentW) as string[]) {
      checkPage(6); doc.text(line, margin, y); y += 5.6
    }
  }

  footer(page)
  return doc.output('blob')
}
