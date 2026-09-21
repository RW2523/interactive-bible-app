import {
  ArrowLeft, ArrowRight, BadgeCheck, BookOpen, ChevronDown, Download, ExternalLink, FileText, Headphones, Info, Layers, Loader2, MonitorPlay, PlayCircle, Scissors, Sparkles,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../api/client";
import { useClip } from "../api/hooks";
import type { ClipDetails, Json } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { FeedbackMenu } from "../components/FeedbackMenu";
import { MediaPlayer, Transcript, type PlayerHandle } from "../components/MediaPlayer";
import { MediaThumb } from "../components/MediaThumb";
import { buttonClass, HelpTip, Skeleton } from "../components/page";
import { ErrorState, Modal, RelationshipBadge } from "../components/ui";
import { cn } from "../lib/utils";
import { isYoutubePlayback, youtubeWatchUrl } from "../lib/youtube";
import { fmtDuration, fmtTime, readHref } from "../utils/format";

const CATEGORY: Record<string, string> = { sermon: "Sermon", podcast: "Podcast", study: "Study", devotional: "Devotional", article: "Article", lecture: "Lecture" };

export function ClipModal() {
  const { segmentId = "" } = useParams();
  const navigate = useNavigate();
  const q = useClip(segmentId);
  const d = q.data;
  const TypeIcon = d?.resource.type === "audio" ? Headphones : d?.resource.type === "video" ? PlayCircle : FileText;
  const videoId = d?.playback.youtube_id || d?.resource.youtube_id || null;
  return (
    <Modal
      title={
        d ? (
          <span className="flex min-w-0 items-center gap-2.5">
            {videoId ? (
              <MediaThumb src={d.resource.thumbnail_url} videoId={videoId} alt="" badgeSize="sm" className="aspect-video w-14 shrink-0 rounded-lg" />
            ) : (
              <span className="grid grid-cols-1 size-8 shrink-0 place-items-center rounded-lg bg-gold-50 text-gold-700 dark:bg-gold-400/10 dark:text-gold-300"><TypeIcon className="size-4" aria-hidden /></span>
            )}
            <span className="truncate">{d.resource.title}</span>
          </span>
        ) : (
          "Clip"
        )
      }
      onClose={() => navigate(-1)}
      wide
    >
      <div className="p-4 sm:p-6">
        <ClipBody segmentId={segmentId} />
      </div>
    </Modal>
  );
}

export function ClipPage() {
  const { segmentId = "" } = useParams();
  const q = useClip(segmentId);
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-6 pb-16 sm:px-6 sm:pt-8 lg:px-8">
      <Link to={q.data ? `/resources/${q.data.resource.id}?segment=${segmentId}` : "/library"} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-3 no-underline hover:text-ink hover:no-underline">
        <ArrowLeft className="size-4" aria-hidden /> {q.data ? "Full resource" : "Library"}
      </Link>
      <ClipBody segmentId={segmentId} standalone />
    </div>
  );
}

