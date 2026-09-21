import { BookOpenText, Headphones, Play, MonitorPlay } from "lucide-react";
import { useEffect, useState } from "react";
import { youtubeThumb } from "../lib/youtube";
import { cn } from "../lib/utils";

/**
 * A 16:9 still for a video or audio resource: the picture, a play badge, and how long it runs.
 * Falls back to a quiet coloured tile with an icon when there is no picture (uploads, audio, documents).
 */
export function MediaThumb({
  src,
  videoId,
  alt,
  kind = "watch",
  time,
  youtube,
  className,
  iconClassName,
  badgeSize = "md",
}: {
  src?: string | null;
  videoId?: string | null;
  alt?: string;
  kind?: "watch" | "listen" | "study";
  /** Short label bottom-right: a clip length or the full duration. */
  time?: string | null;
  /** Show the small YouTube source hint. */
  youtube?: boolean;
  className?: string;
  iconClassName?: string;
  badgeSize?: "sm" | "md" | "lg";
}) {
  const initial = src || (videoId ? youtubeThumb(videoId, "hq") : null);
  const [url, setUrl] = useState<string | null>(initial);
  useEffect(() => setUrl(initial), [initial]);

  const Icon = kind === "listen" ? Headphones : kind === "study" ? BookOpenText : Play;
  const badge = badgeSize === "sm" ? "size-7 [&>svg]:size-3" : badgeSize === "lg" ? "size-12 [&>svg]:size-5" : "size-9 [&>svg]:size-4";

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-xl bg-navy-900 ring-1 ring-navy-950/10 dark:bg-white/[0.06] dark:ring-white/10",
        className,
      )}
    >
      {url ? (
        <img
          src={url}
          alt={alt || ""}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={() => {
            // maxresdefault doesn't exist for every video — fall back to the still every video has.
            const fallback = videoId ? youtubeThumb(videoId, "hq") : null;
            setUrl(fallback && fallback !== url ? fallback : null);
          }}
        />
      ) : (
        <div
          className={cn(
            "grid size-full place-items-center",
            kind === "listen" ? "bg-rel-quote/15 text-rel-quote" : kind === "study" ? "bg-gold-50 text-gold-700 dark:bg-gold-400/10 dark:text-gold-300" : "bg-navy-800 text-gold-200",
          )}
          aria-hidden
        >
          <Icon className={cn("size-6", iconClassName)} strokeWidth={1.8} />
        </div>
      )}

      {kind !== "study" && (
        <span
          className={cn(
            "absolute top-1/2 left-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-navy-950/65 text-white shadow-sm ring-1 ring-white/25 backdrop-blur-[2px] transition group-hover/card:bg-navy-950/80 group-hover:bg-navy-950/80",
            badge,
          )}
          aria-hidden
        >
          {kind === "listen" ? <Headphones /> : <Play className="fill-current" />}
        </span>
      )}

      {youtube && (
        <span
          className="absolute top-1 left-1 inline-flex items-center gap-1 rounded-md bg-navy-950/70 px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide text-white uppercase ring-1 ring-white/15"
          title="Plays in YouTube's own player"
        >
          <MonitorPlay className="size-3" aria-hidden />
          {badgeSize === "sm" ? <span className="sr-only">YouTube</span> : "YouTube"}
        </span>
      )}

      {time && (
        <span className="absolute right-1 bottom-1 rounded-md bg-navy-950/80 px-1.5 py-px text-[10px] font-bold text-white tabular-nums">{time}</span>
      )}
    </div>
  );
}
