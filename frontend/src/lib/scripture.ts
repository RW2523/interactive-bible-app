import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";

/** One reference found by the server's Bible reference parser (`/v1/bible/parse`). */
export interface ParsedReference {
  book: string;
  chapter: number;
  verse: number | null;
  end_chapter: number | null;
  end_verse: number | null;
  kind: "verse" | "chapter" | "range" | string;
  raw_text: string;
  start: number;
  end: number;
  confidence: number;
  canonical_start: string;
  canonical_end: string;
  display: string;
}

export async function parseReferences(query: string, signal?: AbortSignal): Promise<ParsedReference[]> {
  const q = query.trim();
  if (!q) return [];
  const res = await api<{ references?: ParsedReference[] }>(`/v1/bible/parse?q=${encodeURIComponent(q)}`, { signal });
  return res.references ?? [];
}

/** True when the reference is (nearly) the whole query — "John 3:16" jumps; "sermons about John 3:16" searches. */
export function isWholeQueryReference(query: string, ref: ParsedReference | undefined | null): boolean {
  if (!ref) return false;
  const q = query.trim();
  const before = q.slice(0, ref.start).trim();
  const after = q.slice(ref.end).replace(/[\s.,;:!?)"'”’]+$/, "").trim();
  return before.length === 0 && after.length === 0;
}

/** Reader URL for a parsed reference: whole chapters open unselected, verses/ranges open selected. */
export function referenceReadHref(ref: ParsedReference): string {
  if (ref.kind === "chapter" || ref.verse == null) return `/read/${ref.book}/${ref.chapter}`;
  const sameChapter = ref.end_chapter == null || ref.end_chapter === ref.chapter;
  const v = ref.end_verse != null && sameChapter && ref.end_verse !== ref.verse ? `${ref.verse}-${ref.end_verse}` : `${ref.verse}`;
  return `/read/${ref.book}/${ref.chapter}?v=${v}`;
}

/** Canonical id for the Verse insights page (`/verse/:ref`), or null for whole chapters. */
export function referenceVerseId(ref: ParsedReference): string | null {
  if (ref.kind === "chapter" || ref.verse == null) return null;
  return ref.canonical_start === ref.canonical_end ? ref.canonical_start : `${ref.canonical_start}-${ref.canonical_end}`;
}

/** Jump straight to a passage when the text is a Bible reference, otherwise run a meaning-based search. */
export function useScriptureJump() {
  const navigate = useNavigate();
  return useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (!q) return;
      try {
        const refs = await parseReferences(q);
        if (refs[0] && isWholeQueryReference(q, refs[0])) {
          navigate(referenceReadHref(refs[0]));
          return;
        }
      } catch {
        /* fall through to search */
      }
      navigate(`/search?q=${encodeURIComponent(q)}`);
    },
    [navigate],
  );
}
