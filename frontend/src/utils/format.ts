export function fmtTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "";
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function pct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return "–";
  return `${(value * 100).toFixed(digits)}%`;
}

/** "ROM.8.28" -> { book: "ROM", chapter: 8, verse: 28 } */
export function parseCanonical(ref: string): { book: string; chapter: number; verse: number; endVerse?: number; endChapter?: number } | null {
  const [a, b] = ref.split("-");
  const m = a.match(/^([1-3]?[A-Z]{2,3})\.(\d+)\.(\d+)$/);
  if (!m) return null;
  const out: { book: string; chapter: number; verse: number; endVerse?: number; endChapter?: number } = { book: m[1], chapter: +m[2], verse: +m[3] };
  if (b) {
    const n = b.match(/^([1-3]?[A-Z]{2,3})\.(\d+)\.(\d+)$/);
    if (n) {
      out.endChapter = +n[2];
      out.endVerse = +n[3];
    }
  }
  return out;
}

export function readHref(ref: string): string {
  const p = parseCanonical(ref);
  if (!p) return `/verse/${encodeURIComponent(ref)}`;
  const v = p.endVerse && p.endChapter === p.chapter && p.endVerse !== p.verse ? `${p.verse}-${p.endVerse}` : `${p.verse}`;
  return `/read/${p.book}/${p.chapter}?v=${v}`;
}

export const TYPE_ICON: Record<string, string> = { video: "▶", audio: "♪", pdf: "▤", document: "▤", article: "✎", native: "✎", generated: "✦" };
export const KIND_LABEL: Record<string, string> = { watch: "Watch", listen: "Listen", study: "Read / Study" };

export function mediaLocation(card: { clip: { start_ms: number; end_ms: number } | null; segment: { page_start: number | null; heading: string | null; ordinal: number } }): string {
  if (card.clip && card.clip.start_ms !== null && card.clip.start_ms !== undefined) {
    return `${fmtTime(card.clip.start_ms)}–${fmtTime(card.clip.end_ms)} · ${fmtDuration(card.clip.end_ms - card.clip.start_ms)}`;
  }
  if (card.segment.page_start) return `Page ${card.segment.page_start}${card.segment.heading ? ` · ${card.segment.heading}` : ""}`;
  if (card.segment.heading) return card.segment.heading;
  return `Section ${card.segment.ordinal + 1}`;
}

export function copyText(text: string): Promise<boolean> {
  return navigator.clipboard?.writeText(text).then(() => true).catch(() => false) ?? Promise.resolve(false);
}
