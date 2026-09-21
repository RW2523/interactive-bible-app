import { ArrowRight, BookOpen, FileText, Headphones, Layers, Library, Loader2, Lock, MonitorPlay, NotebookPen, Plus, Search, SearchX, Upload, Video, X, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useResources } from "../api/hooks";
import type { Json } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { MediaThumb } from "../components/MediaThumb";
import { buttonClass, EmptyState, FilterChip, PageContainer, PageHeader, Skeleton } from "../components/page";
import { ErrorState } from "../components/ui";
import { cn } from "../lib/utils";
import { thumbnailFor } from "../lib/youtube";
import { fmtDuration, fmtTime } from "../utils/format";

const TYPES: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "video", label: "Video", icon: Video },
  { id: "audio", label: "Audio", icon: Headphones },
  { id: "pdf", label: "PDF", icon: FileText },
  { id: "document", label: "Document", icon: FileText },
  { id: "article", label: "Article", icon: NotebookPen },
  { id: "native", label: "Notes", icon: NotebookPen },
];
const TYPE_META: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  video: { label: "Video", icon: Video, tone: "bg-navy-700 text-white dark:bg-white/[0.08] dark:text-gold-200" },
  audio: { label: "Audio", icon: Headphones, tone: "bg-rel-quote/10 text-rel-quote" },
  pdf: { label: "PDF", icon: FileText, tone: "bg-gold-50 text-gold-700 dark:bg-gold-400/10 dark:text-gold-300" },
  document: { label: "Document", icon: FileText, tone: "bg-gold-50 text-gold-700 dark:bg-gold-400/10 dark:text-gold-300" },
  article: { label: "Article", icon: NotebookPen, tone: "bg-surface-2 text-ink-2 dark:bg-white/[0.07]" },
  native: { label: "Note", icon: NotebookPen, tone: "bg-surface-2 text-ink-2 dark:bg-white/[0.07]" },
};
const CATEGORY: Record<string, string> = { sermon: "Sermon", podcast: "Podcast", study: "Study", devotional: "Devotional", article: "Article", lecture: "Lecture" };
const STATUS: Record<string, string> = { queued: "Waiting to process", processing: "Processing…", failed: "Processing failed", draft: "Draft" };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function LibraryPage() {
  const [text, setText] = useState("");
  const [type, setType] = useState("");
  const [mine, setMine] = useState(false);
  const { viewer } = useAuth();
  const q = useDebounced(text.trim(), 250);
  const res = useResources({ q: q || undefined, type: type || undefined, mine: mine || undefined, page_size: 60 });
  const items: Json[] = res.data?.items ?? [];
  const filtered = !!(q || type || mine);
  const clear = () => {
    setText("");
    setType("");
    setMine(false);
  };

  return (
    <PageContainer size="wide">
      <PageHeader
        eyebrow="Library"
        icon={Library}
        title="Your library"
        description="Sermons, podcasts, studies and articles — each one linked to the Bible verses it talks about, so they appear while you read."
        actions={
          viewer?.authenticated ? (
            <Link className={buttonClass("primary")} to="/admin/ingest">
              <Plus aria-hidden /> Add to library
            </Link>
          ) : null
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-3">
        <div className="flex items-center gap-3">
          <div className="relative min-w-0 flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Search titles, speakers, authors"
              aria-label="Search the library"
              className="h-11 w-full rounded-xl border border-input bg-card pr-10 pl-10 text-[15px] text-ink shadow-xs outline-none placeholder:text-ink-3 focus:border-ring focus:ring-3 focus:ring-ring/40 dark:bg-white/[0.04]"
            />
            {res.isFetching && q ? (
              <Loader2 className="absolute top-1/2 right-3.5 size-4 -translate-y-1/2 animate-spin text-ink-3" aria-hidden />
            ) : text ? (
              <button type="button" onClick={() => setText("")} className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Clear search">
                <X className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>
          {res.data && (
            <p className="ml-auto shrink-0 text-sm whitespace-nowrap text-ink-3" aria-live="polite">
              {res.data.total ?? items.length} item{(res.data.total ?? items.length) === 1 ? "" : "s"}
            </p>
          )}
        </div>
        <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Filter by type">
          <FilterChip active={!type} onClick={() => setType("")}>All</FilterChip>
          {TYPES.map((t) => (
            <FilterChip key={t.id} icon={t.icon} active={type === t.id} onClick={() => setType(type === t.id ? "" : t.id)}>
              {t.label}
            </FilterChip>
          ))}
          {viewer?.authenticated && (
            <>
              <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
              <FilterChip variant="soft" icon={Lock} active={mine} onClick={() => setMine((m) => !m)}>
                Added by me
              </FilterChip>
            </>
          )}
        </div>
      </div>

      {res.error && <ErrorState error={res.error} onRetry={() => res.refetch()} />}

      {res.isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-2xl" />)}
        </div>
      )}

      {res.data && items.length === 0 && (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title="Nothing matches these filters"
            description={q ? `No titles, speakers or authors match “${q}”.` : "Try another type, or show everything."}
            action={<button type="button" onClick={clear} className={buttonClass("secondary", "sm")}>Clear filters</button>}
          />
        ) : (
          <EmptyState
            icon={Library}
            title="Your library is empty"
            description="Add a sermon video, podcast, PDF study or article. The app finds the verses it discusses and links them to the reader."
            action={<Link to="/admin/ingest" className={buttonClass("primary", "sm")}><Upload aria-hidden /> Add your first resource</Link>}
          />
        )
      )}

      {items.length > 0 && (
        <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3", res.isPlaceholderData && "opacity-70 transition-opacity")}>
          {items.map((r) => <LibraryCard key={r.id} r={r} />)}
        </div>
      )}
    </PageContainer>
  );
}

function LibraryCard({ r }: { r: Json }) {
  const meta = TYPE_META[r.type] || { label: r.type, icon: FileText, tone: "bg-surface-2 text-ink-2" };
  const Icon = meta.icon;
  const who = [...new Set([r.speaker, r.author].filter(Boolean) as string[])].join(" · ");
  const status = r.status !== "processed" ? STATUS[r.status] || r.status : null;
  const videoId: string | null = r.youtube?.video_id ?? null;
  const still = thumbnailFor({ thumbnail_url: r.thumbnail_url, youtube_id: videoId });
  // the still already carries the length in its corner
  const length = still ? null : r.duration_ms ? fmtDuration(r.duration_ms) : r.page_count ? `${r.page_count} pages` : null;
  return (
    <Link
      to={`/resources/${r.id}`}
      className="group flex flex-col rounded-2xl border border-border bg-card p-5 no-underline shadow-xs transition hover:border-gold-500/40 hover:no-underline hover:shadow-md dark:bg-white/[0.03] dark:hover:border-gold-400/30"
    >
      {still && (
        <MediaThumb
          src={still}
          videoId={videoId}
          alt=""
          kind={r.type === "audio" ? "listen" : "watch"}
          time={r.duration_ms ? fmtTime(r.duration_ms) : undefined}
          youtube={!!videoId}
          className="mb-4 aspect-video w-full"
        />
      )}
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex items-center gap-2.5">
          {!still && (
            <span className={cn("grid grid-cols-1 size-10 shrink-0 place-items-center rounded-xl", meta.tone)}>
              <Icon className="size-5" aria-hidden />
            </span>
          )}
          <span className="text-xs leading-tight">
            <span className="block font-semibold text-ink-2">
              {meta.label}
              {CATEGORY[r.category] && !still ? "" : CATEGORY[r.category] ? ` · ${CATEGORY[r.category]}` : ""}
            </span>
            {CATEGORY[r.category] && !still && <span className="block text-ink-3">{CATEGORY[r.category]}</span>}
            {videoId && (
              <span className="mt-0.5 inline-flex items-center gap-1 text-ink-3">
                <MonitorPlay className="size-3" aria-hidden /> YouTube
              </span>
            )}
          </span>
        </span>
        <span className="flex flex-wrap justify-end gap-1.5">
          {r.is_official && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-link">Official</span>}
          {r.visibility && r.visibility !== "public" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-ink-2 dark:bg-white/[0.07]" title="Only you (or your organization) can see this">
              <Lock className="size-3" aria-hidden /> {r.visibility === "private" ? "Private" : r.visibility}
            </span>
          )}
        </span>
      </div>
      <h2 className="mt-4 line-clamp-2 text-[17px] leading-snug font-semibold text-ink">{r.title}</h2>
      {(who || length) && <p className="mt-1 truncate text-[13px] text-ink-3">{[who, length].filter(Boolean).join(" · ")}</p>}
      {r.description && <p className="mt-2.5 line-clamp-2 flex-1 text-sm/relaxed text-ink-2">{r.description}</p>}
      <div className="mt-4 flex items-center gap-3 border-t border-border pt-3.5 text-[13px]">
        {status ? (
          <span className={cn("inline-flex items-center gap-1.5 font-medium", r.status === "failed" ? "text-danger" : "text-warn")}>
            {r.status === "processing" && <Loader2 className="size-3.5 animate-spin" aria-hidden />} {status}
          </span>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5 font-medium text-gold-700 dark:text-gold-300">
              <BookOpen className="size-3.5" aria-hidden /> {r.visible_mappings ?? 0} linked verse{r.visible_mappings === 1 ? "" : "s"}
            </span>
            <span className="inline-flex items-center gap-1.5 text-ink-3">
              <Layers className="size-3.5" aria-hidden /> {r.segment_count ?? 0} section{r.segment_count === 1 ? "" : "s"}
            </span>
          </>
        )}
        <ArrowRight className="ml-auto size-4 text-ink-3 transition group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />
      </div>
    </Link>
  );
}
