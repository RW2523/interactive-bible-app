import {
  Activity, ArrowRight, Bot, CircleCheck, CircleX, Cpu, Database, HeartPulse, LayoutDashboard, Link2, ListChecks, ScanSearch, ServerCog, TriangleAlert, Upload, Workflow,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAdminMetrics, useResources, useReviewQueue } from "@/api/hooks";
import type { Json } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRecentRuns, useSystemStatus } from "./adminApi";
import { VisibilityChart } from "./AdminCharts";
import {
  ADMIN_PAGE, CardListSkeleton, ConfidenceMeter, EmptyState, ErrorCard, KpiCard, Meter, Notice, PageHeader, RelationshipChip, SectionCard, Skeleton, StatusPill, TimeAgo, TypeIcon,
} from "./AdminUI";
import { compactNumber, money, reasonLabel, RUN_STATUS, segmentLocation, sortReasons, stageStep, stageTitle, STAGE_ORDER, type Tone } from "./adminLabels";

export function AdminDashboard() {
  const { viewer } = useAuth();
  const metrics = useAdminMetrics(7);
  const system = useSystemStatus();
  const queue = useReviewQueue({ status: "open", page_size: 5 });
  const failed = useResources({ status: "failed", page_size: 1 });
  const m = metrics.data;
  const s = system.data;
  const firstName = viewer?.display_name?.split(" ")[0];

  const tokens = Number(m?.ai?.today?.tokens || 0);
  const budget = Number(m?.ai?.daily_token_budget || 0);
  const used = budget ? tokens / budget : 0;
  const budgetTone: Tone = used >= 0.9 ? "danger" : used >= 0.6 ? "warn" : "info";
  const openCount = Number(queue.data?.facets?.open ?? 0);
  const failedCount = Number(failed.data?.total || 0);
  const deadJobs = Number(s?.queue?.dead || 0);

  return (
    <div className={ADMIN_PAGE}>
      <PageHeader
        icon={LayoutDashboard}
        eyebrow="Admin dashboard"
        title={firstName ? `Welcome back, ${firstName}` : "Dashboard"}
        description="What needs your attention in the library today, and whether everything behind the scenes is healthy."
        actions={
          <>
            <Link to="/admin/review" className={cn(buttonVariants({ variant: "outline" }), "h-10 gap-2 rounded-xl bg-card px-4 no-underline hover:no-underline")}>
              <ListChecks className="size-4" aria-hidden /> Review queue
            </Link>
            <Link to="/admin/ingest" className={cn(buttonVariants(), "h-10 gap-2 rounded-xl px-4 no-underline hover:no-underline")}>
              <Upload className="size-4" aria-hidden /> Add to library
            </Link>
          </>
        }
      />

      {(metrics.error || system.error) && (
        <ErrorCard
          className="mb-6"
          error={metrics.error || system.error}
          retrying={metrics.isFetching || system.isFetching}
          onRetry={() => {
            void metrics.refetch();
            void system.refetch();
          }}
        />
      )}

      <div className="mb-6 grid grid-cols-1 gap-3" aria-live="polite">
        {s && !s.ai?.configured && (
          <Notice tone="warn" title="Gemini AI isn't set up" action={<NoticeLink to="/admin/system">System & AI</NoticeLink>}>
            Only the non-AI steps run: written references, quotations and captions. Add <code className="rounded bg-card px-1 font-mono text-xs">GEMINI_API_KEY</code> to the .env file and restart the app to turn on transcription, AI verse
            links, summaries and Ask AI.
          </Notice>
        )}
        {s && Number(s.workers?.alive || 0) === 0 && (
          <Notice tone="danger" title="The background worker isn't running" action={<NoticeLink to="/admin/system">See details</NoticeLink>}>
            New items won't be processed until it starts. Start the app with <code className="rounded bg-card px-1 font-mono text-xs">make start</code> in the project folder.
          </Notice>
        )}
        {failedCount > 0 && (
          <Notice tone="danger" title={`${failedCount} library ${failedCount === 1 ? "item needs" : "items need"} attention`} action={<NoticeLink to="/admin/resources?view=failed">Open</NoticeLink>}>
            Processing stopped with an error. Open the item to see what went wrong and try again.
          </Notice>
        )}
        {deadJobs > 0 && (
          <Notice tone="warn" title={`${deadJobs} background ${deadJobs === 1 ? "job" : "jobs"} stopped after several tries`} action={<NoticeLink to="/admin/system#jobs">Review jobs</NoticeLink>} />
        )}
        {budget > 0 && used >= 0.8 && (
          <Notice tone="warn" title={`You've used ${Math.round(used * 100)}% of today's AI allowance`}>
            When the daily limit is reached, AI steps pause until tomorrow. Items still process without AI.
          </Notice>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          icon={ListChecks}
          label="Waiting for review"
          value={openCount}
          hint={openCount ? "Verse links the system wasn't sure about" : "You're all caught up"}
          tone={openCount ? "warn" : "ok"}
          to="/admin/review"
          cta={openCount ? "Start reviewing" : "Open review queue"}
          loading={queue.isLoading}
        />
        <KpiCard
          icon={Link2}
          label="Library items"
          value={s ? compactNumber(s.corpus?.resources) : "–"}
          hint={s ? `${compactNumber(s.corpus?.mappings)} verse links in total` : undefined}
          to="/admin/resources"
          cta="Processing monitor"
          loading={system.isLoading}
        />
        <KpiCard
          icon={Bot}
          label="AI spend today"
          value={s && !s.ai?.configured ? "Off" : money(m?.ai?.today?.cost_usd)}
          hint={s && !s.ai?.configured ? "Gemini isn't set up" : budget ? `${compactNumber(tokens)} of ${compactNumber(budget)} tokens · ${Math.round(used * 100)}% of daily allowance` : undefined}
          tone={budgetTone === "info" ? "brand" : budgetTone}
          to="/admin/metrics"
          cta="See metrics"
          loading={metrics.isLoading}
        >
          {budget > 0 && s?.ai?.configured && <Meter className="mt-3" value={tokens} max={budget} tone={budgetTone} label={`AI tokens used today: ${Math.round(used * 100)}% of the daily allowance`} />}
        </KpiCard>
        <KpiCard
          icon={Cpu}
          label="Background workers"
          value={s ? `${s.workers?.alive ?? 0} running` : "–"}
          hint={s ? jobsLine(s) : undefined}
          tone={s && Number(s.workers?.alive || 0) === 0 ? "danger" : "ok"}
          to="/admin/system"
          cta="System & AI"
          loading={system.isLoading}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-1 min-w-0 content-start gap-6">
          <SectionCard
            icon={ListChecks}
            title="Needs your review"
            description="The verse links to check first. Approving shows them to readers."
            action={
              openCount > 0 ? (
                <Link to="/admin/review" className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-link no-underline hover:underline">
                  See all {openCount} <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              ) : undefined
            }
            bodyClassName="p-0 sm:p-0"
          >
            {queue.isLoading ? (
              <CardListSkeleton rows={3} className="p-4" />
            ) : queue.error ? (
              <ErrorCard className="m-4" error={queue.error} onRetry={() => void queue.refetch()} />
            ) : (queue.data?.items || []).length === 0 ? (
              <EmptyState
                className="m-4 border-none"
                icon={CircleCheck}
                tone="ok"
                title="You're all caught up"
                action={
                  <Link to="/admin/ingest" className={cn(buttonVariants({ variant: "outline" }), "h-10 gap-2 rounded-xl px-4 no-underline hover:no-underline")}>
                    <Upload className="size-4" aria-hidden /> Add to library
                  </Link>
                }
              >
                When the system finds a verse link it isn't sure about, it will wait for you here.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {(queue.data.items as Json[]).map((item) => (
                  <li key={item.mapping_id}>
                    <ReviewRow item={item} ids={(queue.data.items as Json[]).map((x) => x.mapping_id)} />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <RecentProcessing />
        </div>

        <div className="grid grid-cols-1 min-w-0 content-start gap-6">
          <SectionCard icon={Link2} title="Verse links" description="How each verse is used, and whether readers can see it.">
            {metrics.isLoading ? <ChartSkeleton /> : <VisibilityChart byTypeStatus={m?.mappings?.by_type_status} />}
          </SectionCard>
          <HealthCard system={s} loading={system.isLoading} />
        </div>
      </div>
    </div>
  );
}

function jobsLine(s: Json): string {
  const q = Number(s.queue?.queued || 0);
  const r = Number(s.queue?.running || 0);
  if (!q && !r) return "Nothing waiting";
  return [r ? `${r} in progress` : null, q ? `${q} waiting` : null].filter(Boolean).join(" · ");
}

function NoticeLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={cn(buttonVariants({ variant: "outline" }), "h-10 gap-1.5 rounded-xl bg-card px-3.5 no-underline hover:no-underline")}>
      {children} <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

function ChartSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4" aria-hidden>
      <Skeleton className="h-4 w-3/4" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid grid-cols-1 gap-1.5">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3.5 w-full" />
        </div>
      ))}
    </div>
  );
}

