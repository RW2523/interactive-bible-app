import { useQuery } from "@tanstack/react-query";
import { api, getToken, qs } from "@/api/client";
import { ApiError } from "@/api/client";
import type { Json } from "@/api/types";

/*
 * Admin-only query helpers. They reuse the app-wide query keys (["system"], ["admin-feedback", …], ["runs", …]) so the
 * cache is shared with the hooks in src/api/hooks.ts, and add the `enabled` switches the admin layout needs.
 */

export const useSystemStatus = (enabled = true) =>
  useQuery({ queryKey: ["system"], queryFn: () => api<Json>("/v1/system/status"), refetchInterval: 10_000, enabled });

export const useAdminFeedback = (params: Record<string, string | number | undefined>, enabled = true) =>
  useQuery({ queryKey: ["admin-feedback", params], queryFn: () => api<Json>(`/v1/admin/feedback${qs(params)}`), placeholderData: (p) => p, enabled });

/** Admin metrics for the last `days` days; keeps the previous numbers on screen while a new period loads. */
export const useMetrics = (days: number) =>
  useQuery({ queryKey: ["admin-metrics", days], queryFn: () => api<Json>(`/v1/admin/metrics${qs({ days })}`), refetchInterval: 15_000, placeholderData: (p) => p });

/** Turn “Luke 15:11-32” into “LUK.15.11-LUK.15.32” with the app's reference parser (no AI). */
export async function canonicalRef(text: string): Promise<string | null> {
  const t = text.trim();
  if (!t) return null;
  if (/^[1-3]?[A-Z]{2,3}\.\d+\.\d+(-[1-3]?[A-Z]{2,3}\.\d+\.\d+)?$/.test(t)) return t;
  const res = await api<{ canonical: string | null }>(`/v1/bible/parse${qs({ q: t })}`);
  return res.canonical;
}

/** Processing runs for one resource; polls only while something is running. Shares the ["runs", id] cache with useRuns(). */
export const useResourceRuns = (resourceId: string, poll: boolean) =>
  useQuery({ queryKey: ["runs", resourceId], queryFn: () => api<Json[]>(`/v1/admin/runs${qs({ resource_id: resourceId })}`), refetchInterval: poll ? 3000 : false, enabled: !!resourceId });

/** Latest processing runs across all resources (newest first). */
export const useRecentRuns = (limit = 50, poll = 3000) =>
  useQuery({ queryKey: ["runs", undefined, limit], queryFn: () => api<Json[]>(`/v1/admin/runs${qs({ limit })}`), refetchInterval: poll || false, placeholderData: (p) => p });

/**
 * POST multipart form data with upload progress (fetch can't report upload progress).
 * Mirrors api() in src/api/client.ts: same auth header, same-origin cookies and error messages.
 */
export function uploadWithProgress<T>(path: string, form: FormData, onProgress: (fraction: number | null) => void, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.withCredentials = true;
    const token = getToken();
    if (token) xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => onProgress(e.lengthComputable && e.total > 0 ? e.loaded / e.total : null);
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = xhr.responseText;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve(data as T);
        return;
      }
      const detail = data && typeof data === "object" && "detail" in (data as Record<string, unknown>) ? (data as Record<string, unknown>).detail : null;
      const message =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join("; ")
            : detail
              ? JSON.stringify(detail)
              : xhr.statusText || `Upload failed (${xhr.status})`;
      reject(new ApiError(xhr.status, message));
    };
    xhr.onerror = () => reject(new ApiError(0, navigator.onLine ? "Cannot reach the Interactive Bible App server. Is the API running?" : "You are offline."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}
