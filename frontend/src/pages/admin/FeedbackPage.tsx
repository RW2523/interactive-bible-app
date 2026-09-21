import { ArrowRight, CircleCheck, Clock, Flag, ListChecks, Loader2, MessageSquareWarning, RotateCcw, ThumbsUp, X, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useBooks, useInvalidate } from "@/api/hooks";
import type { Json } from "@/api/types";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAdminFeedback, useSystemStatus } from "./adminApi";
import { ADMIN_PAGE, CardListSkeleton, EmptyState, ErrorCard, errorMessage, FilterTabs, NativeSelect, PageHeader, StatusPill, TimeAgo } from "./AdminUI";
import { FEEDBACK_KINDS, FEEDBACK_STATUS, humanize, prettyRef, reviewStatusLabel } from "./adminLabels";

const PAGE_SIZE = 25;

const KIND_ICON: Record<string, LucideIcon> = {
  helpful: ThumbsUp,
  report_content: Flag,
};

export function FeedbackAdminPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "open";
  const kind = params.get("kind") || "";
  const page = Math.max(1, Number(params.get("page") || 1));
  const q = useAdminFeedback({ status: status === "all" ? undefined : status, kind: kind || undefined, page, page_size: PAGE_SIZE });
  const books = useBooks();
  const threshold = Number(useSystemStatus().data?.policy?.feedback_hide_threshold || 0);
  const bookNames = useMemo(() => Object.fromEntries((books.data || []).map((b) => [b.code, b.name])), [books.data]);
  const d = q.data;
  const summary: Json[] = d?.summary || [];
  const countFor = (s: string) => summary.filter((x) => s === "all" || x.status === s).filter((x) => !kind || x.kind === kind).reduce((a, x) => a + Number(x.n || 0), 0);

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (!("page" in changes)) next.delete("page");
    setParams(next, { replace: true });
  };

  const totalPages = d ? Math.max(1, Math.ceil(d.total / (d.page_size || PAGE_SIZE))) : 1;

  return (
    <div className={ADMIN_PAGE}>
      <PageHeader
        icon={MessageSquareWarning}
        eyebrow="Review"
        title="Reader feedback"
        description={`When readers tell you a verse link looks wrong, their reports land here. A link is only hidden automatically after ${threshold > 1 ? `${threshold} different people` : "several different people"} report it.`}
      />

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterTabs
          label="Report status"
          value={status}
          onChange={(v) => update({ status: v === "open" ? null : v })}
          options={[
            { value: "open", label: FEEDBACK_STATUS.open.label, count: d ? countFor("open") : null },
            { value: "in_review", label: FEEDBACK_STATUS.in_review.label, count: d ? countFor("in_review") : null },
            { value: "resolved", label: FEEDBACK_STATUS.resolved.label, count: d ? countFor("resolved") : null },
            { value: "dismissed", label: FEEDBACK_STATUS.dismissed.label, count: d ? countFor("dismissed") : null },
            { value: "all", label: "All", count: d ? countFor("all") : null },
          ]}
        />
        <NativeSelect value={kind} onChange={(e) => update({ kind: e.target.value || null })} aria-label="Kind of report" wrapperClassName="lg:w-64" className="bg-card">
          <option value="">All kinds of report</option>
          {Object.entries(FEEDBACK_KINDS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </NativeSelect>
      </div>

      {q.error && !d ? (
        <ErrorCard error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : q.isLoading ? (
        <CardListSkeleton rows={4} />
      ) : d && d.items.length === 0 ? (
        <EmptyState
          icon={status === "open" ? CircleCheck : MessageSquareWarning}
          tone={status === "open" ? "ok" : "brand"}
          title={status === "open" ? "No new reports" : "Nothing here"}
          action={
            <Link to="/admin/review" className={cn(buttonVariants({ variant: "outline" }), "h-10 gap-2 rounded-xl px-4 no-underline hover:no-underline")}>
              <ListChecks className="size-4" aria-hidden /> Go to the review queue
            </Link>
          }
        >
          {status === "open"
            ? "When a reader reports a wrong verse, a wrong time in a recording or content that shouldn't be there, it will appear here."
            : "Try another tab or kind of report."}
        </EmptyState>
      ) : d ? (
        <>
          <ul className={cn("grid grid-cols-1 gap-3 transition-opacity", q.isFetching && q.isPlaceholderData && "opacity-60")} aria-label="Reader reports">
            {d.items.map((f: Json) => (
              <li key={f.id}>
                <FeedbackCard f={f} bookNames={bookNames} />
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <nav aria-label="Pages" className="mt-5 flex items-center justify-center gap-3">
              <Button variant="outline" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })} className="h-10 rounded-xl bg-card px-3.5">
                Previous
              </Button>
              <span className="text-sm text-ink-2 tabular-nums">
                Page {page} of {totalPages}
              </span>
              <Button variant="outline" disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })} className="h-10 rounded-xl bg-card px-3.5">
                Next
              </Button>
            </nav>
          )}
        </>
      ) : null}
    </div>
  );
}

