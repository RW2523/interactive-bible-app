import type { StructuredSermon, SermonPoint } from '../../types'
import { escapeHtml as esc } from '../sanitize'

export function emptyStructured(title = 'Untitled Sermon'): StructuredSermon {
  return {
    title,
    theme: '',
    scripture: '',
    introduction: '',
    main_points: [],
    applications: [],
    conclusion: '',
    prayer: '',
  }
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v)
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(asString).filter(Boolean)
  const s = asString(v)
  if (!s) return []
  // Split a paragraph of numbered/line-separated applications into items
  return s
    .split(/\n+|(?:^|\s)\d+[.)]\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
}

function asPoints(v: unknown): SermonPoint[] {
  if (!Array.isArray(v)) return []
  return v
    .map((p) => {
      if (typeof p === 'string') return { heading: '', body: p.trim() }
      const o = p as Record<string, unknown>
      return {
        heading: asString(o.heading ?? o.title ?? o.point),
        body: asString(o.body ?? o.content ?? o.text),
        scripture: asString(o.scripture ?? o.verse) || null,
      }
    })
    .filter((p) => p.heading || p.body)
}

/** Coerce arbitrary model JSON into a valid StructuredSermon. Defensive — never throws. */
export function normalizeStructured(raw: unknown, fallbackTitle = 'Untitled Sermon'): StructuredSermon {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    title: asString(o.title) || fallbackTitle,
    theme: asString(o.theme),
    scripture: asString(o.scripture ?? o.verse ?? o.scripture_ref),
    introduction: asString(o.introduction ?? o.intro),
    main_points: asPoints(o.main_points ?? o.points ?? o.mainPoints),
    applications: asStringArray(o.applications ?? o.application),
    conclusion: asString(o.conclusion),
    prayer: asString(o.prayer),
  }
}


function paras(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br/>')}</p>`)
    .join('\n')
}

/**
 * Render a structured sermon to semantic HTML for the editor preview,
 * the public share page, and the print view. Pure string work — runs
 * on both server and client.
 */
export function structuredToHtml(s: StructuredSermon): string {
  const out: string[] = []
  if (s.scripture) out.push(`<blockquote>${esc(s.scripture)}</blockquote>`)
  if (s.introduction) {
    out.push('<h2>Introduction</h2>')
    out.push(paras(s.introduction))
  }
  s.main_points.forEach((pt, i) => {
    out.push(`<h2>${i + 1}. ${esc(pt.heading || 'Main Point')}</h2>`)
    if (pt.scripture) out.push(`<blockquote>${esc(pt.scripture)}</blockquote>`)
    if (pt.body) out.push(paras(pt.body))
  })
  if (s.applications.length) {
    out.push('<h2>Application</h2>')
    out.push(`<ul>${s.applications.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`)
  }
  if (s.conclusion) {
    out.push('<h2>Conclusion</h2>')
    out.push(paras(s.conclusion))
  }
  if (s.prayer) {
    out.push('<h2>Closing Prayer</h2>')
    out.push(`<blockquote>${esc(s.prayer)}</blockquote>`)
  }
  return out.join('\n')
}

/** Plain-text rendering for word counts and chunking. */
export function structuredToPlainText(s: StructuredSermon): string {
  const parts = [
    s.scripture,
    s.introduction,
    ...s.main_points.flatMap((p) => [p.heading, p.scripture ?? '', p.body]),
    ...s.applications,
    s.conclusion,
    s.prayer,
  ]
  return parts.filter(Boolean).join('\n\n')
}
