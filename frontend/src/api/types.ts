export type RelationshipType = "direct_reference" | "scripture_quote" | "contextual_reference" | "ai_related";
export type MediaKind = "watch" | "listen" | "study";

export interface RelationshipLabel {
  type: RelationshipType;
  label: string;
  human_verified: boolean;
  trust: string;
  confidence_label: string;
  note: string | null;
  detected_type: RelationshipType;
  subtype?: string | null;
  confidence: number;
  primary?: boolean;
  mention_count?: number;
  passage_note?: string | null;
}

export interface ResourceSummary {
  id: string;
  title: string;
  type: string;
  category: string;
  speaker?: string | null;
  author?: string | null;
  duration_ms?: number | null;
  page_count?: number | null;
  is_official?: boolean;
  visibility?: string;
  language?: string;
  series?: string | null;
  /** 16:9 still for video resources (YouTube's own thumbnail). */
  thumbnail_url?: string | null;
  /** Set when the video is hosted on YouTube and plays in YouTube's embed. */
  youtube_id?: string | null;
}

export interface YoutubeChapter {
  title: string;
  start_ms: number;
  end_ms?: number | null;
}

export interface YoutubeCaptionTrack {
  language: string;
  kind: "manual" | "auto";
  name?: string | null;
}

export interface YoutubeCaptions {
  tracks: YoutubeCaptionTrack[];
  best: YoutubeCaptionTrack | null;
}

/** What the server stored about a video that stays on YouTube. */
export interface YoutubeMeta {
  video_id: string;
  channel?: string | null;
  thumbnail?: string | null;
  duration_ms?: number | null;
  upload_date?: string | null;
  watch_url?: string | null;
  embed_url?: string | null;
  chapters?: YoutubeChapter[];
  captions?: YoutubeCaptions | null;
}

/** POST /v1/resources/inspect-url for a YouTube link. */
export interface UrlInspection {
  provider: "youtube";
  video_id: string;
  title: string;
  channel?: string | null;
  duration_ms?: number | null;
  thumbnail?: string | null;
  upload_date?: string | null;
  language?: string | null;
  watch_url: string;
  embed_url: string;
  chapters: YoutubeChapter[];
  captions: YoutubeCaptions | null;
  captions_available: boolean;
  captions_kind: "manual" | "auto" | null;
  transcript_source: "captions" | "gemini";
  suggested: {
    type: string;
    category: string;
    title: string;
    author?: string | null;
    speaker?: string | null;
    duration_ms?: number | null;
    language?: string | null;
    rights_status: string;
    allow_clip_export: boolean;
    url: string;
  };
}

export interface ClipRange {
  start_ms: number;
  end_ms: number;
  core_start_ms?: number | null;
  core_end_ms?: number | null;
  reviewed?: boolean;
}

export interface ResourceCardData {
  id?: string;
  mapping_id: string | null;
  segment_id: string;
  media_kind: MediaKind;
  resource: ResourceSummary;
  verse_ref: string | null;
  verse_display: string | null;
  segment: { ordinal: number; start_ms: number | null; end_ms: number | null; page_start: number | null; page_end: number | null; heading: string | null };
  clip: ClipRange | null;
  summary: string | null;
  excerpt: string | null;
  evidence_text: string | null;
  why_related: string | null;
  relationship: RelationshipLabel | null;
  review_status?: string;
  rank_score?: number;
  score?: number;
  reasons?: string[];
}

export interface VerseLine {
  ref: string;
  number: number;
  text: string;
  translations: Record<string, string>;
}

export interface RelatedVerse {
  ref: string;
  display_ref: string;
  text: string;
  relationship: string;
  label: string;
  score: number;
  why: string;
  why_status: "ready" | "pending" | "template" | "unavailable";
  why_confidence: number | null;
  sources: string[];
  relationship_ids: number[];
  is_ai: boolean;
}

