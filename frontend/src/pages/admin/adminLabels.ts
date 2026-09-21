/**
 * Plain-language vocabulary for the admin area.
 * The backend speaks in codes (ING-09, pending_review, ai_match_below_display_bar…); the owner should never have to.
 */

export type Tone = "ok" | "warn" | "danger" | "info" | "neutral" | "progress" | "brand";

// ───────────────────────────────────────────────────────────── resources

export const RESOURCE_TYPES: Record<string, { label: string; plural: string }> = {
  video: { label: "Video", plural: "Videos" },
  audio: { label: "Audio", plural: "Audio" },
  pdf: { label: "PDF", plural: "PDFs" },
  document: { label: "Document", plural: "Documents" },
  article: { label: "Article", plural: "Articles" },
  native: { label: "Written text", plural: "Written texts" },
  generated: { label: "AI-generated text", plural: "AI-generated texts" },
};

export const typeLabel = (type?: string | null) => (type ? RESOURCE_TYPES[type]?.label ?? humanize(type) : "");

export const CATEGORIES: [string, string][] = [
  ["sermon", "Sermon"],
  ["podcast", "Podcast"],
  ["study", "Bible study"],
  ["devotional", "Devotional"],
  ["teaching", "Teaching"],
  ["article", "Article"],
  ["sermon_notes", "Sermon notes"],
  ["study_plan", "Study plan"],
  ["worship", "Worship"],
  ["other", "Other"],
];

export const categoryLabel = (c?: string | null) => (c ? CATEGORIES.find(([id]) => id === c)?.[1] ?? humanize(c) : "");

export const VISIBILITY: Record<string, { label: string; description: string }> = {
  public: { label: "Public", description: "Anyone using the app can find it from the verses it talks about." },
  organization: { label: "Church members", description: "Only people in your church or organization can find it." },
  unlisted: { label: "Unlisted", description: "Hidden from verse pages and search — only people with the direct link can open it." },
  private: { label: "Private", description: "Only you can see it." },
};

export const RIGHTS: Record<string, { label: string; description: string }> = {
  owned: { label: "We own it", description: "Your church made it. Clips can be played and, if you allow it, downloaded." },
  licensed: { label: "Licensed", description: "You have permission to use it, including clips." },
  embed_only: { label: "Embedded playback only", description: "Someone else's content (for example a YouTube video). It plays inside their player only." },
  unknown: { label: "Not sure yet", description: "Nothing plays until you confirm the rights. Verse links still work." },
};

