import { Activity, Bot, ChartColumn, CircleCheck, CircleX, Cpu, Flag, Gauge, Link2, ListChecks, Search, Timer, Workflow } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import type { Json } from "@/api/types";
import { cn } from "@/lib/utils";
import { useMetrics } from "./adminApi";
import { BarList, ConfidenceHistogram, VisibilityChart } from "./AdminCharts";
import { ADMIN_PAGE, ErrorCard, FilterTabs, KpiCard, PageHeader, SectionCard, Skeleton, StatusPill, TimeAgo } from "./AdminUI";
import { compactNumber, duration, humanize, JOB_STATUS, money, pct0, promptLabel, RUN_STATUS, stageTitle, type Tone } from "./adminLabels";

const PERIODS = [
  { value: "1", label: "24 hours" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

const ERROR_LABELS: Record<string, string> = {
  "error:no_media": "the image or voice model returned nothing",
  "error:quota": "Gemini was busy or the quota ran out",
  "error:timeout": "a request timed out",
  "error:blocked": "a response was blocked by safety filters",
  "error:recitation": "a response was stopped for quoting too much",
  "error:auth": "the API key was refused",
  "error:not_found": "a model wasn't available",
  "error:invalid_request": "a request was rejected",
  "error:error": "an unexpected Gemini error",
  "error:unexpected": "an unexpected error",
  invalid_json: "an answer couldn't be read",
};

export function MetricsPage() {
  const [params, setParams] = useSearchParams();
  const days = PERIODS.some((p) => p.value === params.get("days")) ? Number(params.get("days")) : 7;
  const q = useMetrics(days);
  const m = q.data;
  const periodLabel = PERIODS.find((p) => Number(p.value) === days)?.label ?? `${days} days`;

  const setDays = (v: string) => {
    const next = new URLSearchParams(params);
    if (v === "7") next.delete("days");
    else next.set("days", v);
    setParams(next, { replace: true });
  };

  const tokens = m ? Number(m.ai.prompt_tokens || 0) + Number(m.ai.output_tokens || 0) : 0;
  const decisions = m ? Number(m.review.approved || 0) + Number(m.review.rejected || 0) : 0;
  const cache = m?.cache?.intelligence;
  const cacheRequests = cache ? Number(cache.hits || 0) + Number(cache.misses || 0) : 0;

  return (
    <div className={ADMIN_PAGE}>
      <PageHeader
        icon={ChartColumn}
        eyebrow="Insights"
        title="Metrics"
        description="How processing, AI, reviewing and search have been doing. Numbers refresh every few seconds."
        actions={<FilterTabs label="Time period" value={String(days)} onChange={setDays} options={PERIODS} className="sm:flex-nowrap" />}
      />

      {q.error && !m && <ErrorCard className="mb-6" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />}

      {!m && !q.error ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : m ? (
        <div className={cn("grid grid-cols-1 gap-6 transition-opacity", q.isFetching && q.isPlaceholderData && "opacity-60")}>
          <p className="-mt-2 text-sm text-ink-2">
            Showing the last <span className="font-semibold text-ink">{periodLabel}</span>. Figures marked “all time” ignore the period.
          </p>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            <KpiCard icon={Bot} label="AI requests" value={compactNumber(m.ai.calls)} hint={`${compactNumber(m.ai.cached)} reused from cache · ${compactNumber(m.ai.failures)} failed`} tone={m.ai.failures ? "warn" : "brand"} />
            <KpiCard icon={Cpu} label="AI cost" value={money(m.ai.cost_usd)} hint={`${compactNumber(tokens)} tokens · answers take ${duration(m.ai.avg_latency_ms)} on average`} tone="brand" />
            <KpiCard
              icon={ListChecks}
              label="Review decisions"
              value={compactNumber(decisions)}
              hint={`${m.review.approved || 0} approved · ${m.review.rejected || 0} rejected · ${m.review.edited || 0} edited or added${m.review.rejection_rate != null ? ` · ${pct0(m.review.rejection_rate)} rejected` : ""}`}
              tone="ok"
            />
            <KpiCard icon={Link2} label="Waiting for review" value={compactNumber(m.review.queue_open)} hint="All time · verse links that still need a decision" tone={m.review.queue_open ? "warn" : "ok"} to="/admin/review" cta="Open review queue" />
            <KpiCard
              icon={Flag}
              label="Reader error reports"
              value={m.feedback.errors_per_1000_views == null ? "–" : `${m.feedback.errors_per_1000_views}`}
              hint={m.feedback.errors_per_1000_views == null ? "No verse link views yet" : `per 1,000 verse link views · ${compactNumber(m.feedback.mapping_views)} views`}
              tone="info"
              to="/admin/feedback"
              cta="Reader feedback"
            />
            <KpiCard
              icon={Search}
              label="Searches"
              value={compactNumber(m.search.searches)}
              hint={m.search.searches ? `take ${duration(m.search.avg_latency_ms)} on average · ${pct0(m.search.zero_result_rate)} found nothing` : "No searches in this period"}
              tone="info"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SectionCard icon={Gauge} title="Confidence of all verse links" description="All time. Links at 90% or more are shown automatically; weaker ones wait for review or only help search.">
              <ConfidenceHistogram bins={m.mappings.confidence_histogram} />
            </SectionCard>
            <SectionCard icon={Link2} title="Verse links by visibility" description="All time. How each kind of link is used, and whether readers can see it.">
              <VisibilityChart byTypeStatus={m.mappings.by_type_status} />
            </SectionCard>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SectionCard icon={Activity} title="Processing" description={`Library items processed in the last ${periodLabel}.`}>
              {(m.processing.runs || []).length === 0 ? (
                <p className="text-sm text-ink-2">Nothing was processed in this period.</p>
              ) : (
                <ul className="mb-5 grid grid-cols-1 gap-2">
                  {m.processing.runs.map((r: Json) => {
                    const s = RUN_STATUS[r.status] ?? { label: humanize(r.status), tone: "neutral" as Tone };
                    return (
                      <li key={r.status} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5">
                        <StatusPill tone={s.tone} icon={r.status === "succeeded" ? CircleCheck : r.status === "failed" ? CircleX : undefined}>
                          {s.label}
                        </StatusPill>
                        <span className="text-sm text-ink">
                          <span className="font-semibold tabular-nums">{r.n}</span> {r.n === 1 ? "item" : "items"}
                          {r.avg_seconds ? <span className="text-ink-2"> · {duration(r.avg_seconds * 1000)} each</span> : null}
                          {r.degraded ? <span className="text-warn"> · {r.degraded} without AI</span> : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
                <Timer className="size-4 text-ink-2" aria-hidden /> Where the time goes
              </h3>
              <BarList
                caption="Average time per processing step"
                labelHeader="Step"
                valueHeader="Average (longest)"
                maxRows={8}
                emptyText="Step timings appear after processing."
                items={[...(m.processing.stage_latency || [])]
                  .sort((a: Json, b: Json) => Number(b.avg_ms) - Number(a.avg_ms))
                  .map((s: Json) => ({
                    key: s.stage,
                    label: stageTitle(s.stage),
                    value: Number(s.avg_ms || 0),
                    display: duration(s.avg_ms),
                    tip: `${stageTitle(s.stage)} — longest ${duration(s.max_ms)}`,
                  }))}
              />
            </SectionCard>

            <SectionCard icon={Bot} title="AI cost by feature" description={`What Gemini was used for in the last ${periodLabel}.`}>
              <BarList
                caption="AI cost by feature"
                labelHeader="Feature"
                valueHeader="Cost"
                maxRows={8}
                emptyText="No AI was used in this period."
                items={[...(m.ai.by_prompt || [])]
                  .sort((a: Json, b: Json) => Number(b.cost_usd) - Number(a.cost_usd))
                  .map((p: Json) => ({
                    key: p.prompt_id,
                    label: promptLabel(p.prompt_id),
                    value: Number(p.cost_usd || 0),
                    display: money(p.cost_usd),
                    sub: `${compactNumber(p.calls)} ${p.calls === 1 ? "request" : "requests"}${p.cached ? ` · ${p.cached} cached` : ""}${p.failures ? ` · ${p.failures} failed` : ""}${p.avg_latency_ms ? ` · ${duration(p.avg_latency_ms)} each` : ""}`,
                    tip: promptLabel(p.prompt_id),
                  }))}
              />
              {(m.ai.errors || []).length > 0 && (
                <p className="mt-4 rounded-xl bg-[var(--warn-soft)] px-3 py-2 text-sm text-ink">
                  <span className="font-semibold">Problems:</span>{" "}
                  {m.ai.errors.map((e: Json) => `${ERROR_LABELS[e.status] ?? humanize(String(e.status).replace(/^error:/, ""))} (${e.n}×)`).join(" · ")}
                </p>
              )}
            </SectionCard>
          </div>

          <SectionCard icon={Workflow} title="Background work" description="Jobs waiting or running now, and the workers that run them.">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold text-ink">Jobs by queue</h3>
                {(m.queue.jobs || []).length === 0 ? (
                  <p className="text-sm text-ink-2">No jobs are stored right now.</p>
                ) : (
                  <ul className="grid grid-cols-1 gap-2">
                    {m.queue.jobs.map((j: Json) => {
                      const s = JOB_STATUS[j.status] ?? { label: humanize(j.status), tone: "neutral" as Tone };
                      return (
                        <li key={`${j.queue}-${j.status}`} className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                          <span className="text-sm text-ink">{humanize(j.queue)}</span>
                          <span className="flex items-center gap-2">
                            <StatusPill tone={s.tone}>{s.label}</StatusPill>
                            <span className="w-8 text-right text-sm font-semibold text-ink tabular-nums">{j.n}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {cache && (
                  <p className="mt-4 text-sm text-ink-2">
                    Verse insight cache: <span className="font-semibold text-ink">{cacheRequests ? pct0(cache.hits / cacheRequests) : "–"}</span> of {compactNumber(cacheRequests)} requests answered instantly since the app last started.
                  </p>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-ink">Workers</h3>
                {(m.queue.workers || []).length === 0 ? (
                  <p className="text-sm text-ink-2">No worker has checked in.</p>
                ) : (
                  <ul className="grid grid-cols-1 gap-2">
                    {m.queue.workers.map((w: Json) => (
                      <li key={w.worker_id} className="rounded-xl border border-border px-3 py-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="min-w-0 truncate font-mono text-xs text-ink" title={w.worker_id}>
                            {w.worker_id}
                          </span>
                          <StatusPill tone={w.alive ? "ok" : "neutral"} icon={w.alive ? CircleCheck : CircleX}>
                            {w.alive ? "Running" : "Not responding"}
                          </StatusPill>
                        </div>
                        <p className="mt-1 text-xs text-ink-2">
                          {w.current_job ? `Working on ${w.current_job}` : "Idle"} · <TimeAgo iso={w.seen_at} prefix="checked in" />
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </SectionCard>
        </div>
      ) : null}
    </div>
  );
}
