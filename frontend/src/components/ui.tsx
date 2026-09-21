import { AlertTriangle, BadgeCheck, BookOpenText, Loader2, MessageSquareQuote, Quote, RotateCw, Sparkles, WifiOff, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast as sonnerToast } from "sonner";
import { ApiError } from "../api/client";
import type { RelationshipLabel } from "../api/types";
import { EmptyState } from "./page";

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] font-medium opacity-80" role="status">
      <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
      {label ?? "Loading…"}
    </span>
  );
}

export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <div className="grid grid-cols-1 gap-2.5 py-1" aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3.5 animate-pulse rounded-full bg-surface-2" style={{ width: `${Math.max(38, 94 - ((i * 13) % 45))}%` }} />
      ))}
    </div>
  );
}

function friendlyError(error: unknown): { title: string; detail?: string; offline?: boolean } {
  const status = error instanceof ApiError ? error.status : undefined;
  const message = error instanceof Error ? error.message : "";
  if (status === 404) return { title: "We couldn't find that", detail: "It may be private, or it's no longer available." };
  if (status === 0) return { title: "Can't reach the app right now", detail: message || "Check that the Interactive Bible App server is running, then try again.", offline: true };
  if (status === 401 || status === 403) return { title: "You don't have access to this", detail: message || undefined };
  if (status === 429) return { title: "Please wait a moment", detail: message || "Too many requests in a short time — try again in a minute." };
  if (status && status >= 500) return { title: "Something went wrong on the server", detail: message && !/^Internal Server Error$/i.test(message) ? message : "Please try again." };
  return { title: "Something went wrong", detail: message || undefined };
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { title, detail, offline } = friendlyError(error);
  const Icon = offline ? WifiOff : AlertTriangle;
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-danger/20 bg-danger-soft px-4 py-3.5 text-sm" role="alert">
      <Icon className="mt-0.5 size-[18px] shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-danger">{title}</p>
        {detail && <p className="mt-0.5 text-ink-2">{detail}</p>}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[13px] font-semibold text-ink shadow-xs transition hover:bg-surface-2"
        >
          <RotateCw className="size-3.5" aria-hidden /> Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children, icon, action }: { title: string; children?: ReactNode; icon?: LucideIcon; action?: ReactNode }) {
  return <EmptyState compact icon={icon} title={title} description={children} action={action} className="border-0 bg-transparent" />;
}

const REL_ICON: Record<string, LucideIcon> = {
  direct_reference: MessageSquareQuote,
  scripture_quote: Quote,
  contextual_reference: BookOpenText,
  ai_related: Sparkles,
};

const REL_HELP: Record<string, string> = {
  direct_reference: "The speaker or author names this passage directly.",
  scripture_quote: "The words of this passage are quoted.",
  contextual_reference: "The passage is discussed without being named or quoted word for word.",
  ai_related: "AI suggests a connection by meaning — treat it as a lead, not a fact.",
};

export function RelationshipBadge({ rel, showConfidence = true }: { rel: RelationshipLabel | null | undefined; showConfidence?: boolean }) {
  if (!rel) return null;
  const aiish = rel.type === "ai_related";
  const Icon = REL_ICON[rel.type] || BookOpenText;
  const help = rel.note || REL_HELP[rel.type] || `${rel.label}: ${rel.trust} trust`;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`rel rel-${rel.type}`} title={help} aria-label={`Relationship: ${rel.label}. ${help}`}>
        <Icon aria-hidden />
        {rel.label}
      </span>
      {rel.human_verified && (
        <span className="rel rel-human" title="Approved or added by a reviewer" aria-label="Human verified: approved or added by a reviewer">
          <BadgeCheck aria-hidden />
          Human verified
        </span>
      )}
      {showConfidence && (aiish || rel.confidence < 0.9) && (
        <span className="conf" title="How strongly the source content supports this link — not a measure of theological truth">
          {rel.confidence_label}
        </span>
      )}
    </span>
  );
}

// ------------------------------------------------------------------ toast
// Legacy pages call useToast()(message); all toasts render through the app-wide sonner Toaster.
export function ToastProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
export const useToast = () => useCallback((msg: string) => void sonnerToast(msg), []);

// ------------------------------------------------------------------ modal
export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab" && ref.current) {
        // keep keyboard focus inside the dialog
        const focusable = ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" tabIndex={-1} ref={ref} style={wide ? { width: "min(1180px, 100%)" } : undefined}>
        <div className="modal-head">
          <div className="min-w-0 truncate font-display text-lg font-semibold text-ink">{title}</div>
          <button
            type="button"
            className="grid grid-cols-1 size-9 shrink-0 place-items-center rounded-xl text-ink-3 transition hover:bg-surface-2 hover:text-ink"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== "undefined" ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setMatches(mq.matches);
    mq.addEventListener("change", fn);
    fn();
    return () => mq.removeEventListener("change", fn);
  }, [query]);
  return matches;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-3">{hint}</div>}
    </div>
  );
}
