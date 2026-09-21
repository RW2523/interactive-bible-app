import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Check, CloudAlert, CloudCheck, ExternalLink, FileQuestionMark, Globe, Link2, Loader2, Lock, Pencil, RefreshCw, Share2, TriangleAlert, WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ApiError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn, timeAgo } from "@/lib/utils";
import { absoluteUrl, describeError, sermonApi, setPersonalMode, sharePathFromDetail, useSermonCache, useSermonDetail, useStudioOptions, type MetaPatch } from "./api";
import { EmptyState, LinkButton, PAGE, STAGES, SignInCard, Skeleton, StatusBadge, copyToClipboard } from "./components/StudioUI";
import "./sermon-studio.css";
import { Stage1Collect } from "./stages/Stage1Collect";
import { Stage2Polish } from "./stages/Stage2Polish";
import { Stage3Visuals } from "./stages/Stage3Visuals";
import { Stage4Publish } from "./stages/Stage4Publish";
import type { Sermon, SermonDetail, SermonStage } from "./types";
import { WorkspaceProvider, clampStage, lockReason, stepHint, stepsDone, useCommitField, useSaveTracker, type SaveState, type WorkspaceValue } from "./workspace";

export default function SermonWorkspace() {
  const { id = "" } = useParams();
  const location = useLocation();
  const { viewer, loading, singleUser } = useAuth();
  setPersonalMode(singleUser);
  // Personal mode: this computer is always signed in as the owner.
  const signedIn = singleUser || !!viewer?.authenticated;
  const query = useSermonDetail(id, signedIn);

  if (loading) return <WorkspaceSkeleton />;
  if (!signedIn) {
    if (!viewer) return <ServerUnavailable />;
    return (
      <div className={cn(PAGE, "py-6 sm:py-10")}>
        <SignInCard from={location.pathname} title="Sign in to open this sermon" />
      </div>
    );
  }
  if (!query.data) {
    if (query.isError) return <WorkspaceError error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} personal={singleUser} />;
    return <WorkspaceSkeleton />;
  }
  return <Workspace key={id} id={id} detail={query.data} />;
}

