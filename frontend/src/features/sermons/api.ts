import { useMutation, useMutationState, useQuery, useQueryClient, type MutationKey } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/api/client";
import { EXPORT_THEMES, LANGUAGES, TONES, type ExportTheme } from "./lib/sermon/templates";
import { TEMPLATE_STRUCTURES } from "./lib/sermon/templateStructures";
import type {
  OutreachPost, PlanResponse, Sermon, SermonDetail, SermonDraft, SermonInput, SermonLanguage, SermonListItem, SermonMedia, SermonMeta,
  SermonTone, SharedSermon, SocialPosts, Suggestions, TemplateSectionInfo,
} from "./types";

// ───────────────────────────────────────────────────────────── query keys

export const sermonKeys = {
  /** Shared with the Home page's "Your sermons" card. */
  list: ["sermons"] as const,
  detail: (id: string) => ["sermon", id] as const,
  suggestions: (id: string, draftId: string) => ["sermon", id, "suggestions", draftId] as const,
  meta: ["sermon-meta"] as const,
  share: (slug: string) => ["sermon-share", slug] as const,
};

/** Mutation keys are `["sermon", id, stage, action]` so pending AI jobs can be observed per stage. */
export const jobKey = (id: string, stage: 1 | 2 | 3 | 4, action: string): MutationKey => ["sermon", id, stage, action];

// ───────────────────────────────────────────────────────────── errors

/**
 * Personal mode (no sign-in on this computer). Set by the studio pages from `useAuth().singleUser` so that
 * error messages never talk about sessions or signing in when there is nothing to sign in to.
 */
let personalMode = false;
export function setPersonalMode(value: boolean) {
  personalMode = value;
}

export function describeError(err: unknown, fallback: string): { title: string; description?: string } {
  if (err instanceof ApiError) {
    const detail = err.message && !/^(Bad Request|Unprocessable Entity|Internal Server Error|Service Unavailable|Bad Gateway|Too Many Requests|Not Found)$/i.test(err.message) ? err.message : undefined;
    switch (err.status) {
      case 0:
        return { title: err.message || "Cannot reach the server" };
      case 401:
        return personalMode
          ? { title: fallback, description: "The server didn't accept the request. Refresh the page and try again." }
          : { title: "Your session has ended", description: "Sign in again to keep working." };
      case 403:
        return { title: "You don't have access to this sermon", description: detail };
      case 404:
        return { title: fallback, description: detail || "It may have been deleted." };
      case 413:
        return { title: "That file is too large", description: detail };
      case 422:
        return { title: detail || fallback };
      case 429:
        return { title: "Hourly AI limit reached", description: detail || "You've used this hour's AI requests. Please try again a little later." };
      case 502:
        return { title: "The AI response couldn't be used", description: detail || "Please try again — a second attempt usually works." };
      case 503:
        return { title: "AI is unavailable right now", description: detail || "Check that a Gemini API key is configured, or try again shortly." };
      default:
        return { title: fallback, description: detail };
    }
  }
  if (err instanceof Error && err.name !== "AbortError") return { title: fallback, description: err.message || undefined };
  return { title: fallback };
}

export function toastError(err: unknown, fallback: string) {
  const { title, description } = describeError(err, fallback);
  toast.error(title, description ? { description } : undefined);
}

// ───────────────────────────────────────────────────────────── response normalisation

type Maybe<T> = T | { [k: string]: unknown } | null | undefined;

function unwrap<T extends { id: string }>(res: Maybe<T>, key: string): T | null {
  if (!res || typeof res !== "object") return null;
  const inner = (res as Record<string, unknown>)[key];
  if (inner && typeof inner === "object" && "id" in (inner as object)) return inner as T;
  return "id" in res ? (res as T) : null;
}

// ───────────────────────────────────────────────────────────── endpoints

const base = (id: string) => `/v1/sermons/${encodeURIComponent(id)}`;

export type MetaPatch = Partial<Pick<Sermon, "title" | "scripture_ref" | "theme" | "status" | "current_stage" | "tone" | "language" | "export_template">>;

