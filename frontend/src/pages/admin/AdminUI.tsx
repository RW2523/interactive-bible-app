import {
  ArrowLeft, ArrowRight, BookMarked, ChevronDown, CircleAlert, CircleCheck, CircleHelp, FileText, Headphones, Loader2, Newspaper, PenLine, Quote, RefreshCw,
  ScrollText, Sparkles, TriangleAlert, Video, type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { confidenceBand, fullDate, humanize, relativeTime, RELATIONSHIPS, type Tone } from "./adminLabels";

// ───────────────────────────────────────────────────────────── layout

export const ADMIN_PAGE = "mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8";
export const ADMIN_PAGE_WIDE = "mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8";

export function PageHeader({
  icon: Icon,
  eyebrow,
  title,
  description,
  actions,
  back,
  children,
}: {
  icon?: LucideIcon;
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:mb-8 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0 flex-1">
        {back && (
          <Link to={back.to} className="mb-3 inline-flex min-h-10 items-center gap-1.5 rounded-lg pr-2 text-sm font-medium text-ink-2 no-underline hover:text-ink hover:no-underline">
            <ArrowLeft className="size-4" aria-hidden /> {back.label}
          </Link>
        )}
        {eyebrow && (
          <div className="mb-2.5 flex">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-gold-700 shadow-xs dark:text-gold-300">
              {Icon && <Icon className="size-3.5" aria-hidden />} {eyebrow}
            </span>
          </div>
        )}
        <h1 className="font-display text-3xl leading-tight font-semibold tracking-tight text-balance text-ink sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-2">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionCard({
  icon: Icon,
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  footer,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  footer?: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn("min-w-0 rounded-2xl border border-border bg-card shadow-xs", className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 flex-[1_1_15rem] items-start gap-3">
          {Icon && (
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gold-400/15 text-gold-700 dark:text-gold-300" aria-hidden>
              <Icon className="size-[18px]" />
            </span>
          )}
          <div className="min-w-0">
            <h2 id={headingId} className="font-display text-[17px] leading-snug font-semibold tracking-tight text-ink">{title}</h2>
            {description && <div className="mt-0.5 text-sm leading-relaxed text-ink-2">{description}</div>}
          </div>
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{action}</div>}
      </header>
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
      {footer && <div className="border-t border-border px-4 py-3 sm:px-5">{footer}</div>}
    </section>
  );
}

// ───────────────────────────────────────────────────────────── figures

const TONE_ICON_BG: Record<Tone, string> = {
  ok: "bg-[var(--ok-soft)] text-[#1b5e20] dark:text-ok",
  warn: "bg-[var(--warn-soft)] text-warn",
  danger: "bg-[var(--danger-soft)] text-danger",
  info: "bg-[var(--accent-soft)] text-link",
  neutral: "bg-surface-2 text-ink-2",
  progress: "bg-[var(--accent-soft)] text-link",
  brand: "bg-gold-400/15 text-gold-700 dark:text-gold-300",
};

export function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  to,
  cta,
  tone = "brand",
  loading,
  children,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  to?: string;
  cta?: string;
  tone?: Tone;
  loading?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", TONE_ICON_BG[tone])} aria-hidden>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 text-sm leading-tight font-medium text-ink-2">{label}</span>
      </div>
      {loading ? (
        <div className="mt-3 space-y-2" aria-hidden>
          <div className="h-8 w-20 animate-pulse rounded-lg bg-surface-2" />
          <div className="h-3.5 w-36 animate-pulse rounded bg-surface-2" />
        </div>
      ) : (
        <>
          <div className="mt-3 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{value}</div>
          {hint && <div className="mt-1 text-[13px] leading-snug text-ink-2 sm:text-sm">{hint}</div>}
          {children}
        </>
      )}
      {to && cta && (
        <span className="mt-auto inline-flex items-center gap-1 pt-3 text-[13px] font-semibold text-link sm:text-sm">
          {cta} <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" aria-hidden />
        </span>
      )}
    </>
  );
  const cls = cn("group flex min-w-0 flex-col rounded-2xl border border-border bg-card p-3.5 shadow-xs sm:p-5", className);
  if (to) {
    return (
      <Link to={to} className={cn(cls, "text-inherit no-underline transition hover:border-gold-400/50 hover:no-underline hover:shadow-md")}>
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}

const PILL: Record<Tone, string> = {
  ok: "bg-[var(--ok-soft)] text-[#1b5e20] dark:text-ok",
  warn: "bg-[var(--warn-soft)] text-warn",
  danger: "bg-[var(--danger-soft)] text-danger",
  info: "bg-[var(--accent-soft)] text-link",
  neutral: "bg-surface-2 text-ink-2",
  progress: "bg-[var(--accent-soft)] text-link",
  brand: "bg-gold-400/15 text-gold-700 dark:text-gold-300",
};

/** Status label with a shape cue (dot, spinner or icon) so meaning never depends on colour alone. */
export function StatusPill({ tone = "neutral", children, icon: Icon, className, title }: { tone?: Tone; children: ReactNode; icon?: LucideIcon; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap", PILL[tone], className)}>
      {tone === "progress" ? (
        <Loader2 className="size-3 animate-spin" aria-hidden />
      ) : Icon ? (
        <Icon className="size-3.5" aria-hidden />
      ) : (
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
      )}
      <span className="truncate">{children}</span>
    </span>
  );
}

const METER_FILL: Record<Tone, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  info: "var(--accent-2)",
  neutral: "var(--ink-3)",
  progress: "var(--accent-2)",
  brand: "var(--gold-500)",
};

/** A single value against a limit. The track is a lighter step of the fill colour. */
export function Meter({ value, max = 1, tone = "info", label, className, size = "md", marker }: { value: number; max?: number; tone?: Tone; label: string; className?: string; size?: "sm" | "md"; marker?: number }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const fill = METER_FILL[tone];
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className={cn("relative w-full overflow-hidden rounded-full", size === "sm" ? "h-1.5" : "h-2.5", className)}
      style={{ background: `color-mix(in srgb, ${fill} 18%, transparent)` }}
    >
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${ratio * 100}%`, background: fill }} />
      {marker != null && <span className="absolute inset-y-0 w-0.5 bg-card" style={{ left: `${marker * 100}%` }} aria-hidden />}
    </div>
  );
}

/** Confidence (0–1) as a labelled meter: “78% · Weak”. */
export function ConfidenceMeter({ value, className, showMeaning, width = "w-20" }: { value: number | null | undefined; className?: string; showMeaning?: boolean; width?: string }) {
  if (value == null || Number.isNaN(Number(value))) return <span className="text-sm text-ink-2">–</span>;
  const v = Number(value);
  const band = confidenceBand(v);
  const pct = Math.round(v * 100);
  return (
    <div className={cn("min-w-0", className)} title={`${pct}% confidence — ${band.meaning}`}>
      <div className="flex items-center gap-2">
        <Meter value={v} tone={band.tone} size="sm" label={`Confidence ${pct}%, ${band.label.toLowerCase()}`} className={cn("shrink-0", width)} marker={0.9} />
        <span className="text-sm font-semibold text-ink tabular-nums">{pct}%</span>
        <span className="text-xs font-medium text-ink-2">{band.label}</span>
      </div>
      {showMeaning && <p className="mt-1 text-xs text-ink-2">{band.meaning}</p>}
    </div>
  );
}

const REL_STYLE: Record<string, { cls: string; icon: LucideIcon }> = {
  direct_reference: { cls: "bg-[var(--rel-direct-soft)] text-[var(--rel-direct)]", icon: BookMarked },
  scripture_quote: { cls: "bg-[var(--rel-quote-soft)] text-[var(--rel-quote)]", icon: Quote },
  contextual_reference: { cls: "bg-[var(--rel-context-soft)] text-[#8a5a00] dark:text-[var(--rel-context)]", icon: ScrollText },
  ai_related: { cls: "border border-dashed border-[color-mix(in_srgb,var(--rel-ai)_65%,transparent)] text-[var(--rel-ai)]", icon: Sparkles },
};

export function RelationshipChip({ type, className }: { type: string; className?: string }) {
  const style = REL_STYLE[type] ?? { cls: "bg-surface-2 text-ink-2", icon: BookMarked };
  const Icon = style.icon;
  const info = RELATIONSHIPS[type];
  return (
    <span title={info?.description} className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap", style.cls, className)}>
      <Icon className="size-3.5" aria-hidden />
      {info?.label ?? type}
    </span>
  );
}

const TYPE_ICON: Record<string, LucideIcon> = { video: Video, audio: Headphones, pdf: FileText, document: FileText, article: Newspaper, native: PenLine, generated: Sparkles };
const TYPE_TINT: Record<string, string> = {
  video: "bg-[var(--rel-direct-soft)] text-[var(--rel-direct)]",
  audio: "bg-[var(--rel-quote-soft)] text-[var(--rel-quote)]",
  pdf: "bg-gold-400/15 text-gold-700 dark:text-gold-300",
  document: "bg-gold-400/15 text-gold-700 dark:text-gold-300",
  article: "bg-[var(--accent-soft)] text-link",
  native: "bg-[var(--accent-soft)] text-link",
  generated: "bg-[var(--rel-ai-soft)] text-[var(--rel-ai)]",
};

export function TypeIcon({ type, className, size = "md" }: { type?: string | null; className?: string; size?: "sm" | "md" | "lg" }) {
  const Icon = TYPE_ICON[type || ""] ?? FileText;
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-xl", size === "sm" ? "size-8" : size === "lg" ? "size-12 rounded-2xl" : "size-10", TYPE_TINT[type || ""] ?? "bg-surface-2 text-ink-2", className)} aria-hidden>
      <Icon className={size === "sm" ? "size-4" : size === "lg" ? "size-6" : "size-5"} />
    </span>
  );
}

export function TimeAgo({ iso, className, prefix }: { iso?: string | null; className?: string; prefix?: string }) {
  if (!iso) return null;
  return (
    <time dateTime={iso} title={fullDate(iso)} className={className}>
      {prefix ? `${prefix} ` : ""}
      {relativeTime(iso)}
    </time>
  );
}

export function LiveIndicator({ label = "Live", className }: { label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs font-medium text-ink-2", className)}>
      <span className="relative flex size-2" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60 motion-reduce:hidden" />
        <span className="relative inline-flex size-2 rounded-full bg-ok" />
      </span>
      {label}
    </span>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border border-b-2 bg-surface px-1 font-mono text-[11px] leading-none font-medium text-ink-2", className)}>{children}</kbd>;
}

// ───────────────────────────────────────────────────────────── states

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-surface-2", className)} aria-hidden />;
}

export function CardListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-3", className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-xs">
          <Skeleton className="size-10 rounded-xl" />
          <div className="flex-1 space-y-2.5">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action, className, tone = "brand" }: { icon: LucideIcon; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string; tone?: Tone }) {
  return (
    <div className={cn("flex flex-col items-center rounded-2xl border border-dashed border-border bg-card/60 px-6 py-12 text-center", className)}>
      <span className={cn("grid size-14 place-items-center rounded-full", TONE_ICON_BG[tone])} aria-hidden>
        <Icon className="size-6" />
      </span>
      <h3 className="mt-4 font-display text-lg font-semibold text-ink">{title}</h3>
      {children && <div className="mt-1.5 max-w-md text-sm leading-relaxed text-ink-2">{children}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function describeError(error: unknown): { title: string; detail: string } {
  if (error instanceof ApiError) {
    if (error.status === 0) return { title: "Can't reach the server", detail: "Check that the Interactive Bible App is still running on this computer, then try again." };
    if (error.status === 404) return { title: "Not found", detail: "It may have been deleted, or the link is out of date." };
    if (error.status === 403 || error.status === 401) return { title: "Not allowed", detail: "Your account doesn't have access to this." };
    if (error.status === 429) return { title: "Too many requests", detail: "Please wait a minute and try again." };
    if (error.status >= 500) return { title: "Something went wrong on the server", detail: error.message || "Please try again in a moment." };
    return { title: "That didn't work", detail: error.message };
  }
  return { title: "Something went wrong", detail: error instanceof Error ? error.message : "Please try again." };
}

export function errorMessage(error: unknown): string {
  const d = describeError(error);
  return d.detail && d.detail !== d.title ? `${d.title}: ${d.detail}` : d.title;
}

export function ErrorCard({ error, onRetry, retrying, className, title }: { error: unknown; onRetry?: () => void; retrying?: boolean; className?: string; title?: string }) {
  const d = describeError(error);
  return (
    <div role="alert" className={cn("flex items-start gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--danger)_25%,var(--line))] bg-[var(--danger-soft)] p-4", className)}>
      <CircleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-danger">{title ?? d.title}</p>
          <p className="mt-0.5 text-sm break-words text-ink-2">{d.detail}</p>
        </div>
        {onRetry && (
          <Button variant="outline" onClick={onRetry} disabled={retrying} className="h-10 w-fit shrink-0 gap-2 rounded-xl bg-card px-4">
            <RefreshCw className={cn("size-4", retrying && "animate-spin")} aria-hidden /> Try again
          </Button>
        )}
      </div>
    </div>
  );
}

export function Notice({ tone = "info", icon, title, children, action, className }: { tone?: "info" | "warn" | "danger" | "ok"; icon?: LucideIcon; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const Icon = icon ?? (tone === "ok" ? CircleCheck : tone === "info" ? CircleHelp : TriangleAlert);
  const styles = {
    info: "border-[color-mix(in_srgb,var(--accent)_22%,var(--line))] bg-[var(--accent-soft)] [&_.notice-icon]:text-link",
    warn: "border-[color-mix(in_srgb,var(--warn)_30%,var(--line))] bg-[var(--warn-soft)] [&_.notice-icon]:text-warn",
    danger: "border-[color-mix(in_srgb,var(--danger)_25%,var(--line))] bg-[var(--danger-soft)] [&_.notice-icon]:text-danger",
    ok: "border-[color-mix(in_srgb,var(--ok)_25%,var(--line))] bg-[var(--ok-soft)] [&_.notice-icon]:text-ok",
  }[tone];
  return (
    <div role={tone === "danger" || tone === "warn" ? "alert" : "note"} className={cn("flex items-start gap-3 rounded-2xl border p-4", styles, className)}>
      <Icon className="notice-icon mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 text-sm leading-relaxed text-ink-2">
          {title && <p className="font-semibold text-ink">{title}</p>}
          {children && <div className={cn(title && "mt-0.5")}>{children}</div>}
        </div>
        {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── help

/** Collapsible plain-language explanation. Remembers whether the owner closed it. */
export function HelpPanel({ id, title, children, defaultOpen = false, className }: { id: string; title: string; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const key = `ibible_admin_help_${id}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(key);
      return v == null ? defaultOpen : v === "1";
    } catch {
      return defaultOpen;
    }
  });
  const panelId = useId();
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(key, o ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !o;
    });
  return (
    <div className={cn("rounded-2xl border border-border bg-card shadow-xs", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring sm:px-5"
      >
        <CircleHelp className="size-5 shrink-0 text-gold-600 dark:text-gold-300" aria-hidden />
        <span className="flex-1 text-sm font-semibold text-ink">{title}</span>
        <ChevronDown className={cn("size-4 text-ink-2 transition", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div id={panelId} className="border-t border-border px-4 py-4 text-sm leading-relaxed text-ink-2 sm:px-5">
          {children}
        </div>
      )}
    </div>
  );
}

/** “Verse link”, “Section”, “Confidence”… explained once, reused on every review screen. */
export function ReviewGlossary() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <dl className="grid grid-cols-1 gap-3">
        <div>
          <dt className="font-semibold text-ink">Section</dt>
          <dd>A short part of a sermon, podcast or study about one idea — a minute or two of a recording, or a few paragraphs.</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Verse link</dt>
          <dd>A connection between a section and a Bible verse. Approved links appear on that verse's page, so readers can watch or read the section.</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Confidence</dt>
          <dd>
            How sure the system is. <strong className="text-ink">90% or more</strong> is shown automatically, <strong className="text-ink">80–89%</strong> is shown but flagged,{" "}
            <strong className="text-ink">65–79%</strong> is kept for search or sent here, and anything lower is discarded.
          </dd>
        </div>
      </dl>
      <div>
        <p className="font-semibold text-ink">How a verse is used</p>
        <ul className="mt-2 grid grid-cols-1 gap-2.5">
          {Object.entries(RELATIONSHIPS).map(([type, r]) => (
            <li key={type} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
              <RelationshipChip type={type} className="w-fit" />
              <span>
                {r.description} <span className="text-ink-2 italic">{r.example}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── change diff

/** Before → after for an audit entry, as a readable table instead of raw JSON. */
export function ChangeTable({ before, after }: { before: unknown; after: unknown }) {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (!isObj(before) && !isObj(after)) {
    return (
      <pre className="max-h-64 overflow-auto rounded-lg bg-surface-2 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink">
        {JSON.stringify({ before, after }, null, 2)}
      </pre>
    );
  }
  const b = isObj(before) ? before : {};
  const a = isObj(after) ? after : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const show = (v: unknown) => (v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[420px] border-collapse text-xs">
        <thead className="bg-surface-2/60 text-left text-ink-2">
          <tr>
            <th scope="col" className="px-2.5 py-1.5 font-semibold">Field</th>
            <th scope="col" className="px-2.5 py-1.5 font-semibold">Before</th>
            <th scope="col" className="px-2.5 py-1.5 font-semibold">After</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k} className="border-t border-border align-top">
              <th scope="row" className="px-2.5 py-1.5 text-left font-medium text-ink">{humanize(k)}</th>
              <td className="max-w-56 px-2.5 py-1.5 break-words text-ink-2">{show(b[k])}</td>
              <td className={cn("max-w-56 px-2.5 py-1.5 break-words", show(b[k]) !== show(a[k]) ? "font-medium text-ink" : "text-ink-2")}>{show(a[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── dialogs

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  tone = "default",
  pending,
  icon: Icon,
  children,
  confirmDisabled,
  focusConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  tone?: "default" | "destructive" | "ok";
  pending?: boolean;
  icon?: LucideIcon;
  children?: ReactNode;
  confirmDisabled?: boolean;
  /** Put focus on the confirm button so Enter confirms. Defaults to on, except for destructive actions. */
  focusConfirm?: boolean;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const initial = (focusConfirm ?? tone !== "destructive") && !confirmDisabled ? confirmRef : cancelRef;
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="gap-5 sm:max-w-md" initialFocus={initial}>
        <DialogHeader>
          <DialogTitle className="pr-8 font-display text-xl leading-snug">{title}</DialogTitle>
          <DialogDescription className="text-[15px] leading-relaxed text-ink-2">{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button ref={cancelRef} variant="ghost" onClick={() => onOpenChange(false)} disabled={pending} className="h-10 rounded-xl px-4">
            Cancel
          </Button>
          <Button
            ref={confirmRef}
            onClick={onConfirm}
            disabled={pending || confirmDisabled}
            className={cn(
              "h-10 gap-2 rounded-xl px-4",
              tone === "destructive" && "bg-danger text-white hover:bg-danger/90 dark:text-navy-950",
              tone === "ok" && "bg-[#1b5e20] text-white hover:bg-[#1b5e20]/90 dark:bg-ok dark:text-navy-950 dark:hover:bg-ok/90",
            )}
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Icon ? <Icon className="size-4" aria-hidden /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────── forms

export const inputClass =
  "w-full min-w-0 rounded-xl border border-input bg-surface px-3 text-[15px] text-ink shadow-xs outline-none transition placeholder:text-ink-3 focus:border-gold-500/60 focus:ring-3 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger aria-invalid:ring-danger/20 dark:bg-surface-2/50 sm:text-sm";

export function TextInput({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(inputClass, "h-10", className)} {...props} />;
}

export function TextArea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(inputClass, "min-h-24 resize-y py-2.5 leading-relaxed", className)} {...props} />;
}

export function NativeSelect({ className, children, wrapperClassName, ...props }: ComponentProps<"select"> & { wrapperClassName?: string }) {
  return (
    <div className={cn("relative min-w-0", wrapperClassName)}>
      <select className={cn(inputClass, "h-10 cursor-pointer appearance-none pr-9", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-2" aria-hidden />
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={htmlFor} className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-[13px] font-semibold text-ink">
        {label}
        {optional && <span className="text-xs font-normal text-ink-2">Optional</span>}
      </label>
      {children}
      {error ? (
        <p id={htmlFor ? `${htmlFor}-error` : undefined} className="mt-1.5 flex items-start gap-1.5 text-[13px] font-medium text-danger">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {error}
        </p>
      ) : hint ? (
        <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{hint}</p>
      ) : null}
    </div>
  );
}

/** Accessible on/off switch built on a native checkbox. */
export function Toggle({ checked, onChange, label, description, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean; id?: string }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl py-1", disabled && "cursor-not-allowed opacity-60")}>
      <input id={id} type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 transition peer-focus-visible:ring-3 peer-focus-visible:ring-ring",
          checked ? "border-transparent bg-primary" : "border-ink-3 bg-surface",
        )}
      >
        <span
          className={cn(
            "inline-block rounded-full transition",
            checked ? "size-[18px] translate-x-[20px] bg-white shadow-sm dark:bg-navy-900" : "size-3.5 translate-x-[3px] bg-ink-3",
          )}
        />
      </span>
      <span className="min-w-0 text-sm">
        <span className="block font-semibold text-ink">{label}</span>
        {description && <span className="mt-0.5 block leading-relaxed text-ink-2">{description}</span>}
      </span>
    </label>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  badge?: ReactNode;
}

/** Radio group rendered as large, explained choice cards. */
export function ChoiceCards<T extends string>({
  name,
  value,
  onChange,
  options,
  columns = 2,
  legend,
  error,
  className,
}: {
  name: string;
  value: T | "";
  onChange: (v: T) => void;
  options: ChoiceOption<T>[];
  columns?: 1 | 2 | 3 | 4;
  legend: ReactNode;
  error?: string | null;
  className?: string;
}) {
  // container queries: columns follow the space the form actually has, not the window width
  const cols = { 1: "", 2: "@lg:grid-cols-2", 3: "@lg:grid-cols-2 @3xl:grid-cols-3", 4: "@lg:grid-cols-2 @5xl:grid-cols-4" }[columns];
  return (
    <fieldset className={cn("@container min-w-0", className)} aria-invalid={error ? true : undefined}>
      <legend className="mb-2 text-[13px] font-semibold text-ink">{legend}</legend>
      <div className={cn("grid grid-cols-1 gap-2.5", cols)}>
        {options.map((o) => {
          const selected = value === o.value;
          const Icon = o.icon;
          return (
            <label
              key={o.value}
              className={cn(
                "relative flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border bg-surface p-3.5 transition has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring dark:bg-surface-2/40",
                selected ? "border-gold-500 bg-gold-400/10 shadow-xs dark:border-gold-400 dark:bg-gold-400/10" : "border-border hover:border-gold-400/50",
              )}
            >
              <input type="radio" name={name} value={o.value} checked={selected} onChange={() => onChange(o.value)} className="peer sr-only" />
              {Icon && (
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", selected ? "bg-gold-400/20 text-gold-700 dark:text-gold-300" : "bg-surface-2 text-ink-2")} aria-hidden>
                  <Icon className="size-[18px]" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  {o.label}
                  {o.badge}
                </span>
                {o.description && <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-2">{o.description}</span>}
              </span>
              <span
                aria-hidden
                className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition", selected ? "border-gold-600 dark:border-gold-400" : "border-input")}
              >
                {selected && <span className="size-2.5 rounded-full bg-gold-600 dark:bg-gold-400" />}
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-[13px] font-medium text-danger">
          <CircleAlert className="size-3.5" aria-hidden /> {error}
        </p>
      )}
    </fieldset>
  );
}

export interface FilterOption<T extends string> {
  value: T;
  label: string;
  count?: number | null;
}

/** A row of toggle buttons (one active) that scrolls sideways on phones. */
export function FilterTabs<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: FilterOption<T>[]; label: string; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cn("no-scrollbar relative -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition outline-none focus-visible:ring-3 focus-visible:ring-ring",
              active ? "border-transparent bg-navy-700 text-white shadow-xs dark:bg-gold-400 dark:text-navy-950" : "border-border bg-card text-ink-2 hover:border-gold-400/50 hover:text-ink",
            )}
          >
            {o.label}
            {o.count != null && (
              <span className={cn("rounded-full px-1.5 py-px text-xs font-semibold tabular-nums", active ? "bg-white/20 dark:bg-navy-950/15" : "bg-surface-2 text-ink-2")}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── hooks

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== "undefined" ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function useDebounced<T>(value: T, delay = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** True when a keyboard shortcut should be ignored (typing, modifier keys, or a dialog/menu is open). */
export function shortcutBlocked(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return true;
  const t = e.target as HTMLElement | null;
  if (t && (t.closest("input, textarea, select, [contenteditable='true'], [role='textbox']") || t.isContentEditable)) return true;
  return !!document.querySelector("[role='dialog'][data-open], [role='alertdialog'][data-open], [role='menu'][data-open]");
}
