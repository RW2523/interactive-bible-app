import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CircleCheck, Flag, ListChecks, Search, SlidersHorizontal, Star, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import { useReviewQueue } from "@/api/hooks";
import type { Json } from "@/api/types";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ADMIN_PAGE, CardListSkeleton, ConfidenceMeter, EmptyState, ErrorCard, Field, FilterTabs, HelpPanel, Kbd, NativeSelect, PageHeader, RelationshipChip, ReviewGlossary, StatusPill, TextInput,
  TypeIcon, useDebounced,
} from "./AdminUI";
import { reasonLabel, REL_TYPES, relLabel, REVIEW_STATUS, reviewStatusLabel, segmentLocation, sortReasons, typeLabel } from "./adminLabels";

const PAGE_SIZE = 20;

const STATUS_TABS: { value: string; label: string; facet?: string }[] = [
  { value: "open", label: "Needs review" },
  { value: "flagged", label: "Reported by readers" },
  { value: "pending_review", label: "Waiting (hidden)", facet: "pending_review" },
  { value: "index_only", label: "Search only", facet: "index_only" },
  { value: "published", label: "Shown to readers", facet: "published" },
  { value: "approved", label: "Approved", facet: "approved" },
  { value: "rejected", label: "Rejected", facet: "rejected" },
  { value: "discarded", label: "Discarded", facet: "discarded" },
  { value: "all", label: "All" },
];

const CONFIDENCE_PRESETS: Record<string, { label: string; min?: string; max?: string }> = {
  "": { label: "Any confidence" },
  low: { label: "Below 80%", max: "0.799" },
  medium: { label: "80–89%", min: "0.8", max: "0.899" },
  high: { label: "90% and above", min: "0.9" },
};

const REASON_FILTERS = [
  "audit_needs_review",
  "audit_rejected",
  "editorial_review_required",
  "weak_candidate",
  "uncertain_confidence_band",
  "ai_match_below_display_bar",
  "user_reported_wrong_verse",
  "user_reported_not_relevant",
  "llm_only_reference",
  "quote_evidence_not_grounded",
];

function presetFor(min?: string | null, max?: string | null): string {
  const hit = Object.entries(CONFIDENCE_PRESETS).find(([, p]) => (p.min ?? null) === (min ?? null) && (p.max ?? null) === (max ?? null));
  return hit ? hit[0] : "custom";
}

