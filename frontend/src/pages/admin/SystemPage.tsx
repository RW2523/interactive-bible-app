import {
  BookText, Bot, CircleCheck, CircleX, Cpu, Database, HardDrive, KeyRound, Loader2, PlugZap, RefreshCw, ScanSearch, ServerCog, TriangleAlert, Workflow, type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useInvalidate, useJobs } from "@/api/hooks";
import type { Json } from "@/api/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSystemStatus } from "./adminApi";
import { ADMIN_PAGE, ConfirmDialog, ErrorCard, errorMessage, Meter, Notice, PageHeader, SectionCard, Skeleton, StatusPill, TimeAgo } from "./AdminUI";
import { compactNumber, fileSize, humanize, JOB_STATUS, JOB_TYPES, MODEL_ROLES, relativeTime, type Tone } from "./adminLabels";

function StatusTile({ icon: Icon, label, ok, status, children }: { icon: LucideIcon; label: string; ok: boolean | null; status: string; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4 shadow-xs">
      <div className="flex items-center gap-2.5">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", ok === null ? "bg-[var(--accent-soft)] text-link" : ok ? "bg-[var(--ok-soft)] text-[#1b5e20] dark:text-ok" : "bg-[var(--danger-soft)] text-danger")} aria-hidden>
          <Icon className="size-4" />
        </span>
        <span className="text-sm font-medium text-ink-2">{label}</span>
      </div>
      <div className="mt-3">
        <StatusPill tone={ok === null ? "progress" : ok ? "ok" : "danger"} icon={ok === null ? undefined : ok ? CircleCheck : CircleX}>
          {status}
        </StatusPill>
      </div>
      {children && <p className="mt-2 text-sm leading-snug text-ink-2">{children}</p>}
    </div>
  );
}

export function SystemPage() {
  const q = useSystemStatus();
  const jobs = useJobs();
  const invalidate = useInvalidate();
  const s = q.data;
  const [doctor, setDoctor] = useState<Json | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmEmbed, setConfirmEmbed] = useState(false);
  const [embedding, setEmbedding] = useState(false);
  const [retryJob, setRetryJob] = useState<Json | null>(null);
  const [retrying, setRetrying] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      const res = await api<Json>("/v1/admin/system/check-gemini", { method: "POST" });
      setDoctor(res);
      if (res.ok) toast.success("Gemini is working");
      else toast.error("Gemini check found a problem", { description: res.message });
    } catch (e) {
      toast.error("Couldn't run the check", { description: errorMessage(e) });
    } finally {
      setChecking(false);
    }
  };

  const embed = async () => {
    setEmbedding(true);
    try {
      const res = await api<Json>("/v1/admin/system/embed-bible", { method: "POST" });
      toast.success(res.job_id ? "Building the search index in the background" : "Nothing to do — the index is complete or AI isn't set up");
      invalidate("system", "jobs");
      setConfirmEmbed(false);
    } catch (e) {
      toast.error("Couldn't start", { description: errorMessage(e) });
    } finally {
      setEmbedding(false);
    }
  };

  const retry = async () => {
    if (!retryJob) return;
    setRetrying(true);
    try {
      await api(`/v1/admin/jobs/${retryJob.id}/retry`, { method: "POST" });
      toast.success("Job queued to run again");
      invalidate("jobs", "system");
      setRetryJob(null);
    } catch (e) {
      toast.error("Couldn't retry", { description: errorMessage(e) });
    } finally {
      setRetrying(false);
    }
  };

  const location = useLocation();
  const loaded = !!s && !jobs.isLoading;
  useEffect(() => {
    if (loaded && location.hash === "#jobs") document.getElementById("jobs")?.scrollIntoView({ block: "start" });
  }, [loaded, location.hash]);

  const d = doctor || s?.ai?.doctor;
  const embedded = Number(s?.embeddings?.embedded || 0);
  const total = Number(s?.embeddings?.total || 0);
  const alive = Number(s?.workers?.alive || 0);

  return (
    <div className={ADMIN_PAGE}>
      <PageHeader
        icon={ServerCog}
        eyebrow="Insights & settings"
        title="System & AI"
        description="Check that everything behind the scenes is healthy: the Bible text, Gemini AI, the search index and the background workers."
      />

      {q.error && !s && <ErrorCard className="mb-6" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />}

      {!s && !q.error ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : s ? (
        <div className="grid grid-cols-1 gap-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-5">
            <StatusTile icon={Bot} label="Gemini AI" ok={!!s.ai?.configured} status={s.ai?.configured ? "Set up" : "Not set up"}>
              {s.ai?.configured ? "API key found. AI features are on." : "No API key. Only non-AI steps run."}
            </StatusTile>
            <StatusTile icon={ScanSearch} label="Bible search index" ok={s.embeddings?.complete ? true : s.embeddings?.job ? null : false} status={s.embeddings?.complete ? "Complete" : s.embeddings?.job ? "Building" : "Incomplete"}>
              {total ? `${Math.round((embedded / total) * 100)}% of verses ready` : "No verses yet"}
            </StatusTile>
            <StatusTile icon={Workflow} label="Background workers" ok={alive > 0} status={alive > 0 ? `${alive} running` : "Stopped"}>
              {s.workers?.last_seen ? `Last check-in ${relativeTime(s.workers.last_seen)}` : "No worker has checked in"}
            </StatusTile>
            <StatusTile icon={Database} label="Database" ok={!!s.database?.ok} status={s.database?.ok ? "Connected" : "Problem"}>
              {(s.database?.migrations || []).length} updates applied
            </StatusTile>
            {s.storage && (
              <StatusTile
                icon={HardDrive}
                label="File storage"
                ok={Number(s.storage.disk_free_bytes) >= 2 * 1024 ** 3}
                status={`${fileSize(Number(s.storage.used_bytes || 0))} used`}
              >
                {compactNumber(Number(s.storage.files || 0))} files · {fileSize(Number(s.storage.disk_free_bytes || 0))} free on this disk
              </StatusTile>
            )}
          </div>

          {alive === 0 && (
            <Notice tone="danger" title="No background worker is running">
              New items won't be processed until one starts. Run <code className="rounded bg-card px-1 font-mono text-xs">make start</code> in the project folder
              (or <code className="rounded bg-card px-1 font-mono text-xs">make status</code> to see what is running).
            </Notice>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SectionCard
              icon={Bot}
              title="Gemini AI"
              description="The only online service the app uses. It transcribes recordings, suggests related verses, writes summaries and answers Ask AI questions."
            >
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", s.ai?.configured ? "bg-[var(--ok-soft)] text-[#1b5e20] dark:text-ok" : "bg-[var(--danger-soft)] text-danger")} aria-hidden>
                  <KeyRound className="size-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{s.ai?.configured ? "API key found" : "API key missing"}</p>
                  <p className="text-xs text-ink-2">{s.ai?.configured ? "Set in the .env file as GEMINI_API_KEY." : "Add GEMINI_API_KEY to the .env file, then restart the app."}</p>
                </div>
              </div>

              <h3 className="mt-5 mb-2 text-xs font-semibold tracking-wider text-ink-2 uppercase">Models</h3>
              <ul className="grid grid-cols-1 gap-2">
                {(["analysis", "fast", "transcribe", "embedding", "image", "image_hq", "speech"] as const).filter((role) => s.ai?.models?.[role]).map((role) => {
                  const check = d?.checks?.[role];
                  return (
                    <li key={role} className="rounded-xl bg-surface-2/40 px-3 py-2.5">
                      <p className="text-sm font-semibold text-ink">{MODEL_ROLES[role].label}</p>
                      <p className="text-xs text-ink-2">{MODEL_ROLES[role].description}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <code className="max-w-full truncate rounded-md bg-card px-1.5 py-0.5 font-mono text-xs text-ink">{s.ai?.models?.[role]}</code>
                        {check && (
                          <StatusPill tone={check.available ? "ok" : check.fallback ? "warn" : "danger"} icon={check.available ? CircleCheck : check.fallback ? TriangleAlert : CircleX}>
                            {check.available ? "Available" : check.fallback ? `Using ${check.fallback}` : "Not available"}
                          </StatusPill>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {(s.ai?.models?.fallbacks || []).length > 0 && (
                <p className="mt-3 text-xs text-ink-2">
                  Backup models if one is unavailable: <span className="font-mono text-ink">{s.ai.models.fallbacks.join(", ")}</span>
                </p>
              )}

              <div className="mt-5 rounded-xl border border-border p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">Test the connection</p>
                    <p className="text-xs leading-relaxed text-ink-2">Sends two tiny requests to Gemini to confirm the key and models work. Costs a fraction of a cent.</p>
                  </div>
                  <Button onClick={() => void check()} disabled={checking || !s.ai?.configured} className="h-10 shrink-0 gap-2 rounded-xl px-4">
                    {checking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <PlugZap className="size-4" aria-hidden />}
                    {checking ? "Checking…" : "Run test"}
                  </Button>
                </div>
                {d && (
                  <div className="mt-4 border-t border-border pt-4" aria-live="polite">
                    <p className={cn("flex items-center gap-2 text-sm font-semibold", d.ok ? "text-[#1b5e20] dark:text-ok" : "text-danger")}>
                      {d.ok ? <CircleCheck className="size-4" aria-hidden /> : <CircleX className="size-4" aria-hidden />}
                      {d.ok ? "Gemini is working" : "Gemini check found a problem"}
                      {d.checked_at && <span className="font-normal text-ink-2">· {relativeTime(new Date(d.checked_at * 1000).toISOString())}</span>}
                    </p>
                    {d.message && <p className="mt-1 text-sm text-ink-2">{d.message}</p>}
                    {d.checks && (
                      <ul className="mt-2 grid grid-cols-1 gap-1 text-sm text-ink">
                        {d.checks.generate_probe && (
                          <li className="flex items-center gap-2">
                            {d.checks.generate_probe.ok ? <CircleCheck className="size-4 text-ok" aria-hidden /> : <CircleX className="size-4 text-danger" aria-hidden />}
                            Writing text {d.checks.generate_probe.ok ? `works (${d.checks.generate_probe.latency_ms} ms)` : `failed: ${d.checks.generate_probe.error}`}
                          </li>
                        )}
                        {d.checks.embed_probe && (
                          <li className="flex items-center gap-2">
                            {d.checks.embed_probe.ok ? <CircleCheck className="size-4 text-ok" aria-hidden /> : <CircleX className="size-4 text-danger" aria-hidden />}
                            Meaning search {d.checks.embed_probe.ok ? "works" : `failed: ${d.checks.embed_probe.error}`}
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              <p className="mt-3 text-xs text-ink-2">
                Pipeline version <span className="font-mono text-ink">{s.ai?.pipeline_version}</span>
              </p>
            </SectionCard>

            <div className="grid grid-cols-1 content-start gap-6">
              <SectionCard icon={ScanSearch} title="Bible search index" description="Lets search find passages by meaning, not just matching words.">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-3xl font-semibold tracking-tight text-ink">{total ? `${Math.round((embedded / total) * 100)}%` : "–"}</span>
                  <span className="text-sm text-ink-2 tabular-nums">
                    {embedded.toLocaleString()} of {total.toLocaleString()} verses
                  </span>
                </div>
                <Meter className="mt-3" value={embedded} max={Math.max(1, total)} tone={s.embeddings?.complete ? "ok" : "info"} label={`Search index ${embedded} of ${total} verses`} />
                <p className="mt-3 text-sm text-ink-2">
                  Model <span className="font-mono text-ink">{s.embeddings?.model}</span> · {s.embeddings?.dimensions} dimensions
                  {s.embeddings?.job && <> · job {JOB_STATUS[s.embeddings.job.status]?.label.toLowerCase() ?? s.embeddings.job.status}</>}
                </p>
                {s.embeddings?.job?.last_error && <p className="mt-2 rounded-xl bg-[var(--danger-soft)] px-3 py-2 text-sm break-words text-danger">{String(s.embeddings.job.last_error).slice(0, 300)}</p>}
                <Button variant="outline" onClick={() => setConfirmEmbed(true)} disabled={!s.ai?.configured || s.embeddings?.complete} className="mt-4 h-10 gap-2 rounded-xl bg-card px-4">
                  <RefreshCw className="size-4" aria-hidden /> {s.embeddings?.complete ? "Index is complete" : "Build or resume the index"}
                </Button>
              </SectionCard>

              <SectionCard icon={BookText} title="Bible text" description="Stored on this computer — no internet needed to read.">
                <ul className="grid grid-cols-1 gap-2">
                  {(s.corpus?.translations || []).map((t: Json) => (
                    <li key={t.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl bg-surface-2/40 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">
                          {t.abbreviation} <span className="font-normal text-ink-2">· {t.name}</span>
                          {t.is_default && (
                            <StatusPill tone="brand" className="ml-2 h-5 px-2 text-[11px]">
                              Default
                            </StatusPill>
                          )}
                        </p>
                        <p className="text-xs text-ink-2">{t.license}</p>
                      </div>
                      <span className="text-sm text-ink tabular-nums">{Number(t.verse_count).toLocaleString()} verses</span>
                    </li>
                  ))}
                </ul>
                <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ["Verses", s.corpus?.verses],
                    ["Cross-references", s.corpus?.cross_references],
                    ["Topics", s.corpus?.topics],
                    ["People & events", s.corpus?.entities],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl border border-border px-3 py-2">
                      <dt className="text-xs text-ink-2">{label}</dt>
                      <dd className="text-lg font-semibold text-ink">{compactNumber(Number(value))}</dd>
                    </div>
                  ))}
                </dl>
              </SectionCard>
            </div>
          </div>

          <SectionCard icon={Cpu} title="Background workers" description="Workers pick up jobs like processing a new sermon. At least one should be running.">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Running workers", alive, alive > 0 ? "ok" : "danger"],
                ["Waiting jobs", s.queue?.queued ?? 0, "neutral"],
                ["Running jobs", s.queue?.running ?? 0, "neutral"],
                ["Stopped jobs", s.queue?.dead ?? 0, Number(s.queue?.dead || 0) ? "danger" : "neutral"],
              ].map(([label, value, tone]) => (
                <div key={String(label)} className="rounded-xl border border-border px-3 py-2.5">
                  <dt className="text-xs text-ink-2">{label}</dt>
                  <dd className={cn("text-2xl font-semibold", tone === "danger" ? "text-danger" : tone === "ok" ? "text-[#1b5e20] dark:text-ok" : "text-ink")}>{String(value)}</dd>
                </div>
              ))}
            </dl>
            {s.workers?.last_seen && <TimeAgo iso={s.workers.last_seen} prefix="Last check-in" className="mt-3 block text-sm text-ink-2" />}
            <details className="group mt-4 rounded-xl border border-border">
              <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium text-ink-2 hover:text-ink">Technical details</summary>
              <div className="grid grid-cols-1 gap-3 border-t border-border p-3 text-xs text-ink-2">
                <p>
                  Database updates: <span className="font-mono text-ink">{(s.database?.migrations || []).join(", ")}</span>
                </p>
                <div>
                  <p className="mb-1">AI instruction versions:</p>
                  <pre className="max-h-56 overflow-auto rounded-lg bg-surface-2 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink">{JSON.stringify(s.ai?.prompt_versions, null, 2)}</pre>
                </div>
              </div>
            </details>
          </SectionCard>

          <section id="jobs" className="scroll-mt-32">
            <SectionCard icon={Workflow} title="Recent background jobs" description="The latest work handed to the workers. Failed jobs retry by themselves a few times before they stop." bodyClassName="p-0 sm:p-0">
              {jobs.error && !jobs.data ? (
                <ErrorCard className="m-4" error={jobs.error} onRetry={() => void jobs.refetch()} />
              ) : jobs.isLoading ? (
                <div className="grid grid-cols-1 gap-2 p-4" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-12 rounded-xl" />
                  ))}
                </div>
              ) : (jobs.data || []).length === 0 ? (
                <p className="p-4 text-sm text-ink-2 sm:p-5">No recent jobs. Finished jobs are cleared away automatically.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {(jobs.data || []).map((j: Json) => {
                    const st = JOB_STATUS[j.status] ?? { label: humanize(j.status), tone: "neutral" as Tone };
                    return (
                      <li key={j.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink">{JOB_TYPES[j.type] ?? humanize(j.type)}</p>
                          <p className="text-xs text-ink-2">
                            {humanize(j.queue)} queue · try {j.attempts} of {j.max_attempts} · <TimeAgo iso={j.updated_at || j.created_at} />
                          </p>
                          {j.last_error && <p className="mt-1 line-clamp-2 text-xs break-words text-danger">{j.last_error}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <StatusPill tone={st.tone}>{st.label}</StatusPill>
                          {["dead", "failed"].includes(j.status) && (
                            <Button variant="outline" onClick={() => setRetryJob(j)} className="h-10 gap-2 rounded-xl bg-card px-3.5">
                              <RefreshCw className="size-4" aria-hidden /> Retry
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionCard>
          </section>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmEmbed}
        onOpenChange={setConfirmEmbed}
        title="Build the Bible search index?"
        description="Every verse is turned into a “meaning fingerprint” so search can find passages by meaning. It runs in the background, picks up where it left off, and uses Gemini — usually well under a dollar for the whole Bible."
        confirmLabel="Start building"
        icon={RefreshCw}
        pending={embedding}
        onConfirm={() => void embed()}
      />
      <ConfirmDialog
        open={!!retryJob}
        onOpenChange={(o) => !o && setRetryJob(null)}
        title="Run this job again?"
        description={`“${retryJob ? JOB_TYPES[retryJob.type] ?? humanize(retryJob.type) : ""}” will start again from the beginning. If it processes a library item, it uses AI again.`}
        confirmLabel="Retry job"
        icon={RefreshCw}
        pending={retrying}
        onConfirm={() => void retry()}
      />
    </div>
  );
}
