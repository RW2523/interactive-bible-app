// Sermon Studio domain types — mirror the local FastAPI sermon API (/v1/sermons, /v1/share).

export type SermonStatus = "draft" | "polished" | "multimedia" | "exported" | "published";
export type SermonStage = 1 | 2 | 3 | 4;
export type InputKind = "text" | "dictation" | "audio" | "document" | "bible_ref" | "file";
export type TemplateType =
  | "prayer"
  | "message"
  | "story"
  | "devotional"
  | "teaching"
  | "testimony"
  | "youth"
  | "small_group"
  | "storytelling"
  | "custom";
export type MediaKind = "image" | "map" | "timeline" | "scripture_slide" | "graphic";
export type ExportTemplateId = "navy_gold" | "light_classic" | "royal_purple" | "minimal_slate" | "warm_sand";

// ── Structured sermon model (source of truth for editor + exports) ──
export interface SermonPoint {
  heading: string;
  body: string;
  scripture?: string | null;
}

export interface StructuredSermon {
  title: string;
  theme: string;
  scripture: string;
  introduction: string;
  main_points: SermonPoint[];
  applications: string[];
  conclusion: string;
  prayer: string;
}

export interface SermonTone {
  id: string;
  label: string;
  hint: string;
}

export interface SermonLanguage {
  code: string;
  label: string;
  /** true when the script needs system/browser fonts (not Latin) for faithful PDF rendering */
  complexScript?: boolean;
}

export interface Sermon {
  id: string;
  title: string;
  status: SermonStatus | string;
  current_stage: number;
  scripture_ref: string | null;
  theme: string | null;
  tone: string | null;
  language: string | null;
  export_template: ExportTemplateId | string | null;
  created_at: string;
  updated_at: string;
}

export interface SermonListItem extends Sermon {
  input_count?: number;
  draft_version?: number | null;
  media_count?: number;
  cover_url?: string | null;
  is_published?: boolean;
  /** Public page path when published (not sent by every server version — the dashboard falls back to the detail). */
  share_path?: string | null;
}

export interface BibleRefMeta {
  reference?: string | null;
  canonical?: string | null;
  translation?: string | null;
  verse_text?: string | null;
  notes?: string | null;
}

export interface SermonInput {
  id: string;
  kind: InputKind | string;
  text: string | null;
  raw_text?: string | null;
  transcription?: string | null;
  original_filename?: string | null;
  meta?: (BibleRefMeta & Record<string, unknown>) | null;
  created_at: string;
}

export interface SermonDraft {
  id: string;
  sermon_id: string;
  version: number;
  template_type: TemplateType | string | null;
  structured: StructuredSermon | null;
  polished_html: string | null;
  speaker_notes: string | null;
  slide_plan: SlidePlan | null;
  created_at: string;
  updated_at: string;
}

export interface SermonMedia {
  id: string;
  kind: MediaKind | string;
  prompt: string | null;
  caption: string | null;
  order_index: number;
  url: string | null;
  mime_type?: string | null;
  created_at: string;
}

export interface SocialPosts {
  instagram_caption?: string | null;
  facebook_post?: string | null;
  twitter_thread?: string[] | string | null;
}

export interface OutreachPost {
  id: string;
  share_slug: string;
  is_public: boolean;
  summary: string | null;
  social_caption: string | null;
  hashtags: string[] | null;
  social?: SocialPosts | null;
  published_at?: string | null;
  share_path?: string | null;
}

export interface SermonDetail {
  sermon: Sermon;
  inputs: SermonInput[];
  draft: SermonDraft | null;
  media: SermonMedia[];
  outreach: OutreachPost | null;
}

export interface Suggestions {
  illustrations?: { title: string; description: string }[];
  applications?: { point: string; suggestion: string }[];
  scripture_connections?: { reference: string; connection: string; verse_text?: string | null }[];
  opening_hooks?: string[];
  closing_calls?: string[];
  strengthening_tips?: string[];
}

export interface TemplateSectionInfo {
  name: string;
  subtopics: string[];
}