export const LANGUAGES: [string, string][] = [
  ["en", "English"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["pt", "Portuguese"],
  ["de", "German"],
  ["it", "Italian"],
  ["nl", "Dutch"],
  ["ru", "Russian"],
  ["ar", "Arabic"],
  ["hi", "Hindi"],
  ["ta", "Tamil"],
  ["te", "Telugu"],
  ["ml", "Malayalam"],
  ["zh", "Chinese"],
  ["ko", "Korean"],
  ["ja", "Japanese"],
  ["id", "Indonesian"],
  ["tl", "Tagalog"],
  ["sw", "Swahili"],
  ["yo", "Yoruba"],
  ["am", "Amharic"],
];

export const languageLabel = (code?: string | null) => (code ? LANGUAGES.find(([c]) => c === code)?.[1] ?? code.toUpperCase() : "");

export const TRANSCRIPT_MODES: Record<string, { label: string; description: string }> = {
  auto: { label: "Automatic (recommended)", description: "Uses your captions file if you add one, otherwise AI transcription." },
  gemini: { label: "Always use AI transcription", description: "Transcribes with AI even when captions are attached." },
  captions: { label: "Captions file only", description: "Uses only your captions — no AI transcription." },
};

/** Resource lifecycle status (resources.status). */
export const RESOURCE_STATUS: Record<string, { label: string; tone: Tone; description: string }> = {
  draft: { label: "Draft", tone: "neutral", description: "Saved, but the file hasn't been added or processing hasn't started." },
  ready: { label: "Ready to process", tone: "neutral", description: "Everything is in place — start processing when you're ready." },
  queued: { label: "Waiting to start", tone: "progress", description: "In line for a background worker." },
  processing: { label: "Processing", tone: "progress", description: "Being read, split into sections and linked to Scripture." },
  processed: { label: "Ready", tone: "ok", description: "Processed and available in the library." },
  failed: { label: "Needs attention", tone: "danger", description: "Processing stopped with an error." },
};

export const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Waiting to start", tone: "progress" },
  running: { label: "Processing", tone: "progress" },
  succeeded: { label: "Finished", tone: "ok" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Waiting", tone: "progress" },
  running: { label: "Running", tone: "progress" },
  succeeded: { label: "Done", tone: "ok" },
  failed: { label: "Failed — will retry", tone: "warn" },
  dead: { label: "Stopped after retries", tone: "danger" },
};

export const JOB_TYPES: Record<string, string> = {
  process_resource: "Process a library item",
  embed_bible: "Build the Bible search index",
  export_clip: "Export a clip",
  export_story_video: "Export a story video",
};

// ───────────────────────────────────────────────────────────── pipeline stages

export interface StageInfo {
  title: string;
  description: string;
  phase: 0 | 1 | 2 | 3;
}

export const PHASES = ["Read it", "Find Scripture", "Enrich", "Publish"] as const;

/** Stage order matches the pipeline (backend orchestrator STAGES). */
export const STAGE_ORDER = ["ING-01", "ING-02", "ING-03", "ING-04", "ING-05", "ING-05B", "ING-06", "ING-07", "ING-08", "ING-09", "ING-10", "ING-11", "ING-12", "AUDIT", "ING-15", "ING-13", "ING-14", "ING-16"];

export const STAGES: Record<string, StageInfo> = {
  "ING-01": { phase: 0, title: "Check the item", description: "Makes sure the file or text is ready to work with." },
  "ING-02": { phase: 0, title: "Keep the original safe", description: "Stores the original so nothing is ever lost." },
  "ING-03": { phase: 0, title: "Read or transcribe", description: "Pulls out the words — transcribes recordings or reads documents." },
  "ING-04": { phase: 0, title: "Tidy the text", description: "Cleans up the transcript and hides emails or phone numbers if you asked." },
  "ING-05": { phase: 1, title: "Split into sections", description: "Breaks it into short sections, each about one idea." },
  "ING-05B": { phase: 1, title: "Find the message", description: "Works out which part of a recording is the sermon, so songs, welcome and announcements are left out." },
  "ING-06": { phase: 1, title: "Find Bible references", description: "Spots verses mentioned by name, like “Romans 8:28”." },
  "ING-07": { phase: 1, title: "Find quotations", description: "Recognises Scripture that is quoted or paraphrased." },
  "ING-08": { phase: 1, title: "Look for related verses", description: "Searches the Bible for verses about the same ideas." },
  "ING-09": { phase: 1, title: "Check verse links with AI", description: "AI confirms each link and decides how the verse is used." },
  "ING-10": { phase: 2, title: "Tag topics and people", description: "Adds topics, people, places and events." },
  "ING-11": { phase: 2, title: "Write section summaries", description: "Writes a short summary for each section." },
  "ING-12": { phase: 2, title: "Choose clips", description: "Picks good start and end points for short video or audio clips." },
  AUDIT: { phase: 2, title: "Double-check quality", description: "A second AI pass looks for weak or wrong verse links." },
  "ING-15": { phase: 3, title: "Decide what needs review", description: "Shows confident links and sends uncertain ones to your Review queue." },
  "ING-13": { phase: 3, title: "Save verse links", description: "Saves the links with a record of how each one was found." },
  "ING-14": { phase: 3, title: "Update search", description: "Makes the new sections searchable." },
  "ING-16": { phase: 3, title: "Publish", description: "Makes the approved verse links visible to readers." },
};

export function stageTitle(id?: string | null): string {
  if (!id) return "";
  return STAGES[id]?.title ?? id;
}

/** 1-based position of a stage in the pipeline, or 0 when unknown. */
export function stageStep(id?: string | null): number {
  if (!id) return 0;
  return STAGE_ORDER.indexOf(id) + 1;
}

const TRANSCRIPT_METHOD: Record<string, string> = {
  gemini_transcription: "Transcribed with AI",
  gemini_youtube_transcription: "Transcribed the YouTube video with AI",
  youtube_captions: "Read the video's own captions from YouTube (no AI transcription)",
  captions: "Used your captions file (no AI transcription)",
  markdown: "Read the text",
  native: "Read the text",
  docx: "Read the Word document",
  html: "Read the web page",
  pdf_text: "Read the PDF text",
  pdf_ocr: "Read the scanned PDF",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** A friendly one-line summary of what a finished stage produced. Unknown details are left for the technical view. */
export function stageSummary(id: string, detail: Record<string, unknown> | null | undefined): string | null {
  if (!detail) return null;
  const d = detail as Record<string, number | string | Record<string, number> | undefined>;
  const n = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : null);
  const parts: string[] = [];
  if (typeof d.reason === "string") parts.push(`Skipped — ${d.reason}`);
  switch (id) {
    case "ING-01":
      if ((detail as Record<string, unknown>).ai_enabled === false) parts.push("AI is off, so only the non-AI steps will run");
      break;
    case "ING-03":
      if (d.reused_transcript) parts.push("Reused the earlier transcript — no new AI cost");
      else if (typeof d.method === "string") parts.push(TRANSCRIPT_METHOD[d.method] ?? humanize(d.method));
      if (n("raw_units") != null) parts.push(plural(n("raw_units")!, "sentence"));
      else if (n("cues") != null) parts.push(plural(n("cues")!, "caption line"));
      break;
    case "ING-04":
      if (n("characters") != null) parts.push(`${n("characters")!.toLocaleString()} characters`);
      if (n("pii_redactions")) parts.push(`${plural(n("pii_redactions")!, "email or phone number", "emails or phone numbers")} hidden`);
      break;
    case "ING-05":
      if (n("segments") != null) parts.push(plural(n("segments")!, "section"));
      break;
    case "ING-06":
      if (n("explicit_references") != null) parts.push(plural(n("explicit_references")!, "reference") + " found");
      break;
    case "ING-07":
      if (n("quotes") != null) parts.push(plural(n("quotes")!, "quotation"));
      if (n("contextual") != null) parts.push(plural(n("contextual")!, "story reference"));
      break;
    case "ING-08":
      if (n("embedded_segments") != null) parts.push(`${plural(n("embedded_segments")!, "section")} compared with the Bible`);
      break;
    case "ING-09":
      if (n("mappings") != null) parts.push(plural(n("mappings")!, "verse link"));
      if (n("ai_related_candidates") != null) parts.push(plural(n("ai_related_candidates")!, "AI suggestion"));
      break;
    case "ING-10":
      if (n("topics") != null) parts.push(plural(n("topics")!, "tag"));
      break;
    case "ING-11":
      if (n("summaries") != null) parts.push(plural(n("summaries")!, "summary", "summaries"));
      break;
    case "ING-12":
      if (n("clips") != null) parts.push(plural(n("clips")!, "clip"));
      break;
    case "AUDIT":
      if (n("audited_segments") != null) parts.push(`${plural(n("audited_segments")!, "section")} double-checked`);
      break;
    case "ING-15": {
      const bits = (["published", "pending_review", "index_only", "discarded"] as const).filter((k) => n(k)).map((k) => `${n(k)} ${REVIEW_STATUS[k].short.toLowerCase()}`);
      parts.push(...bits);
      break;
    }
    case "ING-13":
      if (n("affected_verses") != null) parts.push(`${plural(n("affected_verses")!, "verse")} updated`);
      break;
    case "ING-14":
      if (n("segments_indexed") != null) parts.push(`${plural(n("segments_indexed")!, "section")} searchable`);
      break;
    case "ING-16":
      if (n("visible_mappings") != null) parts.push(`${plural(n("visible_mappings")!, "link")} visible to readers`);
      if (n("in_review_queue")) parts.push(`${n("in_review_queue")} sent to review`);
      break;
  }
  return parts.length ? parts.join(" · ") : null;
}

// ───────────────────────────────────────────────────────────── verse links (mappings)

export const RELATIONSHIPS: Record<string, { label: string; description: string; example: string }> = {
  direct_reference: {
    label: "Direct mention",
    description: "The speaker or writer names the verse.",
    example: "“Turn with me to Romans 8:28…”",
  },
  scripture_quote: {
    label: "Scripture quote",
    description: "The words of the verse are quoted or closely paraphrased, even without naming it.",
    example: "“…all things work together for good…”",
  },
  contextual_reference: {
    label: "Story or passage",
    description: "It talks about a Bible story or passage without quoting it.",
    example: "“When Joseph forgave his brothers…”",
  },
  ai_related: {
    label: "AI related",
    description: "AI thinks the verse is about the same idea. The least certain kind of link.",
    example: "A section on grief linked to Psalm 34:18",
  },
};

export const REL_TYPES = Object.keys(RELATIONSHIPS);
export const relLabel = (t?: string | null) => (t ? RELATIONSHIPS[t]?.label ?? humanize(t) : "");

/** Mapping review statuses, from most to least visible. */
export const REVIEW_STATUS: Record<string, { label: string; short: string; tone: Tone; description: string }> = {
  published: { label: "Shown to readers", short: "Shown", tone: "ok", description: "Confident enough to show automatically." },
  approved: { label: "Approved", short: "Approved", tone: "ok", description: "Checked and approved by a person." },
  index_only: { label: "Search only", short: "Search only", tone: "info", description: "A weak match: it helps search, but isn't shown on verse pages." },
  pending_review: { label: "Waiting for review", short: "Waiting", tone: "warn", description: "Hidden from readers until someone approves it." },
  rejected: { label: "Rejected", short: "Rejected", tone: "danger", description: "Rejected by a person. It stays hidden, even after reprocessing." },
  discarded: { label: "Discarded", short: "Discarded", tone: "neutral", description: "Too unlikely to keep (below 65% confidence)." },
};

export const reviewStatusLabel = (s?: string | null) => (s ? REVIEW_STATUS[s]?.label ?? humanize(s) : "");

/** Visibility buckets used by the charts (ordinal: most → least visible). */
export const VISIBILITY_BUCKETS = [
  { key: "shown", label: "Shown to readers", statuses: ["published", "approved"] },
  { key: "search", label: "Search only", statuses: ["index_only"] },
  { key: "waiting", label: "Waiting for review", statuses: ["pending_review"] },
  { key: "hidden", label: "Hidden", statuses: ["discarded", "rejected"] },
] as const;

export interface ConfidenceBand {
  label: string;
  tone: Tone;
  meaning: string;
}

/** Bands mirror the backend routing rules (pipeline/routing.py). */
export function confidenceBand(value: number): ConfidenceBand {
  if (value >= 0.95) return { label: "Very high", tone: "ok", meaning: "Shown to readers automatically." };
  if (value >= 0.9) return { label: "High", tone: "ok", meaning: "Shown to readers automatically." };
  if (value >= 0.8) return { label: "Medium", tone: "info", meaning: "Shown, but flagged for a second look." };
  if (value >= 0.65) return { label: "Weak", tone: "warn", meaning: "Kept for search only, or sent to review." };
  return { label: "Low", tone: "danger", meaning: "Too unlikely — discarded automatically." };
}

export const pct0 = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "–" : `${Math.round(v * 100)}%`);

