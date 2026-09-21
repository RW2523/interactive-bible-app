import {
  ArrowLeft, BookOpen, CalendarDays, ChevronDown, ExternalLink, FileText, Headphones, Layers, ListOrdered, Loader2, Lock, MapPin, Mic, MonitorPlay, Network, NotebookPen, Play,
  RefreshCw, Scissors, Settings2, Tags, Users, Video, type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../api/client";
import { useInvalidate, useResource, useResourceStatus, useSegments } from "../api/hooks";
import type { SegmentItem, YoutubeChapter } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { MediaPlayer, Transcript, type PlayerHandle } from "../components/MediaPlayer";
import { buttonClass, EmptyState, HelpTip, Skeleton } from "../components/page";
import { Switch } from "../components/ui/switch";
import { ErrorState, RelationshipBadge } from "../components/ui";
import { pushRecent } from "../lib/recent";
import { cn } from "../lib/utils";
import { isMessage, partLabel, partsSummary } from "../lib/parts";
import { chapterList, fmtYoutubeDate, isYoutubePlayback, resourceVideoId, youtubeWatchUrl } from "../lib/youtube";
import { fmtDuration, fmtTime, readHref } from "../utils/format";

const TYPE_META: Record<string, { label: string; icon: LucideIcon }> = {
  video: { label: "Video", icon: Video },
  audio: { label: "Audio", icon: Headphones },
  pdf: { label: "PDF", icon: FileText },
  document: { label: "Document", icon: FileText },
  article: { label: "Article", icon: NotebookPen },
  native: { label: "Note", icon: NotebookPen },
};
const CATEGORY: Record<string, string> = { sermon: "Sermon", podcast: "Podcast", study: "Study", devotional: "Devotional", article: "Article", lecture: "Lecture" };

function where(s: SegmentItem): string {
  if (s.start_ms != null) return `${fmtTime(s.start_ms)}–${fmtTime(s.end_ms)}`;
  if (s.page_start) return `Page ${s.page_start}${s.page_end && s.page_end !== s.page_start ? `–${s.page_end}` : ""}`;
  return `Section ${s.ordinal + 1}`;
}

export function ResourcePage() {
  const { id = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  const focusSegment = search.get("segment");
  const resource = useResource(id);
  const segments = useSegments(id);
  const { isEditor, viewer } = useAuth();
  const player = useRef<PlayerHandle>(null);
  const [now, setNow] = useState<number | undefined>();
  const [onlyMapped, setOnlyMapped] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const invalidate = useInvalidate();
  const canManage = !!resource.data?.can_edit;
  const status = useResourceStatus(id, canManage && ["queued", "processing"].includes(resource.data?.status || ""));

  useEffect(() => {
    if (!focusSegment || !segments.data) return;
    const el = document.getElementById(`seg-${focusSegment}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusSegment, segments.data]);

  useEffect(() => {
    if (status.data && resource.data && status.data.status !== resource.data.status) {
      invalidate("resource", "segments");
    }
  }, [status.data, resource.data, invalidate]);

  useEffect(() => {
    const r = resource.data;
    if (!r) return;
    document.title = `${r.title} · Interactive Bible App`;
    pushRecent({ kind: "resource", key: r.id, label: r.title, detail: [TYPE_META[r.type]?.label ?? r.type, r.speaker || r.author].filter(Boolean).join(" · "), href: `/resources/${r.id}` });
  }, [resource.data]);

  if (resource.error) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <ErrorState error={resource.error} onRetry={() => resource.refetch()} />
        <Link to="/library" className={buttonClass("ghost", "sm", "mt-4")}><ArrowLeft aria-hidden /> Back to the library</Link>
      </div>
    );
  }
  if (!resource.data) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 pt-8 sm:px-6 lg:px-8" aria-hidden>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-5 h-10 w-2/3" />
        <Skeleton className="mt-3 h-4 w-1/3" />
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1fr]">
          <Skeleton className="aspect-video rounded-2xl" />
          <div className="grid grid-cols-1 gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>
        </div>
      </div>
    );
  }

  const r = resource.data;
  const media = r.type === "video" || r.type === "audio";
  const hosted = isYoutubePlayback(r.playback); // plays in YouTube's own embed
  const videoId = resourceVideoId(r);
  const chapters = chapterList(r.youtube, r.duration_ms);
  const published = fmtYoutubeDate(r.youtube?.upload_date);
  const channel = r.youtube?.channel || r.author || null;
  const messageSpan = r.message && r.message.start_ms != null && r.message.end_ms != null ? { start_ms: r.message.start_ms, end_ms: r.message.end_ms } : null;
  const otherParts = partsSummary(r.message?.parts).filter((p) => p.label !== "Message");
  const allSegments = segments.data?.segments || [];
  const segs = allSegments.filter((s) => !onlyMapped || s.mappings.length > 0);
  const focus = allSegments.find((s) => s.id === focusSegment) || null;
  const typeMeta = TYPE_META[r.type] || { label: r.type, icon: FileText };
  const TypeIcon = typeMeta.icon;
  const mappingCount = allSegments.reduce((n, s) => n + s.mappings.length, 0);
  const run = status.data?.run;

  const jump = (s: SegmentItem) => {
    const next = new URLSearchParams(search);
    next.set("segment", s.id);
    setSearch(next, { replace: true, preventScrollReset: true });
    if (media && s.start_ms != null) player.current?.seek(s.clip?.start_ms ?? s.start_ms, true);
  };

  const reprocess = async () => {
    setReprocessing(true);
    try {
      await api(`/v1/resources/${id}/process`, { method: "POST", body: { reset_human: false, force: true } });
      toast.success("Processing started", { description: "Sections and Scripture links will refresh when it finishes. Reviewed links are kept." });
      invalidate("resource", "resource-status");
    } catch (e) {
      toast.error("Couldn't start processing", { description: (e as Error).message });
    } finally {
      setReprocessing(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-6 pb-16 sm:px-6 sm:pt-8 lg:px-8">
      <Link to="/library" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-3 no-underline hover:text-ink hover:no-underline">
        <ArrowLeft className="size-4" aria-hidden /> Library
      </Link>

      <header className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 max-w-3xl">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-500/25 bg-gold-50 px-2.5 py-1 font-semibold text-gold-700 dark:border-gold-400/20 dark:bg-gold-400/10 dark:text-gold-300">
              <TypeIcon className="size-3.5" aria-hidden /> {typeMeta.label}{CATEGORY[r.category] ? ` · ${CATEGORY[r.category]}` : ""}
            </span>
            {hosted && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 font-semibold text-ink-2 dark:bg-white/[0.07]" title="Plays in YouTube's own player">
                <MonitorPlay className="size-3.5" aria-hidden /> YouTube
              </span>
            )}
            {r.is_official && <span className="rounded-full bg-accent-soft px-2.5 py-1 font-semibold text-link">Official</span>}
            {r.visibility !== "public" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 font-semibold text-ink-2 dark:bg-white/[0.07]">
                <Lock className="size-3" aria-hidden /> {r.visibility === "private" ? "Private" : r.visibility}
              </span>
            )}
            {r.language && r.language !== "en" && <span className="rounded-full bg-surface-2 px-2.5 py-1 font-semibold text-ink-2 uppercase dark:bg-white/[0.07]">{r.language}</span>}
            {isEditor && <span className="rounded-full bg-surface-2 px-2.5 py-1 font-medium text-ink-3 dark:bg-white/[0.07]">Rights: {r.rights_status.replace(/_/g, " ")}</span>}
          </div>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-balance text-ink sm:text-4xl">{r.title}</h1>
          {hosted ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-ink-3">
              {[
                channel ? <span key="ch" className="font-medium text-ink-2">{channel}</span> : null,
                r.speaker && r.speaker !== channel ? <span key="sp">{r.speaker}</span> : null,
                r.series ? <span key="se">{r.series}</span> : null,
                r.duration_ms ? <span key="du" className="tabular-nums">{fmtTime(r.duration_ms)}</span> : null,
                published ? (
                  <span key="pu" className="inline-flex items-center gap-1.5">
                    <CalendarDays className="size-3.5" aria-hidden /> {published}
                  </span>
                ) : null,
              ]
                .filter(Boolean)
                .map((node, i) => (
                  <span key={i} className="inline-flex items-center gap-2">
                    {i > 0 && <span aria-hidden>·</span>}
                    {node}
                  </span>
                ))}
            </p>
          ) : (
            <p className="mt-2 text-[15px] text-ink-3">
              {[r.speaker, r.author, r.series, r.duration_ms ? fmtDuration(r.duration_ms) : r.page_count ? `${r.page_count} pages` : null].filter(Boolean).join(" · ")}
            </p>
          )}
          {messageSpan && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-full bg-gold-50 px-3 py-1.5 font-semibold text-gold-700 transition hover:bg-gold-100 dark:bg-gold-400/12 dark:text-gold-200 dark:hover:bg-gold-400/20"
                onClick={() => media && messageSpan.start_ms != null && player.current?.seek(messageSpan.start_ms, true)}
                title={r.message?.reason || undefined}
              >
                <Mic className="size-3.5" aria-hidden />
                Message {fmtTime(messageSpan.start_ms)}–{fmtTime(messageSpan.end_ms)}
                {media && <span className="font-normal text-gold-600/80 dark:text-gold-300/70">· play</span>}
              </button>
              {otherParts.length > 0 && (
                <span className="text-ink-3">
                  Rest of the recording: {otherParts.map((p) => `${p.label} (${p.count})`).join(" · ")} — not mapped to verses
                </span>
              )}
            </div>
          )}
          {r.description && <p className="mt-3 text-[15px]/relaxed text-ink-2">{r.description}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {hosted && videoId && (
            <a className={buttonClass("secondary")} href={youtubeWatchUrl(videoId)} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden /> Watch on YouTube
            </a>
          )}
          <Link className={buttonClass("secondary")} to={`/map?root=resource:${r.id}`}>
            <Network aria-hidden /> See connections
          </Link>
          {canManage && (
            <button type="button" className={buttonClass("secondary")} onClick={reprocess} disabled={reprocessing || ["queued", "processing"].includes(r.status)}>
              {reprocessing ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />} Reprocess
            </button>
          )}
          {isEditor && (
            <Link className={buttonClass("ghost")} to={`/admin/resources/${r.id}`}>
              <Settings2 aria-hidden /> Manage
            </Link>
          )}
        </div>
      </header>

      {canManage && run && ["queued", "running"].includes(run.status) && (
        <div className="mb-6 rounded-2xl border border-accent-soft bg-accent-soft/60 px-4 py-3.5" role="status">
          <div className="flex items-center gap-2 text-sm font-medium text-link">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Processing — {String(run.current_stage || "waiting to start").replace(/_/g, " ")}
            <span className="ml-auto tabular-nums">{Math.round((status.data?.progress || 0) * 100)}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-card">
            <div className="h-full rounded-full bg-gold-500 transition-all" style={{ width: `${Math.round((status.data?.progress || 0) * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-ink-3">You can leave this page — processing continues in the background.</p>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* left: player + index */}
        <div className="grid grid-cols-1 gap-5 lg:sticky lg:top-[calc(var(--header-h)+20px)] lg:max-h-[calc(100dvh-var(--header-h)-40px)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
          {media ? (
            <div className="grid grid-cols-1 gap-2">
              <MediaPlayer ref={player} playback={r.playback} clip={focus?.clip || null} durationMs={r.duration_ms} title={r.title} onTime={setNow} />
              {focus && (
                <p className="text-[13px] text-ink-3">
                  {hosted ? "Playing" : "Focused on"} <span className="font-medium text-ink-2">{focus.heading || `section ${focus.ordinal + 1}`}</span> · {where(focus)}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-xs dark:bg-white/[0.03]">
              <div className="flex items-center gap-3">
                <span className="grid grid-cols-1 size-11 place-items-center rounded-xl bg-gold-50 text-gold-700 dark:bg-gold-400/10 dark:text-gold-300"><TypeIcon className="size-5" aria-hidden /></span>
                <div>
                  <p className="font-semibold text-ink">{typeMeta.label}</p>
                  <p className="text-[13px] text-ink-3">{allSegments.length} section{allSegments.length === 1 ? "" : "s"} · {mappingCount} Scripture link{mappingCount === 1 ? "" : "s"}</p>
                </div>
              </div>
              <p className="mt-3 text-sm/relaxed text-ink-2">
                The text is split into sections{r.type === "pdf" ? " (pages are read directly; scanned pages use text recognition)" : ""}. Each Scripture link opens the exact section.
              </p>
              {(r.playback.document_url || r.source_url) && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {r.playback.document_url && <a className={buttonClass("secondary", "sm")} href={r.playback.document_url} target="_blank" rel="noreferrer"><ExternalLink aria-hidden /> Open original</a>}
                  {r.source_url && <a className={buttonClass("ghost", "sm")} href={r.source_url} target="_blank" rel="noreferrer"><ExternalLink aria-hidden /> Source website</a>}
                </div>
              )}
            </div>
          )}

          {media && chapters.length > 0 && (
            <ChapterCard chapters={chapters} nowMs={now} onPlay={(ms) => player.current?.seek(ms, true)} hosted={hosted} />
          )}

          <section className="rounded-2xl border border-border bg-card shadow-xs dark:bg-white/[0.03]" aria-labelledby="verse-index">
            <div className="flex items-center gap-1.5 border-b border-border px-5 py-3.5">
              <h2 id="verse-index" className="font-display text-lg font-semibold text-ink">
                {media ? "Verse clips" : `Scripture in this ${typeMeta.label.toLowerCase()}`}
              </h2>
              <HelpTip label={media ? "Verse clips" : "Scripture links"}>
                Verses this resource talks about, found automatically and checked by editors where marked “Human verified”.{" "}
                {media
                  ? hosted
                    ? "“Play this moment” starts the YouTube player where the verse is discussed."
                    : "“Play this moment” jumps the player to where the verse is discussed."
                  : "Choose Show to open the section it comes from."}
              </HelpTip>
              <span className="ml-auto text-sm text-ink-3">{mappingCount}</span>
            </div>
            <VerseIndex segments={allSegments} media={media} onJump={jump} loading={segments.isLoading} focusSegment={focusSegment} />
            {(r.topics.length > 0 || r.entities.length > 0) && (
              <div className="grid grid-cols-1 gap-4 border-t border-border px-5 py-4">
                {r.topics.length > 0 && (
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.1em] text-ink-3 uppercase"><Tags className="size-3.5" aria-hidden /> Themes</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {r.topics.map((t) => (
                        <Link key={t.id} to={`/map?root=topic:${t.slug}`} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[13px] font-medium text-ink-2 no-underline transition hover:bg-surface-2 hover:text-ink hover:no-underline dark:bg-white/[0.04]">
                          {t.name} <span className="text-xs text-ink-3 tabular-nums">{t.segments}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
                {r.entities.length > 0 && (
                  <div>
                    <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.1em] text-ink-3 uppercase"><Users className="size-3.5" aria-hidden /> People, places & events</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {r.entities.map((e) => (
                        <Link key={e.id} to={`/map?root=entity:${e.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[13px] font-medium text-ink-2 no-underline transition hover:bg-surface-2 hover:text-ink hover:no-underline dark:bg-white/[0.04]">
                          {e.type === "place" ? <MapPin className="size-3.5 text-ink-3" aria-hidden /> : <Users className="size-3.5 text-ink-3" aria-hidden />} {e.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        {/* right: sections */}
        <section aria-labelledby="sections-title" className="grid grid-cols-1 gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="sections-title" className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
              <Layers className="size-5 text-gold-600 dark:text-gold-400" aria-hidden /> Sections <span className="font-sans text-sm font-normal text-ink-3">{segments.data ? allSegments.length : ""}</span>
            </h2>
            <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-ink-2">
              <Switch checked={onlyMapped} onCheckedChange={(v) => setOnlyMapped(v)} aria-label="Only sections with Scripture" />
              Only sections with Scripture
            </label>
          </div>
          {segments.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
          {segments.error && <ErrorState error={segments.error} onRetry={() => segments.refetch()} />}
          {segments.data && segs.length === 0 && (
            <EmptyState
              compact
              icon={Layers}
              title={onlyMapped ? "No sections with Scripture" : "No sections yet"}
              description={onlyMapped ? "Turn off the filter to see every section." : canManage ? "Process this resource to split it into sections and find the Scripture it discusses." : "This resource hasn't been processed yet."}
              action={canManage && !onlyMapped ? <button type="button" className={buttonClass("primary", "sm")} onClick={reprocess}><RefreshCw aria-hidden /> Process now</button> : undefined}
            />
          )}
          {otherParts.length > 0 && (
            <p className="-mt-1 text-[13px] text-ink-3">
              Only the message is mapped to verses and clipped. Songs, welcome and announcements are labelled and left as they are.
            </p>
          )}
          {segs.map((s) => (
            <SectionCard
              key={s.id}
              s={s}
              media={media}
              hosted={hosted}
              focused={s.id === focusSegment}
              isEditor={isEditor}
              now={media ? now : undefined}
              onJump={() => jump(s)}
              onSeek={media ? (ms) => player.current?.seek(ms, true) : undefined}
            />
          ))}
          {viewer && !viewer.authenticated && <p className="text-xs text-ink-3">Sign in to see resources shared with your church or organization.</p>}
        </section>
      </div>
    </div>
  );
}

function SectionCard({ s, media, hosted, focused, isEditor, now, onJump, onSeek }: {
  s: SegmentItem; media: boolean; hosted: boolean; focused: boolean; isEditor: boolean; now?: number; onJump: () => void; onSeek?: (ms: number) => void;
}) {
  const [open, setOpen] = useState(focused);
  useEffect(() => {
    if (focused) setOpen(true);
  }, [focused]);
  return (
    <article
      id={`seg-${s.id}`}
      className={cn(
        "scroll-mt-[calc(var(--header-h)+16px)] rounded-2xl border bg-card p-4 shadow-xs transition sm:p-5 dark:bg-white/[0.03]",
        focused ? "border-gold-500/60 ring-3 ring-gold-400/20" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 font-semibold text-ink">
            {s.heading || `Section ${s.ordinal + 1}`}
            {!isMessage(s.part) && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-ink-3 dark:bg-white/[0.07]">{partLabel(s.part)}</span>
            )}
          </h3>
          <p className="mt-0.5 text-[13px] text-ink-3 tabular-nums">
            {where(s)}
            {s.speaker ? ` · ${s.speaker}` : ""}
          </p>
        </div>
        <button type="button" className={buttonClass(focused ? "primary" : "secondary", "sm")} onClick={onJump}>
          {media ? <Play className="fill-current" aria-hidden /> : <BookOpen aria-hidden />}
          {media ? "Play from here" : "Focus"}
        </button>
      </div>
      {s.summary && <p className="mt-2.5 text-sm/relaxed text-ink-2">{s.summary}</p>}
      {s.mappings.length > 0 && (
        <ul className="mt-3 grid grid-cols-1 gap-2">
          {s.mappings.map((m) => (
            <li key={m.mapping_id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-xl bg-surface-2/50 px-3 py-2 dark:bg-white/[0.03]">
              <Link to={readHref(m.verse_ref)} className="font-display font-semibold text-ink no-underline decoration-gold-500/60 underline-offset-4 hover:underline">{m.verse_display}</Link>
              <RelationshipBadge rel={m.relationship} />
              {m.mention_count > 1 && <span className="text-xs text-ink-3">{m.mention_count} mentions</span>}
              {isEditor && m.review_status && m.review_status !== "published" && m.review_status !== "approved" && (
                <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn">{m.review_status.replace(/_/g, " ")}</span>
              )}
              <span className="ml-auto flex items-center gap-2">
                {media && onSeek && (
                  <button
                    type="button"
                    className={buttonClass("ghost", "sm", "max-sm:h-10 max-sm:px-3")}
                    onClick={() => onSeek((m.evidence_offsets || []).find((o) => o.start_ms != null)?.start_ms ?? s.clip?.start_ms ?? s.start_ms ?? 0)}
                    title={hosted ? "Restarts the YouTube player where this verse is discussed" : "Plays where this verse is discussed"}
                  >
                    <Play className="fill-current" aria-hidden /> Play this moment
                  </button>
                )}
                {isEditor && <Link className="text-xs font-medium text-link" to={`/admin/review/${m.mapping_id}`}>Review</Link>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {s.topics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {s.topics.slice(0, 5).map((t) => <span key={t.slug} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-medium text-ink-2 dark:bg-white/[0.06]">{t.name}</span>)}
        </div>
      )}
      <div className="mt-3 border-t border-border pt-2.5">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-link">
          {open ? "Hide" : "Show"} {media ? "transcript" : "text"} <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
        {open && (
          <div className="mt-3">
            <Transcript
              text={s.text}
              units={s.units}
              highlights={s.mappings.flatMap((m) => m.evidence_offsets || [])}
              nowMs={now}
              onSeek={onSeek}
              maxHeight={420}
              seekLabel={hosted ? "Play from" : "Jump to"}
            />
            {s.mappings.some((m) => (m.evidence_offsets || []).length > 0) && (
              <p className="mt-2 text-xs text-ink-3">
                Highlighted words are where the Scripture is mentioned{onSeek ? (hosted ? " · tap a sentence and the YouTube player starts there" : " · tap a sentence to play from there") : ""}.
              </p>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/** The video's own chapters: a way into a long service without hunting through the timeline. */
function ChapterCard({ chapters, nowMs, onPlay, hosted }: { chapters: YoutubeChapter[]; nowMs?: number; onPlay: (ms: number) => void; hosted: boolean }) {
  const [open, setOpen] = useState(true);
  const activeIndex = nowMs === undefined ? -1 : chapters.findIndex((c) => nowMs >= c.start_ms && (c.end_ms == null || nowMs < c.end_ms));
  return (
    <section className="rounded-2xl border border-border bg-card shadow-xs dark:bg-white/[0.03]" aria-labelledby="chapters-title">
      <div className="flex items-center gap-1.5 border-b border-border px-5 py-3.5">
        <ListOrdered className="size-[18px] text-gold-600 dark:text-gold-400" aria-hidden />
        <h2 id="chapters-title" className="font-display text-lg font-semibold text-ink">Chapters</h2>
        <HelpTip label="Chapters">
          The chapters the speaker set on YouTube. {hosted ? "Choosing one restarts the YouTube player at that moment." : "Choosing one jumps the player to that moment."}
        </HelpTip>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="ml-auto inline-flex items-center gap-1 text-[13px] font-semibold text-link">
          {chapters.length} <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </div>
      {open && (
        <ul className="max-h-[260px] divide-y divide-border overflow-y-auto">
          {chapters.map((c, i) => (
            <li key={`${c.start_ms}-${i}`}>
              <button
                type="button"
                onClick={() => onPlay(c.start_ms)}
                className={cn(
                  "flex w-full items-center gap-3 px-5 py-2.5 text-left transition hover:bg-surface-2/70 dark:hover:bg-white/[0.04]",
                  i === activeIndex && "bg-gold-50/70 dark:bg-gold-400/[0.08]",
                )}
              >
                <span className="w-14 shrink-0 text-xs font-semibold text-ink-3 tabular-nums">{fmtTime(c.start_ms)}</span>
                <span className={cn("min-w-0 flex-1 truncate text-sm", i === activeIndex ? "font-semibold text-ink" : "text-ink-2")}>{c.title}</span>
                <Play className="size-3.5 shrink-0 fill-current text-ink-3" aria-hidden />
                <span className="sr-only">Play from {fmtTime(c.start_ms)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function VerseIndex({
  segments, media, onJump, loading, focusSegment,
}: {
  segments: SegmentItem[];
  media: boolean;
  onJump: (s: SegmentItem) => void;
  loading: boolean;
  focusSegment?: string | null;
}) {
  const rows = segments.flatMap((s) => s.mappings.map((m) => ({ s, m })));
  if (loading) return <div className="grid grid-cols-1 gap-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>;
  if (!rows.length) return <p className="px-5 py-6 text-sm text-ink-3">No Scripture links are visible yet.</p>;
  return (
    <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">
      {rows.map(({ s, m }) => {
        const clipLength = media && s.clip ? fmtDuration(s.clip.end_ms - s.clip.start_ms) : null;
        return (
          <li
            key={m.mapping_id}
            className={cn("grid grid-cols-1 gap-1.5 px-5 py-3 transition", s.id === focusSegment && "bg-gold-50/70 dark:bg-gold-400/[0.07]")}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Link to={readHref(m.verse_ref)} className="font-display font-semibold text-ink no-underline decoration-gold-500/60 underline-offset-4 hover:underline">
                {m.verse_display}
              </Link>
              <RelationshipBadge rel={m.relationship} showConfidence={false} />
              <span className="ml-auto text-xs text-ink-3 tabular-nums">
                {s.start_ms != null ? fmtTime(s.clip?.start_ms ?? s.start_ms) : s.page_start ? `p. ${s.page_start}` : `§${s.ordinal + 1}`}
                {clipLength ? ` · ${clipLength}` : ""}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={buttonClass(s.id === focusSegment ? "primary" : "secondary", "sm", "max-sm:h-10 max-sm:px-3.5")}
                onClick={() => onJump(s)}
                aria-label={`${media ? "Play the moment" : "Show the section"} for ${m.verse_display}`}
              >
                {media ? <Play className="fill-current" aria-hidden /> : <BookOpen aria-hidden />} {media ? "Play this moment" : "Show"}
              </button>
              {media && s.clip && (
                <Link to={`/clip/${s.id}?ref=${encodeURIComponent(m.verse_ref)}`} className={buttonClass("ghost", "sm", "max-sm:h-10 max-sm:px-3")}>
                  <Scissors aria-hidden /> Open clip
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