export interface Theme {
  id: string;
  slug: string;
  name: string;
  category?: string;
  confidence: number;
  sources?: string[];
}

export interface EntityItem {
  id: string;
  name: string;
  type: string;
  description?: string | null;
  source: string;
  passage?: string | null;
  confidence: number;
}

export interface VerseIntelligence {
  verse: {
    ref: string;
    display_ref: string;
    start: number;
    end: number;
    translation: string;
    text: string;
    verses: VerseLine[];
    book: { code: string; name: string; chapter: number; verse: number };
  };
  counts: { video: number; audio: number; study: number; related_verses: number; themes: number; people_events: number };
  top_resources: ResourceCardData[];
  sections: Record<MediaKind, ResourceCardData[]>;
  themes: Theme[];
  entities: { people: EntityItem[]; places: EntityItem[]; events: EntityItem[] };
  book_context: { code: string; name: string; testament: string; genre: string; attribution: string | null };
  related_verses: RelatedVerse[];
  map_preview: { nodes: number; top: { type: string; label: string }[] };
  ai_available: boolean;
  provenance: { last_updated: string | null; pipeline_versions: string[]; cache: string; confidence_note: string; latency_ms: number };
}

export interface ChapterVerse {
  number: number;
  ref: string;
  text: string | null;
  indicators: { watch: number; listen: number; study: number; total: number; explicit: boolean } | null;
}

export interface Chapter {
  book: { code: string; name: string; chapters: number; testament: string; genre: string };
  chapter: number;
  translation: string;
  verses: ChapterVerse[];
  chapter_resources: number;
  prev: { book: string; chapter: number } | null;
  next: { book: string; chapter: number } | null;
}

export interface Book {
  code: string;
  name: string;
  testament: string;
  genre: string;
  chapters: number;
  ordinal: number;
}

export interface Translation {
  id: string;
  name: string;
  abbreviation: string;
  license: string;
  is_default: boolean;
}

export interface Unit {
  id: string;
  start: number;
  end: number;
  start_ms: number | null;
  end_ms: number | null;
  page: number | null;
  speaker: string | null;
  kind: string;
}

export interface MappingSummary {
  mapping_id: string;
  verse_ref: string;
  verse_display: string;
  relationship: RelationshipLabel;
  evidence_text: string | null;
  evidence_offsets: { start: number; end: number; start_ms?: number | null; end_ms?: number | null }[];
  mention_count: number;
  why_related: string | null;
  review_status?: string;
  needs_review?: boolean;
  review_reasons?: string[];
}

export interface Playback {
  mode: "local" | "embed" | "none" | "document" | "text";
  media_type: string;
  url?: string;
  mime_type?: string;
  provider?: string;
  youtube_id?: string;
  captions_url?: string;
  document_url?: string;
}

export interface ClipDetails {
  segment_id: string;
  resource: ResourceSummary & { rights_status: string };
  segment: { ordinal: number; start_ms: number | null; end_ms: number | null; page_start: number | null; page_end: number | null; heading: string | null; summary: string | null; text: string; units: Unit[] };
  clip: ClipRange & { reason: string | null; confidence: number | null; review_status: string; virtual: boolean };
  primary_verse: ClipVerse | null;
  verses: ClipVerse[];
  playback: Playback;
  can_export: boolean;
  export_blocked_reason: string | null;
  navigation: { previous_segment: string | null; next_segment: string | null };
  caption_copy: unknown;
}

export interface ClipVerse {
  mapping_id: string;
  ref: string;
  display_ref: string;
  text: string | null;
  primary: boolean;
  relationship: RelationshipLabel;
  evidence_text: string | null;
  evidence_offsets: { start: number; end: number }[];
  why_related: string | null;
  mention_count: number;
}

