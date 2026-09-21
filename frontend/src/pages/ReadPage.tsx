import { Drawer } from "@base-ui/react/drawer";
import { ChevronLeft, ChevronRight, Copy, Library, Share2, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useBooks, useChapter, useTranslations } from "../api/hooks";
import type { ChapterVerse } from "../api/types";
import { SegmentedControl } from "../components/page";
import { BookChapterPicker } from "../components/reader/BookChapterPicker";
import { MAX_READING_SIZE, MIN_READING_SIZE, ReaderSettings } from "../components/reader/ReaderSettings";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { ErrorState, useMediaQuery } from "../components/ui";
import { VerseIntelligencePanel } from "../components/VerseSheet";
import { pushRecent } from "../lib/recent";
import { cn } from "../lib/utils";
import { copyText } from "../utils/format";

const PREF_KEY = "ibible_read_prefs";
const HINT_KEY = "ibible_read_hint_seen";

interface ReadPrefs {
  translation: string;
  indicators: boolean;
  size: number;
}

function loadPrefs(): ReadPrefs {
  try {
    return { translation: "web", indicators: true, size: 20, ...JSON.parse(localStorage.getItem(PREF_KEY) || "{}") };
  } catch {
    return { translation: "web", indicators: true, size: 20 };
  }
}

const FALLBACK_TRANSLATIONS = [
  { id: "web", abbreviation: "WEB", name: "World English Bible" },
  { id: "kjv", abbreviation: "KJV", name: "King James Version" },
  { id: "asv", abbreviation: "ASV", name: "American Standard Version" },
];

