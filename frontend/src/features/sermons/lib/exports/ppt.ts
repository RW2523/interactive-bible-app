import PptxGenJS from 'pptxgenjs'
import type { Sermon, StructuredSermon, SermonMedia, ExportTemplateId, SlidePlan } from '../../types'
import { getTheme } from '../sermon/templates'
import { getVisualTheme, mix } from '../visuals/theme'
import { renderProgrammaticVisual, isProgrammatic } from '../visuals'
import { prepareImage, prepareScene } from './image'
import { buildContentPlan } from '../slides/contentPlan'
import { createDeck } from './deck'
import { renderSlide, type SlideVisual } from './layouts'

// Ported from the original sermon builder's deck exporter (formatting kept as-is).

interface ExportOpts {
  templateId?: ExportTemplateId | string | null
  slideCount?: number
  speakerNotes?: string | null
  slidePlan?: SlidePlan | null
}

// Plan-driven PowerPoint engine. A SlidePlan (from the LLM planner, or a
// deterministic fallback) decides each slide's layout and at most one visual.
// Scene visuals are pulled from the AI image pool (media); label-bearing
// visuals (scripture/timeline/map/route/diagram) are rendered programmatically
// to crisp PNGs at export time. Every layout places image and text on a shared
// grid with contrast-safe ink.
export async function generatePPT(
  sermon: Sermon,
  structured: StructuredSermon,
  media: SermonMedia[],
  opts: ExportOpts = {}
): Promise<Blob> {
  const t = getTheme(opts.templateId ?? sermon.export_template)
  const vt = getVisualTheme(t)
  const themeId = (opts.templateId ?? sermon.export_template ?? 'navy_gold') as string

  const plan: SlidePlan = opts.slidePlan?.slides?.length
    ? opts.slidePlan
    : buildContentPlan(structured, { themeId, targetSlideCount: opts.slideCount })

  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Interactive Bible App'
  pptx.title = structured.title || sermon.title

  // ── Raw scene image pool (URLs) for backgrounds ──
  // Combine the user's media library AND the per-slide images the planner
  // generated (stored on the plan, not in sermon_media). This guarantees text
  // slides get a background even when "Design Deck" was used without a
  // separate Stage-3 visual set — so the deck looks the same either way.
  const planImages = plan.slides.map((s) => s.visual?.imageUrl).filter(Boolean) as string[]
  const mediaImages = media.map((m) => m.url).filter(Boolean) as string[]
  const rawPool = Array.from(new Set([...mediaImages, ...planImages]))
  let poolIdx = 0
  const nextRaw = (): string | null => (rawPool.length ? rawPool[poolIdx++ % rawPool.length] : null)

  // Dark colour used to bake gradients/washes so off-white text always reads —
  // theme's own deep tone on dark themes, a warm near-black on light themes.
  const scrimDark = t.mode === 'dark' ? `#${t.bgAlt}` : mix(t.text, '#000000', 0.25)
  const crisp = async (url: string) => (await prepareImage(url))?.dataUrl ?? null

  // Prepare a scene, but if the chosen image fails to load (404 / expired URL /
  // CORS) fall back to other images in the pool so hero/cover/section slides
  // still get a usable background instead of a flat colour rectangle.
  const scene = async (url: string, mode: Parameters<typeof prepareScene>[1]): Promise<string | null> => {
    let out = await prepareScene(url, mode, scrimDark)
    let tries = 0
    while (!out && rawPool.length && tries < rawPool.length) {
      const alt = nextRaw()
      tries++
      if (!alt || alt === url) continue
      out = await prepareScene(alt, mode, scrimDark)
    }
    return out
  }

  // ── Resolve each slide into { main, bg }: smooth baked gradients instead of
  // hard scrim rects, and a background image on (almost) every slide. ──
  const visuals: SlideVisual[] = await Promise.all(
    plan.slides.map(async (spec): Promise<SlideVisual> => {
      if (isProgrammatic(spec.visual.type)) {
        return { main: await renderProgrammaticVisual(spec.visual, vt), bg: null }
      }
      const layout = spec.layout
      if (spec.visual.type === 'scene') {
        const url = spec.visual.imageUrl || nextRaw()
        if (!url) return { main: null, bg: null }
        if (layout === 'cover' || layout === 'closing' || layout === 'fullBleedCaption') {
          return { main: await scene(url, 'heroBottom'), bg: null }
        }
        if (layout === 'sectionDivider') {
          return { main: await scene(url, 'heroLeft'), bg: null }
        }
        if (layout === 'bigStat') {
          return { main: await scene(url, 'wash'), bg: null }
        }
        if (layout === 'figure' || layout === 'showcase' || layout === 'split') {
          const [fg, bg] = await Promise.all([crisp(url), scene(url, 'wash')])
          return { main: fg, bg }
        }
        return { main: null, bg: await scene(url, 'wash') }
      }
      // Text-only slides get a subtle washed background from the image pool so
      // every slide carries imagery (panels/text sit on top, fully readable).
      const bgUrl = nextRaw()
      return { main: null, bg: bgUrl ? await scene(bgUrl, 'wash') : null }
    })
  )

  // ── Render ──
  const c = createDeck(pptx, t)
  let sectionIndex = 0
  plan.slides.forEach((spec, i) => {
    if (spec.layout === 'sectionDivider') sectionIndex += 1
    const slide = renderSlide(c, spec, visuals[i], sectionIndex)
    const noteParts = [spec.heading, ...(spec.body ?? [])].filter(Boolean)
    if (spec.role === 'prayer' && opts.speakerNotes) noteParts.push('\n— SPEAKER NOTES —\n' + opts.speakerNotes)
    slide.addNotes(noteParts.join('\n'))
  })

  return (await pptx.write({ outputType: 'blob' })) as Blob
}