export function ReviewQueuePage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const filters = Object.fromEntries(params.entries());
  const status = filters.status || "open";
  const page = Math.max(1, Number(filters.page || 1));
  const q = useReviewQueue({ ...filters, status, page, page_size: PAGE_SIZE });
  const d = q.data;
  const [verseText, setVerseText] = useState(filters.verse || "");
  const verse = useDebounced(verseText, 450);
  const [showFilters, setShowFilters] = useState(false);
  const resource = useQuery({
    queryKey: ["resource", filters.resource_id],
    queryFn: () => api<Json>(`/v1/resources/${filters.resource_id}`),
    enabled: !!filters.resource_id,
    staleTime: 60_000,
  });

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (!("page" in changes)) next.delete("page");
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if ((filters.verse || "") !== verse.trim()) update({ verse: verse.trim() || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verse]);

  const preset = presetFor(filters.min_confidence, filters.max_confidence);
  const facets = d?.facets?.status || {};
  const allCount = Object.values(facets).reduce((a: number, b) => a + Number(b || 0), 0);
  const tabs = STATUS_TABS.map((t) => ({ value: t.value, label: t.label, count: t.value === "open" ? d?.facets?.open ?? null : t.value === "all" ? (d ? allCount : null) : t.facet ? Number(facets[t.facet] || 0) : null }));

  const active: { key: string; label: string; clear: Record<string, null> }[] = [];
  if (filters.resource_id) active.push({ key: "resource", label: `From: ${resource.data?.title ?? "one library item"}`, clear: { resource_id: null } });
  if (filters.relationship_type) active.push({ key: "rel", label: relLabel(filters.relationship_type), clear: { relationship_type: null } });
  if (filters.min_confidence || filters.max_confidence) active.push({ key: "conf", label: preset !== "custom" ? CONFIDENCE_PRESETS[preset].label : `Confidence ${filters.min_confidence ?? 0}–${filters.max_confidence ?? 1}`, clear: { min_confidence: null, max_confidence: null } });
  if (filters.official) active.push({ key: "official", label: filters.official === "true" ? "Official content only" : "Community content only", clear: { official: null } });
  if (filters.verse) active.push({ key: "verse", label: `Verse: ${filters.verse}`, clear: { verse: null } });
  if (filters.reason) active.push({ key: "reason", label: reasonLabel(filters.reason), clear: { reason: null } });
  if (filters.language) active.push({ key: "language", label: `Language: ${filters.language}`, clear: { language: null } });
  if (filters.pipeline_version) active.push({ key: "pipeline", label: `Pipeline: ${filters.pipeline_version}`, clear: { pipeline_version: null } });

  const clearAll = () => {
    setVerseText("");
    const next = new URLSearchParams();
    if (status !== "open") next.set("status", status);
    setParams(next, { replace: true });
  };

  const ids = useMemo(() => (d?.items || []).map((x: Json) => x.mapping_id as string), [d]);
  const from = location.pathname + location.search;
  const totalPages = d ? Math.max(1, Math.ceil(d.total / d.page_size)) : 1;
  const firstShown = d && d.total ? (d.page - 1) * d.page_size + 1 : 0;
  const lastShown = d ? Math.min(d.total, d.page * d.page_size) : 0;

  const filterControls = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Field label="How the verse is used" htmlFor="rq-rel">
        <NativeSelect id="rq-rel" value={filters.relationship_type || ""} onChange={(e) => update({ relationship_type: e.target.value || null })}>
          <option value="">All kinds</option>
          {REL_TYPES.map((t) => (
            <option key={t} value={t}>{relLabel(t)}</option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Confidence" htmlFor="rq-conf">
        <NativeSelect
          id="rq-conf"
          value={preset}
          onChange={(e) => {
            const p = CONFIDENCE_PRESETS[e.target.value];
            if (p) update({ min_confidence: p.min ?? null, max_confidence: p.max ?? null });
          }}
        >
          {Object.entries(CONFIDENCE_PRESETS).map(([k, p]) => (
            <option key={k} value={k}>{p.label}</option>
          ))}
          {preset === "custom" && <option value="custom">Custom range</option>}
        </NativeSelect>
      </Field>
      <Field label="Content" htmlFor="rq-official">
        <NativeSelect id="rq-official" value={filters.official || ""} onChange={(e) => update({ official: e.target.value || null })}>
          <option value="">Official and community</option>
          <option value="true">Official content only</option>
          <option value="false">Community content only</option>
        </NativeSelect>
      </Field>
      <Field label="Sort" htmlFor="rq-sort">
        <NativeSelect id="rq-sort" value={filters.sort || ""} onChange={(e) => update({ sort: e.target.value || null })}>
          <option value="">Most important first</option>
          <option value="confidence">Lowest confidence first</option>
          <option value="feedback">Most reported first</option>
          <option value="newest">Newest first</option>
        </NativeSelect>
      </Field>
      <details className="group sm:col-span-2 xl:col-span-4">
        <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-lg text-sm font-medium text-ink-2 hover:text-ink">
          <ArrowRight className="size-3.5 transition group-open:rotate-90" aria-hidden /> More filters
        </summary>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Why it's in the queue" htmlFor="rq-reason">
            <NativeSelect id="rq-reason" value={filters.reason || ""} onChange={(e) => update({ reason: e.target.value || null })}>
              <option value="">Any reason</option>
              {REASON_FILTERS.map((r) => (
                <option key={r} value={r}>{reasonLabel(r)}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Language code" htmlFor="rq-lang">
            <TextInput id="rq-lang" placeholder="e.g. en" value={filters.language || ""} onChange={(e) => update({ language: e.target.value.trim() || null })} />
          </Field>
          <Field label="Pipeline version" htmlFor="rq-pipeline">
            <TextInput id="rq-pipeline" placeholder="e.g. scripture-intelligence-1.0" value={filters.pipeline_version || ""} onChange={(e) => update({ pipeline_version: e.target.value.trim() || null })} />
          </Field>
        </div>
      </details>
    </div>
  );

  return (
    <div className={ADMIN_PAGE}>
      <PageHeader
        icon={ListChecks}
        eyebrow="Review"
        title="Review queue"
        description="Check the verse links the system wasn't sure about. Approve the good ones so readers can see them, and reject the rest."
      />

      <HelpPanel id="review-glossary" title="New to reviewing? What these words mean" defaultOpen className="mb-5">
        <ReviewGlossary />
      </HelpPanel>

      <FilterTabs label="Review status" value={status} onChange={(v) => update({ status: v === "open" ? null : v })} options={tabs} className="mb-4" />

      <div className="mb-4 rounded-2xl border border-border bg-card p-3 shadow-xs sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-2" aria-hidden />
            <TextInput type="search" value={verseText} onChange={(e) => setVerseText(e.target.value)} placeholder="Find a verse, e.g. Romans 8 or John 3:16" aria-label="Find a verse" className="pl-9" />
          </div>
          <Button
            variant="outline"
            onClick={() => setShowFilters((s) => !s)}
            aria-expanded={showFilters}
            aria-controls="rq-filters"
            className="h-10 gap-2 rounded-xl px-3.5 lg:hidden"
          >
            <SlidersHorizontal className="size-4" aria-hidden /> Filters
            {active.length > 0 && <span className="rounded-full bg-gold-400 px-1.5 text-xs font-bold text-navy-950">{active.length}</span>}
          </Button>
        </div>
        <div id="rq-filters" className={cn("mt-3 border-t border-border pt-3", showFilters ? "block" : "hidden lg:block")}>
          {filterControls}
        </div>
        {active.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {active.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => {
                  if (f.key === "verse") setVerseText("");
                  update(f.clear);
                }}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-surface-2/60 pr-2 pl-3 text-[13px] font-medium text-ink hover:border-gold-400/60"
                aria-label={`Remove filter: ${f.label}`}
              >
                {f.label} <X className="size-3.5 text-ink-2" aria-hidden />
              </button>
            ))}
            <button type="button" onClick={clearAll} className="min-h-9 rounded-lg px-2 text-[13px] font-semibold text-link hover:underline">
              Clear all
            </button>
          </div>
        )}
      </div>

      {q.error && !d ? (
        <ErrorCard error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : q.isLoading ? (
        <CardListSkeleton rows={5} />
      ) : d && d.items.length === 0 ? (
        active.length ? (
          <EmptyState
            icon={Search}
            title="No verse links match these filters"
            action={
              <Button variant="outline" onClick={clearAll} className="h-10 rounded-xl px-4">
                Clear filters
              </Button>
            }
          >
            Try another verse, or remove a filter.
          </EmptyState>
        ) : status === "open" ? (
          <EmptyState
            icon={CircleCheck}
            tone="ok"
            title="You're all caught up"
            action={
              <>
                <Button variant="outline" onClick={() => update({ status: "all" })} className="h-10 rounded-xl px-4">
                  Browse all verse links
                </Button>
                <Link to="/admin" className={cn(buttonVariants(), "h-10 rounded-xl px-4 no-underline hover:no-underline")}>
                  Back to dashboard
                </Link>
              </>
            }
          >
            Nothing needs a second look right now. New items appear here after processing.
          </EmptyState>
        ) : (
          <EmptyState icon={ListChecks} title={`Nothing in “${STATUS_TABS.find((t) => t.value === status)?.label ?? status}”`}>
            {REVIEW_STATUS[status]?.description ?? "Try another tab."}
          </EmptyState>
        )
      ) : d ? (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-2">
            <p aria-live="polite">
              Showing <span className="font-semibold text-ink tabular-nums">{firstShown}–{lastShown}</span> of <span className="font-semibold text-ink tabular-nums">{d.total}</span>
            </p>
            <p className="hidden items-center gap-1.5 md:flex">
              Tip: open an item, then press <Kbd>A</Kbd> to approve or <Kbd>R</Kbd> to reject
            </p>
          </div>
          <ul className={cn("grid grid-cols-1 gap-3 transition-opacity", q.isFetching && q.isPlaceholderData && "opacity-60")} aria-label="Verse links to review">
            {d.items.map((item: Json) => (
              <li key={item.mapping_id}>
                <QueueCard item={item} ids={ids} from={from} />
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <nav aria-label="Pages" className="mt-5 flex items-center justify-center gap-3">
              <Button variant="outline" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })} className="h-10 gap-1.5 rounded-xl bg-card px-3.5">
                <ArrowLeft className="size-4" aria-hidden /> Previous
              </Button>
              <span className="text-sm text-ink-2 tabular-nums">
                Page {page} of {totalPages}
              </span>
              <Button variant="outline" disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })} className="h-10 gap-1.5 rounded-xl bg-card px-3.5">
                Next <ArrowRight className="size-4" aria-hidden />
              </Button>
            </nav>
          )}
        </>
      ) : null}
    </div>
  );
}