export function ReadPage() {
  const params = useParams();
  const book = (params.book || "ROM").toUpperCase();
  const chapterNo = Number(params.chapter || 8);
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState(loadPrefs);
  const translation = search.get("t") || prefs.translation;
  const chapter = useChapter(book, chapterNo, translation);
  const translations = useTranslations();
  const books = useBooks();
  const desktop = useMediaQuery("(min-width: 1024px)");
  const selected = search.get("v");
  const anchor = useRef<number | null>(null);
  const pressTimer = useRef<number | undefined>(undefined);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hintSeen, setHintSeen] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) === "1";
    } catch {
      return true;
    }
  });

  const data = chapter.data && chapter.data.book.code === book && chapter.data.chapter === chapterNo ? chapter.data : undefined;
  const shown = data || chapter.data; // keep the previous chapter on screen while the next one loads
  const loadingNext = !data && chapter.isFetching;
  const translationList = translations.data?.length ? translations.data : FALLBACK_TRANSLATIONS;
  const translationName = translationList.find((t) => t.id === (shown?.translation || translation))?.name;
  const bookName = (code: string) => books.data?.find((b) => b.code === code)?.name || code;

  useEffect(() => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
    document.documentElement.style.setProperty("--reading-size", `${prefs.size}px`);
  }, [prefs]);

  useEffect(() => {
    try {
      localStorage.setItem("ibible_last_read", JSON.stringify({ book, chapter: chapterNo, v: selected }));
    } catch {
      /* ignore */
    }
  }, [book, chapterNo, selected]);

  useEffect(() => {
    if (!data) return;
    document.title = `${data.book.name} ${chapterNo} · Interactive Bible App`;
    pushRecent({ kind: "read", key: `${book}.${chapterNo}`, label: `${data.book.name} ${chapterNo}`, detail: "Continue reading", href: `/read/${book}/${chapterNo}` });
  }, [data, book, chapterNo]);

  useEffect(() => setSheetOpen(false), [book, chapterNo]);

  // scroll a deep-linked verse into view once
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!data || !selected) return;
    const key = `${book}.${chapterNo}.${selected}`;
    if (scrolledFor.current === key) return;
    scrolledFor.current = key;
    const first = selected.split("-")[0];
    const el = document.getElementById(`v${first}`);
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.top < 130 || rect.bottom > window.innerHeight - (desktop ? 40 : 180)) {
        window.scrollTo({ top: window.scrollY + rect.top - 160, behavior: "smooth" });
      }
    }
  }, [data, selected, book, chapterNo, desktop]);

  const selRange = useMemo(() => {
    if (!selected) return null;
    const [a, b] = selected.split("-").map(Number);
    if (!Number.isFinite(a)) return null;
    return { start: a, end: Number.isFinite(b) && b ? b : a };
  }, [selected]);

  const selectVerse = useCallback(
    (n: number, extend: boolean) => {
      const next = new URLSearchParams(search);
      if (extend && anchor.current !== null && anchor.current !== n) {
        const [a, b] = [Math.min(anchor.current, n), Math.max(anchor.current, n)];
        next.set("v", `${a}-${b}`);
      } else if (selRange && selRange.start === n && selRange.end === n && !extend) {
        next.delete("v");
        anchor.current = null;
      } else {
        next.set("v", String(n));
        anchor.current = n;
      }
      setSearch(next, { replace: true, preventScrollReset: true });
      if (!hintSeen) {
        setHintSeen(true);
        try {
          localStorage.setItem(HINT_KEY, "1");
        } catch {
          /* ignore */
        }
      }
    },
    [search, setSearch, selRange, hintSeen],
  );

  const clearSelection = useCallback(() => {
    const next = new URLSearchParams(search);
    next.delete("v");
    setSheetOpen(false);
    setSearch(next, { replace: true, preventScrollReset: true });
  }, [search, setSearch]);

  const setTranslation = (id: string) => {
    setPrefs((p) => ({ ...p, translation: id }));
    const n = new URLSearchParams(search);
    n.delete("t");
    setSearch(n, { replace: true, preventScrollReset: true });
  };

  const refId = selRange
    ? selRange.end !== selRange.start
      ? `${book}.${chapterNo}.${selRange.start}-${book}.${chapterNo}.${selRange.end}`
      : `${book}.${chapterNo}.${selRange.start}`
    : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "Escape" && selected && !sheetOpen && !document.querySelector("[role='dialog']")) clearSelection();
      if (e.key === "ArrowRight" && e.altKey && data?.next) navigate(`/read/${data.next.book}/${data.next.chapter}`);
      if (e.key === "ArrowLeft" && e.altKey && data?.prev) navigate(`/read/${data.prev.book}/${data.prev.chapter}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selectionLabel = shown && selRange ? `${shown.book.name} ${chapterNo}:${selRange.start}${selRange.end !== selRange.start ? `–${selRange.end}` : ""}` : "";
  const selectionText = () =>
    (shown?.verses || [])
      .filter((v) => selRange && v.number >= selRange.start && v.number <= selRange.end)
      .map((v) => v.text)
      .filter(Boolean)
      .join(" ");
  const copySelection = async () => {
    const ok = await copyText(`“${selectionText()}” — ${selectionLabel} (${(shown?.translation || translation).toUpperCase()})`);
    if (ok) toast.success("Verse copied", { description: selectionLabel });
    else toast.error("Couldn't copy the verse");
  };
  const shareSelection = async () => {
    const url = `${window.location.origin}/read/${book}/${chapterNo}${selected ? `?v=${selected}` : ""}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: selectionLabel, text: `“${selectionText()}” — ${selectionLabel}`, url });
      } catch {
        /* cancelled */
      }
      return;
    }
    const ok = await copyText(url);
    if (ok) toast.success("Link copied", { description: "Anyone on this network can open this passage." });
    else toast.error("Couldn't copy the link");
  };

  const withPanel = desktop && !!refId;
  const prev = shown?.prev;
  const next = shown?.next;

  return (
    <div className={cn("grid grid-cols-1 min-h-[calc(100dvh-var(--header-h))]", withPanel ? "grid-cols-[minmax(0,1fr)_min(460px,40vw)]" : "grid-cols-1")}>
      <div className="min-w-0">
        {/* toolbar */}
        <div className="sticky top-[var(--header-h)] z-20 border-b border-border bg-paper/90 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[780px] items-center gap-1.5 px-3 py-2.5 sm:gap-2 sm:px-6">
            <ChapterStep direction="prev" target={prev ? { to: `/read/${prev.book}/${prev.chapter}`, label: `${bookName(prev.book)} ${prev.chapter}` } : null} />
            <BookChapterPicker book={book} chapter={chapterNo} bookName={books.data?.find((b) => b.code === book)?.name || shown?.book.name} />
            <ChapterStep direction="next" target={next ? { to: `/read/${next.book}/${next.chapter}`, label: `${bookName(next.book)} ${next.chapter}` } : null} />
            <div className="ml-2 hidden md:block">
              <SegmentedControl
                ariaLabel="Translation"
                value={translation}
                onChange={setTranslation}
                options={translationList.map((t) => ({ value: t.id, label: t.abbreviation, title: t.name }))}
              />
            </div>
            <div className="min-w-0 flex-1" />
            <Tooltip>
              <TooltipTrigger
                onClick={() => setPrefs((p) => ({ ...p, indicators: !p.indicators }))}
                aria-pressed={prefs.indicators}
                className={cn(
                  "hidden h-10 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium transition outline-none focus-visible:ring-3 focus-visible:ring-ring sm:inline-flex",
                  prefs.indicators
                    ? "border-gold-500/35 bg-gold-50 text-gold-700 dark:border-gold-400/30 dark:bg-gold-400/10 dark:text-gold-200"
                    : "border-border bg-card text-ink-3 hover:bg-surface-2 hover:text-ink dark:bg-white/[0.04]",
                )}
              >
                <Sparkles className="size-4" aria-hidden /> Insights
              </TooltipTrigger>
              <TooltipContent side="bottom">{prefs.indicators ? "Hide" : "Show"} gold dots on verses your library discusses</TooltipContent>
            </Tooltip>
            <ReaderSettings
              size={prefs.size}
              onSize={(size) => setPrefs((p) => ({ ...p, size: Math.min(MAX_READING_SIZE, Math.max(MIN_READING_SIZE, size)) }))}
              markers={prefs.indicators}
              onMarkers={(on) => setPrefs((p) => ({ ...p, indicators: on }))}
              translation={translation}
              translations={translationList}
              onTranslation={setTranslation}
            />
          </div>
          {loadingNext && <div className="absolute inset-x-0 -bottom-px h-0.5 animate-pulse bg-gold-400" aria-hidden />}
        </div>

        <article className="mx-auto w-full max-w-[780px] px-5 pb-44 sm:px-8" aria-busy={loadingNext}>
          {chapter.error && !shown && (
            <div className="pt-10">
              <ErrorState error={chapter.error} onRetry={() => chapter.refetch()} />
            </div>
          )}
          {chapter.isLoading && !shown && <ChapterSkeleton />}
          {shown && (
            <>
              <header className="pt-10 pb-8 text-center sm:pt-14">
                <p className="text-[11px] font-semibold tracking-[0.18em] text-gold-700 uppercase dark:text-gold-300">
                  {shown.book.testament === "OT" ? "Old Testament" : "New Testament"} · {shown.book.genre}
                </p>
                <h1 className="mt-3 font-display text-[42px] leading-none font-semibold tracking-tight text-ink sm:text-[52px]">
                  {shown.book.name} {shown.chapter}
                </h1>
                <p className="mt-3 text-sm text-ink-3">
                  {translationName || shown.translation.toUpperCase()} · {shown.verses.length} verses
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  {!hintSeen && (
                    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[13px] text-ink-2 shadow-xs dark:bg-white/[0.04]">
                      <Sparkles className="size-3.5 text-gold-600 dark:text-gold-400" aria-hidden />
                      Tap a verse for sermons, related verses and more
                    </span>
                  )}
                  {prefs.indicators && shown.verses.some((v) => v.indicators) && (
                    <span className="inline-flex items-center gap-2 rounded-full px-2 py-1 text-[12.5px] text-ink-3">
                      <span className="verse-dot" style={{ margin: 0, verticalAlign: "middle" }} aria-hidden /> discussed in your library
                    </span>
                  )}
                  {shown.chapter_resources > 0 && (
                    <span className="inline-flex items-center gap-2 rounded-full bg-surface-2/70 px-3 py-1.5 text-[12.5px] text-ink-2 dark:bg-white/[0.05]">
                      <Library className="size-3.5" aria-hidden />
                      {shown.chapter_resources} library section{shown.chapter_resources === 1 ? "" : "s"} cover this whole chapter
                    </span>
                  )}
                </div>
              </header>

              <div
                className={cn("scripture mx-auto max-w-[68ch] transition-opacity", loadingNext && "opacity-60")}
                role="list"
                aria-label={`${shown.book.name} chapter ${shown.chapter}`}
              >
                {shown.verses.map((v) => (
                  <VerseSpan
                    key={`${shown.book.code}.${shown.chapter}.${v.number}`}
                    v={v}
                    showIndicator={prefs.indicators}
                    selected={!!selRange && v.number >= selRange.start && v.number <= selRange.end}
                    onSelect={(extend) => selectVerse(v.number, extend)}
                    onPressStart={() => {
                      window.clearTimeout(pressTimer.current);
                      pressTimer.current = window.setTimeout(() => {
                        if (anchor.current === null) anchor.current = v.number;
                        selectVerse(v.number, true);
                        pressTimer.current = -1;
                      }, 550);
                    }}
                    onPressEnd={() => window.clearTimeout(pressTimer.current)}
                    pressTimer={pressTimer}
                    bookName={shown.book.name}
                    chapter={shown.chapter}
                  />
                ))}
              </div>

              <nav className="mx-auto mt-16 grid grid-cols-1 max-w-[68ch] gap-3 sm:grid-cols-2" aria-label="Chapters">
                {prev ? (
                  <Link to={`/read/${prev.book}/${prev.chapter}`} className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 no-underline shadow-xs transition hover:border-line-2 hover:no-underline hover:shadow-md dark:bg-white/[0.03]">
                    <ChevronLeft className="size-5 shrink-0 text-ink-3 transition group-hover:-translate-x-0.5 group-hover:text-ink" aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-xs text-ink-3">Previous chapter</span>
                      <span className="block truncate font-display text-lg font-semibold text-ink">{bookName(prev.book)} {prev.chapter}</span>
                    </span>
                  </Link>
                ) : (
                  <span className="hidden sm:block" />
                )}
                {next && (
                  <Link to={`/read/${next.book}/${next.chapter}`} className="group flex items-center justify-end gap-3 rounded-2xl border border-border bg-card p-4 text-right no-underline shadow-xs transition hover:border-line-2 hover:no-underline hover:shadow-md dark:bg-white/[0.03]">
                    <span className="min-w-0">
                      <span className="block text-xs text-ink-3">Next chapter</span>
                      <span className="block truncate font-display text-lg font-semibold text-ink">{bookName(next.book)} {next.chapter}</span>
                    </span>
                    <ChevronRight className="size-5 shrink-0 text-ink-3 transition group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />
                  </Link>
                )}
              </nav>
              <p className="mt-6 hidden text-center text-xs text-ink-3 lg:block">
                Tip: <kbd className="kbd-hint">Alt</kbd> + <kbd className="kbd-hint">←</kbd> / <kbd className="kbd-hint">→</kbd> changes chapter · <kbd className="kbd-hint">Shift</kbd>-click selects a range
              </p>
            </>
          )}
        </article>
      </div>

      {refId && desktop && (
        <aside className="panel" aria-label="Verse insights">
          <VerseIntelligencePanel refId={refId} translation={translation} onClose={clearSelection} variant="panel" />
        </aside>
      )}

      {/* phones & tablets: a quiet action bar for the selected verse */}
      {refId && !desktop && !sheetOpen && shown && (
        <div className="fixed inset-x-3 bottom-[calc(var(--bottom-nav-h)+12px)] z-40 mx-auto flex max-w-lg animate-sheet-up items-center gap-1 rounded-2xl border border-border bg-popover/95 p-1.5 pl-4 shadow-xl shadow-navy-950/15 backdrop-blur-xl dark:shadow-black/40" role="toolbar" aria-label={`Actions for ${selectionLabel}`}>
          <span className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold text-ink">
            <span className="min-[420px]:hidden">{selectionLabel.replace(/^.*\s(?=\d+:)/, "")}</span>
            <span className="hidden min-[420px]:inline">{selectionLabel}</span>
          </span>
          <button type="button" onClick={() => setSheetOpen(true)} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-sm transition active:scale-[0.98]">
            <Sparkles className="size-4" aria-hidden /> Insights
          </button>
          <button type="button" onClick={copySelection} className="grid grid-cols-1 size-10 shrink-0 place-items-center rounded-xl text-ink-2 transition hover:bg-surface-2" aria-label="Copy verse text">
            <Copy className="size-[18px]" aria-hidden />
          </button>
          <button type="button" onClick={shareSelection} className="grid grid-cols-1 size-10 shrink-0 place-items-center rounded-xl text-ink-2 transition hover:bg-surface-2" aria-label="Share this passage">
            <Share2 className="size-[18px]" aria-hidden />
          </button>
          <button type="button" onClick={clearSelection} className="grid grid-cols-1 size-10 shrink-0 place-items-center rounded-xl text-ink-3 transition hover:bg-surface-2 hover:text-ink" aria-label="Clear selection">
            <X className="size-[18px]" aria-hidden />
          </button>
        </div>
      )}

      <Drawer.Root open={!!refId && !desktop && sheetOpen} onOpenChange={setSheetOpen}>
        <Drawer.Portal>
          <Drawer.Backdrop className="fixed inset-0 z-[60] bg-navy-950/45 opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-300 data-ending-style:opacity-0 data-starting-style:opacity-0 data-swiping:duration-0 lg:hidden" />
          <Drawer.Viewport className="fixed inset-0 z-[60] flex items-end justify-center lg:hidden">
            <Drawer.Popup
              className="flex h-[min(88dvh,920px)] w-full max-w-2xl flex-col overflow-hidden rounded-t-[26px] border-t border-border bg-paper-2 shadow-2xl outline-none [transform:translateY(var(--drawer-swipe-movement-y,0px))] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:[transform:translateY(100%)] data-starting-style:[transform:translateY(100%)] data-swiping:duration-0"
            >
              <div className="mx-auto mt-2.5 mb-0.5 h-1.5 w-10 shrink-0 rounded-full bg-line-2" aria-hidden />
              <Drawer.Title className="sr-only">Verse insights for {selectionLabel}</Drawer.Title>
              {refId && <VerseIntelligencePanel refId={refId} translation={translation} onClose={() => setSheetOpen(false)} variant="sheet" />}
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}