function Workspace({ id, detail }: { id: string; detail: SermonDetail }) {
  const { sermon, inputs, draft, media, outreach } = detail;
  const cache = useSermonCache(id);
  const options = useStudioOptions();
  const { state: saveState, track } = useSaveTracker();
  const [editorDirty, setEditorDirty] = useState(false);

  const flushRef = useRef<(() => Promise<void>) | null>(null);
  const registerEditorFlush = useCallback((fn: (() => Promise<void>) | null) => {
    flushRef.current = fn;
  }, []);
  const flushEditor = useCallback(async () => {
    await flushRef.current?.();
  }, []);

  // Open where the preacher left off — but never on a step whose prerequisites are missing.
  const initialStage = useMemo(() => {
    let s = clampStage(sermon.current_stage);
    while (s > 1 && lockReason(s, inputs, draft)) s = (s - 1) as SermonStage;
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [active, setActive] = useState<SermonStage>(initialStage);
  const [visited, setVisited] = useState<Set<SermonStage>>(() => new Set([initialStage]));
  const stageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const lastStageRequest = useRef<SermonStage | null>(null);
  const firstRender = useRef(true);

  const goToStage = useCallback(
    (stage: SermonStage) => {
      const current = cache.get() ?? detail;
      const reason = lockReason(stage, current.inputs, current.draft);
      if (reason) {
        toast.info(`${STAGES[stage - 1].label} isn't ready yet`, { description: reason });
        return;
      }
      setActive(stage);
      setVisited((v) => (v.has(stage) ? v : new Set(v).add(stage)));
      if (current.sermon.current_stage === stage) return;
      cache.patch((d) => ({ ...d, sermon: { ...d.sermon, current_stage: stage } }));
      lastStageRequest.current = stage;
      track(sermonApi.update(id, { current_stage: stage })).then(
        () => {
          if (lastStageRequest.current === stage) cache.patch((d) => (d.sermon.current_stage === stage ? d : { ...d, sermon: { ...d.sermon, current_stage: stage } }));
        },
        () => toast.error("Couldn't save your progress", { description: "Your place may not be remembered if you leave this page." }),
      );
    },
    [cache, detail, id, track],
  );

  // Move to the top and focus the new step for keyboard and screen-reader users.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    stageRefs.current[active]?.focus({ preventScroll: true });
  }, [active]);

  const saveMeta = useCallback(
    async (patch: MetaPatch) => {
      cache.patch((d) => ({ ...d, sermon: { ...d.sermon, ...patch } }));
      const saved = await track(sermonApi.update(id, patch), "Couldn't save the sermon details");
      // Re-apply the saved fields: a background refetch may have landed while the request was in flight.
      cache.patch((d) => ({ ...d, sermon: { ...d.sermon, ...patch, updated_at: saved?.updated_at ?? d.sermon.updated_at } }));
    },
    [cache, id, track],
  );

  // Warn before closing the tab with unsaved editor changes.
  useEffect(() => {
    if (!editorDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [editorDirty]);

  // The app shell sets a generic title on navigation; refine it once the sermon is known.
  useEffect(() => {
    const t = window.setTimeout(() => {
      document.title = `${sermon.title} · Sermon Studio · Interactive Bible App`;
    }, 0);
    return () => window.clearTimeout(t);
  }, [sermon.title]);

  const value: WorkspaceValue = {
    id,
    sermon,
    inputs,
    draft,
    media,
    outreach,
    detail,
    active,
    goToStage,
    cache,
    track,
    saveMeta,
    editorDirty,
    setEditorDirty,
    flushEditor,
    registerEditorFlush,
    options,
  };

  const stages: Record<SermonStage, ReactNode> = {
    1: <Stage1Collect />,
    2: <Stage2Polish />,
    3: <Stage3Visuals />,
    4: <Stage4Publish />,
  };

  const sharePath = sharePathFromDetail(detail);

  return (
    <WorkspaceProvider value={value}>
      <div className="pb-16">
        <WorkspaceHeader
          sermon={sermon}
          saveState={saveState}
          editorDirty={editorDirty}
          shareUrl={sharePath ? absoluteUrl(sharePath) : null}
          shareText={outreach?.social_caption ?? outreach?.summary ?? null}
          onTitle={(title) => void saveMeta({ title }).catch(() => undefined)}
        />
        <div className={cn(PAGE, "pt-4 sm:pt-6")}>
          <Stepper sermonId={id} active={active} detail={detail} onSelect={goToStage} />
          <div className="mt-6 sm:mt-8">
            {([1, 2, 3, 4] as SermonStage[]).map((n) => (
              <div
                key={n}
                ref={(el) => {
                  stageRefs.current[n] = el;
                }}
                hidden={active !== n}
                tabIndex={-1}
                aria-label={`Step ${n} of 4: ${STAGES[n - 1].title}`}
                role="region"
                className={cn("outline-none", active === n && "animate-fade-up motion-reduce:animate-none")}
              >
                {visited.has(n) && stages[n]}
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceProvider>
  );
}

// ───────────────────────────────────────────────────────────── header

function WorkspaceHeader({
  sermon,
  saveState,
  editorDirty,
  shareUrl,
  shareText,
  onTitle,
}: {
  sermon: Sermon;
  saveState: SaveState;
  editorDirty: boolean;
  shareUrl: string | null;
  shareText: string | null;
  onTitle: (title: string) => void;
}) {
  const title = useCommitField(sermon.title, onTitle, { required: true });
  return (
    <div className="sticky top-[var(--header-h)] z-30 border-b border-border bg-paper/90 backdrop-blur-xl supports-[backdrop-filter]:bg-paper/75">
      <div className={cn(PAGE, "flex h-14 items-center gap-1.5 sm:gap-3")}>
        <Link
          to="/sermons"
          aria-label="Back to all sermons"
          title="All sermons"
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-ink-2 no-underline transition hover:bg-surface-2 hover:text-ink hover:no-underline"
        >
          <ArrowLeft className="size-[18px]" aria-hidden />
          <span className="hidden md:inline">All sermons</span>
        </Link>
        <span className="hidden h-6 w-px bg-border sm:block" aria-hidden />
        <h1 className="sr-only">{sermon.title}</h1>
        <div className="group relative flex min-w-0 flex-1 items-center">
          <input
            {...title}
            aria-label="Sermon title (click to rename)"
            title="Click to rename"
            maxLength={200}
            className="peer h-10 w-full min-w-0 truncate rounded-lg border border-transparent bg-transparent px-2 pr-8 font-display text-[17px] font-semibold tracking-tight text-ink outline-none transition hover:border-border focus:border-gold-500/60 focus:bg-surface focus:ring-3 focus:ring-ring sm:text-xl dark:focus:bg-surface-2/60"
          />
          <Pencil
            className="pointer-events-none absolute right-2.5 size-3.5 text-ink-3 opacity-0 transition group-hover:opacity-100 peer-focus:opacity-0"
            aria-hidden
          />
        </div>
        <SaveIndicator state={saveState} dirty={editorDirty} />
        <StatusBadge status={sermon.status} className="hidden sm:inline-flex" />
        {shareUrl && <ShareMenu url={shareUrl} title={sermon.title} text={shareText} />}
      </div>
    </div>
  );
}

function SaveIndicator({ state, dirty }: { state: SaveState; dirty: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!state.savedAt) return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [state.savedAt]);

  let icon: ReactNode;
  let text: string;
  let tone: string;
  if (state.pending > 0) {
    icon = <Loader2 className="size-4 animate-spin" aria-hidden />;
    text = "Saving…";
    tone = "text-ink-3";
  } else if (state.error) {
    icon = <CloudAlert className="size-4" aria-hidden />;
    text = "Not saved";
    tone = "text-danger";
  } else if (dirty) {
    icon = <span className="size-2 rounded-full bg-warn" aria-hidden />;
    text = "Unsaved changes";
    tone = "text-warn";
  } else {
    icon = <CloudCheck className="size-4" aria-hidden />;
    text = state.savedAt ? "Saved" : "All changes saved";
    tone = "text-ink-3";
  }
  const title = state.error ?? (state.savedAt ? `Saved ${timeAgo(new Date(state.savedAt).toISOString())}` : "Your work is saved automatically");
  return (
    <span role="status" aria-live="polite" title={title} className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-1.5 text-xs font-medium whitespace-nowrap", tone)}>
      {icon}
      <span className="sr-only lg:not-sr-only">{text}</span>
    </span>
  );
}

function ShareMenu({ url, title, text }: { url: string; title: string; text: string | null }) {
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const copy = async () => {
    try {
      await copyToClipboard(url);
      toast.success("Share link copied", { description: "Paste it into a message, an email or your church website." });
    } catch {
      toast.error("Couldn't copy the link", { description: url });
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Share this sermon"
        className={cn(buttonVariants({ variant: "outline" }), "h-10 shrink-0 gap-1.5 rounded-xl px-2.5 sm:h-9 sm:px-3")}
      >
        <Globe className="size-4 text-ok" aria-hidden />
        <span className="hidden sm:inline">Share</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-1.5">
        <div className="px-2 pt-1.5 pb-2">
          <p className="text-sm font-semibold text-ink">This sermon is published</p>
          <p className="mt-0.5 truncate text-xs text-ink-3">{url}</p>
        </div>
        <DropdownMenuItem onClick={() => void copy()}>
          <Link2 /> Copy share link
        </DropdownMenuItem>
        <DropdownMenuItem render={<a href={url} target="_blank" rel="noopener noreferrer" />}>
          <ExternalLink /> Open share page
        </DropdownMenuItem>
        {canNativeShare && (
          <DropdownMenuItem onClick={() => void navigator.share({ title, text: text ?? title, url }).catch(() => undefined)}>
            <Share2 /> Share…
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ───────────────────────────────────────────────────────────── stepper

function Stepper({ sermonId, active, detail, onSelect }: { sermonId: string; active: SermonStage; detail: SermonDetail; onSelect: (s: SermonStage) => void }) {
  const done = stepsDone(detail);
  return (
    <nav aria-label="Sermon steps">
      <ol className="grid grid-cols-4 gap-1 rounded-2xl border border-border bg-card p-1.5 shadow-xs">
        {STAGES.map((step) => (
          <StepItem
            key={step.n}
            sermonId={sermonId}
            step={step}
            active={active === step.n}
            done={done[step.n]}
            hint={stepHint(step.n, detail)}
            locked={lockReason(step.n, detail.inputs, detail.draft)}
            onSelect={() => onSelect(step.n)}
          />
        ))}
      </ol>
    </nav>
  );
}

function StepItem({
  sermonId,
  step,
  active,
  done,
  hint,
  locked,
  onSelect,
}: {
  sermonId: string;
  step: (typeof STAGES)[number];
  active: boolean;
  done: boolean;
  hint: string;
  locked: string | null;
  onSelect: () => void;
}) {
  const pending = useIsMutating({ mutationKey: ["sermon", sermonId, step.n] }) > 0;
  const Icon = step.icon;
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "step" : undefined}
        aria-label={`Step ${step.n} of 4, ${step.label}: ${hint}${done ? ", done" : ""}${locked ? `. Locked — ${locked}` : ""}${pending ? ", working" : ""}`}
        title={locked ?? `${step.title} — ${hint}`}
        className={cn(
          "group flex h-full w-full min-w-0 flex-col items-center gap-1.5 rounded-xl px-1 py-2 text-center transition outline-none focus-visible:ring-3 focus-visible:ring-ring sm:flex-row sm:gap-3 sm:px-3 sm:py-2.5 sm:text-left",
          active ? "bg-navy-700 text-white shadow-sm dark:bg-gold-400/15 dark:text-gold-100" : locked ? "text-ink-3 hover:bg-surface-2/70" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
        )}
      >
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full transition sm:size-9",
            active
              ? "bg-white text-navy-800 shadow-sm dark:bg-gold-400 dark:text-navy-900"
              : done
                ? "bg-gold-400/20 text-gold-700 dark:text-gold-300"
                : locked
                  ? "bg-surface-2 text-ink-3"
                  : "border border-border bg-surface text-ink-2 dark:bg-surface-2/50",
          )}
          aria-hidden
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : done && !active ? (
            <Check className="size-4" strokeWidth={2.5} />
          ) : locked && !active ? (
            <Lock className="size-3.5" />
          ) : (
            <Icon className="size-4" />
          )}
        </span>
        <span className="min-w-0 max-w-full">
          <span className="block truncate text-[12px] font-semibold sm:text-sm">{step.label}</span>
          <span className={cn("hidden truncate text-xs md:block", active ? "text-white/75 dark:text-gold-100/75" : "text-ink-3")}>{hint}</span>
        </span>
      </button>
    </li>
  );
}

// ───────────────────────────────────────────────────────────── loading + errors

function WorkspaceSkeleton() {
  return (
    <div aria-busy="true">
      <div className="border-b border-border">
        <div className={cn(PAGE, "flex h-14 items-center gap-3")}>
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-7 w-72 max-w-[55%]" />
        </div>
      </div>
      <div className={cn(PAGE, "grid grid-cols-1 gap-6 pt-4 sm:pt-6")}>
        <Skeleton className="h-[64px] rounded-2xl" />
        <div className="grid gap-2">
          <Skeleton className="h-4 w-24 rounded-md" />
          <Skeleton className="h-8 w-64 rounded-lg" />
          <Skeleton className="h-4 w-full max-w-xl rounded-md" />
        </div>
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
      <span className="sr-only" role="status">
        Loading your sermon…
      </span>
    </div>
  );
}

function ServerUnavailable() {
  const qc = useQueryClient();
  return (
    <div className={cn(PAGE, "py-10 sm:py-16")}>
      <EmptyState
        icon={WifiOff}
        title="Sermon Studio can't reach the server"
        action={
          <Button onClick={() => void qc.refetchQueries({ queryKey: ["me"] })} className="h-10 gap-2 rounded-xl px-4">
            <RefreshCw className="size-4" /> Try again
          </Button>
        }
      >
        Check that the Interactive Bible App is running on this computer, then try again. Your sermons are safe.
      </EmptyState>
    </div>
  );
}

function WorkspaceError({ error, onRetry, retrying, personal }: { error: unknown; onRetry: () => void; retrying: boolean; personal: boolean }) {
  const qc = useQueryClient();
  const location = useLocation();
  const status = error instanceof ApiError ? error.status : 0;

  useEffect(() => {
    if (status === 401 && !personal) void qc.invalidateQueries({ queryKey: ["me"] });
  }, [status, qc, personal]);

  if (status === 401 && !personal) {
    return (
      <div className={cn(PAGE, "py-6 sm:py-10")}>
        <SignInCard from={location.pathname} title="Your session has ended">
          Sign in again to keep working on this sermon.
        </SignInCard>
      </div>
    );
  }
  if (status === 404 || status === 403) {
    return (
      <div className={cn(PAGE, "py-10")}>
        <EmptyState
          icon={FileQuestionMark}
          title="We couldn't find this sermon"
          action={
            <LinkButton to="/sermons" className="h-10 gap-2 rounded-xl px-4">
              <ArrowLeft className="size-4" /> Back to your sermons
            </LinkButton>
          }
        >
          {personal ? "It may have been deleted, or the link is out of date." : "It may have been deleted, or it belongs to another account."}
        </EmptyState>
      </div>
    );
  }
  const { title, description } = describeError(error, "Couldn't load this sermon");
  return (
    <div className={cn(PAGE, "py-10")}>
      <EmptyState
        icon={TriangleAlert}
        title={title}
        action={
          <>
            <Button onClick={onRetry} disabled={retrying} className="h-10 gap-2 rounded-xl px-4">
              <RefreshCw className={cn("size-4", retrying && "animate-spin")} /> Try again
            </Button>
            <LinkButton to="/sermons" variant="outline" className="h-10 rounded-xl px-4">
              All sermons
            </LinkButton>
          </>
        }
      >
        {description ?? "Check your connection and try again."}
      </EmptyState>
    </div>
  );
}
