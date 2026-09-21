import { ArrowRight, BookOpenText, Headphones, Lock, MonitorPlay, Play, PlayCircle, Sparkles } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import type { ResourceCardData } from "../api/types";
import { splitReasons } from "../lib/reasons";
import { cn } from "../lib/utils";
import { thumbnailFor } from "../lib/youtube";
import { fmtDuration, fmtTime, mediaLocation } from "../utils/format";
import { FeedbackMenu } from "./FeedbackMenu";
import { MediaThumb } from "./MediaThumb";
import { RelationshipBadge } from "./ui";

const CATEGORY_LABEL: Record<string, string> = { sermon: "Sermon", podcast: "Podcast", study: "Study", devotional: "Devotional", article: "Article", lecture: "Lecture", other: "" };

function Thumb({ kind, time }: { kind: string; time?: string }) {
  const Icon = kind === "watch" ? PlayCircle : kind === "listen" ? Headphones : BookOpenText;
  return (
    <div
      className={cn(
        "relative grid grid-cols-1 size-14 shrink-0 place-items-center rounded-xl ring-1",
        kind === "watch" && "bg-navy-700 text-white ring-navy-800/10 dark:bg-white/[0.08] dark:text-gold-200 dark:ring-white/10",
        kind === "listen" && "bg-rel-quote/10 text-rel-quote ring-rel-quote/15",
        kind === "study" && "bg-gold-50 text-gold-700 ring-gold-500/20 dark:bg-gold-400/10 dark:text-gold-300 dark:ring-gold-400/20",
      )}
      aria-hidden
    >
      <Icon className="size-6" strokeWidth={1.8} />
      {time && (
        <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-md bg-ink px-1.5 py-px text-[10px] font-bold whitespace-nowrap text-paper tabular-nums shadow-sm">{time}</span>
      )}
    </div>
  );
}

export function ResourceCard({ card, verseRef, showVerse = false }: { card: ResourceCardData; verseRef?: string; showVerse?: boolean }) {
  const location = useLocation();
  const isMedia = card.media_kind !== "study" && !!card.clip;
  const clipHref = `/clip/${card.segment_id}${verseRef ? `?ref=${encodeURIComponent(verseRef)}` : ""}`;
  const sectionHref = `/resources/${card.resource.id}?segment=${card.segment_id}`;
  const who = card.resource.speaker || card.resource.author;  // speaker wins; they are often the same channel
  const category = CATEGORY_LABEL[card.resource.category] ?? card.resource.category;
  const privateResource = card.resource.visibility && card.resource.visibility !== "public";
  const aiRelated = card.relationship?.type === "ai_related";
  const href = isMedia ? clipHref : sectionHref;
  const linkState = isMedia ? { background: location } : undefined;
  const reasons = splitReasons(card.reasons);
  const still = thumbnailFor(card.resource);
  const youtube = !!card.resource.youtube_id;
  const clipLength = card.clip ? fmtDuration(card.clip.end_ms - card.clip.start_ms) : null;
  // the still's corner already shows how long the clip runs, so the meta line keeps just the range
  const whereLabel = still && card.clip ? `${fmtTime(card.clip.start_ms)}–${fmtTime(card.clip.end_ms)}` : mediaLocation(card);

  return (
    <article
      className="group/card @container relative flex gap-3.5 rounded-2xl border border-border bg-card p-3.5 shadow-xs transition hover:border-line-2 hover:shadow-md sm:gap-4 sm:p-4 dark:bg-white/[0.03]"
      aria-label={`${card.resource.title}${who ? ` by ${who}` : ""}`}
    >
      {still && card.media_kind !== "study" ? (
        <MediaThumb
          src={still}
          videoId={card.resource.youtube_id || null}
          alt=""
          kind={card.media_kind}
          time={isMedia ? clipLength : undefined}
          youtube={youtube}
          className="aspect-video w-24 self-start @xs:w-28 @sm:w-36 @2xl:w-44"
        />
      ) : (
        <Thumb kind={card.media_kind} time={isMedia && card.clip ? fmtTime(card.clip.start_ms) : undefined} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Link to={href} state={linkState} className="line-clamp-2 font-semibold leading-snug text-ink no-underline decoration-gold-500/60 underline-offset-4 hover:underline">
              {card.resource.title}
            </Link>
            <p className="mt-0.5 truncate text-[13px] text-ink-3">{[who, category, whereLabel].filter(Boolean).join(" · ")}</p>
            {youtube && (
              <p className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-medium text-ink-3">
                <MonitorPlay className="size-3.5" aria-hidden /> Plays on YouTube
              </p>
            )}
          </div>
          <FeedbackMenu objectType={card.mapping_id ? "mapping" : "segment"} objectId={card.mapping_id || card.segment_id} />
        </div>

        {(card.resource.is_official || privateResource) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {card.resource.is_official && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-link">Official</span>}
            {privateResource && (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-ink-2" title="Only people allowed to see this resource can find it">
                <Lock className="size-3" aria-hidden /> {card.resource.visibility === "private" ? "Private" : card.resource.visibility}
              </span>
            )}
          </div>
        )}

        {card.summary ? (
          <p className="mt-2 line-clamp-3 text-sm/relaxed text-ink-2">{card.summary}</p>
        ) : !card.evidence_text && card.excerpt ? (
          <p className="mt-2 line-clamp-3 text-sm/relaxed text-ink-2">{card.excerpt.slice(0, 220)}…</p>
        ) : null}
        {card.evidence_text && !aiRelated && (
          <p className="scripture-quote mt-2.5 line-clamp-3 text-[14.5px]/relaxed text-ink-2 italic">“{card.evidence_text.slice(0, 240)}{card.evidence_text.length > 240 ? "…" : ""}”</p>
        )}
        {aiRelated && card.why_related && (
          <p className="mt-2.5 rounded-xl border border-dashed border-rel-ai/40 px-3 py-2 text-[13px]/relaxed text-ink-2">
            <span className="mr-1 inline-flex items-center gap-1 font-semibold text-rel-ai"><Sparkles className="size-3.5" aria-hidden /> Why related?</span>
            {card.why_related}
          </p>
        )}

        {reasons.explanation && (
          <p className="mt-2 text-[13px]/relaxed text-ink-3">
            <span className="font-semibold text-ink-2">Why it's here: </span>
            {reasons.explanation}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <RelationshipBadge rel={card.relationship} />
          {card.relationship?.passage_note && <span className="text-xs text-ink-3">{card.relationship.passage_note}</span>}
          {showVerse && card.verse_display && <span className="tag">{card.verse_display}</span>}
          {reasons.chips.map((c) => (
            <span key={c.label} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-medium text-ink-2 dark:bg-white/[0.06]">
              <c.icon className="size-3" aria-hidden /> {c.label}
            </span>
          ))}
          <span className="flex-1" />
          <Link
            to={href}
            state={linkState}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold no-underline transition hover:no-underline max-sm:h-10 max-sm:px-3.5",
              isMedia ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90" : "border border-border bg-card text-ink hover:bg-surface-2 dark:bg-white/[0.04]",
            )}
          >
            {isMedia ? (
              <>
                {card.media_kind === "watch" ? <Play className="size-3.5 fill-current" aria-hidden /> : <Headphones className="size-3.5" aria-hidden />}
                {card.media_kind === "watch" ? "Play this moment" : "Listen"}
              </>
            ) : (
              <>
                Open section <ArrowRight className="size-3.5" aria-hidden />
              </>
            )}
          </Link>
        </div>
      </div>
    </article>
  );
}