function ChapterStep({ direction, target }: { direction: "prev" | "next"; target: { to: string; label: string } | null }) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  const base = "grid grid-cols-1 size-10 shrink-0 place-items-center rounded-xl border border-border bg-card text-ink-2 shadow-xs transition outline-none dark:bg-white/[0.04]";
  if (!target) {
    return (
      <span className={cn(base, "opacity-40")} aria-hidden>
        <Icon className="size-[18px]" />
      </span>
    );
  }
  const label = `${direction === "prev" ? "Previous" : "Next"} chapter: ${target.label}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Link to={target.to} aria-label={label} className={cn(base, "no-underline hover:border-line-2 hover:bg-surface-2 hover:text-ink hover:no-underline focus-visible:ring-3 focus-visible:ring-ring dark:hover:bg-white/[0.08]")} />}
      >
        <Icon className="size-[18px]" aria-hidden />
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {target.label} <span className="ml-1 text-white/60">Alt {direction === "prev" ? "←" : "→"}</span>
      </TooltipContent>
    </Tooltip>
  );
}

function ChapterSkeleton() {
  return (
    <div className="animate-pulse pt-12" aria-hidden>
      <div className="mx-auto h-3 w-40 rounded-full bg-surface-2" />
      <div className="mx-auto mt-4 h-12 w-56 rounded-xl bg-surface-2" />
      <div className="mx-auto mt-4 h-3 w-48 rounded-full bg-surface-2" />
      <div className="mx-auto mt-12 grid grid-cols-1 max-w-[68ch] gap-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-4 rounded-full bg-surface-2" style={{ width: `${96 - ((i * 17) % 30)}%` }} />
        ))}
      </div>
    </div>
  );
}

function VerseSpan({ v, showIndicator, selected, onSelect, onPressStart, onPressEnd, pressTimer, bookName, chapter }: {
  v: ChapterVerse; showIndicator: boolean; selected: boolean; onSelect: (extend: boolean) => void; onPressStart: () => void; onPressEnd: () => void;
  pressTimer: MutableRefObject<number | undefined>; bookName: string; chapter: number;
}) {
  const ind = v.indicators;
  const resourceNote = ind ? `${ind.total} library section${ind.total === 1 ? "" : "s"} discuss this verse` : "";
  const label = `${bookName} ${chapter}:${v.number}${ind ? `, ${resourceNote}` : ""}`;
  return (
    <span
      id={`v${v.number}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={label}
      className={cn("verse", selected && "selected")}
      onClick={(e) => {
        if (pressTimer.current === -1) {
          pressTimer.current = undefined;
          return;
        }
        onSelect(e.shiftKey);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(e.shiftKey);
        }
      }}
      onTouchStart={onPressStart}
      onTouchEnd={onPressEnd}
      onTouchMove={onPressEnd}
    >
      <sup className="verse-num">{v.number}</sup>
      {showIndicator && ind && (
        <span
          className={cn("verse-dot", !ind.explicit && "soft")}
          title={`${resourceNote}: ${ind.watch} video · ${ind.listen} audio · ${ind.study} study${ind.explicit ? "" : " (related by context)"}`}
          aria-hidden
        />
      )}
      {v.text ?? <span className="font-sans text-sm text-ink-3">(not in this translation)</span>}{" "}
    </span>
  );
}

export function ReadRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    let target = "/read/ROM/8?v=28";
    try {
      const last = JSON.parse(localStorage.getItem("ibible_last_read") || "null");
      if (last?.book) target = `/read/${last.book}/${last.chapter}${last.v ? `?v=${last.v}` : ""}`;
    } catch {
      /* ignore */
    }
    navigate(target, { replace: true });
  }, [navigate]);
  return null;
}

export function VersePage() {
  const { ref = "" } = useParams();
  const [search] = useSearchParams();
  const translation = search.get("t") || loadPrefs().translation;
  return (
    <div className="mx-auto w-full max-w-3xl px-0 pb-10 sm:px-6 sm:pt-6">
      <div className="bg-paper-2 sm:overflow-clip sm:rounded-2xl sm:border sm:border-border sm:shadow-sm">
        <VerseIntelligencePanel refId={decodeURIComponent(ref)} translation={translation} variant="page" />
      </div>
    </div>
  );
}