function FeedbackCard({ f, bookNames }: { f: Json; bookNames: Record<string, string> }) {
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState<string | null>(null);
  const kind = FEEDBACK_KINDS[f.kind] ?? { label: humanize(f.kind), tone: "warn" as const };
  const status = FEEDBACK_STATUS[f.status] ?? { label: humanize(f.status), tone: "neutral" as const };
  const Icon = KIND_ICON[f.kind] ?? Flag;

  const setStatus = async (next: string, message: string) => {
    setBusy(next);
    try {
      await api(`/v1/admin/feedback/${f.id}`, { method: "PATCH", body: { status: next } });
      toast.success(message);
      invalidate("admin-feedback", "audit");
    } catch (e) {
      toast.error("That didn't work", { description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const target =
    f.object_type === "mapping" ? (
      <Link to={`/admin/review/${f.object_id}`} className="font-semibold text-link">
        {f.verse_ref ? prettyRef(f.verse_ref, bookNames) : "Verse link"}
        {f.resource_title ? ` in “${f.resource_title}”` : ""}
      </Link>
    ) : f.object_type === "resource" ? (
      <Link to={`/admin/resources/${f.object_id}`} className="font-semibold text-link">
        {f.resource_title ? `“${f.resource_title}”` : "Library item"}
      </Link>
    ) : (
      <span className="font-semibold text-ink">{f.object_type === "segment" ? "A section" : f.object_type === "verse_relationship" ? "A related-verse suggestion" : humanize(f.object_type)}</span>
    );

  const action = (value: string, label: string, message: string, icon: LucideIcon, variant: "outline" | "ghost" = "outline") => {
    const I = icon;
    return (
      <Button variant={variant} onClick={() => void setStatus(value, message)} disabled={!!busy} className={cn("h-10 gap-2 rounded-xl px-3.5", variant === "outline" && "bg-card")}>
        {busy === value ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <I className="size-4" aria-hidden />} {label}
      </Button>
    );
  };

  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-xs sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", kind.tone === "ok" ? "bg-[var(--ok-soft)] text-ok" : kind.tone === "danger" ? "bg-[var(--danger-soft)] text-danger" : "bg-[var(--warn-soft)] text-warn")} aria-hidden>
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-ink">{kind.label}</h3>
            <p className="mt-0.5 text-sm text-ink-2">
              About {target}
              {f.mapping_status && <span> · the link is now “{reviewStatusLabel(f.mapping_status).toLowerCase()}”</span>}
            </p>
            {f.note && <blockquote className="mt-2 border-l-2 border-border pl-3 text-sm text-ink italic">“{f.note}”</blockquote>}
            <p className="mt-2 text-xs text-ink-2">
              {f.user_name ? `From ${f.user_name}` : "From a reader"} · <TimeAgo iso={f.created_at} />
            </p>
          </div>
        </div>
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
        {f.object_type === "mapping" && (
          <Link to={`/admin/review/${f.object_id}`} className={cn(buttonVariants(), "h-10 gap-2 rounded-xl px-3.5 no-underline hover:no-underline")}>
            Review the link <ArrowRight className="size-4" aria-hidden />
          </Link>
        )}
        {f.status === "open" && action("in_review", "Looking into it", "Marked as looking into it", Clock)}
        {(f.status === "open" || f.status === "in_review") && action("resolved", "Resolved", "Report resolved", CircleCheck)}
        {(f.status === "open" || f.status === "in_review") && action("dismissed", "Dismiss", "Report dismissed", X, "ghost")}
        {(f.status === "resolved" || f.status === "dismissed") && action("open", "Reopen", "Report reopened", RotateCcw)}
      </div>
    </article>
  );
}