export const sermonApi = {
  list: () => api<{ items: SermonListItem[] }>("/v1/sermons"),
  detail: (id: string, signal?: AbortSignal) => api<SermonDetail>(base(id), { signal }),
  meta: () => api<SermonMeta>("/v1/sermons/meta"),
  share: (slug: string) => api<SharedSermon>(`/v1/share/${encodeURIComponent(slug)}`),

  create: async (title: string) => unwrap<Sermon>(await api<Maybe<Sermon>>("/v1/sermons", { method: "POST", body: { title } }), "sermon"),
  update: async (id: string, patch: MetaPatch) => unwrap<Sermon>(await api<Maybe<Sermon>>(base(id), { method: "PATCH", body: patch }), "sermon"),
  remove: (id: string) => api<void>(base(id), { method: "DELETE" }),

  addText: async (id: string, kind: "text" | "dictation", text: string) =>
    unwrap<SermonInput>(await api<Maybe<SermonInput>>(`${base(id)}/inputs`, { method: "POST", body: { kind, text } }), "input"),
  addBibleRef: async (id: string, body: { reference: string; notes?: string; translation?: string }) =>
    unwrap<SermonInput>(await api<Maybe<SermonInput>>(`${base(id)}/inputs`, { method: "POST", body: { kind: "bible_ref", ...body } }), "input"),
  uploadAudio: async (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await api<{ input?: SermonInput; transcription?: string | null }>(`${base(id)}/inputs/audio`, { method: "POST", form });
    return { input: unwrap<SermonInput>(res, "input"), transcription: res?.transcription ?? null };
  },
  uploadDocument: async (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return unwrap<SermonInput>(await api<Maybe<SermonInput>>(`${base(id)}/inputs/document`, { method: "POST", form }), "input");
  },
  removeInput: (id: string, inputId: string) => api<void>(`${base(id)}/inputs/${encodeURIComponent(inputId)}`, { method: "DELETE" }),

  polish: (id: string, body: { tone: string; language: string; style: string }) =>
    api<{ draft: SermonDraft; sermon?: Sermon }>(`${base(id)}/polish`, { method: "POST", body }),
  applyTemplate: (id: string, body: { draft_id: string; template_type: string; tone: string; language: string }) =>
    api<{ draft: SermonDraft }>(`${base(id)}/template`, { method: "POST", body }),
  suggestions: (id: string, draftId: string) => api<{ suggestions: Suggestions }>(`${base(id)}/suggestions`, { method: "POST", body: { draft_id: draftId } }),
  updateDraft: async (id: string, draftId: string, patch: Partial<Pick<SermonDraft, "polished_html" | "structured" | "speaker_notes">>) =>
    unwrap<SermonDraft>(await api<Maybe<SermonDraft>>(`${base(id)}/drafts/${encodeURIComponent(draftId)}`, { method: "PATCH", body: patch }), "draft"),
  speakerNotes: (id: string, draftId: string) => api<{ notes: string; draft?: SermonDraft }>(`${base(id)}/speaker-notes`, { method: "POST", body: { draft_id: draftId } }),
  plan: (id: string, body: { theme_id: string; target_slide_count: number }) => api<PlanResponse>(`${base(id)}/plan`, { method: "POST", body }),

  generateMedia: (id: string, body: { kind: string; prompt?: string; auto_prompt?: boolean; high_quality?: boolean; regenerate_id?: string }) =>
    api<{ media: SermonMedia }>(`${base(id)}/media/generate`, { method: "POST", body }),
  generateMediaSet: (id: string, body: { count: number; high_quality: boolean }) =>
    api<{ media: SermonMedia[]; generated?: number; requested?: number }>(`${base(id)}/media/set`, { method: "POST", body }),
  updateMedia: async (id: string, mediaId: string, patch: { caption: string }) =>
    unwrap<SermonMedia>(await api<Maybe<SermonMedia>>(`${base(id)}/media/${encodeURIComponent(mediaId)}`, { method: "PATCH", body: patch }), "media"),
  removeMedia: (id: string, mediaId: string) => api<void>(`${base(id)}/media/${encodeURIComponent(mediaId)}`, { method: "DELETE" }),

  generateOutreach: (id: string) => api<{ outreach: OutreachPost; social?: SocialPosts | null }>(`${base(id)}/outreach`, { method: "POST" }),
  setPublic: (id: string, isPublic: boolean) => api<{ outreach: OutreachPost; sermon?: Sermon }>(`${base(id)}/outreach`, { method: "PATCH", body: { is_public: isPublic } }),
};

// ───────────────────────────────────────────────────────────── queries

export const useSermonList = (enabled: boolean) =>
  useQuery({ queryKey: sermonKeys.list, queryFn: sermonApi.list, enabled, retry: false });

export const useSermonDetail = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: sermonKeys.detail(id),
    queryFn: ({ signal }) => sermonApi.detail(id, signal),
    enabled: enabled && !!id,
    retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
  });

export const useSharedSermon = (slug: string) =>
  useQuery({
    queryKey: sermonKeys.share(slug),
    queryFn: () => sermonApi.share(slug),
    enabled: !!slug,
    staleTime: 60_000,
    retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
  });

/** Public share path of a published sermon (null when it isn't public). */
export function sharePathFromDetail(detail: Pick<SermonDetail, "outreach"> | null | undefined): string | null {
  const o = detail?.outreach;
  return o?.is_public && o.share_slug ? o.share_path || `/share/${o.share_slug}` : null;
}

