import { ArrowLeft, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBooks } from "@/api/hooks";
import type { Book } from "@/api/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** "Romans 8 ▾" — pick a book (left) and a chapter (right); on phones the two panes become two steps. */
export function BookChapterPicker({ book, chapter, bookName }: { book: string; chapter: number; bookName?: string }) {
  const books = useBooks();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(book);
  const [step, setStep] = useState<"book" | "chapter">("chapter");
  const [filter, setFilter] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPicked(book);
    setStep("chapter");
    setFilter("");
    // bring the current book into view
    window.requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-book="${book}"]`)?.scrollIntoView({ block: "center" }));
  }, [open, book]);

  const current = books.data?.find((b) => b.code === book);
  const selected = books.data?.find((b) => b.code === picked) || current;
  const matches = useMemo(() => {
    const f = filter.trim().toLowerCase().replace(/\s+/g, "");
    const all = books.data || [];
    return f ? all.filter((b) => b.name.toLowerCase().replace(/\s+/g, "").includes(f) || b.code.toLowerCase() === f) : all;
  }, [books.data, filter]);
  const groups: [string, Book[]][] = [
    ["Old Testament", matches.filter((b) => b.testament === "OT")],
    ["New Testament", matches.filter((b) => b.testament === "NT")],
  ];

  const choose = (b: Book) => {
    setPicked(b.code);
    setStep("chapter");
    if (b.chapters === 1) go(b.code, 1);
  };
  const go = (code: string, ch: number) => {
    setOpen(false);
    navigate(`/read/${code}/${ch}`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="inline-flex h-10 min-w-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-left shadow-xs transition outline-none hover:border-line-2 hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring data-popup-open:border-line-2 data-popup-open:bg-surface-2 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
        aria-label={`Choose book and chapter (currently ${bookName || current?.name || book} ${chapter})`}
      >
        <span className="truncate font-display text-[17px] font-semibold text-ink">{bookName || current?.name || book} {chapter}</span>
        <ChevronDown className="size-4 shrink-0 text-ink-3" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} initialFocus={(openType) => (openType === "touch" ? false : filterRef.current)} className="w-[min(640px,calc(100vw-24px))] overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="size-4 shrink-0 text-ink-3" aria-hidden />
          <input
            ref={filterRef}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setStep("book");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches[0]) {
                e.preventDefault();
                choose(matches[0]);
              }
            }}
            placeholder="Find a book…"
            aria-label="Find a book"
            className="h-8 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
          />
          <span className="hidden text-xs text-ink-3 sm:inline">66 books</span>
        </div>
        <div className="grid grid-cols-1 h-[min(62dvh,440px)] sm:grid-cols-[210px_1fr]">
          {/* books */}
          <div ref={listRef} className={cn("min-h-0 overflow-y-auto overscroll-contain border-border px-2 pb-2 sm:border-r", step === "chapter" && "hidden sm:block")} role="listbox" aria-label="Books">
            {groups.map(([label, list]) =>
              list.length ? (
                <div key={label} className="mb-2">
                  <div className="sticky top-0 z-[1] bg-popover px-2 pt-2.5 pb-1.5 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">{label}</div>
                  {list.map((b) => {
                    const isPicked = b.code === selected?.code;
                    return (
                      <button
                        key={b.code}
                        type="button"
                        role="option"
                        aria-selected={isPicked}
                        data-book={b.code}
                        onClick={() => choose(b)}
                        className={cn(
                          "flex h-9 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left text-sm transition",
                          isPicked ? "bg-navy-700 font-semibold text-white dark:bg-gold-400 dark:text-navy-900" : "text-ink-2 hover:bg-surface-2 hover:text-ink dark:hover:bg-white/[0.06]",
                        )}
                      >
                        <span className="truncate">{b.name}</span>
                        <span className={cn("text-[11px] tabular-nums", isPicked ? "opacity-75" : "text-ink-3")}>{b.chapters}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null,
            )}
            {books.data && matches.length === 0 && <p className="px-3 py-6 text-center text-sm text-ink-3">No book matches “{filter}”.</p>}
          </div>
          {/* chapters */}
          <div className={cn("min-h-0 overflow-y-auto overscroll-contain p-3", step === "book" && "hidden sm:block")}>
            {selected ? (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <button type="button" onClick={() => setStep("book")} className="grid grid-cols-1 size-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink sm:hidden" aria-label="Back to books">
                    <ArrowLeft className="size-4" aria-hidden />
                  </button>
                  <div className="min-w-0">
                    <div className="truncate font-display text-lg font-semibold text-ink">{selected.name}</div>
                    <div className="text-xs text-ink-3">{selected.chapters} chapter{selected.chapters === 1 ? "" : "s"} · {selected.genre}</div>
                  </div>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1.5" role="listbox" aria-label={`${selected.name} chapters`}>
                  {Array.from({ length: selected.chapters }, (_, i) => i + 1).map((c) => {
                    const isCurrent = selected.code === book && c === chapter;
                    return (
                      <button
                        key={c}
                        type="button"
                        role="option"
                        aria-selected={isCurrent}
                        onClick={() => go(selected.code, c)}
                        className={cn(
                          "grid grid-cols-1 h-10 place-items-center rounded-lg border text-sm font-medium tabular-nums transition",
                          isCurrent
                            ? "border-navy-700 bg-navy-700 text-white dark:border-gold-400 dark:bg-gold-400 dark:text-navy-900"
                            : "border-border bg-card text-ink-2 hover:border-line-2 hover:bg-surface-2 hover:text-ink dark:bg-white/[0.03] dark:hover:bg-white/[0.08]",
                        )}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="grid grid-cols-1 gap-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-surface-2" />)}</div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