const REASONS: Record<string, string> = {
  ai_match_below_display_bar: "AI suggestion that isn't strong enough to show",
  audit_needs_review: "The AI double-check wasn't sure",
  audit_rejected: "The AI double-check thinks it's wrong",
  audit_disputed_explicit_reference: "The AI double-check disputes a named reference",
  audit_missing: "The AI double-check skipped it",
  audit_unavailable: "The AI double-check was unavailable",
  editorial_review_required: "Your settings require approval for this item",
  weak_candidate: "Weak match (65–79% confidence)",
  uncertain_confidence_band: "Medium confidence (80–89%)",
  "below_0.65": "Very weak match (below 65%)",
  unverified_reference_form: "Reference written in an unusual way",
  verification_unavailable: "AI couldn't verify it",
  llm_corrected_reference: "AI corrected the reference",
  llm_did_not_confirm_reference: "AI couldn't confirm the reference",
  llm_only_reference: "Only AI found this reference",
  quote_evidence_not_grounded: "Quoted words weren't found exactly",
  semantic_evidence_not_grounded: "The supporting words weren't found in the text",
  generic_passage_alias: "Common phrase that might mean another passage",
  inherited_context: "Carried over from a nearby section",
  inherited_passage_context: "Carried over from a nearby section",
  p05_downgraded: "AI lowered how the verse is used",
  p05_omitted: "AI left it out when classifying",
  unverified_partial_quote: "Partial quotation",
  unverified_short_quote: "Very short quotation",
  weak_lexical_overlap: "Only a few words match",
  weaker_match_for_same_evidence: "A stronger verse matches the same words",
  user_reported_not_relevant: "A reader said it's not relevant",
  user_reported_wrong_verse: "A reader reported the wrong verse",
  user_reported_wrong_timestamp: "A reader reported the wrong time",
  user_reported_wrong_quote_reference: "A reader reported a wrong quote reference",
};