export interface SermonMeta {
  tones?: SermonTone[];
  languages?: { code: string; label: string; complex_script?: boolean }[];
  templates?: { value: string; label: string; summary: string; sections: TemplateSectionInfo[] }[];
  export_themes?: string[];
}

export interface PlanResponse {
  plan: SlidePlan;
  scenes_generated?: number;
  scenes_reused?: number;
  scenes_requested?: number;
  scenes_failed?: number;
}

export interface SharedSermon {
  title: string;
  scripture_ref: string | null;
  theme: string | null;
  language: string | null;
  author: { display_name: string | null; church: string | null } | null;
  published_at: string | null;
  summary: string | null;
  social_caption: string | null;
  hashtags: string[] | null;
  html: string | null;
  structured: StructuredSermon | null;
  media: { url: string | null; caption: string | null; kind: string }[];
}

// ── Content-aware slide plan (planner output consumed by the export engine) ──
// The planner decides, per slide, one of the named layouts and at most one
// visual via a strict priority cascade (route > map > timeline > diagram >
// scriptureArt > scene > none).

export type LayoutName =
  | "cover" // full-bleed hero, lower-anchored title
  | "fullBleedCaption" // image fills slide, one short phrase
  | "split" // 60/40 image + text (imageSide L/R)
  | "figure" // text + a FRAMED content image with caption
  | "showcase" // a large framed image as the hero subject
  | "scripture" // featured verse, quiet + spacious
  | "bigStat" // one oversized number/word
  | "bento" // asymmetric tile grid
  | "threeCol" // three parallel points
  | "timelineSlide" // sequence / progression
  | "pullQuote" // non-scripture quote
  | "twoUp" // before/after, law/grace
  | "sectionDivider" // numbered section break
  | "closing"; // benediction / sending

export type SlideRole =
  | "cover"
  | "section"
  | "teaching"
  | "scripture"
  | "application"
  | "illustration"
  | "stat"
  | "comparison"
  | "framework"
  | "prayer"
  | "closing";

export type VisualType =
  | "none" // text-only (default, majority)
  | "scene" // AI full-bleed background (label-free)
  | "scriptureArt" // programmatic verse card
  | "map" // programmatic biblical-location map
  | "route" // programmatic ordered journey route
  | "timeline" // programmatic timeline
  | "diagram"; // programmatic concept diagram

export type DiagramShape = "hubSpoke" | "flow" | "compare" | "pyramid" | "list";
export type Emphasis = "normal" | "breath" | "climax";
export type ImageSide = "left" | "right";

export interface VisualSpec {
  type: VisualType;
  /** Human-readable intent (AI subject or diagram purpose). Doubles as a caption for framed content images. */
  spec?: string;
  /** scene only — full cinematic prompt; must forbid text in the image. */
  prompt?: string;
  /** Resolved per-slide AI image URL (filled in after the plan is generated). */
  imageUrl?: string;
  highQuality?: boolean;
  // Structured payloads — exactly the one matching `type` is populated:
  scripture?: { text: string; reference: string };
  places?: Array<{ name: string; note?: string }>;
  routeStops?: Array<{ name: string; order: number; note?: string }>;
  events?: Array<{ label: string; date?: string; note?: string }>;
  diagram?: {
    shape: DiagramShape;
    center?: string;
    nodes: Array<{ label: string; detail?: string }>;
    leftHeader?: string;
    rightHeader?: string;
    leftItems?: string[];
    rightItems?: string[];
  };
}

export interface SlideSpec {
  layout: LayoutName;
  role: SlideRole;
  emphasis: Emphasis;
  kicker?: string; // tracked-caps eyebrow, <= 4 words
  heading: string; // <= 10 words, the single headline
  subheading?: string;
  body?: string[]; // 0–5 short lines
  reference?: string; // scripture ref / attribution
  stat?: { value: string; label?: string };
  imageSide?: ImageSide;
  visual: VisualSpec;
}

export interface SlidePlan {
  meta: { title: string; theme: string; generatedFor: string };
  slides: SlideSpec[];
}
