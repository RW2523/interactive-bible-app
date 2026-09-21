import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "./client";
import type {
  AskResponse, Book, Chapter, ClipDetails, ExploreByVerse, Json, RelatedVerse, ResourceDetail, ScriptureMap, SearchResponse, SegmentItem, Translation, VerseIntelligence, Viewer, WhyResponse,
} from "./types";

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<Viewer>("/v1/auth/me"), staleTime: 60_000 });
export const useBooks = () => useQuery({ queryKey: ["books"], queryFn: () => api<Book[]>("/v1/bible/books"), staleTime: Infinity });
export const useTranslations = () => useQuery({ queryKey: ["translations"], queryFn: () => api<Translation[]>("/v1/bible/translations"), staleTime: Infinity });

export const useChapter = (book: string, chapter: number, translation: string) =>
  useQuery({ queryKey: ["chapter", book, chapter, translation], queryFn: () => api<Chapter>(`/v1/bible/chapters/${book}/${chapter}${qs({ translation })}`), placeholderData: (prev) => prev });

export const useVerseIntelligence = (ref: string | null, translation: string) =>
  useQuery({
    queryKey: ["intel", ref, translation],
    queryFn: () => api<VerseIntelligence>(`/v1/verses/${encodeURIComponent(ref!)}/intelligence${qs({ translation })}`),
    enabled: !!ref,
    refetchInterval: (q) => {
      const d = q.state.data as VerseIntelligence | undefined;
      if (!d || !d.ai_available) return false;
      const pending = d.related_verses.slice(0, 6).some((r) => r.why_status === "pending") || d.themes.length === 0;
      return pending && q.state.dataUpdateCount < 6 ? 8000 : false;
    },
  });

export const useVerseResources = (ref: string, params: Record<string, string | number | boolean | undefined>) =>
  useQuery({ queryKey: ["verse-resources", ref, params], queryFn: () => api<{ total: number; items: Json[] }>(`/v1/verses/${encodeURIComponent(ref)}/resources${qs(params)}`), enabled: !!ref });

export const useWhy = (from: string, to: string, enabled: boolean) =>
  useQuery({ queryKey: ["why", from, to], queryFn: () => api<WhyResponse>(`/v1/verses/${encodeURIComponent(from)}/related/${encodeURIComponent(to)}/why`), enabled, staleTime: 5 * 60_000 });

export const useExploreByVerse = (ref: string) =>
  useQuery({ queryKey: ["explore-by-verse", ref], queryFn: () => api<ExploreByVerse>(`/v1/explore/by-verse/${encodeURIComponent(ref)}`), enabled: !!ref, staleTime: Infinity, retry: false });

export const useRelated = (ref: string) => useQuery({ queryKey: ["related", ref], queryFn: () => api<RelatedVerse[]>(`/v1/verses/${encodeURIComponent(ref)}/related`) });

export const useClip = (segmentId: string | null) =>
  useQuery({ queryKey: ["clip", segmentId], queryFn: () => api<ClipDetails>(`/v1/clips/${segmentId}`), enabled: !!segmentId });

export const useResource = (id: string) => useQuery({ queryKey: ["resource", id], queryFn: () => api<ResourceDetail>(`/v1/resources/${id}`) });
export const useSegments = (id: string) => useQuery({ queryKey: ["segments", id], queryFn: () => api<{ segments: SegmentItem[] }>(`/v1/resources/${id}/segments`) });
export const useResourceStatus = (id: string, poll: boolean) =>
  useQuery({ queryKey: ["resource-status", id], queryFn: () => api<Json>(`/v1/resources/${id}/status`), refetchInterval: poll ? 1500 : false, refetchIntervalInBackground: poll });

export const useResources = (params: Record<string, string | number | boolean | undefined>, poll = false) =>
  useQuery({ queryKey: ["resources", params], queryFn: () => api<{ total: number; items: Json[] }>(`/v1/resources${qs(params)}`), refetchInterval: poll ? 3000 : false, placeholderData: (p) => p });

export const useScriptureMap = (params: Record<string, string | number | boolean | undefined>, enabled = true) =>
  useQuery({ queryKey: ["map", params], queryFn: () => api<ScriptureMap>(`/v1/scripture-map${qs(params)}`), enabled, placeholderData: (p) => p });

export const useSearch = (body: { query: string; scope?: string; resource_types?: string[] } | null) =>
  useQuery({ queryKey: ["search", body], queryFn: () => api<SearchResponse>("/v1/search/scripture", { method: "POST", body }), enabled: !!body && body.query.trim().length > 0, staleTime: 60_000 });

export const useSystemStatus = () => useQuery({ queryKey: ["system"], queryFn: () => api<Json>("/v1/system/status"), refetchInterval: 10_000 });

export const useTopics = () => useQuery({ queryKey: ["topics"], queryFn: () => api<Json[]>("/v1/topics"), staleTime: 5 * 60_000 });
export const useEntities = () => useQuery({ queryKey: ["entities"], queryFn: () => api<Json[]>("/v1/entities"), staleTime: 5 * 60_000 });

export function useAsk() {
  return useMutation({ mutationFn: (body: { ref: string; question: string; translation: string }) => api<AskResponse>("/v1/ask", { method: "POST", body }) });
}

export function useFeedback() {
  return useMutation({ mutationFn: (body: { object_type: string; object_id: string; kind: string; note?: string }) => api<Json>("/v1/feedback", { method: "POST", body }) });
}

// ------------------------------------------------------------------ admin
export const useReviewQueue = (params: Record<string, string | number | boolean | undefined>, enabled = true) =>
  useQuery({ queryKey: ["review-queue", params], queryFn: () => api<Json>(`/v1/admin/review-queue${qs(params)}`), placeholderData: (p) => p, enabled });
export const useMappingDetail = (id: string) => useQuery({ queryKey: ["mapping", id], queryFn: () => api<Json>(`/v1/admin/mappings/${id}`) });
export const useAdminMetrics = (days: number) => useQuery({ queryKey: ["admin-metrics", days], queryFn: () => api<Json>(`/v1/admin/metrics${qs({ days })}`), refetchInterval: 15_000 });
export const useRuns = (resourceId?: string) =>
  useQuery({ queryKey: ["runs", resourceId], queryFn: () => api<Json[]>(`/v1/admin/runs${qs({ resource_id: resourceId })}`), refetchInterval: 3000, refetchIntervalInBackground: true });
export const useAuditLog = (params: Record<string, string | number | undefined>) =>
  useQuery({ queryKey: ["audit", params], queryFn: () => api<Json>(`/v1/admin/audit${qs(params)}`), placeholderData: (p) => p });
export const useAdminFeedback = (params: Record<string, string | number | undefined>) =>
  useQuery({ queryKey: ["admin-feedback", params], queryFn: () => api<Json>(`/v1/admin/feedback${qs(params)}`), placeholderData: (p) => p });
export const useJobs = () => useQuery({ queryKey: ["jobs"], queryFn: () => api<Json[]>("/v1/admin/jobs"), refetchInterval: 4000 });

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}