export function reasonLabel(code: string): string {
  return REASONS[code] ?? humanize(code);
}

/** Order reasons so the most useful explanation comes first. */
export function sortReasons(codes: string[] | null | undefined): string[] {
  const rank = (c: string) => (c.startsWith("user_reported") ? 0 : c.startsWith("audit_") ? 1 : c === "editorial_review_required" ? 3 : 2);
  return [...(codes || [])].sort((a, b) => rank(a) - rank(b));
}

export const DETECTORS: Record<string, string> = {
  refparser: "Reference finder — a written reference like “Romans 8:28”",
  "P-02": "AI reference check",
  quote_index: "Quotation matcher",
  "P-03": "AI quotation check",
  named_passage_vocab: "Named passage, like “the Prodigal Son”",
  passage_context_inheritance: "Carried over from a nearby reference",
  hybrid_retrieval: "Meaning-based Bible search",
  "P-04": "AI related-verse suggestion",
};

// ───────────────────────────────────────────────────────────── feedback + audit

export const FEEDBACK_KINDS: Record<string, { label: string; tone: Tone }> = {
  not_relevant: { label: "Not relevant", tone: "warn" },
  wrong_verse: { label: "Wrong verse", tone: "danger" },
  wrong_timestamp: { label: "Wrong time in the recording", tone: "warn" },
  wrong_quote_reference: { label: "Quote linked to the wrong verse", tone: "danger" },
  report_content: { label: "Content reported", tone: "danger" },
  helpful: { label: "Marked helpful", tone: "ok" },
};

