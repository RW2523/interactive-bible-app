import type { StructuredSermon, SlidePlan, SlideSpec, VisualSpec } from '../../types'

// Content-FAITHFUL deck builder for PREACHING. Unlike a minimalist "design"
// planner, this carries the actual sermon onto the slides — the scripture text,
// each point's real teaching (chunked into readable bullets), every
// application, the conclusion and prayer — so the congregation can follow and
// the preacher has their material on screen. Nothing is summarised away.

function sentences(text: string): string[] {
  return (text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?”"])\s+(?=[A-Z“"])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// Group sentences into slide-sized bullets by a character budget so dense
// passages spread across several slides instead of overflowing one.
function chunkByChars(sents: string[], maxChars: number): string[][] {
  const groups: string[][] = []
  let cur: string[] = []
  let count = 0
  for (const s of sents) {
    if (cur.length && count + s.length > maxChars) {
      groups.push(cur)
      cur = [s]
      count = s.length
    } else {
      cur.push(s)
      count += s.length
    }
  }
  if (cur.length) groups.push(cur)
  return groups
}

function refOf(scripture: string): string | undefined {
  const paren = scripture.match(/\(([^)]+)\)/)
  if (paren) return paren[1].trim()
  const lead = scripture.match(/^([1-3]?\s?[A-Z][A-Za-z]+\.?\s+\d+(?::[\d\-,\s]*\d)?)/)
  return lead?.[1]?.trim()
}

function verseText(scripture: string): string {
  // Drop a leading "Reference (KJV): " label and surrounding quotes.
  return scripture
    .replace(/^[^:]{0,48}:\s*/, '')
    .replace(/^["'“”]|["'“”]\s*$/g, '')
    .trim()
}

const scene = (subject: string, hq = false): VisualSpec => ({
  type: 'scene',
  spec: subject,
  prompt: `A reverent, cinematic fine-art scene evoking ${subject}. No text, no letters, no words.`,
  highQuality: hq,
})

const scriptureArt = (raw: string, max = 360): VisualSpec => ({
  type: 'scriptureArt',
  scripture: { text: verseText(raw).slice(0, max), reference: refOf(raw) ?? '' },
})

export function buildContentPlan(s: StructuredSermon, opts: { themeId: string; targetSlideCount?: number }): SlidePlan {
  const target = Math.max(10, Math.min(40, opts.targetSlideCount ?? 16))
  // Denser target → fewer slides → more sentences per slide. Roughly tune the
  // per-slide character budget so the deck lands near the requested length.
  const budget = target <= 12 ? 420 : target <= 16 ? 340 : 280
  const slides: SlideSpec[] = []

  // ── Cover ──
  slides.push({
    layout: 'cover', role: 'cover', emphasis: 'climax', kicker: 'Sermon',
    heading: s.title, subheading: s.theme || undefined,
    reference: s.scripture ? refOf(s.scripture) ?? s.scripture.split('\n')[0].slice(0, 50) : undefined,
    visual: scene(s.theme || s.title, true),
  })

  // ── Key scripture (actual passage text) ──
  if (s.scripture) {
    slides.push({
      layout: 'scripture', role: 'scripture', emphasis: 'breath',
      kicker: 'Scripture', heading: refOf(s.scripture) ?? 'Scripture', reference: refOf(s.scripture),
      visual: scriptureArt(s.scripture),
    })
  }

  // ── Introduction (real text) ──
  if (s.introduction) {
    chunkByChars(sentences(s.introduction), budget).slice(0, 3).forEach((g, gi) => {
      slides.push({
        layout: gi === 0 ? 'figure' : 'split', role: 'teaching', emphasis: 'normal', imageSide: 'right',
        kicker: 'Introduction', heading: gi === 0 ? 'Where We Begin' : 'Introduction',
        body: g, visual: gi === 0 ? scene(`${s.theme || s.title}, opening mood`) : { type: 'none' },
      })
    })
  }

  // ── Main points (real teaching, chunked) ──
  s.main_points.forEach((pt, i) => {
    const heading = pt.heading || `Point ${i + 1}`
    slides.push({
      layout: 'sectionDivider', role: 'section', emphasis: 'normal',
      kicker: `Point ${i + 1}`, heading, visual: scene(`${heading}`),
    })
    if (pt.scripture) {
      slides.push({
        layout: 'scripture', role: 'scripture', emphasis: 'breath',
        kicker: 'Scripture', heading: refOf(pt.scripture) ?? 'Scripture', reference: refOf(pt.scripture),
        visual: scriptureArt(pt.scripture, 300),
      })
    }
    chunkByChars(sentences(pt.body), budget).forEach((g, gi) => {
      slides.push({
        layout: gi % 2 === 0 ? 'figure' : 'split', role: 'teaching', emphasis: 'normal',
        imageSide: gi % 2 === 0 ? 'right' : 'left',
        kicker: `Point ${i + 1}`, heading: gi === 0 ? heading : `${heading} (continued)`,
        body: g, visual: gi === 0 ? scene(`${heading}`) : { type: 'none' },
      })
    })
  })

  // ── Application (every point, in full) ──
  const apps = (s.applications ?? []).map((a) => a?.trim()).filter(Boolean) as string[]
  if (apps.length) {
    chunkByChars(apps.map((a) => a + ' '), 700).forEach((g, gi) => {
      // chunkByChars on items keeps each application intact; recover the items.
      const items = g.map((x) => x.trim())
      slides.push({
        layout: 'bento', role: 'application', emphasis: 'normal',
        kicker: 'Apply This Week', heading: gi === 0 ? 'Living It Out' : 'Living It Out (more)',
        body: items.slice(0, 5), visual: { type: 'none' },
      })
    })
  }

  // ── Conclusion (real text) ──
  if (s.conclusion) {
    chunkByChars(sentences(s.conclusion), budget + 80).slice(0, 2).forEach((g, gi) => {
      slides.push({
        layout: gi === 0 ? 'figure' : 'split', role: 'teaching', emphasis: 'normal', imageSide: 'left',
        kicker: 'Conclusion', heading: gi === 0 ? 'Bringing It Home' : 'Conclusion',
        body: g, visual: gi === 0 ? scene(`${s.theme || s.title}, resolution`) : { type: 'none' },
      })
    })
  }

  // ── Closing prayer ──
  slides.push({
    layout: 'closing', role: s.prayer ? 'prayer' : 'closing', emphasis: 'climax',
    kicker: s.prayer ? 'Closing Prayer' : 'Benediction',
    heading: s.prayer ? 'Let Us Pray' : 'Go in Peace',
    body: s.prayer ? sentences(s.prayer).slice(0, 4) : undefined,
    visual: scene(`${s.theme || s.title}, peaceful benediction`),
  })

  return { meta: { title: s.title, theme: opts.themeId, generatedFor: 'content' }, slides }
}
