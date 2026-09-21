import type { VisualSpec } from '../../types'
import type { VisualTheme } from './theme'
import { svgToDataUrl } from './svg'
import { scriptureCardSvg } from './scriptureCard'
import { timelineSvg } from './timeline'
import { diagramSvg } from './diagram'
import { mapSvg, routeSvg } from './atlas'

// Render a programmatic, label-bearing visual to a data URL. Returns null for
// 'scene'/'none' (scene images come from the AI media pool, handled by the
// export engine) and on any failure — callers fall back to a clean text slide.
export async function renderProgrammaticVisual(spec: VisualSpec, vt: VisualTheme): Promise<string | null> {
  try {
    let svg: string | null = null
    switch (spec.type) {
      case 'scriptureArt':
        if (spec.scripture?.text) svg = scriptureCardSvg(spec.scripture, vt)
        break
      case 'timeline':
        if (spec.events?.length) svg = timelineSvg(spec.events, vt)
        break
      case 'diagram':
        // compare uses left/right item lists, not nodes; others need >=2 nodes.
        if (spec.diagram && (spec.diagram.shape === 'compare' ? (spec.diagram.leftItems?.length || spec.diagram.rightItems?.length) : (spec.diagram.nodes?.length ?? 0) >= 2)) {
          svg = diagramSvg(spec.diagram, vt)
        }
        break
      case 'map':
        if (spec.places?.length) svg = mapSvg(spec.places, vt)
        break
      case 'route':
        if (spec.routeStops?.length) svg = routeSvg(spec.routeStops, vt)
        break
      default:
        return null
    }
    if (!svg) {
      console.warn(`Visual "${spec.type}" skipped: missing or insufficient payload`)
      return null
    }
    return await svgToDataUrl(svg, 1600, 900, vt.bgDeep)
  } catch (err) {
    console.warn(`Visual "${spec.type}" failed to render:`, err)
    return null
  }
}

/** Whether a visual type is rendered programmatically (vs an AI scene). */
export function isProgrammatic(type: VisualSpec['type']): boolean {
  return type === 'scriptureArt' || type === 'timeline' || type === 'diagram' || type === 'map' || type === 'route'
}
