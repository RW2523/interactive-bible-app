import type { Sermon, StructuredSermon, SermonMedia, ExportTemplateId } from '../../types'
import { escapeHtml } from '../sanitize'
import { getTheme, withHash, languageCode } from '../sermon/templates'

interface PrintOpts {
  templateId?: ExportTemplateId | string | null
  speakerNotes?: string | null
  language?: string | null
  /** A window opened synchronously in the click handler (avoids pop-up blockers). */
  target?: Window | null
}

/** Media URLs from the API are same-origin paths; make them absolute for the about:blank print window. */
function absoluteUrl(url: string): string {
  try {
    return new URL(url, window.location.origin).href
  } catch {
    return url
  }
}

/**
 * High-fidelity, theme-aware print view rendered straight from the structured
 * sermon. Because the browser does the rendering, every language/script — including
 * Hindi, Tamil, Telugu, Malayalam — displays correctly here, making this the
 * reliable "print / save as PDF" path for non-Latin sermons.
 *
 * Returns false when the window could not be opened (pop-ups blocked).
 */
export function openPrintView(
  sermon: Sermon,
  structured: StructuredSermon,
  media: SermonMedia[],
  opts: PrintOpts = {}
): boolean {
  const t = getTheme(opts.templateId ?? sermon.export_template)
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const accent = withHash(t.accent)
  const ink = '#1d2330'
  const panel = t.mode === 'light' ? withHash(t.panel) : '#f3eee1'
  const language = opts.language ?? sermon.language ?? 'English'

  const p = (text: string) =>
    text.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean)
      .map((x) => `<p>${escapeHtml(x).replace(/\n/g, '<br/>')}</p>`).join('')

  const pointsHtml = structured.main_points.map((pt, i) => `
    <h2>${i + 1}. ${escapeHtml(pt.heading)}</h2>
    ${pt.scripture ? `<blockquote>${escapeHtml(pt.scripture)}</blockquote>` : ''}
    ${p(pt.body)}
  `).join('')

  const appsHtml = structured.applications.length
    ? `<div class="section-header">Application</div><ol class="apps">${structured.applications.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ol>`
    : ''

  const withUrls = media.filter((m) => m.url)
  const mediaSection = withUrls.length ? `
    <div class="section-header">Visuals</div>
    <div class="media-grid">
      ${withUrls.map((m) => `
        <div class="media-item">
          <img src="${escapeHtml(absoluteUrl(m.url as string))}" alt="${escapeHtml(m.caption ?? '')}" />
          ${m.caption ? `<p class="caption">${escapeHtml(m.caption)}</p>` : ''}
        </div>`).join('')}
    </div>` : ''

  const notesSection = opts.speakerNotes ? `
    <div class="page-break"></div>
    <div class="section-header notes-header">Speaker Notes (Private — Not For Distribution)</div>
    <div class="speaker-notes">${escapeHtml(opts.speakerNotes).replace(/\n/g, '<br/>')}</div>` : ''

  const scriptureLine = (sermon.scripture_ref || structured.scripture || '').split('\n')[0]

  const html = `<!DOCTYPE html>
<html lang="${escapeHtml(languageCode(language))}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(structured.title || sermon.title)} — Sermon Notes</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Georgia, 'Times New Roman', serif; color: ${ink}; background: #fff; max-width: 680px; margin: 0 auto; padding: 44px 34px; line-height: 1.7; }
    .header { border-bottom: 3px solid ${accent}; padding-bottom: 20px; margin-bottom: 26px; }
    .kicker { font-size: 11px; letter-spacing: 3px; text-transform: uppercase; color: ${accent}; font-family: Arial, sans-serif; font-weight: bold; margin-bottom: 8px; }
    .title { font-size: 30px; font-weight: bold; color: ${ink}; line-height: 1.2; }
    .theme { font-style: italic; color: #6b7280; margin-top: 8px; font-size: 15px; }
    .meta { font-size: 12px; color: #6b7280; margin-top: 12px; display: flex; flex-wrap: wrap; gap: 14px; }
    .section-header { font-size: 11px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; color: ${accent}; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin: 26px 0 14px; font-family: Arial, sans-serif; }
    h2 { font-size: 20px; font-weight: bold; color: ${ink}; margin: 22px 0 8px; }
    p { margin-bottom: 12px; font-size: 15px; }
    blockquote { border-left: 4px solid ${accent}; margin: 16px 0; padding: 12px 18px; background: ${panel}; font-style: italic; color: #374151; border-radius: 0 6px 6px 0; }
    ol.apps { margin: 8px 0 12px 22px; } ol.apps li { margin-bottom: 8px; font-size: 15px; }
    .media-grid { display: flex; flex-wrap: wrap; gap: 12px; }
    .media-item { flex: 1 1 280px; }
    .media-item img { width: 100%; border-radius: 8px; border: 1px solid #e5e7eb; max-height: 220px; object-fit: cover; }
    .caption { font-size: 12px; color: #6b7280; margin-top: 4px; font-style: italic; text-align: center; }
    .page-break { page-break-before: always; }
    .notes-header { color: #b91c1c; border-color: #fca5a5; }
    .speaker-notes { font-family: 'Courier New', monospace; font-size: 13px; color: #374151; background: #fef9e7; padding: 16px; border-radius: 8px; border: 1px solid #f3e2a8; line-height: 1.8; white-space: pre-wrap; }
    .footer { margin-top: 44px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; text-align: center; }
    @media print { body { padding: 22px; max-width: 100%; } a { text-decoration: none; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="kicker">${escapeHtml(sermon.tone || 'Sermon')}</div>
    <div class="title">${escapeHtml(structured.title || sermon.title)}</div>
    ${structured.theme ? `<div class="theme">${escapeHtml(structured.theme)}</div>` : ''}
    <div class="meta">
      ${scriptureLine ? `<span>📖 ${escapeHtml(scriptureLine)}</span>` : ''}
      <span>📅 ${date}</span>
      <span>🌐 ${escapeHtml(language)}</span>
    </div>
  </div>

  ${structured.scripture ? `<blockquote>${escapeHtml(structured.scripture)}</blockquote>` : ''}
  ${structured.introduction ? `<div class="section-header">Introduction</div>${p(structured.introduction)}` : ''}
  ${pointsHtml}
  ${appsHtml}
  ${structured.conclusion ? `<div class="section-header">Conclusion</div>${p(structured.conclusion)}` : ''}
  ${structured.prayer ? `<div class="section-header">Closing Prayer</div><blockquote>${escapeHtml(structured.prayer)}</blockquote>` : ''}
  ${mediaSection}
  ${notesSection}

  <div class="footer">Generated by Interactive Bible App • ${date}</div>
</body>
</html>`

  const w = opts.target ?? window.open('', '_blank')
  if (!w) return false
  w.document.open()
  w.document.write(html)
  w.document.close()
  // Give images a moment to start loading before the print dialog appears.
  setTimeout(() => {
    try { w.focus(); w.print() } catch { /* window closed */ }
  }, 600)
  return true
}