function QueueCard({ item, ids, from }: { item: Json; ids: string[]; from: string }) {
  const reasons = sortReasons(item.review_reasons);
  const status = REVIEW_STATUS[item.review_status];
  const conf = item.confidence_override ?? item.confidence;
  return (
    <article className="group relative rounded-2xl border border-border bg-card p-4 shadow-xs transition hover:border-gold-400/50 hover:shadow-md sm:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-xl leading-tight font-semibold text-ink">
              <Link
                to={`/admin/review/${item.mapping_id}`}
                state={{ queue: ids, from }}
                className="text-ink no-underline after:absolute after:inset-0 after:rounded-2xl hover:no-underline focus-visible:outline-none"
              >
                {item.verse_display}
              </Link>
            </h3>
            <RelationshipChip type={item.relationship_type} />
            {item.primary && (
              <StatusPill tone="brand" icon={Star}>
                Main verse
              </StatusPill>
            )}
            {item.feedback_count > 0 && (
              <StatusPill tone="danger" icon={Flag}>
                {item.feedback_count} reader {item.feedback_count === 1 ? "report" : "reports"}
              </StatusPill>
            )}
          </div>
          <div className="mt-2 flex min-w-0 items-center gap-2 text-sm text-ink-2">
            <TypeIcon type={item.resource?.type} size="sm" className="size-6 rounded-md [&_svg]:size-3.5" />
            <span className="relative min-w-0 truncate">
              {item.resource?.type ? <span className="sr-only">{typeLabel(item.resource.type)}: </span> : null}
              <span className="font-medium text-ink">{item.resource?.title}</span>
              {segmentLocation(item.segment) && ` · ${segmentLocation(item.segment)}`}
              {item.resource?.is_official ? " · Official" : ""}
            </span>
          </div>
          {item.evidence_text && (
            <blockquote className="mt-3 line-clamp-3 border-l-2 border-gold-400/70 pl-3 font-serif text-[15px] leading-relaxed text-ink-2 italic">“{item.evidence_text}”</blockquote>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <ConfidenceMeter value={conf} />
            {reasons.length > 0 && (
              <p className="min-w-0 text-[13px] text-ink-2">
                <span className="font-medium text-ink">Why it's here:</span> {reasonLabel(reasons[0])}
                {reasons.length > 1 && <span> · +{reasons.length - 1} more</span>}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 md:flex-col md:items-end">
          <StatusPill tone={status?.tone ?? "neutral"} icon={item.is_human_verified ? CircleCheck : undefined}>
            {item.is_human_verified && item.review_status !== "approved" && item.review_status !== "rejected" ? `${reviewStatusLabel(item.review_status)} · checked` : reviewStatusLabel(item.review_status)}
          </StatusPill>
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-link">
            Review <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" aria-hidden />
          </span>
        </div>
      </div>
    </article>
  );
}