export const FEEDBACK_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "New", tone: "warn" },
  in_review: { label: "Looking into it", tone: "info" },
  resolved: { label: "Resolved", tone: "ok" },
  dismissed: { label: "Dismissed", tone: "neutral" },
};

export const AUDIT_OBJECTS: Record<string, { label: string; singular: string }> = {
  mapping: { label: "Verse links", singular: "verse link" },
  segment: { label: "Sections", singular: "section" },
  clip: { label: "Clips", singular: "clip" },
  resource: { label: "Library items", singular: "library item" },
  feedback: { label: "Feedback", singular: "feedback report" },
  topic: { label: "Topics", singular: "topic" },
  entity: { label: "People & events", singular: "person, place or event" },
};

export const AUDIT_ACTIONS: Record<string, { verb: string; tone: Tone }> = {
  approve: { verb: "approved", tone: "ok" },
  reject: { verb: "rejected", tone: "danger" },
  edit: { verb: "edited", tone: "info" },
  add: { verb: "added", tone: "ok" },
  merge: { verb: "merged", tone: "info" },
  auto_hidden_by_feedback_threshold: { verb: "hid (after several reader reports)", tone: "warn" },
  create: { verb: "added", tone: "ok" },
  update: { verb: "updated", tone: "info" },
  delete: { verb: "deleted", tone: "danger" },
  process: { verb: "started processing", tone: "progress" },
  upload_source: { verb: "uploaded the file for", tone: "info" },
  upload_captions: { verb: "uploaded captions for", tone: "info" },
  reset_mappings: { verb: "reset all verse links on", tone: "warn" },
  change_primary_verse: { verb: "changed the main verse of", tone: "info" },
  edit_tags: { verb: "updated the tags on", tone: "info" },
  approve_clip: { verb: "approved", tone: "ok" },
  edit_clip: { verb: "adjusted the boundaries of", tone: "info" },
  caption_generated: { verb: "wrote caption ideas for", tone: "info" },
  export_requested: { verb: "requested a download of", tone: "info" },
  export_denied: { verb: "was refused a download of", tone: "warn" },
  upsert: { verb: "saved", tone: "info" },
  feedback_open: { verb: "reopened", tone: "warn" },
  feedback_in_review: { verb: "started looking into", tone: "info" },
  feedback_resolved: { verb: "resolved", tone: "ok" },
  feedback_dismissed: { verb: "dismissed", tone: "neutral" },
};

// ───────────────────────────────────────────────────────────── AI features

const PROMPTS: Record<string, string> = {
  "P-00": "Transcribe recordings",
  "P-01": "Split into sections",
  "P-02": "Find Bible references",
  "P-03": "Check quotations",
  "P-04": "Suggest related verses",
  "P-05": "Classify verse links",
  "P-06": "Tag topics and people",
  "P-07": "Summarise sections",
  "P-08": "Choose clips",
  "P-09": "Explain related verses",
  "P-10": "Understand searches",
  "P-11": "Rank search results",
  "P-12": "Double-check verse links",
  "P-13": "Write clip captions",
  "P-14": "Ask AI answers",
  "P-15": "Tag verse themes",
  "S-01": "Sermon Studio · polish",
  "S-02": "Sermon Studio · format",
  "S-03": "Sermon Studio · suggestions",
  "S-04": "Sermon Studio · speaker notes",
  "S-05": "Sermon Studio · slides",
  "S-06": "Sermon Studio · image ideas",
  "S-07": "Sermon Studio · social posts",
  "E-01": "Explore · event pages",
  "E-02": "Explore · story scripts",
  "E-03": "Explore · timeline explanations",
  "E-04": "Explore · timeline stories",
  EMBED: "Meaning-based search index",
  "IMG:sermon": "Sermon Studio · images",
  "IMG:explore": "Explore · illustrations",
  "TTS:explore": "Explore · narration",
};

