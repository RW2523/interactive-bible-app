import {
  Activity, ArrowRight, BookOpen, ChevronRight, Circle, CircleCheck, CircleMinus, CircleX, Cpu, Ellipsis, Eye, FileText, Info, ListChecks, Loader2, Pencil, Play,
  RefreshCw, RotateCcw, Search, Trash2, TriangleAlert, Upload, Wand2, type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useInvalidate, useResource, useResourceStatus, useResources } from "@/api/hooks";
import type { Json } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useRecentRuns, useResourceRuns } from "./adminApi";
import { ConfidenceHistogram } from "./AdminCharts";
import {
  ADMIN_PAGE, CardListSkeleton, ChoiceCards, ConfirmDialog, EmptyState, ErrorCard, Field, FilterTabs, KpiCard, LiveIndicator, Meter, NativeSelect, Notice, PageHeader, RelationshipChip,
  SectionCard, Skeleton, StatusPill, TextArea, TextInput, TimeAgo, Toggle, TypeIcon, errorMessage,
} from "./AdminUI";
import {
  CATEGORIES, categoryLabel, compactNumber, duration, fileSize, fullDate, humanize, LANGUAGES, languageLabel, money, PHASES, RELATIONSHIPS, RESOURCE_STATUS, REVIEW_STATUS, RIGHTS,
  RUN_STATUS, STAGE_ORDER, STAGES, stageStep, stageSummary, stageTitle, TRANSCRIPT_MODES, typeLabel, VISIBILITY, type Tone,
} from "./adminLabels";

const ACTIVE_RESOURCE = ["queued", "processing"];
const ACTIVE_RUN = ["queued", "running"];

type View = "all" | "active" | "failed" | "ready" | "draft";

const VIEW_MATCH: Record<View, (r: Json) => boolean> = {
  all: () => true,
  active: (r) => ACTIVE_RESOURCE.includes(r.status),
  failed: (r) => r.status === "failed",
  ready: (r) => r.status === "processed",
  draft: (r) => r.status === "draft" || r.status === "ready",
};

function runProgress(run: Json | null | undefined): number {
  if (!run) return 0;
  if (run.status === "succeeded") return 1;
  if (Array.isArray(run.stages)) {
    const done = run.stages.filter((s: Json) => ["completed", "skipped", "degraded"].includes(s.status)).length;
    return done / STAGE_ORDER.length;
  }
  const step = stageStep(run.current_stage);
  return step ? (step - 1) / STAGE_ORDER.length : 0;
}

function peopleLine(r: Json): string {
  return [r.speaker, r.author].filter(Boolean).join(" · ");
}

/** “Video · Sermon · Pastor Elena Brooks” without repeating “Article · Article”. */
function kindLine(r: Json, ...extra: (string | null | undefined)[]): string {
  const type = typeLabel(r.type);
  const category = categoryLabel(r.category);
  return [type, category && category !== type ? category : null, peopleLine(r), ...extra].filter(Boolean).join(" · ");
}

// ───────────────────────────────────────────────────────────── monitor

