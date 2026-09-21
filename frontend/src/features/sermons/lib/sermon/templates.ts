import type { ExportTemplateId, SermonTone, SermonLanguage } from '../../types'

// All colors are 6-digit hex WITHOUT the leading '#'.
// pptxgenjs wants them bare; jsPDF/CSS get a '#' prepended via withHash().
export interface ExportTheme {
  id: ExportTemplateId
  label: string
  mode: 'dark' | 'light'
  bg: string        // primary slide / page background
  bgAlt: string     // section dividers / deep background
  panel: string     // cards, strips, watermark fill
  accent: string    // gold / brand accent (rules, kickers, bullets)
  text: string      // primary body text on bg
  textMuted: string // secondary text (footers, dates)
  heading: string   // heading text color on bg
  serif: string     // display / heading font
  sans: string      // body font
}

export const EXPORT_THEMES: Record<ExportTemplateId, ExportTheme> = {
  navy_gold: {
    id: 'navy_gold', label: 'Navy & Gold', mode: 'dark',
    bg: '0F1B33', bgAlt: '0A1326', panel: '16243F', accent: 'E3B448',
    text: 'F5F1E6', textMuted: '8FA1BE', heading: 'FFFFFF',
    serif: 'Georgia', sans: 'Calibri',
  },
  royal_purple: {
    id: 'royal_purple', label: 'Royal Purple', mode: 'dark',
    bg: '241046', bgAlt: '180A33', panel: '33196B', accent: 'D9B44A',
    text: 'F3ECFB', textMuted: 'A892C8', heading: 'FFFFFF',
    serif: 'Georgia', sans: 'Calibri',
  },
  minimal_slate: {
    id: 'minimal_slate', label: 'Minimal Slate', mode: 'dark',
    bg: '1E232B', bgAlt: '141820', panel: '2B323D', accent: '8AB4F8',
    text: 'EAEEF5', textMuted: '94A0B3', heading: 'FFFFFF',
    serif: 'Calibri', sans: 'Calibri',
  },
  light_classic: {
    id: 'light_classic', label: 'Light Classic', mode: 'light',
    bg: 'FBF8F1', bgAlt: 'F1EADB', panel: 'EFE7D6', accent: 'A8741A',
    text: '2B2117', textMuted: '6B5E48', heading: '241B10',
    serif: 'Georgia', sans: 'Calibri',
  },
  warm_sand: {
    id: 'warm_sand', label: 'Warm Sand', mode: 'light',
    bg: 'F6EFE2', bgAlt: 'EADCC4', panel: 'EADCC4', accent: 'B5651D',
    text: '3A2A1A', textMuted: '7A6750', heading: '2E2012',
    serif: 'Georgia', sans: 'Calibri',
  },
}

export const DEFAULT_TEMPLATE: ExportTemplateId = 'navy_gold'

export function getTheme(id?: string | null): ExportTheme {
  return EXPORT_THEMES[(id as ExportTemplateId)] ?? EXPORT_THEMES[DEFAULT_TEMPLATE]
}

export const withHash = (hex: string) => (hex.startsWith('#') ? hex : `#${hex}`)

/** WCAG relative luminance of a bare hex color. */
export function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const lin = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

/** Pick the more readable of light/dark text for a given background. */
export function contrastText(bgHex: string, light = 'F5F1E6', dark = '20160B'): string {
  return luminance(bgHex) > 0.4 ? dark : light
}

// ── Tone presets shape the generated sermon's voice ──
export const TONES: SermonTone[] = [
  { id: 'Inspirational', label: 'Inspirational', hint: 'Uplifting, hope-filled, encouraging' },
  { id: 'Teaching', label: 'Teaching', hint: 'Expository, clear, instructional' },
  { id: 'Evangelistic', label: 'Evangelistic', hint: 'Bold gospel invitation, urgency' },
  { id: 'Devotional', label: 'Devotional', hint: 'Intimate, reflective, personal' },
  { id: 'Youth', label: 'Youth', hint: 'Energetic, relatable, contemporary' },
  { id: 'Prophetic', label: 'Prophetic', hint: 'Weighty, exhortational, scripture-saturated' },
]

export const DEFAULT_TONE = 'Inspirational'

// ── Languages (complexScript => print path renders most faithfully) ──
export const LANGUAGES: SermonLanguage[] = [
  { code: 'English', label: 'English' },
  { code: 'Spanish', label: 'Español' },
  { code: 'French', label: 'Français' },
  { code: 'Portuguese', label: 'Português' },
  { code: 'German', label: 'Deutsch' },
  { code: 'Swahili', label: 'Kiswahili' },
  { code: 'Hindi', label: 'हिन्दी', complexScript: true },
  { code: 'Tamil', label: 'தமிழ்', complexScript: true },
  { code: 'Telugu', label: 'తెలుగు', complexScript: true },
  { code: 'Malayalam', label: 'മലയാളം', complexScript: true },
]

export const DEFAULT_LANGUAGE = 'English'

export function isComplexScript(language?: string | null): boolean {
  return LANGUAGES.find((l) => l.code === language)?.complexScript ?? false
}

// ── Slide-count control ──
export const SLIDE_COUNT = { min: 8, max: 20, default: 12 } as const

// ── BCP-47 codes for the supported sermon languages (html lang, speech recognition) ──
const LANGUAGE_CODES: Record<string, { lang: string; speech: string }> = {
  English: { lang: 'en', speech: 'en-US' },
  Spanish: { lang: 'es', speech: 'es-ES' },
  French: { lang: 'fr', speech: 'fr-FR' },
  Portuguese: { lang: 'pt', speech: 'pt-BR' },
  German: { lang: 'de', speech: 'de-DE' },
  Swahili: { lang: 'sw', speech: 'sw-KE' },
  Hindi: { lang: 'hi', speech: 'hi-IN' },
  Tamil: { lang: 'ta', speech: 'ta-IN' },
  Telugu: { lang: 'te', speech: 'te-IN' },
  Malayalam: { lang: 'ml', speech: 'ml-IN' },
}

/** HTML `lang` code for a sermon language name ("Hindi" -> "hi"). */
export function languageCode(language?: string | null): string {
  return LANGUAGE_CODES[language ?? '']?.lang ?? 'en'
}

/** Speech-recognition locale for a sermon language name ("Tamil" -> "ta-IN"). */
export function speechLocale(language?: string | null): string {
  return LANGUAGE_CODES[language ?? '']?.speech ?? 'en-US'
}