function ReviewRow({ item, ids }: { item: Json; ids: string[] }) {
  const reason = sortReasons(item.review_reasons)[0];
  return (
    <Link
      to={`/admin/review/${item.mapping_id}`}
      state={{ queue: ids, from: "/admin" }}
      className="group flex items-start gap-3 px-4 py-3.5 text-inherit no-underline transition hover:bg-surface-2/60 hover:no-underline sm:px-5"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-[17px] font-semibold text-ink">{item.verse_display}</span>
          <RelationshipChip type={item.relationship_type} />
          {item.feedback_count > 0 && <StatusPill tone="danger">{item.feedback_count} reader {item.feedback_count === 1 ? "report" : "reports"}</StatusPill>}
        </div>
        <p className="mt-1 truncate text-sm text-ink-2">
          {item.resource?.title}
          {segmentLocation(item.segment) && <span> · {segmentLocation(item.segment)}</span>}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <ConfidenceMeter value={item.confidence_override ?? item.confidence} />
          {reason && <span className="text-xs text-ink-2">{reasonLabel(reason)}</span>}
        </div>
      </div>
      <span className="mt-1 hidden items-center gap-1 text-sm font-semibold text-link sm:inline-flex">
        Review <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}

function RecentProcessing() {
  const runs = useRecentRuns(6, 5000);
  const items = (runs.data || []).slice(0, 5);
  return (
    <SectionCard
      icon={Activity}
      title="Recent processing"
      description="The latest items read and linked to Scripture."
      action={
        <Link to="/admin/resources" className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-link no-underline hover:underline">
          Processing monitor <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      }
      bodyClassName="p-0 sm:p-0"
    >
      {runs.isLoading ? (
        <CardListSkeleton rows={3} className="p-4" />
      ) : runs.error ? (
        <ErrorCard className="m-4" error={runs.error} onRetry={() => void runs.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          className="m-4 border-none"
          icon={Upload}
          title="Nothing processed yet"
          action={
            <Link to="/admin/ingest" className={cn(buttonVariants(), "h-10 gap-2 rounded-xl px-4 no-underline hover:no-underline")}>
              <Upload className="size-4" aria-hidden /> Add your first item
            </Link>
          }
        >
          Add a sermon, podcast or study and it will show up here while it's processed.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((run: Json) => {
            const status = RUN_STATUS[run.status] ?? { label: run.status, tone: "neutral" as Tone };
            const active = run.status === "running" || run.status === "queued";
            const step = stageStep(run.current_stage);
            return (
              <li key={run.id}>
                <Link to={`/admin/resources/${run.resource_id}`} className="flex items-center gap-3 px-4 py-3 text-inherit no-underline transition hover:bg-surface-2/60 hover:no-underline sm:px-5">
                  <TypeIcon type={run.type} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{run.title}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-2">
                      {active && step ? (
                        <>
                          Step {step} of {STAGE_ORDER.length} · {stageTitle(run.current_stage)}
                        </>
                      ) : run.status === "failed" && run.error ? (
                        <span className="text-danger">{run.error}</span>
                      ) : (
                        <TimeAgo iso={run.completed_at || run.created_at} prefix={run.status === "succeeded" ? "Finished" : "Started"} />
                      )}
                    </p>
                  </div>
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

function HealthRow({ icon: Icon, label, ok, status, children }: { icon: LucideIcon; label: string; ok: boolean | null; status: string; children?: ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-2" aria-hidden>
        <Icon className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-ink">{label}</span>
          <StatusPill tone={ok === null ? "progress" : ok ? "ok" : "danger"} icon={ok === null ? undefined : ok ? CircleCheck : CircleX}>
            {status}
          </StatusPill>
        </div>
        {children && <div className="mt-1 text-xs leading-relaxed text-ink-2">{children}</div>}
      </div>
    </li>
  );
}

function HealthCard({ system: s, loading }: { system: Json | undefined; loading: boolean }) {
  const embedded = Number(s?.embeddings?.embedded || 0);
  const total = Number(s?.embeddings?.total || 0);
  const alive = Number(s?.workers?.alive || 0);
  const busy = Number(s?.queue?.queued || 0) + Number(s?.queue?.running || 0);
  return (
    <SectionCard
      icon={HeartPulse}
      title="Health"
      description="Is everything behind the scenes working?"
      footer={
        <Link to="/admin/system" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-link no-underline hover:underline">
          <ServerCog className="size-4" aria-hidden /> Open System & AI
        </Link>
      }
    >
      {loading || !s ? (
        <div className="grid grid-cols-1 gap-4" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-9 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          <HealthRow icon={Bot} label="Gemini AI" ok={!!s.ai?.configured} status={s.ai?.configured ? "Set up" : "Not set up"}>
            {s.ai?.configured ? "AI transcription, verse suggestions and summaries are on." : "Only non-AI steps are running."}
          </HealthRow>
          <HealthRow icon={ScanSearch} label="Bible search index" ok={s.embeddings?.complete ? true : s.embeddings?.job ? null : false} status={s.embeddings?.complete ? "Complete" : s.embeddings?.job ? "Building" : "Incomplete"}>
            <Meter className="mt-1.5 mb-1" size="sm" value={embedded} max={Math.max(1, total)} tone={s.embeddings?.complete ? "ok" : "info"} label={`Bible search index: ${embedded} of ${total} verses`} />
            {embedded.toLocaleString()} of {total.toLocaleString()} verses ready for meaning-based search
          </HealthRow>
          <HealthRow icon={Workflow} label="Background workers" ok={alive > 0} status={alive > 0 ? `${alive} running` : "Stopped"}>
            {alive > 0 ? (busy ? jobsLine(s) : "Ready for new items") : "New items won't be processed until a worker starts."}
            {s.workers?.last_seen && (
              <>
                {" · "}
                <TimeAgo iso={s.workers.last_seen} prefix="last check-in" />
              </>
            )}
          </HealthRow>
          <HealthRow icon={Database} label="Database" ok={!!s.database?.ok} status={s.database?.ok ? "Connected" : "Problem"}>
            {(s.database?.migrations || []).length} updates applied
          </HealthRow>
          {Number(s.queue?.dead || 0) > 0 && (
            <HealthRow icon={TriangleAlert} label="Stopped jobs" ok={false} status={`${s.queue.dead} stopped`}>
              Retry them from System & AI.
            </HealthRow>
          )}
        </ul>
      )}
    </SectionCard>
  );
}
