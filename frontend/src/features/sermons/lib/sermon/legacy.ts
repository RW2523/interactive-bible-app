// Client-only: derive a StructuredSermon from legacy polished_html drafts that
// predate the structured model. Uses DOMParser (browser) via the shared parser.
import { parseSermonHtml, promoteHeadings, runsToText, type Block } from '../exports/sermon-html'
import { emptyStructured } from './structured'
import type { StructuredSermon, SermonPoint } from '../../types'

function blocksText(blocks: Block[]): string {
  return blocks.map((b) => runsToText(b.runs)).filter(Boolean).join('\n\n')
}

export function htmlToStructured(html: string, fallbackTitle = 'Untitled Sermon'): StructuredSermon {
  const s = emptyStructured(fallbackTitle)
  if (!html) return s

  const blocks = promoteHeadings(parseSermonHtml(html))
  type Bucket = 'intro' | 'point' | 'application' | 'conclusion' | 'prayer' | 'scripture'
  let bucket: Bucket = 'intro'
  let currentPoint: SermonPoint | null = null
  const introBlocks: Block[] = []
  const conclusionBlocks: Block[] = []

  const classify = (heading: string): Bucket => {
    if (/introduction|opening|hook/i.test(heading)) return 'intro'
    if (/application|apply|takeaway/i.test(heading)) return 'application'
    if (/conclusion|closing|call to action/i.test(heading)) return 'conclusion'
    if (/prayer|benediction/i.test(heading)) return 'prayer'
    if (/scripture|reading|text/i.test(heading)) return 'scripture'
    return 'point'
  }

  for (const block of blocks) {
    if (block.type === 'h1' || block.type === 'h2') {
      const heading = runsToText(block.runs).replace(/^\d+[.)]\s*/, '')
      if (/^title\s*:/i.test(heading)) {
        s.title = heading.replace(/^title\s*:\s*/i, '') || s.title
        continue
      }
      bucket = classify(heading)
      if (bucket === 'point') {
        currentPoint = { heading, body: '', scripture: null }
        s.main_points.push(currentPoint)
      }
      continue
    }

    if (block.type === 'quote') {
      const text = runsToText(block.runs)
      if (!s.scripture) s.scripture = text
      else if (bucket === 'prayer') s.prayer = s.prayer ? `${s.prayer}\n\n${text}` : text
      else if (currentPoint && !currentPoint.scripture) currentPoint.scripture = text
      continue
    }

    if (block.type === 'list' && block.items) {
      const items = block.items.map((it) => runsToText(it)).filter(Boolean)
      if (bucket === 'application') s.applications.push(...items)
      else if (currentPoint) currentPoint.body += (currentPoint.body ? '\n\n' : '') + items.map((i) => `• ${i}`).join('\n')
      else introBlocks.push(block)
      continue
    }

    // paragraph / h3
    const text = runsToText(block.runs)
    if (!text) continue
    switch (bucket) {
      case 'intro': introBlocks.push(block); break
      case 'application': s.applications.push(...text.split(/\n+/).filter(Boolean)); break
      case 'conclusion': conclusionBlocks.push(block); break
      case 'prayer': s.prayer = s.prayer ? `${s.prayer}\n\n${text}` : text; break
      case 'scripture': if (!s.scripture) s.scripture = text; break
      case 'point':
        if (currentPoint) currentPoint.body += (currentPoint.body ? '\n\n' : '') + text
        else introBlocks.push(block)
        break
    }
  }

  s.introduction = blocksText(introBlocks)
  s.conclusion = blocksText(conclusionBlocks)
  return s
}
