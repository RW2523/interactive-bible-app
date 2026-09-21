import { ArrowRight, ExternalLink, Headphones, Info, RotateCcw, Scissors, MonitorPlay } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Playback, Unit } from "../api/types";
import { youtubeEmbedSrc, youtubeWatchUrl } from "../lib/youtube";
import { fmtDuration, fmtTime } from "../utils/format";
import { buttonClass, HelpTip } from "./page";

export interface PlayerHandle {
  seek: (ms: number, play?: boolean) => void;
  playClip: () => void;
}

interface Props {
  playback: Playback;
  clip?: { start_ms: number; end_ms: number; core_start_ms?: number | null; core_end_ms?: number | null } | null;
  durationMs?: number | null;
  title?: string;
  initialMode?: "clip" | "full";
  onTime?: (ms: number) => void;
  autoPlay?: boolean;
}

export const MediaPlayer = forwardRef<PlayerHandle, Props>(function MediaPlayer({ playback, clip, durationMs, title, initialMode = "clip", onTime, autoPlay }, ref) {
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [mode, setMode] = useState<"clip" | "full">(clip ? initialMode : "full");
  const [now, setNow] = useState(clip?.start_ms ?? 0);
  const [duration, setDuration] = useState<number>(durationMs ?? 0);
  const [clipEnded, setClipEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  // embedded YouTube: we can't drive the player, so choosing a moment reloads the embed there
  const [embed, setEmbed] = useState<{ at: number | null; jumps: number }>({ at: null, jumps: 0 });

  const isEmbed = playback.mode === "embed" && !!playback.youtube_id;

  const seek = useCallback(
    (ms: number, play = true) => {
      if (isEmbed) {
        const at = Math.max(0, Math.round(ms));
        if (clip) {
          // inside the clip: keep the clip's end. Outside it: the owner wants the wider video.
          const inClip = at >= clip.start_ms - 1500 && at < clip.end_ms;
          setMode(inClip ? "clip" : "full");
        }
        setEmbed((e) => ({ at, jumps: e.jumps + 1 }));
        setNow(at);
        setClipEnded(false);
        onTime?.(at);
        return;
      }
      const el = media.current;
      if (!el) return;
      el.currentTime = ms / 1000;
      setNow(ms);
      setClipEnded(false);
      if (play) el.play().catch(() => undefined);
    },
    [clip, isEmbed, onTime],
  );

  const playClip = useCallback(() => {
    if (!clip) return;
    setMode("clip");
    if (isEmbed) {
      setEmbed((e) => ({ at: clip.start_ms, jumps: e.jumps + 1 }));
      setNow(clip.start_ms);
      setClipEnded(false);
      onTime?.(clip.start_ms);
      return;
    }
    seek(clip.start_ms, true);
  }, [clip, isEmbed, onTime, seek]);

  useImperativeHandle(ref, () => ({ seek, playClip }), [seek, playClip]);

  // a different recording starts over from scratch
  useEffect(() => {
    started.current = false;
    setClipEnded(false);
    setEmbed({ at: null, jumps: 0 });
    setMode(clip ? initialMode : "full");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback.url, playback.youtube_id]);

  // a different clip on the same recording: keep the moment the owner just asked for, otherwise start at the clip
  useEffect(() => {
    started.current = false;
    setClipEnded(false);
    setMode(clip ? initialMode : "full");
    setEmbed((e) => (clip && e.at === clip.start_ms ? e : { at: null, jumps: e.jumps }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.start_ms, clip?.end_ms]);

  const onLoaded = () => {
    const el = media.current;
    if (!el) return;
    if (Number.isFinite(el.duration)) setDuration(el.duration * 1000);
    if (clip && !started.current) {
      el.currentTime = clip.start_ms / 1000;
      started.current = true;
      if (autoPlay) el.play().catch(() => undefined);
    }
  };

  const onTimeUpdate = () => {
    const el = media.current;
    if (!el) return;
    const ms = el.currentTime * 1000;
    setNow(ms);
    onTime?.(ms);
    if (clip && mode === "clip" && ms >= clip.end_ms && !el.paused) {
      el.pause();
      setClipEnded(true);
    }
  };

  const continueFull = () => {
    setMode("full");
    setClipEnded(false);
    media.current?.play().catch(() => undefined);
  };

  /* ───────────────────────────── YouTube: playback stays in YouTube's own player */
  if (isEmbed && playback.youtube_id) {
    const videoId = playback.youtube_id;
    const clipMode = !!clip && mode === "clip";
    const startAt = embed.at ?? (clip ? clip.start_ms : 0);
    const total = durationMs || 0;
    const jumped = embed.jumps > 0;
    return (
      <div className="grid grid-cols-1 gap-2.5">
        <div className="player" style={{ aspectRatio: "16 / 9" }}>
          <iframe
            key={`${videoId}:${startAt}:${clipMode ? "clip" : "full"}:${embed.jumps}`}
            title={title ? `${title} — YouTube player` : "YouTube player"}
            src={youtubeEmbedSrc({ videoId, startMs: startAt, endMs: clipMode ? clip!.end_ms : null, autoplay: jumped || !!autoPlay })}
            style={{ width: "100%", height: "100%", border: 0 }}
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>

        <div className="rounded-2xl border border-border bg-card p-3.5 shadow-xs dark:bg-white/[0.03]">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-[13px]">
            {clip ? (
              <span className="inline-flex items-center gap-2 font-medium text-ink">
                <Scissors className="size-4 text-gold-600 dark:text-gold-400" aria-hidden />
                Verse clip {fmtTime(clip.start_ms)}–{fmtTime(clip.end_ms)}
                <span className="font-normal text-ink-3">· {fmtDuration(clip.end_ms - clip.start_ms)}</span>
                <HelpTip label="Verse clips">
                  The moment in the video that talks about this Scripture. The video itself stays on YouTube — the clip is just a start and end
                  time, so nothing is downloaded or re-hosted.
                </HelpTip>
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 font-medium text-ink">
                <MonitorPlay className="size-4 text-gold-600 dark:text-gold-400" aria-hidden /> Playing on YouTube
                {total ? <span className="font-normal text-ink-3 tabular-nums">· {fmtTime(total)}</span> : null}
              </span>
            )}
            <a className={buttonClass("ghost", "sm", "max-sm:h-10 max-sm:px-3.5")} href={youtubeWatchUrl(videoId, clipMode && clip ? clip.start_ms : jumped ? startAt : null)} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden /> Watch on YouTube
            </a>
          </div>

          {clip && total > 0 && (
            <div className="clip-bar mt-2.5" aria-hidden>
              <div className="range" style={{ left: `${(clip.start_ms / total) * 100}%`, width: `${Math.max(0.6, ((clip.end_ms - clip.start_ms) / total) * 100)}%` }} />
              {clip.core_start_ms != null && clip.core_end_ms != null && (
                <div className="core" style={{ left: `${(clip.core_start_ms / total) * 100}%`, width: `${Math.max(0.4, ((clip.core_end_ms - clip.core_start_ms) / total) * 100)}%` }} />
              )}
              <div className="head" style={{ left: `${Math.min(100, (startAt / total) * 100)}%` }} />
            </div>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {clip && (
              <button type="button" className={buttonClass(clipMode ? "secondary" : "primary", "sm", "max-sm:h-10 max-sm:px-4")} onClick={playClip}>
                <RotateCcw aria-hidden /> Play from the start of the clip
              </button>
            )}
            {clip &&
              (clipMode ? (
                <button type="button" className={buttonClass("ghost", "sm", "max-sm:h-10 max-sm:px-3.5")} onClick={() => setMode("full")}>
                  Watch the whole video <ArrowRight aria-hidden />
                </button>
              ) : (
                <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-2 dark:bg-white/[0.06]">Playing the whole video</span>
              ))}
            {!clip && jumped && (
              <button type="button" className={buttonClass("secondary", "sm")} onClick={() => seek(0)}>
                <RotateCcw aria-hidden /> Back to the beginning
              </button>
            )}
          </div>

          <p className="mt-2.5 flex items-start gap-2 text-[13px]/relaxed text-ink-3" aria-live="polite">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {jumped ? (
                <>
                  <span className="font-medium text-ink-2">Starting at {fmtTime(startAt)}.</span> The YouTube player reloads at each moment you
                  choose, so press play if it doesn't start on its own.
                </>
              ) : (
                <>
                  Played from YouTube{clipMode ? ", stopping at the end of the clip" : ""}. Choosing a chapter or a line of the transcript restarts
                  the player at that moment.
                </>
              )}
            </span>
          </p>
        </div>
      </div>
    );
  }

  const directEmbed = playback.mode === "embed" && playback.provider === "direct" && !!playback.url;
  if ((playback.mode !== "local" && !directEmbed) || !playback.url) {
    return (
      <div className="flex gap-3 rounded-2xl border border-warn/20 bg-warn-soft px-4 py-3.5 text-sm text-warn">
        <Info className="mt-0.5 size-[18px] shrink-0" aria-hidden />
        <p>
          {playback.mode === "embed"
            ? "This recording is hosted elsewhere — open the original link to play it. The transcript and Scripture links below still work."
            : "Playback isn't available for this resource (usage rights). The transcript and Scripture links below still work."}
        </p>
      </div>
    );
  }

  const total = duration || durationMs || 1;
  const isVideo = playback.media_type === "video";
  const common = {
    ref: media,
    src: playback.url,
    controls: true,
    preload: "metadata" as const,
    onLoadedMetadata: onLoaded,
    onTimeUpdate,
    onError: () => setError("The recording couldn't be loaded. It may have been moved or deleted."),
    crossOrigin: undefined,
  };
  return (
    <div className="grid grid-cols-1 gap-3">
      {isVideo ? (
        <div className="player">
          <video {...common} playsInline aria-label={title}>
            {playback.captions_url && <track kind="captions" src={playback.captions_url} srcLang="en" label="English (transcript)" default />}
          </video>
        </div>
      ) : (
        <div className="player-audio">
          <div className="flex items-center gap-3">
            <span className="grid grid-cols-1 size-12 shrink-0 place-items-center rounded-xl bg-white/10 text-gold-300 ring-1 ring-white/15">
              <Headphones className="size-6" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="text-xs font-semibold tracking-wider text-gold-200/90 uppercase">Audio</div>
              <div className="truncate font-display text-lg font-semibold">{title}</div>
            </div>
          </div>
          <audio {...common} aria-label={title}>
            {playback.captions_url && <track kind="captions" src={playback.captions_url} srcLang="en" label="English (transcript)" default />}
          </audio>
        </div>
      )}
      {error && <div className="rounded-xl border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</div>}
      {clip && (
        <div className="rounded-2xl border border-border bg-card p-3.5 shadow-xs dark:bg-white/[0.03]">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px]">
            <span className="inline-flex items-center gap-2 font-medium text-ink">
              <Scissors className="size-4 text-gold-600 dark:text-gold-400" aria-hidden />
              Clip {fmtTime(clip.start_ms)}–{fmtTime(clip.end_ms)}
              <span className="font-normal text-ink-3">· {fmtDuration(clip.end_ms - clip.start_ms)}</span>
              <HelpTip label="Clips">
                The part of the recording that talks about this Scripture. The gold band is the key moment; the soft band around it adds context. You can keep playing the whole recording anytime.
              </HelpTip>
            </span>
            <span className="text-ink-3 tabular-nums">
              {fmtTime(now)} / {fmtTime(total)}
            </span>
          </div>
          <div
            className="clip-bar"
            role="slider"
            aria-label="Position in the full recording"
            aria-valuemin={0}
            aria-valuemax={Math.round(total / 1000)}
            aria-valuenow={Math.round(now / 1000)}
            aria-valuetext={`${fmtTime(now)} of ${fmtTime(total)}`}
            tabIndex={0}
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              seek(((e.clientX - rect.left) / rect.width) * total, true);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") seek(now + 5000, false);
              if (e.key === "ArrowLeft") seek(Math.max(0, now - 5000), false);
            }}
          >
            <div className="range" style={{ left: `${(clip.start_ms / total) * 100}%`, width: `${((clip.end_ms - clip.start_ms) / total) * 100}%` }} />
            {clip.core_start_ms != null && clip.core_end_ms != null && (
              <div className="core" style={{ left: `${(clip.core_start_ms / total) * 100}%`, width: `${Math.max(0.4, ((clip.core_end_ms - clip.core_start_ms) / total) * 100)}%` }} />
            )}
            <div className="head" style={{ left: `${Math.min(100, (now / total) * 100)}%` }} />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button type="button" className={buttonClass("secondary", "sm")} onClick={playClip}>
              <RotateCcw aria-hidden /> {clipEnded ? "Replay clip" : "Play clip"}
            </button>
            {mode === "clip" ? (
              <button type="button" className={buttonClass("primary", "sm")} onClick={continueFull}>
                Keep playing the full {isVideo ? "video" : "recording"} <ArrowRight aria-hidden />
              </button>
            ) : (
              <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-2 dark:bg-white/[0.06]">Playing the full {isVideo ? "video" : "recording"}</span>
            )}
          </div>
          {clipEnded && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-accent-soft px-3.5 py-2.5 text-sm text-link" role="status">
              <span className="flex-1">That's the end of the clip.</span>
              <button type="button" className={buttonClass("primary", "sm")} onClick={continueFull}>
                Keep playing
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export function Transcript({
  text, units, highlights, nowMs, clip, onSeek, maxHeight, seekLabel,
}: {
  text: string;
  units: Unit[];
  highlights: { start: number; end: number }[];
  nowMs?: number;
  clip?: { start_ms: number; end_ms: number } | null;
  onSeek?: (ms: number) => void;
  maxHeight?: number | string;
  /** Tooltip prefix for clickable lines — "Jump to" by default. */
  seekLabel?: string;
}) {
  const activeRef = useRef<HTMLSpanElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const activeId = nowMs !== undefined ? units.find((u) => u.start_ms !== null && u.end_ms !== null && nowMs >= u.start_ms && nowMs < u.end_ms)?.id : undefined;
  useEffect(() => {
    const el = activeRef.current;
    const box = container.current;
    if (el && box && maxHeight) {
      const top = el.offsetTop - box.offsetTop;
      if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 60) box.scrollTo({ top: top - 60, behavior: "smooth" });
    }
  }, [activeId, maxHeight]);
  if (!units.length) return <div className="transcript whitespace-pre-wrap">{text}</div>;
  let lastSpeaker: string | null = null;
  return (
    <div className="transcript" ref={container} style={maxHeight ? { maxHeight, overflowY: "auto", paddingRight: 8 } : undefined}>
      {units.map((u) => {
        const piece = text.slice(u.start, u.end);
        const parts: { t: string; hl: boolean }[] = [];
        let cursor = u.start;
        const hs = highlights.filter((h) => h.start < u.end && h.end > u.start).sort((a, b) => a.start - b.start);
        for (const h of hs) {
          const s = Math.max(h.start, u.start);
          const e = Math.min(h.end, u.end);
          if (s > cursor) parts.push({ t: text.slice(cursor, s), hl: false });
          if (e > Math.max(s, cursor)) parts.push({ t: text.slice(Math.max(s, cursor), e), hl: true });
          cursor = Math.max(cursor, e);
        }
        if (cursor < u.end) parts.push({ t: text.slice(cursor, u.end), hl: false });
        if (!parts.length) parts.push({ t: piece, hl: false });
        const outside = clip && u.start_ms !== null && (u.end_ms! <= clip.start_ms || u.start_ms >= clip.end_ms);
        const speakerLabel = u.speaker && u.speaker !== lastSpeaker ? u.speaker : null;
        lastSpeaker = u.speaker;
        return (
          <span key={u.id}>
            {speakerLabel && <span className="speaker">{speakerLabel}</span>}
            <span
              ref={u.id === activeId ? activeRef : undefined}
              className={`tunit ${u.id === activeId ? "active" : ""} ${outside ? "outside" : ""}`}
              onClick={() => u.start_ms !== null && onSeek?.(u.start_ms)}
              role={onSeek && u.start_ms !== null ? "button" : undefined}
              tabIndex={onSeek && u.start_ms !== null ? 0 : undefined}
              onKeyDown={(e) => e.key === "Enter" && u.start_ms !== null && onSeek?.(u.start_ms)}
              title={u.start_ms !== null ? `${seekLabel ?? "Jump to"} ${fmtTime(u.start_ms)}` : u.page ? `Page ${u.page}` : undefined}
            >
              {parts.map((p, i) => (p.hl ? <mark key={i} className="evidence">{p.t}</mark> : <span key={i}>{p.t}</span>))}
            </span>{" "}
          </span>
        );
      })}
    </div>
  );
}
