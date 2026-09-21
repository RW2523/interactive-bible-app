import { BookOpen, Info, PlayCircle, Sparkles } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import type { AskResponse } from "@/api/types";
import { cn } from "@/lib/utils";
import { readHref } from "@/utils/format";

function confidenceLabel(value: number): { label: string; tone: string } {
  if (value >= 0.8) return { label: "Well supported", tone: "bg-ok-soft text-ok" };
  if (value >= 0.55) return { label: "Partly supported", tone: "bg-warn-soft text-warn" };
  return { label: "Tentative", tone: "bg-surface-2 text-ink-2" };
}

/** An AI answer with its sources. Every citation links to the verse or clip it came from. */
export function AnswerCard({ data, question, grounding, className }: { data: AskResponse; question?: string | null; grounding?: string; className?: string }) {
  const location = useLocation();
  const conf = confidenceLabel(data.confidence);
  return (
    <article className={cn("overflow-hidden rounded-2xl border border-gold-500/25 bg-card shadow-sm dark:border-gold-400/20", className)} aria-label="AI answer">
      <header className="flex items-center gap-3 border-b border-border bg-gold-50/50 px-4 py-3 dark:bg-gold-400/[0.05]">
        <span className="grid grid-cols-1 size-8 shrink-0 place-items-center rounded-lg bg-gold-100 text-gold-700 dark:bg-gold-400/15 dark:text-gold-300">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">AI answer{grounding ? <span className="font-normal text-ink-3"> · based on {grounding}</span> : null}</p>
          {question && <p className="truncate text-xs text-ink-3">“{question}”</p>}
        </div>
        <span
          className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold", conf.tone)}
          title={`Confidence ${Math.round(data.confidence * 100)}% — how well the sources support this answer`}
        >
          {conf.label}
        </span>
      </header>
      <div className="px-4 py-4 sm:px-5">
        <div className="text-[15px]/relaxed whitespace-pre-wrap text-ink">{data.answer}</div>
        {data.interpretive_note && (
          <p className="mt-4 flex gap-2.5 rounded-xl bg-accent-soft px-3 py-2.5 text-[13px]/relaxed text-link">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{data.interpretive_note}</span>
          </p>
        )}
        {data.citations.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">Sources</p>
            <div className="flex flex-wrap gap-2">
              {data.citations.map((c) => {
                const verse = c.kind === "verse";
                return (
                  <Link
                    key={`${c.kind}-${c.id}`}
                    to={verse ? readHref(c.id) : `/clip/${c.id}`}
                    state={verse ? undefined : { background: location }}
                    className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[13px] font-medium text-ink-2 no-underline transition hover:border-line-2 hover:bg-surface-2 hover:text-ink hover:no-underline dark:bg-white/[0.04]"
                  >
                    {verse ? <BookOpen className="size-3.5 shrink-0 text-gold-700 dark:text-gold-300" aria-hidden /> : <PlayCircle className="size-3.5 shrink-0 text-rel-quote" aria-hidden />}
                    <span className="truncate">{c.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <footer className="border-t border-border px-4 py-2.5 text-xs/relaxed text-ink-3 sm:px-5">{data.disclaimer}</footer>
    </article>
  );
}

export function AnswerSkeleton({ label = "Reading the passage and your library…" }: { label?: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card" role="status" aria-live="polite">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="grid grid-cols-1 size-8 place-items-center rounded-lg bg-gold-100 text-gold-700 dark:bg-gold-400/15 dark:text-gold-300">
          <Sparkles className="size-4 animate-pulse" aria-hidden />
        </span>
        <span className="text-sm font-medium text-ink-2">{label}</span>
      </div>
      <div className="grid grid-cols-1 gap-2.5 px-5 py-5" aria-hidden>
        {[96, 88, 92, 60].map((w, i) => (
          <div key={i} className="h-3.5 animate-pulse rounded-full bg-surface-2" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}
