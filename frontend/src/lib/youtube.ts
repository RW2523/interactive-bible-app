/**
 * Everything the UI needs to know about YouTube-hosted resources.
 *
 * Videos pasted as a YouTube link are never downloaded or re-hosted: playback is always YouTube's own
 * embed, and only the transcript is stored locally. These helpers build the embed/watch URLs, pick a
 * still image, and put the video's own details into plain language.
 */
import type { Playback, ResourceDetail, YoutubeChapter, YoutubeMeta } from "../api/types";

export const YOUTUBE_URL_RE = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

/** The 11-character video id inside a YouTube link, or null when it isn't one. */
export function youtubeIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(YOUTUBE_URL_RE);
  return m ? m[1] : null;
}

export const looksLikeYoutube = (url: string | null | undefined) => !!youtubeIdFromUrl(url);

/** YouTube's own still for a video. `hq` (480×360) exists for every video; `max` only for most. */
export function youtubeThumb(videoId: string, quality: "hq" | "max" | "mq" = "hq"): string {
  const name = quality === "max" ? "maxresdefault" : quality === "mq" ? "mqdefault" : "hqdefault";
  return `https://i.ytimg.com/vi/${videoId}/${name}.jpg`;
}

/** The best still we can show for a resource or card: what the server stored, else YouTube's own. */
export function thumbnailFor(r: { thumbnail_url?: string | null; youtube_id?: string | null } | null | undefined): string | null {
  if (!r) return null;
  if (r.thumbnail_url) return r.thumbnail_url;
  return r.youtube_id ? youtubeThumb(r.youtube_id) : null;
}

/** A watch link on youtube.com, optionally starting at a moment (opens in a new tab). */
export function youtubeWatchUrl(videoId: string, startMs?: number | null): string {
  const t = startMs && startMs > 0 ? `&t=${Math.floor(startMs / 1000)}s` : "";
  return `https://www.youtube.com/watch?v=${videoId}${t}`;
}

/** The privacy-friendly embed URL. `endMs` is only honoured while playing a clip. */
export function youtubeEmbedSrc({
  videoId,
  startMs,
  endMs,
  autoplay,
}: {
  videoId: string;
  startMs?: number | null;
  endMs?: number | null;
  autoplay?: boolean;
}): string {
  const params = new URLSearchParams({ rel: "0", modestbranding: "1", playsinline: "1" });
  if (startMs && startMs > 0) params.set("start", String(Math.floor(startMs / 1000)));
  if (endMs && endMs > 0) params.set("end", String(Math.ceil(endMs / 1000)));
  if (autoplay) params.set("autoplay", "1");
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

export const isYoutubePlayback = (p: Playback | null | undefined): boolean =>
  !!p && p.mode === "embed" && (p.provider === "youtube" || !!p.youtube_id);

/** The video id for a resource, wherever it is recorded. */
export function resourceVideoId(r: Partial<ResourceDetail> | null | undefined): string | null {
  if (!r) return null;
  return r.youtube?.video_id || r.playback?.youtube_id || youtubeIdFromUrl(r.source_url) || null;
}

/** "20260913" (how YouTube reports it) or an ISO date → "13 September 2026". */
export function fmtYoutubeDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  // built from local parts on purpose: "2026-09-13" parsed as UTC would show as the 12th in the Americas
  const d =
    digits.length >= 8
      ? new Date(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)) - 1, Number(digits.slice(6, 8)))
      : new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export interface CaptionSource {
  /** Where the words will come from. */
  kind: "manual" | "auto" | "gemini";
  label: string;
  detail: string;
  /** Warn tone when it will cost AI credits. */
  tone: "ok" | "info" | "warn";
}

/** Plain-language badge for where a video's transcript comes from. */
export function captionSource(input: {
  captions_available?: boolean;
  captions_kind?: "manual" | "auto" | null;
  transcript_source?: "captions" | "gemini";
}): CaptionSource {
  if (input.transcript_source === "gemini" || !input.captions_available) {
    return {
      kind: "gemini",
      label: "No captions — Gemini will transcribe this",
      detail: "This video has no captions on YouTube, so the words are transcribed by AI. That costs AI credits and takes longer (often 5–15 minutes for a long service).",
      tone: "warn",
    };
  }
  if (input.captions_kind === "manual") {
    return {
      kind: "manual",
      label: "Captions from YouTube · human-made",
      detail: "The words come from captions a person wrote, so they're accurate and free — no AI transcription needed.",
      tone: "ok",
    };
  }
  return {
    kind: "auto",
    label: "Captions from YouTube · auto-generated",
    detail: "The words come from YouTube's automatic captions — free and usually good, though names and quotes can be a little off.",
    tone: "info",
  };
}

/** Chapters as the video reports them, with an end time for every one. */
export function chapterList(meta: YoutubeMeta | null | undefined, durationMs?: number | null): YoutubeChapter[] {
  const chapters = (meta?.chapters || []).filter((c) => c && typeof c.start_ms === "number");
  return chapters.map((c, i) => ({
    ...c,
    title: chapterTitle(c.title, i),
    end_ms: c.end_ms ?? chapters[i + 1]?.start_ms ?? durationMs ?? null,
  }));
}

/** YouTube reports unnamed chapters as "<Untitled Chapter 1>" — show something a person would write. */
function chapterTitle(raw: string | null | undefined, index: number): string {
  const title = (raw ?? "").trim().replace(/^<(.*)>$/, "$1").replace(/^untitled\s+/i, "").trim();
  return title || `Chapter ${index + 1}`;
}