function ClipBody({ segmentId, standalone }: { segmentId: string; standalone?: boolean }) {
  const q = useClip(segmentId);
  const [search] = useSearchParams();
  const focusRef = search.get("ref");
  const player = useRef<PlayerHandle>(null);
  const [now, setNow] = useState<number | undefined>(undefined);
  const [showTranscript, setShowTranscript] = useState(true);
  const location = useLocation();
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (q.isLoading || !q.data) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" aria-hidden>
        <div className="grid grid-cols-1 gap-3"><Skeleton className="aspect-video rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /></div>
        <div className="grid grid-cols-1 gap-3"><Skeleton className="h-48 rounded-2xl" /><Skeleton className="h-56 rounded-2xl" /></div>
      </div>
    );
  }
  const d = q.data;
  const highlights = d.verses.flatMap((v) => v.evidence_offsets || []);
  const media = d.resource.type === "video" || d.resource.type === "audio";
  const focus = d.verses.find((v) => v.ref === focusRef) || d.primary_verse;
  const who = d.resource.speaker || d.resource.author;
  const reviewed = d.clip.review_status === "approved" || d.clip.review_status === "edited";
  const hosted = isYoutubePlayback(d.playback);
  const videoId = d.playback.youtube_id || d.resource.youtube_id || null;

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="grid grid-cols-1 gap-4">
        {standalone && (
          <header>
            <p className="text-xs font-semibold tracking-[0.12em] text-gold-700 uppercase dark:text-gold-300">{[CATEGORY[d.resource.category], media ? "Clip" : "Section"].filter(Boolean).join(" · ")}</p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-balance text-ink">{d.resource.title}</h1>
            {who && <p className="mt-1.5 text-[15px] text-ink-3">{who}</p>}
          </header>
        )}
        {media ? (
          <MediaPlayer
            ref={player}
            playback={d.playback}
            clip={d.clip}
            durationMs={d.resource.duration_ms}
            title={d.resource.title}
            onTime={setNow}
            // opened from a “Play this moment” card, so start the clip; a shared /clip link waits for the play button
            autoPlay={hosted && !standalone}
          />
        ) : (
          <div className="flex gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 text-sm text-ink-2 dark:bg-white/[0.03]">
            <FileText className="mt-0.5 size-[18px] shrink-0 text-gold-600 dark:text-gold-400" aria-hidden />
            <p>A section of a written resource{d.segment.page_start ? ` (page ${d.segment.page_start})` : ""}. The linked Scripture and the full text are on the right.</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
          {!standalone && who && <span className="font-medium text-ink-2">{who}</span>}
          {!standalone && CATEGORY[d.resource.category] && <span>· {CATEGORY[d.resource.category]}</span>}
          {hosted && (
            <span className="inline-flex items-center gap-1.5 font-medium text-ink-2" title="Plays in YouTube's own player">
              <MonitorPlay className="size-3.5" aria-hidden /> YouTube
            </span>
          )}
          {reviewed && (
            <span className="rel rel-human" title="An editor checked where this clip starts and ends"><BadgeCheck aria-hidden /> Clip reviewed</span>
          )}
        </div>

        {(d.segment.summary || d.clip.reason) && (
          <div className="rounded-2xl border border-border bg-card p-4 shadow-xs dark:bg-white/[0.03]">
            {d.segment.summary && <p className="text-[15px]/relaxed text-ink">{d.segment.summary}</p>}
            {d.clip.reason && (
              <p className={cn("flex gap-2 text-[13px]/relaxed text-ink-3", d.segment.summary && "mt-2.5 border-t border-border pt-2.5")}>
                <Scissors className="mt-0.5 size-3.5 shrink-0" aria-hidden /> <span><span className="font-semibold text-ink-2">Why this clip: </span>{d.clip.reason}</span>
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/resources/${d.resource.id}?segment=${d.segment_id}`} className={buttonClass("secondary", "sm", "max-sm:h-10 max-sm:px-3.5")}>
            <Layers aria-hidden /> Full resource & all sections
          </Link>
          {hosted && videoId && (
            <a className={buttonClass("ghost", "sm", "max-sm:h-10 max-sm:px-3.5")} href={youtubeWatchUrl(videoId, d.clip.start_ms)} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden /> Watch the full video on YouTube
            </a>
          )}
          <ExportButton d={d} />
          <span className="flex-1" />
          {d.navigation.previous_segment && (
            <Link className={buttonClass("ghost", "sm", "max-sm:h-10 max-sm:px-3.5")} to={`/clip/${d.navigation.previous_segment}`} state={location.state} replace>
              <ArrowLeft aria-hidden /> Previous
            </Link>
          )}
          {d.navigation.next_segment && (
            <Link className={buttonClass("ghost", "sm", "max-sm:h-10 max-sm:px-3.5")} to={`/clip/${d.navigation.next_segment}`} state={location.state} replace>
              Next <ArrowRight aria-hidden />
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <section className="rounded-2xl border border-border bg-card shadow-xs dark:bg-white/[0.03]" aria-labelledby="clip-scripture">
          <div className="flex items-center gap-1.5 border-b border-border px-4 py-3">
            <BookOpen className="size-[18px] text-gold-600 dark:text-gold-400" aria-hidden />
            <h2 id="clip-scripture" className="font-display text-lg font-semibold text-ink">Linked Scripture</h2>
            <HelpTip label="Linked Scripture">The verses this {media ? "clip" : "section"} talks about. Highlighted words in the transcript show where each one is mentioned.</HelpTip>
            <span className="ml-auto" />
            <FeedbackMenu objectType="segment" objectId={d.segment_id} />
          </div>
          {d.verses.length === 0 && <p className="px-4 py-5 text-sm text-ink-3">No published Scripture links for this section yet.</p>}
          <ul className="divide-y divide-border">
            {d.verses.map((v) => (
              <li key={v.mapping_id} className={cn("grid grid-cols-1 gap-2 px-4 py-3.5", focus?.mapping_id === v.mapping_id && "bg-gold-50/60 dark:bg-gold-400/[0.06]")}>
                <div className="flex items-start justify-between gap-2">
                  <Link to={readHref(v.ref)} className="font-display text-[17px] font-semibold text-ink no-underline decoration-gold-500/60 underline-offset-4 hover:underline">
                    {v.display_ref}
                  </Link>
                  <span className="flex items-center gap-1">
                    {v.primary && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-link">Main passage</span>}
                    <FeedbackMenu objectType="mapping" objectId={v.mapping_id} />
                  </span>
                </div>
                {v.text && <p className="font-serif text-[15px]/relaxed text-ink-2">{v.text}</p>}
                <RelationshipBadge rel={v.relationship} />
                {v.why_related && (
                  <p className="flex gap-2 text-[13px]/relaxed text-ink-2">
                    <Sparkles className="mt-0.5 size-3.5 shrink-0 text-rel-ai" aria-hidden /> <span><span className="font-semibold">Why related? </span>{v.why_related}</span>
                  </p>
                )}
                {v.evidence_text && <p className="scripture-quote text-[13.5px]/relaxed text-ink-3 italic">“{v.evidence_text.slice(0, 220)}{v.evidence_text.length > 220 ? "…" : ""}”</p>}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-border bg-card shadow-xs dark:bg-white/[0.03]" aria-labelledby="clip-transcript">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <h2 id="clip-transcript" className="font-display text-lg font-semibold text-ink">{media ? "Transcript" : "Text"}</h2>
            {media && d.segment.start_ms != null && (
              <span className="text-xs text-ink-3 tabular-nums">
                {fmtTime(d.segment.start_ms)}–{fmtTime(d.segment.end_ms)} · {fmtDuration((d.segment.end_ms || 0) - (d.segment.start_ms || 0))}
              </span>
            )}
            <button type="button" className="ml-auto inline-flex items-center gap-1 text-[13px] font-semibold text-link" onClick={() => setShowTranscript((s) => !s)} aria-expanded={showTranscript}>
              {showTranscript ? "Hide" : "Show"} <ChevronDown className={cn("size-4 transition-transform", showTranscript && "rotate-180")} aria-hidden />
            </button>
          </div>
          {showTranscript && (
            <div className="px-4 py-3.5">
              <p className="mb-2.5 flex items-center gap-1.5 text-xs text-ink-3">
                <Info className="size-3.5 shrink-0" aria-hidden /> Highlighted words mention the Scripture
                {media ? (hosted ? " · tap a sentence and the YouTube player starts there" : " · tap a sentence to jump there") : ""}.
              </p>
              <Transcript
                text={d.segment.text}
                units={d.segment.units}
                highlights={highlights}
                nowMs={now}
                clip={d.clip}
                onSeek={media ? (ms) => player.current?.seek(ms, true) : undefined}
                maxHeight={360}
                seekLabel={hosted ? "Play from" : "Jump to"}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ExportButton({ d }: { d: ClipDetails }) {
  const { viewer } = useAuth();
  const [job, setJob] = useState<Json | null>(null);
  const [busy, setBusy] = useState(false);
  if (d.resource.type !== "video" && d.resource.type !== "audio") return null;
  if (!d.can_export && isYoutubePlayback(d.playback)) return null; // the player card says the video stays on YouTube
  if (!d.can_export) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-3 dark:bg-white/[0.06]" title={d.export_blocked_reason || "Usage rights don't allow saving clips from this resource"}>
        <Info className="size-3.5" aria-hidden /> Clip saving not allowed (usage rights)
      </span>
    );
  }
  if (!viewer?.authenticated) return null;
  const start = async () => {
    setBusy(true);
    try {
      const res = await api<Json>(`/v1/clips/${d.segment_id}/export`, { method: "POST" });
      for (let i = 0; i < 90; i++) {
        const status = await api<Json>(`/v1/jobs/${res.job_id}`);
        setJob(status);
        if (status.status === "succeeded" || status.status === "dead" || status.status === "failed") {
          if (status.status !== "succeeded") toast.error("Couldn't prepare the clip file", { description: status.last_error || "Please try again." });
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (e) {
      toast.error("Couldn't prepare the clip file", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  if (job?.download_url) {
    return (
      <a
        className={buttonClass("primary", "sm")}
        href={`${job.download_url}`}
        onClick={(e) => {
          e.preventDefault();
          void downloadWithAuth(job.download_url, `clip_${d.segment_id}`);
        }}
      >
        <Download aria-hidden /> Download clip
      </a>
    );
  }
  return (
    <button type="button" className={buttonClass("secondary", "sm")} onClick={start} disabled={busy} title="Creates a video or audio file of just this clip">
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Scissors aria-hidden />}
      {busy ? "Preparing clip file…" : "Save clip as a file"}
    </button>
  );
}

async function downloadWithAuth(url: string, name: string) {
  const token = localStorage.getItem("ibible_token");
  const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name + (blob.type.includes("audio") ? ".mp3" : ".mp4");
  a.click();
}