export interface ResourceDetail extends ResourceSummary {
  description: string | null;
  source_kind: string;
  rights_status: string;
  allow_clip_export: boolean;
  requires_review: boolean;
  status: string;
  created_at: string;
  processed_at: string | null;
  can_edit: boolean;
  capabilities: { playback: string; clip_export: boolean; download: boolean };
  playback: Playback;
  topics: { id: string; name: string; slug: string; segments: number }[];
  entities: { id: string; name: string; type: string; segments: number }[];
  has_captions: boolean;
  transcript_mode: string;
  verse_hints: string[];
  topic_hints: string[];
  last_run_id: string | null;
  source_url?: string;
  owner_id?: string;
  source_hash?: string;
  original_filename?: string | null;
  size_bytes?: number | null;
  /** Present when the resource is a YouTube video (playback stays on YouTube). */
  youtube?: YoutubeMeta | null;
  thumbnail_url?: string | null;
  /** Where the sermon sits inside a service recording, and what the other parts are */
  message?: { start_ms: number | null; end_ms: number | null; confidence: number | null; reason: string | null; parts?: Record<string, number> } | null;
}

export interface SegmentItem {
  id: string;
  ordinal: number;
  start_ms: number | null;
  end_ms: number | null;
  page_start: number | null;
  page_end: number | null;
  heading: string | null;
  speaker: string | null;
  summary: string | null;
  topic_hint: string | null;
  text: string;
  units: Unit[];
  transcript_raw?: string;
  clip: (ClipRange & { reason: string | null; confidence: number | null; review_status: string }) | null;
  mappings: MappingSummary[];
  topics: { name: string; slug: string; confidence: number }[];
  /** message | worship | welcome | announcements | prayer | scripture_reading | communion | testimony | other */
  part?: string;
  /** share of the section the captions marked as music/singing (≥ 0.6 is a sung section) */
  non_speech_ratio?: number;
}

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  score: number;
  ref?: string;
  slug?: string;
  resource_id?: string;
  entity_id?: string;
  start_ms?: number | null;
  page?: number | null;
  summary?: string | null;
  description?: string | null;
  text?: string;
  media_kind?: string;
  resource_type?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
  confidence: number | null;
  relationship_type?: string;
  human_verified?: boolean;
  why?: string | null;
  why_status?: string;
  ai?: boolean;
  mapping_id?: string;
}

export interface ScriptureMap {
  root: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  list: { type: string; items: { node: GraphNode; edge: GraphEdge }[] }[];
}

export interface SearchVerse {
  id: string;
  ref: string;
  display_ref: string;
  text: string;
  score: number;
  reasons: string[];
  match_types: string[];
}

export interface SearchResponse {
  query: string;
  parsed: { explicit_refs: string[]; topics: string[]; entities: string[]; resource_types: string[]; semantic_query: string; search_scope: string; parser: string };
  scope: string;
  verses: SearchVerse[];
  segments: ResourceCardData[];
  explanation: string;
  reranked: boolean;
  semantic: boolean;
  latency_ms: number;
}

export interface Viewer {
  authenticated: boolean;
  id: string | null;
  role: "anonymous" | "member" | "editor" | "admin";
  email: string | null;
  display_name: string | null;
  church?: string | null;
  organization_ids: string[];
  /** "single_user": personal mode on this computer — no sign-in, the owner account has full access */
  auth_mode?: "single_user" | "accounts";
  allow_signup?: boolean;
}

export interface AskResponse {
  answer: string;
  citations: { kind: "verse" | "segment"; id: string; label: string; resource_id?: string; media_kind?: string }[];
  interpretive_note: string | null;
  confidence: number;
  disclaimer: string;
  ungrounded_citations_removed: string[];
}

export interface WhyResponse {
  why: string | null;
  confidence?: number | null;
  status: string;
  relationship?: string;
  sources?: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export interface ExploreByVerse {
  events: { id: string; title: string; references: string[]; era: string }[];
  timeline: { id: string; title: string; dateLabel: string; referenceText: string }[];
}
