import { ArrowRight, History } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuditLog, useBooks } from "@/api/hooks";
import type { Json } from "@/api/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ADMIN_PAGE, CardListSkeleton, ChangeTable, EmptyState, ErrorCard, FilterTabs, PageHeader, StatusPill } from "./AdminUI";
import { AUDIT_ACTIONS, AUDIT_OBJECTS, fullDate, humanize, prettyRef } from "./adminLabels";

const PAGE_SIZE = 50;

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function objectLink(a: Json): { to: string; label: string } | null {
  if (a.object_type === "mapping" && a.action !== "delete") return { to: `/admin/review/${a.object_id}`, label: "Open verse link" };
  if (a.object_type === "resource" && a.action !== "delete") return { to: `/admin/resources/${a.object_id}`, label: "Open library item" };
  if (a.object_type === "feedback") return { to: "/admin/feedback?status=all", label: "Open feedback" };
  if (a.object_type === "topic" || a.object_type === "entity") return { to: `/admin/vocabulary?tab=${a.object_type === "topic" ? "topics" : "entities"}`, label: "Open vocabulary" };
  return null;
}

function objectName(a: Json, bookNames: Record<string, string>): string {
  const n = a.new_value || a.previous_value || {};
  const singular = AUDIT_OBJECTS[a.object_type]?.singular ?? humanize(a.object_type).toLowerCase();
  if (a.object_type === "resource" && n.title) return `“${n.title}”`;
  if ((a.object_type === "topic" || a.object_type === "entity") && n.name) return `the ${a.object_type === "topic" ? "topic" : "entry"} “${n.name}”`;
  if (a.object_type === "mapping" && typeof n.verse_ref === "string") return `a verse link to ${prettyRef(n.verse_ref, bookNames)}`;
  if (a.object_type === "clip") return "a clip";
  if (a.object_type === "segment") return "a section";
  return `a ${singular}`;
}

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const objectType = params.get("type") || "";
  const page = Math.max(1, Number(params.get("page") || 1));
  const q = useAuditLog({ object_type: objectType || undefined, page, page_size: PAGE_SIZE });
  const books = useBooks();
  const bookNames = Object.fromEntries((books.data || []).map((b) => [b.code, b.name]));
  const d = q.data;
  const items: Json[] = d?.items || [];
  const totalPages = d ? Math.max(1, Math.ceil(d.total / PAGE_SIZE)) : 1;

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (!("page" in changes)) next.delete("page");
    setParams(next, { replace: true });
  };

  const groups: { day: string; entries: Json[] }[] = [];
  for (const a of items) {
    const day = dayLabel(a.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.entries.push(a);
    else groups.push({ day, entries: [a] });
  }

  return (
    <div className={ADMIN_PAGE}>
      <PageHeader icon={History} eyebrow="Review" title="Audit history" description="A permanent record of every review and admin change — who did what, and when. Nothing here can be edited or deleted." />

      <FilterTabs
        label="Show changes to"
        value={objectType}
        onChange={(v) => update({ type: v || null })}
        className="mb-5"
        options={[{ value: "", label: "Everything" }, ...Object.entries(AUDIT_OBJECTS).map(([value, o]) => ({ value, label: o.label }))]}
      />

      {q.error && !d ? (
        <ErrorCard error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : q.isLoading ? (
        <CardListSkeleton rows={5} />
      ) : items.length === 0 ? (
        <EmptyState icon={History} title="Nothing recorded yet">
          {objectType ? "No changes of this kind have been made." : "Approvals, edits, uploads and other changes will be listed here as they happen."}
        </EmptyState>
      ) : (
        <div className={cn("grid grid-cols-1 gap-6 transition-opacity", q.isFetching && q.isPlaceholderData && "opacity-60")}>
          <p className="text-sm text-ink-2" aria-live="polite">
            {d.total.toLocaleString()} {d.total === 1 ? "change" : "changes"}
            {totalPages > 1 && ` · page ${page} of ${totalPages}`}
          </p>
          {groups.map((g) => (
            <section key={g.day} aria-label={g.day}>
              <h2 className="mb-3 text-xs font-semibold tracking-wider text-ink-2 uppercase">{g.day}</h2>
              <ol className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
                {g.entries.map((a) => {
                  const action = AUDIT_ACTIONS[a.action] ?? { verb: humanize(a.action).toLowerCase(), tone: "neutral" as const };
                  const link = objectLink(a);
                  return (
                    <li key={a.id} className="border-b border-border px-4 py-3.5 last:border-b-0 sm:px-5">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <span
                            className={cn(
                              "mt-1.5 size-2.5 shrink-0 rounded-full",
                              action.tone === "ok" ? "bg-ok" : action.tone === "danger" ? "bg-danger" : action.tone === "warn" ? "bg-warn" : action.tone === "progress" || action.tone === "info" ? "bg-[var(--accent-2)]" : "bg-ink-3",
                            )}
                            aria-hidden
                          />
                          <div className="min-w-0">
                            <p className="text-sm leading-relaxed text-ink">
                              <span className="font-semibold">{a.reviewer_name || "The system"}</span> {action.verb} {objectName(a, bookNames)}
                            </p>
                            {a.note && <p className="mt-0.5 text-sm text-ink-2 italic">“{a.note}”</p>}
                            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
                              <time dateTime={a.created_at}>{fullDate(a.created_at)}</time>
                              <StatusPill tone="neutral" className="h-5 px-2 text-[11px]">
                                {AUDIT_OBJECTS[a.object_type]?.singular ?? humanize(a.object_type)}
                              </StatusPill>
                            </p>
                          </div>
                        </div>
                        {link && (
                          <Link to={link.to} className="inline-flex min-h-10 shrink-0 items-center gap-1 self-start pl-5 text-sm font-semibold text-link no-underline hover:underline sm:pl-0">
                            {link.label} <ArrowRight className="size-3.5" aria-hidden />
                          </Link>
                        )}
                      </div>
                      {(a.previous_value || a.new_value) && (
                        <details className="mt-2 pl-5">
                          <summary className="inline-flex min-h-8 cursor-pointer items-center text-xs font-semibold text-link">Show what changed</summary>
                          <div className="mt-2">
                            <ChangeTable before={a.previous_value} after={a.new_value} />
                          </div>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          {totalPages > 1 && (
            <nav aria-label="Pages" className="flex items-center justify-center gap-3">
              <Button variant="outline" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })} className="h-10 rounded-xl bg-card px-3.5">
                Newer
              </Button>
              <span className="text-sm text-ink-2 tabular-nums">
                Page {page} of {totalPages}
              </span>
              <Button variant="outline" disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })} className="h-10 rounded-xl bg-card px-3.5">
                Older
              </Button>
            </nav>
          )}
        </div>
      )}
    </div>
  );
}