export function ResourcesMonitorPage() {
  const [params, setParams] = useSearchParams();
  const view = ((params.get("view") as View) || "all") in VIEW_MATCH ? ((params.get("view") as View) || "all") : "all";
  const [query, setQuery] = useState("");
  const resources = useResources({ page_size: 100 }, true);
  const runs = useRecentRuns(100, 3000);
  const invalidate = useInvalidate();
  const [retry, setRetry] = useState<Json | null>(null);
  const [retrying, setRetrying] = useState(false);

  const latestRun = useMemo(() => {
    const map = new Map<string, Json>();
    for (const run of runs.data || []) if (!map.has(run.resource_id)) map.set(run.resource_id, run);
    return map;
  }, [runs.data]);

  const items: Json[] = resources.data?.items || [];
  const counts = Object.fromEntries((Object.keys(VIEW_MATCH) as View[]).map((v) => [v, items.filter(VIEW_MATCH[v]).length])) as Record<View, number>;
  const q = query.trim().toLowerCase();
  const visible = items.filter((r) => VIEW_MATCH[view](r) && (!q || [r.title, r.speaker, r.author, r.series].some((x) => x && String(x).toLowerCase().includes(q))));

  const setView = (v: View) => {
    const next = new URLSearchParams(params);
    if (v === "all") next.delete("view");
    else next.set("view", v);
    setParams(next, { replace: true });
  };

  const startRetry = async () => {
    if (!retry) return;
    setRetrying(true);
    try {
      await api(`/v1/resources/${retry.id}/process`, { method: "POST", body: {} });
      toast.success("Processing started", { description: retry.title });
      invalidate("resources", "runs", "resource-status", "system");
      setRetry(null);
    } catch (e) {
      toast.error("Couldn't start processing", { description: errorMessage(e) });
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className={ADMIN_PAGE}>
      <PageHeader
        icon={Activity}
        eyebrow="Library"
        title="Processing monitor"
        description="Follow each item as it's read, split into sections and linked to Scripture. This page updates by itself."
        actions={
          <>
            <LiveIndicator label="Updating live" className="mr-2" />
            <Link to="/admin/ingest" className={cn(buttonVariants(), "h-10 gap-2 rounded-xl px-4 no-underline hover:no-underline")}>
              <Upload className="size-4" aria-hidden /> Add to library
            </Link>
          </>
        }
      />

      <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <FilterTabs<View>
          className="min-w-0 xl:flex-1"
          label="Show"
          value={view}
          onChange={setView}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "active", label: "Processing", count: counts.active },
            { value: "failed", label: "Needs attention", count: counts.failed },
            { value: "ready", label: "Ready", count: counts.ready },
            { value: "draft", label: "Not processed", count: counts.draft },
          ]}
        />
        <div className="relative shrink-0 xl:w-52">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-2" aria-hidden />
          <TextInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title or speaker" aria-label="Search library items" className="bg-card pl-9" />
        </div>
      </div>

      {resources.error && !resources.data ? (
        <ErrorCard error={resources.error} onRetry={() => void resources.refetch()} retrying={resources.isFetching} />
      ) : resources.isLoading ? (
        <CardListSkeleton rows={5} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Upload}
          title="Your library is empty"
          action={
            <Link to="/admin/ingest" className={cn(buttonVariants(), "h-10 gap-2 rounded-xl px-4 no-underline hover:no-underline")}>
              <Upload className="size-4" aria-hidden /> Add your first item
            </Link>
          }
        >
          Add a sermon video, podcast, PDF study or article. It will be split into sections and linked to the verses it talks about.
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nothing matches"
          action={
            <Button
              variant="outline"
              className="h-10 rounded-xl px-4"
              onClick={() => {
                setQuery("");
                setView("all");
              }}
            >
              Show everything
            </Button>
          }
        >
          {view === "failed" ? "No items need attention right now." : view === "active" ? "Nothing is processing right now." : "Try a different search or filter."}
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-3" aria-label="Library items">
          {visible.map((r) => (
            <li key={r.id}>
              <MonitorRow resource={r} run={latestRun.get(r.id)} onRetry={() => setRetry(r)} />
            </li>
          ))}
        </ul>
      )}
      {resources.data && resources.data.total > items.length && (
        <p className="mt-4 text-center text-sm text-ink-2">Showing the {items.length} most recently updated of {resources.data.total} items.</p>
      )}

      <ConfirmDialog
        open={!!retry}
        onOpenChange={(o) => !o && setRetry(null)}
        title="Try processing again?"
        description={
          <>
            <strong className="text-ink">{retry?.title}</strong> will be processed again from the start. This uses AI — usually a few cents. Verse links you've already reviewed are kept.
          </>
        }
        confirmLabel="Process again"
        icon={RefreshCw}
        pending={retrying}
        onConfirm={() => void startRetry()}
      />
    </div>
  );
}

