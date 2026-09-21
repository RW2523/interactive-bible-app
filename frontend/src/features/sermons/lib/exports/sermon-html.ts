// Shared rich parser for AI-polished sermon HTML. Both exporters run in the
// browser, so DOMParser is available. Output preserves inline bold/italic so
// PDF and PPT renderers can style runs instead of flattening to plain text.

export interface Run {
  text: string
  bold?: boolean
  italic?: boolean
}

export interface Block {
  type: 'h1' | 'h2' | 'h3' | 'p' | 'quote' | 'list'
  runs: Run[]
  /** for type 'list': one runs-array per list item */
  items?: Run[][]
  ordered?: boolean
}

function collectRuns(node: Node, bold = false, italic = false, out: Run[] = []): Run[] {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? ''
      if (text) out.push({ text, bold: bold || undefined, italic: italic || undefined })
      return
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return
    const el = child as Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'br') {
      out.push({ text: '\n' })
      return
    }
    collectRuns(
      el,
      bold || tag === 'strong' || tag === 'b',
      italic || tag === 'em' || tag === 'i',
      out
    )
  })
  return out
}

function normalizeRuns(runs: Run[]): Run[] {
  // Merge adjacent runs with the same style and collapse whitespace
  const merged: Run[] = []
  for (const run of runs) {
    const prev = merged[merged.length - 1]
    if (prev && !!prev.bold === !!run.bold && !!prev.italic === !!run.italic) {
      prev.text += run.text
    } else {
      merged.push({ ...run })
    }
  }
  return merged
    .map((r) => ({ ...r, text: r.text.replace(/[ \t]+/g, ' ') }))
    .filter((r) => r.text.trim().length > 0 || r.text === '\n')
}

export function runsToText(runs: Run[]): string {
  return runs.map((r) => r.text).join('').trim()
}

/**
 * AI drafts often use a single "Title: …" h2 and h3 for every real section.
 * When no genuine h2 sections exist, promote h3 headings so exporters can
 * build section structure from them.
 */
export function promoteHeadings(blocks: Block[]): Block[] {
  const realH2 = blocks.filter(
    (b) => (b.type === 'h1' || b.type === 'h2') && !/^title\s*:/i.test(runsToText(b.runs))
  )
  if (realH2.length > 0) return blocks
  return blocks.map((b) => (b.type === 'h3' ? { ...b, type: 'h2' as const } : b))
}

/** Detect a trailing scripture reference like “… — Hebrews 6:19-20” */
export function splitQuoteReference(text: string): { body: string; reference: string | null } {
  const m = text.match(/[—–-]\s*([1-3]?\s?[A-Z][A-Za-z]+\.?\s+\d+(?::[\d\-–,\s]+\d)?)\s*["”']?\s*$/)
  if (!m) return { body: text, reference: null }
  return { body: text.slice(0, m.index).replace(/["”']\s*$/, '”').trim(), reference: m[1].trim() }
}

export function parseSermonHtml(html: string): Block[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const blocks: Block[] = []

  function walk(parent: Element) {
    for (const el of Array.from(parent.children)) {
      const tag = el.tagName.toLowerCase()
      if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
        const runs = normalizeRuns(collectRuns(el))
        if (runsToText(runs)) blocks.push({ type: tag, runs })
      } else if (tag === 'p') {
        const runs = normalizeRuns(collectRuns(el))
        if (runsToText(runs)) blocks.push({ type: 'p', runs })
      } else if (tag === 'blockquote') {
        const runs = normalizeRuns(collectRuns(el))
        if (runsToText(runs)) blocks.push({ type: 'quote', runs })
      } else if (tag === 'ul' || tag === 'ol') {
        const items = Array.from(el.querySelectorAll(':scope > li'))
          .map((li) => normalizeRuns(collectRuns(li)))
          .filter((runs) => runsToText(runs))
        if (items.length) blocks.push({ type: 'list', runs: [], items, ordered: tag === 'ol' })
      } else if (tag === 'div' || tag === 'section' || tag === 'article') {
        walk(el)
      } else {
        // Unknown wrapper — treat its text as a paragraph if it has any
        const runs = normalizeRuns(collectRuns(el))
        if (runsToText(runs)) blocks.push({ type: 'p', runs })
      }
    }
  }

  walk(doc.body)
  return blocks
}

/** Split a long runs-array into chunks of roughly maxChars, breaking at sentence ends. */
export function chunkRuns(runs: Run[], maxChars: number): Run[][] {
  const total = runsToText(runs).length
  if (total <= maxChars) return [runs]

  const chunks: Run[][] = []
  let current: Run[] = []
  let count = 0
  for (const run of runs) {
    if (count + run.text.length <= maxChars || current.length === 0) {
      current.push(run)
      count += run.text.length
      continue
    }
    // Try to split this run at a sentence boundary
    const slack = maxChars - count
    const breakAt = findSentenceBreak(run.text, slack)
    if (breakAt > 0) {
      current.push({ ...run, text: run.text.slice(0, breakAt) })
      chunks.push(current)
      current = [{ ...run, text: run.text.slice(breakAt).trimStart() }]
      count = current[0].text.length
    } else {
      chunks.push(current)
      current = [run]
      count = run.text.length
    }
  }
  if (current.length && runsToText(current)) chunks.push(current)
  return chunks
}

function findSentenceBreak(text: string, near: number): number {
  for (let i = Math.min(near, text.length - 1); i > near - 200 && i > 0; i--) {
    if ('.!?'.includes(text[i]) && (text[i + 1] === ' ' || i === text.length - 1)) {
      return i + 1
    }
  }
  return 0
}
