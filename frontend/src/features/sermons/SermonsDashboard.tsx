import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight, BookMarked, BookOpen, ChevronRight, CircleHelp, EllipsisVertical, ExternalLink, Globe, Link2, Loader2, LogIn, PenLine, Plus,
  RefreshCw, Search, SearchX, Sparkles, Trash2, TriangleAlert, WifiOff, X, type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { Chapter } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn, timeAgo } from "@/lib/utils";
import { absoluteUrl, describeError, sermonApi, sermonKeys, setPersonalMode, sharePathFromDetail, toastError, useSermonList } from "./api";
import {
  ConfirmDialog, EmptyState, FieldLabel, LinkButton, PAGE, STAGES, Skeleton, StageBars, StatusBadge, TextInput, copyToClipboard, readStorage, writeStorage,
} from "./components/StudioUI";
import "./sermon-studio.css";
import type { SermonListItem } from "./types";
import { listProgress } from "./workspace";

const STARFIELD = {
  backgroundImage:
    "radial-gradient(circle at 12% 18%, rgba(255,255,255,0.35) 1px, transparent 1.6px), radial-gradient(circle at 72% 62%, rgba(255,255,255,0.25) 1px, transparent 1.6px)",
  backgroundSize: "34px 34px, 52px 52px",
};

const GUIDE_KEY = "ibible_sermon_guide";
const QUICK_PASSAGES = ["Psalm 23", "John 3:16", "Romans 8:28", "Isaiah 40:31", "Philippians 4:6-7", "Matthew 5:1-12"];

type Filter = "all" | "progress" | "published";
type GuideMode = "full" | "compact";

const isPublished = (s: SermonListItem) => s.is_published ?? s.status === "published";

