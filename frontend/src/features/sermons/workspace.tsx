import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { MetaPatch, StudioOptions, useSermonCache } from "./api";
import { describeError, toastError } from "./api";
import type { OutreachPost, Sermon, SermonDetail, SermonDraft, SermonInput, SermonListItem, SermonMedia, SermonStage } from "./types";

export interface SaveState {
  pending: number;
  savedAt: number | null;
  error: string | null;
}

export interface WorkspaceValue {
  id: string;
  sermon: Sermon;
  inputs: SermonInput[];
  draft: SermonDraft | null;
  media: SermonMedia[];
  outreach: OutreachPost | null;
  detail: SermonDetail;
  active: SermonStage;
  goToStage: (stage: SermonStage) => void;
  cache: ReturnType<typeof useSermonCache>;
  /** Track a save so the header's saved-state indicator reflects it. Toasts `errorTitle` on failure. */
  track: <T>(promise: Promise<T>, errorTitle?: string) => Promise<T>;
  saveMeta: (patch: MetaPatch) => Promise<void>;
  editorDirty: boolean;
  setEditorDirty: (dirty: boolean) => void;
  /** Save any unsaved editor changes now (no-op when clean). Registered by the Polish stage. */
  flushEditor: () => Promise<void>;
  registerEditorFlush: (fn: (() => Promise<void>) | null) => void;
  options: StudioOptions;
}

const Ctx = createContext<WorkspaceValue | null>(null);
export const WorkspaceProvider = Ctx.Provider;

export function useWorkspace(): WorkspaceValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useWorkspace must be used inside the sermon workspace");
  return value;
}

/** Aggregated save status for the sticky header ("Saving…", "Saved", "Not saved"). */
export function useSaveTracker() {
  const [state, setState] = useState<SaveState>({ pending: 0, savedAt: null, error: null });
  const track = useCallback(<T,>(promise: Promise<T>, errorTitle?: string): Promise<T> => {
    setState((s) => ({ ...s, pending: s.pending + 1 }));
    return promise.then(
      (value) => {
        setState((s) => ({ pending: Math.max(0, s.pending - 1), savedAt: Date.now(), error: null }));
        return value;
      },
      (err: unknown) => {
        setState((s) => ({ pending: Math.max(0, s.pending - 1), savedAt: s.savedAt, error: describeError(err, errorTitle ?? "Couldn't save your changes").title }));
        if (errorTitle) toastError(err, errorTitle);
        throw err;
      },
    );
  }, []);
  return { state, track };
}

/**
 * Props for an input that edits a saved value and commits on blur/Enter (Escape reverts).
 * The local text follows the saved value whenever the field isn't focused.
 */
export function useCommitField(value: string | null | undefined, onCommit: (next: string) => void, opts: { required?: boolean } = {}) {
  const saved = value ?? "";
  const [text, setText] = useState(saved);
  const [focused, setFocused] = useState(false);
  const skipCommit = useRef(false);
  useEffect(() => {
    if (!focused) setText(saved);
  }, [saved, focused]);
  return {
    value: text,
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      if (skipCommit.current) {
        skipCommit.current = false;
        return;
      }
      const next = text.trim();
      if (opts.required && !next) {
        setText(saved);
        return;
      }
      if (next !== saved.trim()) onCommit(next);
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") e.currentTarget.blur();
      else if (e.key === "Escape") {
        skipCommit.current = true;
        setText(saved);
        e.currentTarget.blur();
      }
    },
  };
}

// ───────────────────────────────────────────────────────────── steps

export const NEEDS_CONTENT = "Add at least one note, recording, document or Scripture passage in Collect first.";
export const NEEDS_DRAFT = "Write your sermon draft in Polish first.";

/** Why a step can't be opened yet (plain language), or null when it's available. */
export function lockReason(stage: SermonStage, inputs: SermonInput[], draft: SermonDraft | null): string | null {
  if (stage > 1 && inputs.length === 0) return NEEDS_CONTENT;
  if (stage >= 3 && !draft) return NEEDS_DRAFT;
  return null;
}

export function clampStage(n: number | null | undefined): SermonStage {
  const v = Math.round(Number(n) || 1);
  return (v < 1 ? 1 : v > 4 ? 4 : v) as SermonStage;
}

/** Which steps of an open sermon are finished. Visuals are optional, so a designed deck also counts. */
export function stepsDone(detail: Pick<SermonDetail, "inputs" | "draft" | "media" | "outreach">): Record<SermonStage, boolean> {
  return {
    1: detail.inputs.length > 0,
    2: !!detail.draft,
    3: detail.media.length > 0 || !!detail.draft?.slide_plan?.slides?.length,
    4: !!detail.outreach?.is_public,
  };
}

/** A short, state-aware line under each step in the stepper. */
export function stepHint(stage: SermonStage, detail: Pick<SermonDetail, "inputs" | "draft" | "media" | "outreach">): string {
  const locked = lockReason(stage, detail.inputs, detail.draft);
  switch (stage) {
    case 1:
      return detail.inputs.length ? `${detail.inputs.length} ${detail.inputs.length === 1 ? "item" : "items"} collected` : "Add notes, voice or Scripture";
    case 2:
      if (locked) return "Needs content first";
      return detail.draft ? `Draft ready · v${detail.draft.version}` : "Let AI write your draft";
    case 3:
      if (locked) return "Needs a draft first";
      return detail.media.length ? `${detail.media.length} ${detail.media.length === 1 ? "visual" : "visuals"}` : "Optional artwork";
    default:
      if (locked) return "Needs a draft first";
      return detail.outreach?.is_public ? "Published" : "Export & share";
  }
}

const DRAFTED_STATUSES = new Set(["polished", "multimedia", "exported", "published"]);

export interface ListProgress {
  /** Steps finished (0–4) for the progress bars. */
  done: number;
  label: string;
  /** What to do next, in plain language (null when published). */
  next: string | null;
}

/** Progress of a sermon on the dashboard, derived from what it actually contains (not the last step visited). */
export function listProgress(s: SermonListItem): ListProgress {
  const published = s.is_published ?? s.status === "published";
  const drafted = !!s.draft_version || DRAFTED_STATUSES.has(String(s.status));
  const collected = (s.input_count ?? 0) > 0 || drafted;
  const visuals = (s.media_count ?? 0) > 0 || s.status === "multimedia";
  if (published) return { done: 4, label: "Published", next: null };
  if (!collected) return { done: 0, label: "Just started", next: "Collect your notes & Scripture" };
  if (!drafted) return { done: 1, label: "Content collected", next: "Polish it into a draft" };
  if (!visuals) return { done: 2, label: "Draft ready", next: "Add visuals or publish" };
  return { done: 3, label: "Visuals added", next: "Export & publish" };
}