function MonitorRow({ resource: r, run, onRetry }: { resource: Json; run: Json | undefined; onRetry: () => void }) {
  const status = RESOURCE_STATUS[r.status] ?? { label: humanize(r.status), tone: "neutral" as Tone, description: "" };
  const active = ACTIVE_RESOURCE.includes(r.status) || (run && ACTIVE_RUN.includes(run.status));
  const failed = r.status === "failed" || run?.status === "failed";
  const step = stageStep(run?.current_stage);
  const progress = runProgress(run);
  return (
    <article className="group relative flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-xs transition hover:border-gold-400/50 hover:shadow-md sm:flex-row sm:items-center sm:gap-4 sm:p-5">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <TypeIcon type={r.type} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] leading-snug font-semibold text-ink">
            <Link to={`/admin/resources/${r.id}`} className="text-ink no-underline after:absolute after:inset-0 after:rounded-2xl hover:no-underline focus-visible:outline-none">
              {r.title}
            </Link>
          </h3>
          <p className="mt-0.5 text-sm text-ink-2">
            {kindLine(r)}
          </p>
          {active ? (
            <div className="mt-2.5 max-w-md">
              <Meter value={progress} tone="info" size="sm" label={`Processing progress ${Math.round(progress * 100)}%`} />
              <p className="mt-1.5 text-xs text-ink-2">
                {step ? `Step ${step} of ${STAGE_ORDER.length} · ${stageTitle(run?.current_stage)}` : "Waiting for a background worker…"}
                {run?.started_at && (
                  <>
                    {" · "}
                    <TimeAgo iso={run.started_at} prefix="started" />
                  </>
                )}
              </p>
            </div>
          ) : failed ? (
            <p className="mt-2 line-clamp-2 text-sm text-danger">{run?.error || "Processing stopped with an error."}</p>
          ) : r.status === "processed" ? (
            <p className="mt-1.5 text-xs text-ink-2">
              {r.segment_count} {r.segment_count === 1 ? "section" : "sections"} · {r.visible_mappings} verse {r.visible_mappings === 1 ? "link" : "links"} shown to readers
              {run?.degraded ? " · processed without AI" : ""}
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-ink-2">{status.description}</p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 pl-[52px] sm:justify-end sm:pl-0">
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <StatusPill tone={failed ? "danger" : active ? "progress" : status.tone} icon={failed ? CircleX : r.status === "processed" ? CircleCheck : undefined}>
            {failed ? RESOURCE_STATUS.failed.label : active ? RESOURCE_STATUS.processing.label : status.label}
          </StatusPill>
          <TimeAgo iso={r.updated_at} prefix="Updated" className="text-xs text-ink-2" />
        </div>
        {failed ? (
          <Button variant="outline" onClick={onRetry} className="relative z-10 h-10 gap-2 rounded-xl px-3.5">
            <RefreshCw className="size-4" aria-hidden /> Try again
          </Button>
        ) : (
          <ChevronRight className="size-5 shrink-0 text-ink-3 transition group-hover:translate-x-0.5 group-hover:text-ink-2" aria-hidden />
        )}
      </div>
    </article>
  );
}

// ───────────────────────────────────────────────────────────── resource detail

type PendingAction = "process" | "retranscribe" | "reset" | "delete" | "start" | null;

export function ResourceAdminPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const { isEditor } = useAuth();
  const resource = useResource(id);
  const probe = useResourceStatus(id, false);
  const active = ACTIVE_RESOURCE.includes(probe.data?.status) || ACTIVE_RUN.includes(probe.data?.run?.status);
  const status = useResourceStatus(id, active);
  const runs = useResourceRuns(id, active);
  const [confirm, setConfirm] = useState<PendingAction>(null);
  const [pending, setPending] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [editing, setEditing] = useState(false);
  const wasActive = useRef(active);

  // When processing finishes, refresh everything once so counts, history and status are final.
  useEffect(() => {
    if (wasActive.current && !active) {
      invalidate("resource", "runs", "resources", "review-queue", "system");
      if (probe.data?.run?.status === "failed" || probe.data?.status === "failed") toast.error("Processing stopped with an error", { description: resource.data?.title });
      else toast.success("Processing finished", { description: resource.data?.title });
    }
    wasActive.current = active;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (resource.error) {
    return (
      <div className={ADMIN_PAGE}>
        <PageHeader back={{ to: "/admin/resources", label: "Processing monitor" }} title="Library item" />
        <ErrorCard error={resource.error} onRetry={() => void resource.refetch()} retrying={resource.isFetching} />
      </div>
    );
  }
  if (!resource.data) return <DetailSkeleton />;

  const r = resource.data as Json;
  const st = status.data;
  const run = st?.run;
  const metrics = run?.metrics || {};
  const media = r.type === "video" || r.type === "audio";
  const failed = r.status === "failed" || run?.status === "failed";
  const isActive = ACTIVE_RESOURCE.includes(st?.status ?? r.status) || ACTIVE_RUN.includes(run?.status);
  const progress = st?.progress ?? runProgress(run);
  const inReview = Number(st?.counts?.in_review || 0);

  const act = async (kind: Exclude<PendingAction, null>) => {
    setPending(true);
    try {
      if (kind === "delete") {
        await api(`/v1/resources/${id}`, { method: "DELETE" });
        toast.success("Deleted", { description: r.title });
        invalidate("resources", "runs", "system");
        navigate("/admin/resources");
        return;
      }
      const body = kind === "start" ? {} : kind === "process" ? { force: true } : kind === "retranscribe" ? { force: true, force_retranscribe: true } : { force: true, reset_human: true };
      await api(`/v1/resources/${id}/process`, { method: "POST", body });
      toast.success(kind === "reset" ? "Verse links reset — processing again" : "Processing started", { description: r.title });
      invalidate("resource-status", "runs", "resources", "resource", "system");
      setConfirm(null);
    } catch (e) {
      toast.error("That didn't work", { description: errorMessage(e) });
    } finally {
      setPending(false);
      setUnderstood(false);
    }
  };

  const confirmCopy: Record<Exclude<PendingAction, null>, { title: string; description: ReactNode; label: string; tone: "default" | "destructive"; icon: LucideIcon }> = {
    start: { title: "Start processing?", description: "It will be read, split into sections and linked to Scripture. This uses AI — usually a few cents, a little more for long recordings.", label: "Start processing", tone: "default", icon: Play },
    process: {
      title: "Process this item again?",
      description: "Everything is redone from the start with the latest settings. This uses AI — usually a few cents. Verse links you've approved, rejected or edited are kept.",
      label: "Process again",
      tone: "default",
      icon: RefreshCw,
    },
    retranscribe: {
      title: "Transcribe again?",
      description: "Makes a brand-new AI transcript instead of reusing the saved one, then processes everything again. This costs more than processing again, so use it when the transcript has mistakes.",
      label: "Transcribe again",
      tone: "default",
      icon: Wand2,
    },
    reset: {
      title: "Reset all verse links?",
      description: "This deletes every verse link for this item — including the ones you approved, rejected or edited — and processes it again from scratch. It can't be undone.",
      label: "Reset and process",
      tone: "destructive",
      icon: RotateCcw,
    },
    delete: {
      title: `Delete “${r.title}”?`,
      description: "It disappears straight away from the library, verse pages and search, along with its sections, verse links and clips.",
      label: "Delete",
      tone: "destructive",
      icon: Trash2,
    },
  };
  const copy = confirm ? confirmCopy[confirm] : null;

  return (
    <div className={ADMIN_PAGE}>
      <PageHeader
        back={{ to: "/admin/resources", label: "Processing monitor" }}
        title={
          <span className="flex items-start gap-3">
            <TypeIcon type={r.type} size="lg" className="mt-1 hidden sm:grid" />
            <span className="min-w-0">{r.title}</span>
          </span>
        }
        description={kindLine(r, r.duration_ms ? duration(r.duration_ms) : r.page_count ? `${r.page_count} pages` : null)}
        actions={
          <>
            <Link to={`/resources/${id}`} className={cn(buttonVariants({ variant: "outline" }), "h-10 gap-2 rounded-xl bg-card px-3.5 no-underline hover:no-underline")}>
              <Eye className="size-4" aria-hidden /> View in library
            </Link>
            {isEditor && (
              <Link
                to={`/admin/review?resource_id=${id}${inReview ? "" : "&status=all"}`}
                className={cn(buttonVariants({ variant: inReview ? "default" : "outline" }), "h-10 gap-2 rounded-xl px-3.5 no-underline hover:no-underline", !inReview && "bg-card")}
              >
                <ListChecks className="size-4" aria-hidden /> {inReview ? `Review ${inReview} verse ${inReview === 1 ? "link" : "links"}` : "Verse links"}
              </Link>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger className={cn(buttonVariants({ variant: "outline" }), "h-10 gap-2 rounded-xl bg-card px-3.5")} aria-label="More actions">
                <Ellipsis className="size-4" aria-hidden /> More
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-60 p-1.5">
                <DropdownMenuItem className="min-h-10 gap-2.5 px-2.5" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" /> Edit details
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-10 gap-2.5 px-2.5" disabled={isActive} onClick={() => setConfirm("process")}>
                  <RefreshCw className="size-4" /> Process again
                </DropdownMenuItem>
                {media && (
                  <DropdownMenuItem className="min-h-10 gap-2.5 px-2.5" disabled={isActive} onClick={() => setConfirm("retranscribe")}>
                    <Wand2 className="size-4" /> Transcribe again
                  </DropdownMenuItem>
                )}
                {isEditor && (
                  <DropdownMenuItem className="min-h-10 gap-2.5 px-2.5" disabled={isActive} variant="destructive" onClick={() => setConfirm("reset")}>
                    <RotateCcw className="size-4" /> Reset verse links…
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="min-h-10 gap-2.5 px-2.5" variant="destructive" onClick={() => setConfirm("delete")}>
                  <Trash2 className="size-4" /> Delete…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      >
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusPill tone="neutral">{VISIBILITY[r.visibility]?.label ?? humanize(r.visibility)}</StatusPill>
          <StatusPill tone="neutral">{RIGHTS[r.rights_status]?.label ?? humanize(r.rights_status)}</StatusPill>
          {r.is_official && <StatusPill tone="brand">Official</StatusPill>}
          {r.requires_review && <StatusPill tone="warn">Every link needs approval</StatusPill>}
        </div>
      </PageHeader>

      <StatusOverview resource={r} status={st} run={run} progress={progress} active={isActive} failed={failed} onStart={() => setConfirm("start")} onRetry={() => setConfirm("process")} />

      <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard icon={Eye} label="Shown to readers" value={st?.counts?.visible ?? "–"} hint="Verse links readers can see" tone="ok" loading={status.isLoading} />
        <KpiCard
          icon={ListChecks}
          label="Waiting for review"
          value={inReview}
          hint={inReview ? "Check these before readers see them" : "Nothing to review"}
          tone={inReview ? "warn" : "neutral"}
          to={isEditor && inReview ? `/admin/review?resource_id=${id}` : undefined}
          cta={isEditor && inReview ? "Review now" : undefined}
          loading={status.isLoading}
        />
        <KpiCard icon={BookOpen} label="All verse links" value={st?.counts?.mappings ?? "–"} hint="Including hidden and search-only links" tone="info" loading={status.isLoading} />
        <KpiCard
          icon={Cpu}
          label="AI used (last run)"
          value={metrics.ai ? money(metrics.ai.cost_usd) : "–"}
          hint={metrics.ai ? `${compactNumber(metrics.ai.calls)} AI requests · ${compactNumber(Number(metrics.ai.prompt_tokens || 0) + Number(metrics.ai.output_tokens || 0))} tokens` : "Shown after processing"}
          tone="brand"
          loading={status.isLoading}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <StageTimeline run={run} loading={status.isLoading} />
        <div className="grid grid-cols-1 min-w-0 content-start gap-6">
          <FoundCard metrics={metrics} />
          <RunHistory runs={runs.data} loading={runs.isLoading} />
          <DetailsCard resource={r} run={run} />
        </div>
      </div>

      {copy && (
        <ConfirmDialog
          open={!!confirm}
          onOpenChange={(o) => {
            if (!o) {
              setConfirm(null);
              setUnderstood(false);
            }
          }}
          title={copy.title}
          description={copy.description}
          confirmLabel={copy.label}
          tone={copy.tone}
          icon={copy.icon}
          pending={pending}
          confirmDisabled={confirm === "reset" && !understood}
          onConfirm={() => confirm && void act(confirm)}
        >
          {confirm === "reset" && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-2/50 p-3 text-sm text-ink">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--danger)]" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              I understand that my review decisions for this item will be lost.
            </label>
          )}
        </ConfirmDialog>
      )}
      {editing && <EditResourceDialog resource={r} onClose={() => setEditing(false)} canOfficial={isEditor} />}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className={ADMIN_PAGE} role="status" aria-label="Loading">
      <Skeleton className="mb-4 h-4 w-40" />
      <Skeleton className="mb-3 h-10 w-2/3" />
      <Skeleton className="mb-8 h-4 w-1/2" />
      <Skeleton className="mb-4 h-28 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

function StatusOverview({
  resource: r,
  status: st,
  run,
  progress,
  active,
  failed,
  onStart,
  onRetry,
}: {
  resource: Json;
  status: Json | undefined;
  run: Json | undefined;
  progress: number;
  active: boolean;
  failed: boolean;
  onStart: () => void;
  onRetry: () => void;
}) {
  const step = stageStep(run?.current_stage);
  if (!run && !active) {
    const needsFile = r.source_kind === "upload" && !r.original_filename && !r.has_captions;
    return (
      <Notice
        tone="info"
        icon={Info}
        title="This item hasn't been processed yet"
        action={
          !needsFile ? (
            <Button onClick={onStart} className="h-10 gap-2 rounded-xl px-4">
              <Play className="size-4" aria-hidden /> Start processing
            </Button>
          ) : undefined
        }
      >
        {needsFile ? "Its file was never uploaded. Delete this draft and add the item again from Add to library." : "Start processing to split it into sections and link it to the verses it talks about."}
      </Notice>
    );
  }
  if (failed && !active) {
    return (
      <Notice
        tone="danger"
        title="Processing stopped with an error"
        action={
          <Button onClick={onRetry} className="h-10 gap-2 rounded-xl px-4">
            <RefreshCw className="size-4" aria-hidden /> Try again
          </Button>
        }
      >
        <p className="break-words">{run?.error || "Something went wrong while processing."}</p>
        {run?.completed_at && <TimeAgo iso={run.completed_at} prefix="Stopped" className="mt-1 block text-xs" />}
      </Notice>
    );
  }
  const pct = Math.round(progress * 100);
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-xs sm:p-5" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill tone={active ? "progress" : "ok"} icon={active ? undefined : CircleCheck}>
            {active ? (run?.status === "queued" || st?.status === "queued" ? "Waiting to start" : "Processing") : "Ready"}
          </StatusPill>
          <p className="text-sm font-medium text-ink">
            {active
              ? step
                ? `Step ${step} of ${STAGE_ORDER.length} · ${stageTitle(run?.current_stage)}`
                : "Waiting for a background worker…"
              : run?.degraded
                ? "Processed without AI"
                : "All steps finished"}
          </p>
        </div>
        <span className="text-sm font-semibold text-ink tabular-nums">{pct}%</span>
      </div>
      <Meter className="mt-3" value={progress} tone={active ? "info" : "ok"} label={`Processing ${pct}% complete`} />
      <p className="mt-2 text-sm text-ink-2">
        {active ? (
          <>
            {run?.started_at && <TimeAgo iso={run.started_at} prefix="Started" />}
            {run?.started_at && " · "}Usually takes 1–5 minutes. You can leave this page — processing continues in the background.
          </>
        ) : (
          <>
            {run?.completed_at && <TimeAgo iso={run.completed_at} prefix="Finished" />}
            {run?.started_at && run?.completed_at && ` · took ${duration(new Date(run.completed_at).getTime() - new Date(run.started_at).getTime())}`}
            {run?.degraded && " · Gemini AI was unavailable, so only the non-AI steps ran. Process again once AI is set up to find more verse links."}
          </>
        )}
      </p>
    </section>
  );
}

const STAGE_ICON: Record<string, { icon: LucideIcon; cls: string; label: string }> = {
  completed: { icon: CircleCheck, cls: "text-ok", label: "Done" },
  running: { icon: Loader2, cls: "animate-spin text-link", label: "In progress" },
  failed: { icon: CircleX, cls: "text-danger", label: "Failed" },
  skipped: { icon: CircleMinus, cls: "text-ink-2", label: "Skipped" },
  degraded: { icon: TriangleAlert, cls: "text-warn", label: "Done without AI" },
  pending: { icon: Circle, cls: "text-ink-3", label: "Not started" },
};

function StageTimeline({ run, loading }: { run: Json | undefined; loading: boolean }) {
  const stages: Json[] = run?.stages || [];
  const byPhase = PHASES.map((label, phase) => ({ label, items: stages.filter((s) => (STAGES[s.id]?.phase ?? 3) === phase) }));
  return (
    <SectionCard icon={Activity} title="Processing steps" description="What happens to every item, in plain language.">
      {loading ? (
        <div className="grid grid-cols-1 gap-3" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-5 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : !stages.length ? (
        <p className="text-sm text-ink-2">The steps appear here once processing starts.</p>
      ) : (
        <ol className="grid grid-cols-1 gap-6">
          {byPhase.map((phase, pi) => {
            const done = phase.items.filter((s) => ["completed", "skipped", "degraded"].includes(s.status)).length;
            return (
              <li key={phase.label}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold tracking-wider text-ink-2 uppercase">
                    {pi + 1}. {phase.label}
                  </h3>
                  <span className="text-xs text-ink-2 tabular-nums">
                    {done} of {phase.items.length} done
                  </span>
                </div>
                <ol className="relative grid grid-cols-1 gap-0.5 before:absolute before:top-3 before:bottom-3 before:left-[9px] before:w-px before:bg-border">
                  {phase.items.map((s) => {
                    const meta = STAGE_ICON[s.status] ?? STAGE_ICON.pending;
                    const Icon = meta.icon;
                    const info = STAGES[s.id];
                    const summary = stageSummary(s.id, s.detail);
                    return (
                      <li key={s.id} className={cn("relative flex gap-3 rounded-xl py-2 pr-2", s.status === "running" && "bg-[var(--accent-soft)] -mx-2 px-2")}>
                        <span className="relative z-10 grid grid-cols-1 size-5 shrink-0 place-items-center rounded-full bg-card" title={meta.label}>
                          <Icon className={cn("size-5", meta.cls)} aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                            <p className="text-sm font-semibold text-ink">
                              {info?.title ?? s.name}
                              <span className="sr-only"> — {meta.label}</span>
                            </p>
                            <span className="text-xs text-ink-2 tabular-nums">
                              {s.status === "running" ? "Working…" : s.duration_ms != null ? duration(s.duration_ms) : s.status === "pending" ? "" : meta.label}
                            </span>
                          </div>
                          {s.error ? (
                            <p className="mt-0.5 text-xs break-words text-danger">{s.error}</p>
                          ) : summary && s.status !== "pending" ? (
                            <p className="mt-0.5 text-xs text-ink-2">{summary}</p>
                          ) : (
                            <p className="mt-0.5 text-xs text-ink-2">{info?.description}</p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}

function FoundCard({ metrics }: { metrics: Json }) {
  const byType: Record<string, number> = metrics.mappings_by_type || {};
  const byStatus: Record<string, number> = metrics.mappings_by_status || {};
  const hist = Object.entries((metrics.confidence_histogram || {}) as Record<string, number>).map(([k, n]) => ({ from: Number(k), n: Number(n) }));
  const hasData = Object.keys(byType).length > 0;
  return (
    <SectionCard icon={BookOpen} title="What the last run found" description="Verse links as they were when processing finished.">
      {!hasData ? (
        <p className="text-sm text-ink-2">Results appear after processing finishes.</p>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wider text-ink-2 uppercase">How verses are used</h3>
            <ul className="grid grid-cols-1 gap-2">
              {Object.keys(RELATIONSHIPS)
                .filter((t) => byType[t])
                .map((t) => (
                  <li key={t} className="flex items-center justify-between gap-3">
                    <RelationshipChip type={t} />
                    <span className="text-sm font-semibold text-ink tabular-nums">{byType[t]}</span>
                  </li>
                ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wider text-ink-2 uppercase">Where they went</h3>
            <ul className="flex flex-wrap gap-2">
              {Object.entries(byStatus).map(([k, n]) => (
                <li key={k}>
                  <StatusPill tone={REVIEW_STATUS[k]?.tone ?? "neutral"} title={REVIEW_STATUS[k]?.description}>
                    {REVIEW_STATUS[k]?.label ?? humanize(k)} · {n}
                  </StatusPill>
                </li>
              ))}
            </ul>
          </div>
          {hist.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold tracking-wider text-ink-2 uppercase">Confidence</h3>
              <ConfidenceHistogram bins={hist} step={0.1} height={96} />
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function RunHistory({ runs, loading }: { runs: Json[] | undefined; loading: boolean }) {
  return (
    <SectionCard icon={RefreshCw} title="Processing history" bodyClassName="p-0 sm:p-0">
      {loading ? (
        <CardListSkeleton rows={2} className="p-4" />
      ) : !runs?.length ? (
        <p className="p-4 text-sm text-ink-2 sm:p-5">No processing runs yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {runs.map((x) => {
            const s = RUN_STATUS[x.status] ?? { label: humanize(x.status), tone: "neutral" as Tone };
            const took = x.started_at && x.completed_at ? new Date(x.completed_at).getTime() - new Date(x.started_at).getTime() : null;
            return (
              <li key={x.id} className="flex flex-col gap-1.5 px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink" title={fullDate(x.created_at)}>
                    {fullDate(x.created_at)}
                  </span>
                  <StatusPill tone={s.tone} icon={x.status === "succeeded" ? CircleCheck : x.status === "failed" ? CircleX : undefined}>
                    {s.label}
                  </StatusPill>
                </div>
                <p className="text-xs text-ink-2">
                  {[took != null ? `took ${duration(took)}` : null, x.ai ? `${compactNumber(x.ai.calls)} AI requests · ${money(x.ai.cost_usd)}` : null, x.degraded ? "without AI" : null, x.attempts > 1 ? `${x.attempts} attempts` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {x.error && <p className="text-xs break-words text-danger">{x.error}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

function DetailsCard({ resource: r, run }: { resource: Json; run: Json | undefined }) {
  const rows: [string, ReactNode][] = [
    ["Visibility", VISIBILITY[r.visibility] ? `${VISIBILITY[r.visibility].label} — ${VISIBILITY[r.visibility].description}` : r.visibility],
    ["Rights", RIGHTS[r.rights_status] ? `${RIGHTS[r.rights_status].label} — ${RIGHTS[r.rights_status].description}` : r.rights_status],
    ["Clip downloads", r.allow_clip_export ? "Allowed" : "Not allowed"],
    ["Language", languageLabel(r.language)],
  ];
  if (r.type === "video" || r.type === "audio") rows.push(["Transcript", TRANSCRIPT_MODES[r.transcript_mode]?.label ?? r.transcript_mode], ["Captions file", r.has_captions ? "Added" : "None"]);
  if (r.original_filename) rows.push(["Original file", `${r.original_filename}${r.size_bytes ? ` · ${fileSize(Number(r.size_bytes))}` : ""}`]);
  if (r.source_url) rows.push(["Web link", <a key="u" href={r.source_url} target="_blank" rel="noreferrer" className="break-all text-link">{r.source_url}</a>]);
  if (r.series) rows.push(["Series", r.series]);
  if ((r.verse_hints || []).length) rows.push(["Scripture hints", r.verse_hints.join(", ")]);
  if ((r.topic_hints || []).length) rows.push(["Topic hints", r.topic_hints.join(", ")]);
  rows.push(["Added", fullDate(r.created_at)]);
  return (
    <SectionCard icon={FileText} title="Details">
      {r.description && <p className="mb-4 text-sm leading-relaxed text-ink-2">{r.description}</p>}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-medium text-ink-2">{k}</dt>
            <dd className="mb-1.5 min-w-0 text-ink sm:mb-0">{v}</dd>
          </div>
        ))}
      </dl>
      {run && (
        <details className="group mt-5 rounded-xl border border-border">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium text-ink-2 hover:text-ink">
            Technical details <ArrowRight className="size-4 transition group-open:rotate-90" aria-hidden />
          </summary>
          <div className="grid grid-cols-1 gap-2 border-t border-border p-3 text-xs text-ink-2">
            <p>
              Run <span className="font-mono">{run.id}</span> · pipeline <span className="font-mono">{run.pipeline_version}</span>
            </p>
            {(run.metrics?.notes || []).length > 0 && (
              <ul className="list-disc pl-4">
                {run.metrics.notes.map((n: string, i: number) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            <pre className="max-h-64 overflow-auto rounded-lg bg-surface-2 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink">
              {JSON.stringify({ models: run.model_versions, prompts: run.prompt_versions, options: run.options, stage_ms: run.metrics?.stage_ms }, null, 2)}
            </pre>
          </div>
        </details>
      )}
    </SectionCard>
  );
}

function EditResourceDialog({ resource: r, onClose, canOfficial }: { resource: Json; onClose: () => void; canOfficial: boolean }) {
  const invalidate = useInvalidate();
  const orgId = useAuth().viewer?.organization_ids?.[0];
  const media = r.type === "video" || r.type === "audio";
  const initial = {
    title: r.title || "",
    description: r.description || "",
    category: r.category || "other",
    speaker: r.speaker || "",
    author: r.author || "",
    series: r.series || "",
    language: r.language || "en",
    visibility: r.visibility,
    rights_status: r.rights_status,
    allow_clip_export: !!r.allow_clip_export,
    is_official: !!r.is_official,
    requires_review: !!r.requires_review,
    transcript_mode: r.transcript_mode || "auto",
    verse_hints: (r.verse_hints || []).join(", "),
    topic_hints: (r.topic_hints || []).join(", "),
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof initial>(k: K, v: (typeof initial)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const exportAllowed = form.rights_status === "owned" || form.rights_status === "licensed";

  const save = async () => {
    if (!form.title.trim()) {
      setError("Give it a title.");
      return;
    }
    const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
    const textFields = ["title", "description", "speaker", "author", "series"];
    const patch: Json = {};
    for (const k of Object.keys(initial) as (keyof typeof initial)[]) {
      if (form[k] === initial[k]) continue;
      if (k === "verse_hints" || k === "topic_hints") patch[k] = split(form[k]);
      else if (textFields.includes(k)) patch[k] = String(form[k]).trim(); // the API ignores nulls, so an empty string clears a field
      else patch[k] = form[k];
    }
    if (!exportAllowed && initial.allow_clip_export) patch.allow_clip_export = false;
    if (patch.visibility === "organization" && !r.organization_id && orgId) patch.organization_id = orgId;
    if (!Object.keys(patch).length) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await api(`/v1/resources/${r.id}`, { method: "PATCH", body: patch });
      toast.success("Details saved");
      invalidate("resource", "resources");
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border p-5">
          <DialogTitle className="font-display text-xl">Edit details</DialogTitle>
          <DialogDescription>Changes to the title, sharing and rights apply straight away. Transcript settings apply the next time you process it.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-5 p-5">
          <Field label="Title" htmlFor="edit-title" error={error && !form.title.trim() ? error : null}>
            <TextInput id="edit-title" value={form.title} maxLength={300} onChange={(e) => set("title", e.target.value)} aria-invalid={!!error && !form.title.trim()} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Kind of content" htmlFor="edit-category">
              <NativeSelect id="edit-category" value={form.category} onChange={(e) => set("category", e.target.value)}>
                {CATEGORIES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Language" htmlFor="edit-language">
              <NativeSelect id="edit-language" value={form.language} onChange={(e) => set("language", e.target.value)}>
                {!LANGUAGES.some(([c]) => c === form.language) && <option value={form.language}>{form.language}</option>}
                {LANGUAGES.map(([c, l]) => (
                  <option key={c} value={c}>{l}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Speaker" htmlFor="edit-speaker" optional>
              <TextInput id="edit-speaker" value={form.speaker} onChange={(e) => set("speaker", e.target.value)} />
            </Field>
            <Field label="Author" htmlFor="edit-author" optional>
              <TextInput id="edit-author" value={form.author} onChange={(e) => set("author", e.target.value)} />
            </Field>
            <Field label="Series" htmlFor="edit-series" optional className="sm:col-span-2">
              <TextInput id="edit-series" value={form.series} onChange={(e) => set("series", e.target.value)} />
            </Field>
          </div>
          <Field label="Description" htmlFor="edit-description" optional>
            <TextArea id="edit-description" value={form.description} onChange={(e) => set("description", e.target.value)} className="min-h-20" />
          </Field>
          <ChoiceCards
            name="edit-visibility"
            legend="Who can find it"
            value={form.visibility}
            onChange={(v) => set("visibility", v)}
            options={Object.entries(VISIBILITY).map(([value, v]) => ({ value, label: v.label, description: v.description }))}
          />
          <ChoiceCards
            name="edit-rights"
            legend="Rights"
            value={form.rights_status}
            onChange={(v) => set("rights_status", v)}
            options={Object.entries(RIGHTS).map(([value, v]) => ({ value, label: v.label, description: v.description }))}
          />
          {media && (
            <Field label="Transcript" htmlFor="edit-transcript" hint={TRANSCRIPT_MODES[form.transcript_mode]?.description}>
              <NativeSelect id="edit-transcript" value={form.transcript_mode} onChange={(e) => set("transcript_mode", e.target.value)}>
                {Object.entries(TRANSCRIPT_MODES).map(([v, m]) => (
                  <option key={v} value={v}>{m.label}</option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-border p-4">
            <Toggle
              checked={form.allow_clip_export && exportAllowed}
              disabled={!exportAllowed}
              onChange={(v) => set("allow_clip_export", v)}
              label="Allow clip downloads"
              description={exportAllowed ? "People can download short clips as video or audio files." : "Only possible when you own or license it."}
            />
            {canOfficial && (
              <>
                <Toggle checked={form.is_official} onChange={(v) => set("is_official", v)} label="Official church content" description="Its verse links wait for your approval before readers see them." />
                <Toggle checked={form.requires_review} onChange={(v) => set("requires_review", v)} label="Approve every verse link myself" description="Nothing from this item is shown to readers until you approve it." />
              </>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Scripture hints" htmlFor="edit-verses" optional hint="Comma separated, e.g. Romans 8:28, Genesis 50:20">
              <TextInput id="edit-verses" value={form.verse_hints} onChange={(e) => set("verse_hints", e.target.value)} />
            </Field>
            <Field label="Topic hints" htmlFor="edit-topics" optional hint="Comma separated, e.g. hope, suffering">
              <TextInput id="edit-topics" value={form.topic_hints} onChange={(e) => set("topic_hints", e.target.value)} />
            </Field>
          </div>
          {error && form.title.trim() && <Notice tone="danger" title="Couldn't save">{error}</Notice>}
        </div>
        <DialogFooter className="sticky bottom-0 m-0 rounded-none border-t border-border bg-card p-4">
          <Button variant="ghost" onClick={onClose} disabled={saving} className="h-10 rounded-xl px-4">
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving} className="h-10 gap-2 rounded-xl px-4">
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />} Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