export function promptLabel(id: string): string {
  if (PROMPTS[id]) return PROMPTS[id];
  if (id.startsWith("IMG:")) return `Images · ${humanize(id.slice(4))}`;
  if (id.startsWith("TTS:")) return `Narration · ${humanize(id.slice(4))}`;
  return id;
}

export const MODEL_ROLES: Record<string, { label: string; description: string }> = {
  analysis: { label: "Analysis", description: "Reads sections and decides how verses are used" },
  fast: { label: "Quick checks", description: "Short summaries, tags and search questions" },
  transcribe: { label: "Transcription", description: "Turns recordings into text" },
  embedding: { label: "Search index", description: "Understands meaning for Bible search" },
  image: { label: "Images", description: "Paints sermon visuals, slide scenes and Explore story scenes" },
  image_hq: { label: "High-quality images", description: "Used when “High quality” is chosen for a visual" },
  speech: { label: "Narration", description: "Reads Explore story videos aloud" },
};

// ───────────────────────────────────────────────────────────── formatting

export function humanize(code: string): string {
  const s = code.replace(/[_-]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function compactNumber(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "–";
  return new Intl.NumberFormat(undefined, { notation: Number(n) >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(Number(n));
}

export function money(n: number | null | undefined, digits?: number): string {
  if (n == null || Number.isNaN(Number(n))) return "–";
  const v = Number(n);
  const d = digits ?? (v === 0 ? 2 : v < 0.1 ? 3 : 2);
  return `$${v.toFixed(d)}`;
}

export function duration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(Number(ms))) return "–";
  const nb = "\u00a0"; // keep numbers and units together when text wraps
  const v = Number(ms);
  if (v < 1000) return `${Math.round(v)}${nb}ms`;
  const s = v / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}${nb}s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  if (m < 60) return rest ? `${m}${nb}min ${rest}${nb}s` : `${m}${nb}min`;
  const h = Math.floor(m / 60);
  return `${h}${nb}h ${m % 60}${nb}min`;
}

export function clock(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(Number(ms))) return "";
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function fullDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function relativeTime(iso?: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Math.round((Date.now() - t) / 1000);
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} min ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 7 * 86_400) {
    const days = Math.round(diff / 86_400);
    return days === 1 ? "yesterday" : `${days} days ago`;
  }
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

/** Where in a resource a section sits: “1:31”, “page 2” or “section 3”. */
export function segmentLocation(seg: { start_ms?: number | null; end_ms?: number | null; page_start?: number | null; ordinal?: number | null; heading?: string | null } | null | undefined): string {
  if (!seg) return "";
  if (seg.start_ms != null) return seg.end_ms != null ? `${clock(seg.start_ms)}–${clock(seg.end_ms)}` : clock(seg.start_ms);
  if (seg.page_start) return `page ${seg.page_start}`;
  if (seg.ordinal != null) return `section ${seg.ordinal + 1}`;
  return "";
}

/**
 * “ROM.8.28” → “Romans 8:28”. The API gives display names for most refs; this covers the few places it only sends
 * canonical codes. Pass a code → book name map (from /v1/bible/books) to spell out book names.
 */
export function prettyRef(ref: string, bookNames?: Record<string, string>): string {
  const parse = (p: string) => {
    const m = p.match(/^([1-3]?[A-Z]{2,3})\.(\d+)\.(\d+)$/);
    return m ? { book: m[1], chapter: m[2], verse: m[3] } : null;
  };
  const [a, b] = ref.split("-");
  const start = parse(a || "");
  if (!start) return ref;
  const name = (code: string) => bookNames?.[code] ?? code;
  const out = `${name(start.book)} ${start.chapter}:${start.verse}`;
  const end = b ? parse(b) : null;
  if (!end) return out;
  if (end.book !== start.book) return `${out}–${name(end.book)} ${end.chapter}:${end.verse}`;
  if (end.chapter !== start.chapter) return `${out}–${end.chapter}:${end.verse}`;
  return end.verse === start.verse ? out : `${out}–${end.verse}`;
}