export const absoluteUrl = (path: string) => new URL(path, window.location.origin).href;

/** Suggestions live in the query cache (keyed by draft) so they survive stage switches. */
export const useStoredSuggestions = (id: string, draftId: string | undefined) =>
  useQuery<Suggestions | null>({
    queryKey: sermonKeys.suggestions(id, draftId ?? "none"),
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
  });

export interface TemplateOption {
  value: string;
  label: string;
  summary: string;
  sections: TemplateSectionInfo[];
}

export interface StudioOptions {
  tones: SermonTone[];
  languages: SermonLanguage[];
  templates: TemplateOption[];
  themes: ExportTheme[];
  isComplexScript: (language?: string | null) => boolean;
  templateLabel: (value?: string | null) => string | undefined;
}

/** Tones, languages, formats and export themes — from the server when available, with local fallbacks. */
export function useStudioOptions(enabled = true): StudioOptions {
  const q = useQuery({ queryKey: sermonKeys.meta, queryFn: sermonApi.meta, enabled, staleTime: Infinity, retry: false });
  const meta = q.data;
  return useMemo(() => {
    const tones = meta?.tones?.length ? meta.tones : TONES;
    const languages: SermonLanguage[] = meta?.languages?.length
      ? meta.languages.map((l) => ({ code: l.code, label: l.label, complexScript: !!l.complex_script }))
      : LANGUAGES;
    const templates: TemplateOption[] = meta?.templates?.length
      ? meta.templates.map((t) => ({ value: t.value, label: t.label, summary: t.summary, sections: t.sections ?? [] }))
      : Object.entries(TEMPLATE_STRUCTURES).map(([value, s]) => ({ value, label: s.label, summary: s.summary, sections: s.sections }));
    const allThemes = Object.values(EXPORT_THEMES);
    const serverThemes = meta?.export_themes?.length ? allThemes.filter((t) => meta.export_themes!.includes(t.id)) : [];
    const themes = serverThemes.length ? serverThemes : allThemes;
    const complex = new Set(languages.filter((l) => l.complexScript).map((l) => l.code));
    return {
      tones,
      languages,
      templates,
      themes,
      isComplexScript: (language) => !!language && complex.has(language),
      templateLabel: (value) => (value ? templates.find((t) => t.value === value)?.label : undefined),
    };
  }, [meta]);
}

// ───────────────────────────────────────────────────────────── cache + jobs

export function useSermonCache(id: string) {
  const qc = useQueryClient();
  return useMemo(
    () => ({
      get: () => qc.getQueryData<SermonDetail>(sermonKeys.detail(id)),
      /** Apply an immutable update to the cached workspace and mark the dashboard list stale. */
      patch: (fn: (d: SermonDetail) => SermonDetail) => {
        qc.setQueryData<SermonDetail>(sermonKeys.detail(id), (d) => (d ? fn(d) : d));
        void qc.invalidateQueries({ queryKey: sermonKeys.list, exact: true });
      },
      setSuggestions: (draftId: string, s: Suggestions) => qc.setQueryData(sermonKeys.suggestions(id, draftId), s),
      /** Re-fetch the workspace from the server (used when a response had an unexpected shape). */
      refresh: () => qc.invalidateQueries({ queryKey: sermonKeys.detail(id), exact: true }),
    }),
    [qc, id],
  );
}

/**
 * A mutation whose success/error handlers live in the mutation itself, so cache
 * updates and toasts still happen if the user leaves the page mid-request.
 */
export function useStudioMutation<TVars, TData>(
  key: MutationKey,
  fn: (vars: TVars) => Promise<TData>,
  opts: { onSuccess?: (data: TData, vars: TVars) => void; onError?: (err: unknown, vars: TVars) => void; errorTitle?: string } = {},
) {
  return useMutation<TData, unknown, TVars>({
    mutationKey: key,
    mutationFn: fn,
    onSuccess: opts.onSuccess,
    onError: (err, vars) => (opts.onError ? opts.onError(err, vars) : toastError(err, opts.errorTitle ?? "Something went wrong")),
  });
}

/** Pending state of a (possibly long-running) job, observed globally so it survives remounts. */
export function useJob(key: MutationKey): { pending: boolean; since: number | null } {
  const started = useMutationState({ filters: { mutationKey: key, status: "pending" }, select: (m) => m.state.submittedAt });
  return { pending: started.length > 0, since: started.length ? Math.min(...started) : null };
}

/** Variables of pending mutations for a key (e.g. which media items are regenerating). */
export function usePendingVariables<TVars>(key: MutationKey): TVars[] {
  return useMutationState({ filters: { mutationKey: key, status: "pending" }, select: (m) => m.state.variables as TVars });
}