function greeting(date = new Date()): string {
  const h = date.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function SermonsDashboard() {
  const { viewer, loading, singleUser } = useAuth();
  const location = useLocation();
  setPersonalMode(singleUser);
  if (loading) return <DashboardSkeleton />;
  // Personal mode: this computer is always signed in as the owner.
  if (singleUser || viewer?.authenticated) return <Dashboard firstName={viewer?.display_name?.trim().split(/\s+/)[0] || null} />;
  if (!viewer) return <ServerUnavailable />;
  return <SignedOut from={`${location.pathname}${location.search}`} />;
}

// ───────────────────────────────────────────────────────────── dashboard

function Dashboard({ firstName }: { firstName: string | null }) {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const list = useSermonList(true);
  const items = useMemo(() => [...(list.data?.items ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [list.data]);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SermonListItem | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [guidePref, setGuidePref] = useState<GuideMode | null>(() => readStorage<GuideMode>(GUIDE_KEY));

  const newOpen = params.get("new") === "1";
  const scripture = params.get("scripture") ?? "";
  const suggestedTitle = (params.get("title") ?? "").slice(0, 200);
  const openNew = (passage?: string) => {
    const next = new URLSearchParams(params);
    next.set("new", "1");
    if (passage) next.set("scripture", passage);
    setParams(next, { replace: true });
  };
  const closeNew = () => {
    const next = new URLSearchParams(params);
    next.delete("new");
    next.delete("scripture");
    next.delete("title");
    setParams(next, { replace: true });
  };

  const published = items.filter(isPublished).length;
  const inProgress = items.length - published;
  const counts: Record<Filter, number> = { all: items.length, progress: inProgress, published };
  const resume = items.find((s) => !isPublished(s)) ?? null;

  const query = search.trim().toLowerCase();
  const filtered = items.filter((s) => {
    if (filter === "published" && !isPublished(s)) return false;
    if (filter === "progress" && isPublished(s)) return false;
    if (!query) return true;
    return [s.title, s.scripture_ref, s.theme].some((v) => v?.toLowerCase().includes(query));
  });

  const guideMode: GuideMode = guidePref ?? (items.length < 3 ? "full" : "compact");
  const setGuide = (mode: GuideMode) => {
    setGuidePref(mode);
    writeStorage(GUIDE_KEY, mode);
  };

  const remove = useMutation({
    mutationFn: (id: string) => sermonApi.remove(id),
    onSuccess: (_data, id) => {
      qc.setQueryData<{ items: SermonListItem[] }>(sermonKeys.list, (d) => (d ? { ...d, items: d.items.filter((s) => s.id !== id) } : d));
      qc.removeQueries({ queryKey: sermonKeys.detail(id) });
      writeStorage(`ibible_sermon_collect_${id}`, null);
      setDeleteOpen(false);
      toast.success("Sermon deleted");
    },
    onError: (err) => toastError(err, "Couldn't delete the sermon"),
  });

  const loaded = !list.isLoading && !list.isError;

  return (
    <div className={cn(PAGE, "pt-4 pb-16 sm:pt-6 lg:pt-8")}>
      {/* ── Welcome ── */}
      <section className="hero-sky relative overflow-hidden rounded-3xl text-white shadow-xl" aria-labelledby="studio-title">
        <div className="absolute inset-0 opacity-30" style={STARFIELD} aria-hidden />
        <div className="absolute -top-20 -right-12 size-64 rounded-full bg-gold-400/15 blur-3xl" aria-hidden />
        <div
          className={cn(
            "relative grid grid-cols-1 gap-6 px-5 py-7 sm:px-8 sm:py-9",
            (list.isLoading || items.length > 0) && "xl:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] xl:items-center xl:gap-10",
          )}
        >
          <div className="min-w-0 animate-fade-up motion-reduce:animate-none">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[12px] font-medium text-gold-200 backdrop-blur">
              <PenLine className="size-3.5" aria-hidden /> Sermon Studio
            </div>
            <h1 id="studio-title" className="mt-3 font-display text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
              {firstName ? `${greeting()}, ${firstName}` : "Your sermons"}
            </h1>
            <p className="mt-2.5 max-w-xl text-[15px] leading-relaxed text-white/75 sm:text-base">
              Turn your notes, voice memos and Scripture into a finished sermon — with slides, speaker notes and a page to share with your church.
            </p>
            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
              <Button onClick={() => openNew()} className="h-12 gap-2 rounded-xl bg-gold-400 px-6 text-[15px] font-semibold text-navy-900 shadow-lg shadow-black/25 hover:bg-gold-300">
                <Plus className="size-5" /> New sermon
              </Button>
              {loaded && guideMode === "compact" && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setGuide("full");
                    requestAnimationFrame(() => document.getElementById("studio-guide")?.scrollIntoView({ behavior: "smooth", block: "center" }));
                  }}
                  className="h-12 gap-2 rounded-xl px-4 text-[15px] text-white/85 hover:bg-white/10 hover:text-white dark:hover:bg-white/10"
                >
                  <CircleHelp className="size-4" /> How it works
                </Button>
              )}
            </div>
          </div>

          {list.isLoading ? (
            <Skeleton className="h-52 rounded-2xl bg-white/10" />
          ) : items.length > 0 ? (
            <HeroPanel total={items.length} inProgress={inProgress} published={published} resume={resume} />
          ) : null}
        </div>
      </section>

      {/* ── How it works ── */}
      {loaded && <HowItWorks mode={guideMode} canHide={items.length > 0} onChange={setGuide} />}

      {/* ── Sermons ── */}
      {list.isLoading ? (
        <div className="mt-10" aria-busy="true">
          <Skeleton className="h-7 w-40 rounded-lg" />
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
          <span className="sr-only" role="status">
            Loading your sermons…
          </span>
        </div>
      ) : list.isError ? (
        <EmptyState
          className="mt-8"
          icon={TriangleAlert}
          title={describeError(list.error, "Couldn't load your sermons").title}
          action={
            <Button onClick={() => void list.refetch()} disabled={list.isFetching} className="h-10 gap-2 rounded-xl px-4">
              <RefreshCw className={cn("size-4", list.isFetching && "animate-spin")} /> Try again
            </Button>
          }
        >
          {describeError(list.error, "").description ?? "Check that the Interactive Bible App server is running, then try again."}
        </EmptyState>
      ) : items.length === 0 ? (
        <FirstSermon onCreate={openNew} />
      ) : (
        <section aria-labelledby="your-sermons" className="mt-10">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 id="your-sermons" className="font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">
                Your sermons
              </h2>
              <p className="mt-0.5 text-sm text-ink-3">Most recently updated first. Open one to pick up where you left off.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div role="group" aria-label="Filter sermons" className="grid grid-cols-3 rounded-xl border border-border bg-card p-1 shadow-xs sm:inline-flex">
                {(
                  [
                    ["all", "All"],
                    ["progress", "In progress"],
                    ["published", "Published"],
                  ] as [Filter, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                    className={cn(
                      "h-9 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition outline-none focus-visible:ring-3 focus-visible:ring-ring sm:text-sm",
                      filter === key ? "bg-primary text-primary-foreground shadow-xs" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    {label} <span className="ml-0.5 tabular-nums opacity-70">{counts[key]}</span>
                  </button>
                ))}
              </div>
              <div className="relative sm:w-72">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
                <TextInput
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by title or Scripture"
                  aria-label="Search your sermons"
                  className="bg-card pl-9"
                />
              </div>
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              className="mt-5"
              icon={SearchX}
              title={query ? `No sermons match “${search.trim()}”` : filter === "published" ? "Nothing published yet" : "No sermons in progress"}
              action={
                <Button
                  variant="outline"
                  className="h-10 gap-2 rounded-xl px-4"
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                  }}
                >
                  <X className="size-4" /> Show all sermons
                </Button>
              }
            >
              {query ? "Try a different word, or clear the search." : filter === "published" ? "Publish a sermon from its last step to share it with your church." : "Every sermon here has been published."}
            </EmptyState>
          ) : (
            <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((s, i) => (
                <li key={s.id} className="flex">
                  <SermonCard
                    sermon={s}
                    index={i}
                    onDelete={() => {
                      setDeleteTarget(s);
                      setDeleteOpen(true);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <NewSermonDialog open={newOpen} scripture={scripture} suggestedTitle={suggestedTitle} onClose={closeNew} />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(open) => !open && !remove.isPending && setDeleteOpen(false)}
        title="Delete this sermon?"
        description={
          <>
            “{deleteTarget?.title}” and all of its notes, drafts, visuals and share page will be permanently deleted. This can't be undone.
          </>
        }
        confirmLabel="Delete sermon"
        icon={Trash2}
        destructive
        pending={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
      />
    </div>
  );
}

function HeroPanel({ total, inProgress, published, resume }: { total: number; inProgress: number; published: number; resume: SermonListItem | null }) {
  const progress = resume ? listProgress(resume) : null;
  const stats: [string, number][] = [
    ["Sermons", total],
    ["In progress", inProgress],
    ["Published", published],
  ];
  return (
    <div className="animate-fade-up motion-reduce:animate-none rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-2xl shadow-black/20 backdrop-blur-md [animation-delay:90ms] sm:p-5">
      <dl className="grid grid-cols-3 gap-2">
        {stats.map(([label, value]) => (
          <div key={label} className="flex flex-col-reverse items-center rounded-xl bg-white/[0.06] px-2 py-3 text-center">
            <dt className="text-[11px] font-medium text-white/65 sm:text-xs">{label}</dt>
            <dd className="font-display text-2xl leading-none font-semibold text-white tabular-nums sm:text-3xl">{value}</dd>
          </div>
        ))}
      </dl>
      {resume && progress && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-gold-300 uppercase">Pick up where you left off</p>
          <p className="mt-1.5 truncate font-display text-lg font-semibold text-white" title={resume.title}>
            {resume.title || "Untitled sermon"}
          </p>
          <p className="mt-0.5 truncate text-sm text-white/70">
            {progress.next ? `Next: ${progress.next}` : progress.label} · updated {timeAgo(resume.updated_at)}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <span className="flex flex-1 gap-1" role="img" aria-label={`${progress.done} of 4 steps done`}>
              {[1, 2, 3, 4].map((n) => (
                <span key={n} className={cn("h-1.5 flex-1 rounded-full", n <= progress.done ? "bg-gold-400" : "bg-white/15")} />
              ))}
            </span>
            <LinkButton
              to={`/sermons/${resume.id}`}
              className="h-10 shrink-0 gap-1.5 rounded-xl bg-white px-4 font-semibold text-navy-900 hover:bg-gold-100 dark:bg-white dark:text-navy-900 dark:hover:bg-gold-100"
            >
              Continue <ArrowRight className="size-4" />
            </LinkButton>
          </div>
        </div>
      )}
    </div>
  );
}

function HowItWorks({ mode, canHide, onChange }: { mode: GuideMode; canHide: boolean; onChange: (mode: GuideMode) => void }) {
  if (mode === "compact") {
    return (
      <section aria-labelledby="studio-guide" className="mt-6 flex flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-xs md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <h2 id="studio-guide" className="text-sm font-semibold text-ink">
            How it works
          </h2>
          <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink-2">
            {STAGES.map((s, i) => (
              <li key={s.n} className="inline-flex items-center gap-1.5">
                <span className="grid size-6 place-items-center rounded-full bg-gold-400/15 text-gold-700 dark:text-gold-300" aria-hidden>
                  <s.icon className="size-3.5" />
                </span>
                {s.label}
                {i < STAGES.length - 1 && <ChevronRight className="size-3.5 text-ink-3" aria-hidden />}
              </li>
            ))}
          </ol>
        </div>
        <Button variant="ghost" onClick={() => onChange("full")} aria-expanded={false} className="h-9 w-fit gap-1.5 rounded-lg px-3 text-ink-2">
          <CircleHelp className="size-4" /> Show the guide
        </Button>
      </section>
    );
  }
  return (
    <section aria-labelledby="studio-guide" className="mt-6 animate-fade-up motion-reduce:animate-none rounded-3xl border border-border bg-card p-5 shadow-xs sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.12em] text-gold-700 uppercase dark:text-gold-300">Four simple steps</p>
          <h2 id="studio-guide" className="mt-1 font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            How Sermon Studio works
          </h2>
          <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-ink-2">
            Go at your own pace — you can return to any step and change things, and your work is saved as you go.
          </p>
        </div>
        {canHide && (
          <Button variant="ghost" onClick={() => onChange("compact")} aria-expanded className="h-9 gap-1.5 rounded-lg px-3 text-ink-2">
            <X className="size-4" /> Hide guide
          </Button>
        )}
      </div>
      <ol className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {STAGES.map((s, i) => (
          <li key={s.n} className="relative flex gap-3.5 rounded-2xl border border-border/70 bg-paper-2 p-4 xl:flex-col xl:gap-3 dark:bg-surface-2/40">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-gold-400 to-gold-600 text-navy-900 shadow-md shadow-gold-700/15" aria-hidden>
              <s.icon className="size-5" />
            </span>
            <div className="min-w-0">
              <h3 className="font-semibold text-ink">
                <span className="mr-1 text-gold-700 tabular-nums dark:text-gold-300">{s.n}.</span> {s.label}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">{s.guide}</p>
            </div>
            {i < STAGES.length - 1 && (
              <span className="absolute top-1/2 -right-3 z-10 hidden size-6 -translate-y-1/2 place-items-center rounded-full border border-border bg-card text-ink-3 shadow-xs xl:grid" aria-hidden>
                <ChevronRight className="size-3.5" />
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function SermonCard({ sermon: s, index, onDelete }: { sermon: SermonListItem; index: number; onDelete: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const published = isPublished(s);
  const progress = listProgress(s);
  const [coverBroken, setCoverBroken] = useState(false);
  const [wantShare, setWantShare] = useState(false);
  const title = s.title || "Untitled sermon";

  // The list doesn't carry the share link: look it up (once, cached) as soon as the owner shows interest in sharing.
  const detailQuery = { queryKey: sermonKeys.detail(s.id), queryFn: ({ signal }: { signal: AbortSignal }) => sermonApi.detail(s.id, signal), staleTime: 60_000 };
  const share = useQuery({ ...detailQuery, enabled: published && !s.share_path && wantShare, select: sharePathFromDetail });
  const sharePath = s.share_path ?? share.data ?? null;
  const shareUrl = sharePath ? absoluteUrl(sharePath) : null;
  const primeShare = () => {
    if (published && !wantShare) setWantShare(true);
  };

  const copyLink = async () => {
    primeShare();
    try {
      const path = sharePath ?? sharePathFromDetail(await qc.fetchQuery(detailQuery));
      if (!path) {
        toast.error("This sermon isn't published any more");
        return;
      }
      await copyToClipboard(absoluteUrl(path));
      toast.success("Share link copied", { description: "Paste it into a message, an email or your church website." });
    } catch (err) {
      toastError(err, "Couldn't copy the share link");
    }
  };

  return (
    <article
      onPointerEnter={primeShare}
      onFocus={primeShare}
      className="group relative flex w-full animate-fade-up motion-reduce:animate-none flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xs transition duration-200 focus-within:border-gold-400/50 hover:border-gold-400/50 hover:shadow-md"
      style={{ animationDelay: `${Math.min(index, 9) * 40}ms` }}
    >
      <div className="relative aspect-[16/8] overflow-hidden bg-surface-2">
        {s.cover_url && !coverBroken ? (
          <img
            src={s.cover_url}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setCoverBroken(true)}
            className="size-full object-cover transition duration-700 group-hover:scale-[1.03] motion-reduce:transition-none"
          />
        ) : (
          <CoverArt scripture={s.scripture_ref} />
        )}
        <span className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/30 to-transparent" aria-hidden />
        <StatusBadge status={published ? "published" : s.status} className="absolute top-3 left-3 shadow-sm ring-1 ring-black/5" />
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <h3 className="font-display text-lg leading-snug font-semibold tracking-tight">
          <Link
            to={`/sermons/${s.id}`}
            className="line-clamp-2 text-ink no-underline outline-none after:absolute after:inset-0 after:rounded-2xl after:content-[''] hover:no-underline focus-visible:after:ring-3 focus-visible:after:ring-ring"
          >
            {title}
          </Link>
        </h3>
        <div className="mt-1.5 grid min-h-11 grid-cols-1 content-start gap-1 text-[13px]">
          {s.scripture_ref && (
            <p className="flex min-w-0 items-center gap-1.5 text-ink-2">
              <BookOpen className="size-3.5 shrink-0 text-gold-600 dark:text-gold-300" aria-hidden />
              <span className="truncate">{s.scripture_ref}</span>
            </p>
          )}
          {s.theme && <p className="line-clamp-1 text-ink-3 italic">{s.theme}</p>}
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-ink-2">{progress.label}</span>
            <span className="text-ink-3 tabular-nums">{progress.done} of 4</span>
          </div>
          <StageBars stage={progress.done} label={`${progress.done} of 4 steps done`} />
          <p className="mt-2 truncate text-xs text-ink-3">
            {progress.next ? (
              <>
                <span className="font-medium text-ink-2">Next:</span> {progress.next}
              </>
            ) : (
              <span className="inline-flex items-center gap-1 text-ok">
                <Globe className="size-3" aria-hidden /> Live on its share page
              </span>
            )}
          </p>
        </div>

        <div className="mt-4 flex items-center gap-1 border-t border-border pt-3">
          <span className="mr-auto min-w-0 truncate text-xs text-ink-3">Updated {timeAgo(s.updated_at)}</span>
          {published && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void copyLink()}
              aria-label={`Copy the share link for ${title}`}
              title="Copy share link"
              className="relative z-10 size-10 rounded-lg text-ink-2 hover:text-ink sm:size-9"
            >
              <Link2 className="size-4" />
            </Button>
          )}
          <DropdownMenu onOpenChange={(open) => open && primeShare()}>
            <DropdownMenuTrigger
              aria-label={`More actions for ${title}`}
              className="relative z-10 grid size-10 place-items-center rounded-lg text-ink-2 transition outline-none hover:bg-muted hover:text-ink focus-visible:ring-3 focus-visible:ring-ring data-[popup-open]:bg-muted sm:size-9"
            >
              <EllipsisVertical className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem onClick={() => navigate(`/sermons/${s.id}`)}>
                <ArrowRight /> {published ? "Open" : "Continue working"}
              </DropdownMenuItem>
              {published && (
                <>
                  <DropdownMenuItem onClick={() => void copyLink()}>
                    <Link2 /> Copy share link
                  </DropdownMenuItem>
                  {shareUrl ? (
                    <DropdownMenuItem render={<a href={shareUrl} target="_blank" rel="noopener noreferrer" />}>
                      <ExternalLink /> View share page
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem disabled>
                      <Loader2 className="animate-spin" /> View share page
                    </DropdownMenuItem>
                  )}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 /> Delete…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="hidden items-center gap-1 pl-1 text-sm font-semibold text-link sm:inline-flex" aria-hidden>
            {published ? "Open" : "Continue"} <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </article>
  );
}

function CoverArt({ scripture }: { scripture: string | null }) {
  return (
    <div className="hero-sky relative size-full" aria-hidden>
      <div className="absolute inset-0 opacity-40" style={STARFIELD} />
      <div className="absolute -right-10 -bottom-16 size-44 rounded-full bg-gold-400/20 blur-3xl" />
      <div className="relative flex size-full flex-col justify-end p-4">
        <BookMarked className="mb-1.5 size-5 text-gold-300/80" />
        <span className="line-clamp-1 font-serif text-base text-gold-100 italic">{scripture || "A new message"}</span>
      </div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs" aria-hidden>
      <Skeleton className="aspect-[16/8] rounded-none" />
      <div className="grid grid-cols-1 gap-3 p-4 sm:p-5">
        <Skeleton className="h-5 w-3/4 rounded-md" />
        <Skeleton className="h-3.5 w-1/2 rounded-md" />
        <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
        <Skeleton className="h-3 w-1/3 rounded-md" />
      </div>
    </div>
  );
}

function FirstSermon({ onCreate }: { onCreate: (passage?: string) => void }) {
  return (
    <section aria-labelledby="first-sermon" className="mt-8 animate-fade-up motion-reduce:animate-none rounded-3xl border border-dashed border-border bg-card/60 px-5 py-10 text-center sm:px-8 sm:py-14">
      <span className="mx-auto grid size-16 place-items-center rounded-full bg-gold-400/12 text-gold-600 dark:text-gold-300" aria-hidden>
        <BookMarked className="size-7" />
      </span>
      <h2 id="first-sermon" className="mt-4 font-display text-2xl font-semibold tracking-tight text-ink">
        Your first sermon starts here
      </h2>
      <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-ink-2">
        Bring your notes, a voice memo or a passage of Scripture — Sermon Studio helps you shape it into a message and share it.
      </p>
      <Button onClick={() => onCreate()} className="mt-6 h-12 gap-2 rounded-xl px-6 text-[15px]">
        <Plus className="size-5" /> Create your first sermon
      </Button>
      <div className="mx-auto mt-8 max-w-xl">
        <p className="text-sm font-medium text-ink-2">Or start from a passage</p>
        <div className="mt-2.5 flex flex-wrap justify-center gap-2">
          {QUICK_PASSAGES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onCreate(p)}
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-sm text-ink-2 transition hover:border-gold-400/60 hover:text-ink dark:bg-surface-2/40"
            >
              <BookOpen className="size-3.5 text-gold-600 dark:text-gold-300" aria-hidden /> {p}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

// ───────────────────────────────────────────────────────────── new sermon

interface ParsedReference {
  book: string;
  chapter: number;
  verse: number | null;
  end_chapter: number | null;
  end_verse: number | null;
  display: string;
}

interface ParseResult {
  references: ParsedReference[];
  canonical: string | null;
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const parseReference = (q: string, signal?: AbortSignal) => api<ParseResult>(`/v1/bible/parse?q=${encodeURIComponent(q)}`, { signal });

function NewSermonDialog({ open, scripture, suggestedTitle = "", onClose }: { open: boolean; scripture: string; suggestedTitle?: string; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const titleTouched = useRef(false);

  const typed = reference.trim();
  const q = useDebouncedValue(typed, 350);
  const parsed = useQuery({
    queryKey: ["bible-parse", q],
    queryFn: ({ signal }) => parseReference(q, signal),
    enabled: open && q.length >= 3,
    staleTime: Infinity,
    retry: false,
  });
  const settled = q === typed && !parsed.isFetching;
  const match = typed.length >= 3 && q === typed ? (parsed.data?.references?.[0] ?? null) : null;

  useEffect(() => {
    if (!open) return;
    setTitle(suggestedTitle);
    setReference(scripture);
    titleTouched.current = !!suggestedTitle;
  }, [open, scripture, suggestedTitle]);

  // Until the title is typed by hand, suggest the passage as a working title.
  useEffect(() => {
    if (!open || titleTouched.current) return;
    if (match?.display) setTitle(match.display);
    else if (!typed) setTitle("");
  }, [open, match?.display, typed]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const name = title.trim();
    if (!name || busy) return;
    const passage = reference.trim();
    setBusy("Creating your sermon…");
    try {
      const resolved = passage ? (q === passage && parsed.data ? parsed.data : await parseReference(passage).catch(() => null)) : null;
      const sermon = await sermonApi.create(name);
      if (!sermon?.id) throw new Error("The server didn't return the new sermon.");
      if (passage) {
        const found = resolved?.references?.[0] ?? null;
        let label = found?.display ?? passage;
        if (found) {
          setBusy("Adding your Scripture…");
          try {
            const input = await sermonApi.addBibleRef(sermon.id, { reference: resolved?.canonical ?? passage, translation: "web" });
            if (typeof input?.meta?.reference === "string" && input.meta.reference) label = input.meta.reference;
          } catch (err) {
            toastError(err, "Your sermon was created, but the Scripture couldn't be added");
          }
        }
        await sermonApi.update(sermon.id, { scripture_ref: label.slice(0, 300) }).catch(() => undefined);
      }
      void qc.invalidateQueries({ queryKey: sermonKeys.list, exact: true });
      onClose();
      navigate(`/sermons/${sermon.id}`);
      toast.success("Sermon created", {
        description: passage ? "Your Scripture is in your collected content. Add notes, your voice or documents next." : "Start by adding notes, your voice or Scripture.",
      });
    } catch (err) {
      toastError(err, "Couldn't create the sermon");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && !o && onClose()}>
      <DialogContent className="top-4 max-h-[calc(100dvh-2rem)] translate-y-0 overflow-y-auto sm:top-[8vh] sm:max-h-[84vh] sm:max-w-lg">
        <form onSubmit={create} className="grid grid-cols-1 gap-5">
          <DialogHeader className="gap-1.5">
            <span className="mb-1 grid size-11 place-items-center rounded-xl bg-gradient-to-br from-gold-400 to-gold-600 text-navy-900 shadow-md shadow-gold-700/15" aria-hidden>
              <PenLine className="size-5" />
            </span>
            <DialogTitle className="font-display text-2xl leading-tight font-semibold">Start a new sermon</DialogTitle>
            <DialogDescription className="text-[15px] leading-relaxed text-ink-2 sm:text-sm">
              Give it a working title — you can change everything later. Adding a key passage now saves you a step.
            </DialogDescription>
          </DialogHeader>

          <div>
            <FieldLabel htmlFor="new-sermon-title">Title</FieldLabel>
            <TextInput
              id="new-sermon-title"
              value={title}
              onChange={(e) => {
                titleTouched.current = true;
                setTitle(e.target.value);
              }}
              placeholder="e.g. Walking in Faith"
              maxLength={200}
              required
              autoFocus
              autoComplete="off"
            />
          </div>

          <div>
            <FieldLabel htmlFor="new-sermon-scripture" hint="Optional">
              Key Scripture
            </FieldLabel>
            <div className="relative">
              <BookOpen className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
              <TextInput
                id="new-sermon-scripture"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. Romans 8:28 or Psalm 23"
                maxLength={120}
                autoComplete="off"
                aria-describedby="new-sermon-scripture-status"
                className="pr-9 pl-9"
              />
              {typed && (
                <button
                  type="button"
                  onClick={() => setReference("")}
                  aria-label="Clear Scripture"
                  className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-ink-3 transition hover:bg-surface-2 hover:text-ink"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            <div id="new-sermon-scripture-status" aria-live="polite">
              {!typed ? (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {QUICK_PASSAGES.slice(0, 5).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setReference(p)}
                      className="h-8 rounded-full border border-border px-3 text-[13px] text-ink-2 transition hover:border-gold-400/60 hover:bg-surface-2 hover:text-ink"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              ) : match ? (
                <VersePreview reference={match} />
              ) : typed.length >= 3 && settled && parsed.isFetched ? (
                <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
                  We couldn't find that passage. Check the book, chapter and verse — or keep it and it will be saved as a note on the sermon.
                </p>
              ) : typed.length >= 3 ? (
                <p className="mt-2 flex items-center gap-1.5 text-[13px] text-ink-3">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden /> Looking up the passage…
                </p>
              ) : null}
            </div>
          </div>

          <p className="hidden items-start gap-2 rounded-xl bg-surface-2/70 sm:flex px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-gold-600 dark:text-gold-300" aria-hidden />
            Next you'll collect your content — notes, your voice, recordings, documents or more Scripture.
          </p>

          <DialogFooter className="border-border">
            <Button type="button" variant="ghost" onClick={onClose} disabled={!!busy} className="h-11 rounded-xl px-4 sm:h-10">
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || !!busy} className="h-11 gap-2 rounded-xl px-5 sm:h-10">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
              {busy ?? "Create sermon"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VersePreview({ reference: r }: { reference: ParsedReference }) {
  const chapter = useQuery({
    queryKey: ["chapter", r.book, r.chapter, "web"],
    queryFn: ({ signal }) => api<Chapter>(`/v1/bible/chapters/${encodeURIComponent(r.book)}/${r.chapter}?translation=web`, { signal }),
    staleTime: Infinity,
    retry: false,
  });
  const all = (chapter.data?.verses ?? []).filter((v) => !!v.text);
  const crossesChapter = !!r.end_chapter && r.end_chapter !== r.chapter;
  const inRange =
    r.verse == null ? all : all.filter((v) => v.number >= (r.verse ?? 1) && (crossesChapter || v.number <= (r.end_verse ?? r.verse ?? v.number)));
  const limit = r.verse == null ? 3 : 4;
  const shown = inRange.slice(0, limit);
  const more = inRange.length > limit || crossesChapter;

  return (
    <figure className="mt-2.5 rounded-xl border border-gold-400/30 bg-gold-400/[0.06] px-3.5 py-3">
      <figcaption className="mb-1.5 flex items-center justify-between gap-2 text-xs font-semibold">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-gold-700 dark:text-gold-300">
          <BookOpen className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{r.display}</span>
        </span>
        <span className="font-medium text-ink-3">World English Bible</span>
      </figcaption>
      {chapter.isLoading ? (
        <div className="grid gap-1.5 py-1" aria-hidden>
          <Skeleton className="h-3.5 w-full rounded-md" />
          <Skeleton className="h-3.5 w-4/5 rounded-md" />
        </div>
      ) : shown.length ? (
        <blockquote className="max-h-28 overflow-y-auto sm:max-h-36 font-serif text-[15px] leading-relaxed text-ink">
          {shown.map((v) => (
            <span key={v.number}>
              <sup className="mr-0.5 font-sans text-[10px] font-semibold text-ink-3">{v.number}</sup>
              {v.text}{" "}
            </span>
          ))}
          {more && <span className="text-ink-3">…</span>}
        </blockquote>
      ) : (
        <p className="text-[13px] text-ink-3">The verse text will be looked up when the sermon is created.</p>
      )}
    </figure>
  );
}

// ───────────────────────────────────────────────────────────── accounts mode, errors + loading

function ServerUnavailable() {
  const qc = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  return (
    <div className={cn(PAGE, "py-10 sm:py-16")}>
      <EmptyState
        icon={WifiOff}
        title="Sermon Studio can't reach the server"
        action={
          <Button
            onClick={async () => {
              setRetrying(true);
              await qc.refetchQueries({ queryKey: ["me"] }).catch(() => undefined);
              setRetrying(false);
            }}
            disabled={retrying}
            className="h-10 gap-2 rounded-xl px-4"
          >
            <RefreshCw className={cn("size-4", retrying && "animate-spin")} /> Try again
          </Button>
        }
      >
        Check that the Interactive Bible App is running on this computer, then try again. Your sermons are safe.
      </EmptyState>
    </div>
  );
}

/** Accounts mode only (other devices on the network). Personal mode never shows this. */
function SignedOut({ from }: { from: string }) {
  const FEATURES: { icon: LucideIcon; title: string; text: string }[] = STAGES.map((s) => ({ icon: s.icon, title: s.label, text: s.guide }));
  return (
    <div className={cn(PAGE, "pt-4 pb-16 sm:pt-6 lg:pt-8")}>
      <section className="hero-sky relative overflow-hidden rounded-3xl px-5 py-9 text-white shadow-xl sm:px-10 sm:py-12">
        <div className="absolute inset-0 opacity-30" style={STARFIELD} aria-hidden />
        <div className="relative max-w-2xl animate-fade-up motion-reduce:animate-none">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[12px] font-medium text-gold-200 backdrop-blur">
            <PenLine className="size-3.5" aria-hidden /> Sermon Studio
          </div>
          <h1 className="mt-4 font-display text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl">
            From notes to a <span className="bg-gradient-to-r from-gold-200 via-gold-300 to-gold-400 bg-clip-text text-transparent">finished sermon</span>.
          </h1>
          <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-white/75">
            Bring your notes, voice memos and Scripture. Polish them into a structured message, design slides and visuals, and share a beautiful page with your church.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <LinkButton to="/login" state={{ from }} className="h-11 gap-2 rounded-xl bg-gold-400 px-5 text-[15px] text-navy-900 hover:bg-gold-300">
              <LogIn className="size-4" /> Sign in to start
            </LinkButton>
            <LinkButton
              to="/signup"
              state={{ from }}
              variant="outline"
              className="h-11 rounded-xl border-white/25 bg-white/5 px-5 text-[15px] text-white hover:bg-white/10 hover:text-white dark:border-white/25 dark:bg-white/5 dark:hover:bg-white/10"
            >
              Create a free account
            </LinkButton>
          </div>
        </div>
      </section>
      <ol className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {FEATURES.map((f, i) => (
          <li key={f.title} className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-xs">
            <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-gold-400 to-gold-600 text-navy-900 shadow-md" aria-hidden>
              <f.icon className="size-5" />
            </span>
            <h2 className="mt-4 font-display text-lg font-semibold tracking-tight text-ink">
              <span className="mr-1.5 text-gold-600 dark:text-gold-300">{i + 1}.</span>
              {f.title}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{f.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className={cn(PAGE, "pt-4 pb-16 sm:pt-6 lg:pt-8")} aria-busy="true">
      <Skeleton className="h-64 rounded-3xl" />
      <Skeleton className="mt-6 h-40 rounded-3xl" />
      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
      <span className="sr-only" role="status">
        Loading Sermon Studio…
      </span>
    </div>
  );
}
