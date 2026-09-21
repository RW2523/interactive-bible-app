import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, BookOpen, History, Library, Loader2, MessageCircleQuestion, Search, SearchX, Sparkles, Tags, Users, Video, X, type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAsk, useBooks, useSearch } from "../api/hooks";
import type { Book, SearchResponse, SearchVerse } from "../api/types";
import { AnswerCard, AnswerSkeleton } from "../components/AnswerCard";
import { buttonClass, EmptyState, FilterChip, PageContainer, PageHeader, SegmentedControl, Skeleton } from "../components/page";
import { ResourceCard } from "../components/ResourceCard";
import { ErrorState } from "../components/ui";
import { clearRecent, pushRecent, removeRecent, useRecent } from "../lib/recent";
import { cn } from "../lib/utils";
import { splitReasons } from "../lib/reasons";
import { readHref } from "../utils/format";

const EXAMPLES: { group: string; icon: LucideIcon; items: string[] }[] = [
  { group: "Find verses", icon: BookOpen, items: ["Verses about trusting God when everything goes wrong", "Where does Jesus teach about forgiveness?"] },
  { group: "Find sermons & studies", icon: Video, items: ["Show sermons that explain Romans 8:28", "Videos discussing faith during suffering"] },
  { group: "Connect passages", icon: Sparkles, items: ["Find resources that compare Genesis 50:20 and Romans 8:28"] },
];

const TYPES = [["video", "Videos"], ["audio", "Audio"], ["sermon", "Sermons"], ["study", "Studies"], ["devotional", "Devotionals"], ["article", "Articles"]] as const;

/** "ROM.8.28-ROM.8.30" → "Romans 8:28–30" */
function displayCanonical(ref: string, books: Book[] | undefined): string {
  const name = (code: string) => books?.find((b) => b.code === code)?.name || code;
  const [a, b] = ref.split("-");
  const m = a?.match(/^([1-3]?[A-Z]{2,3})\.(\d+)\.(\d+)$/);
  if (!m) return ref;
  const n = b?.match(/^([1-3]?[A-Z]{2,3})\.(\d+)\.(\d+)$/);
  if (!n) return `${name(m[1])} ${m[2]}:${m[3]}`;
  if (n[1] !== m[1]) return `${name(m[1])} ${m[2]}:${m[3]} – ${name(n[1])} ${n[2]}:${n[3]}`;
  return n[2] === m[2] ? `${name(m[1])} ${m[2]}:${m[3]}–${n[3]}` : `${name(m[1])} ${m[2]}:${m[3]}–${n[2]}:${n[3]}`;
}

function useAiConfigured() {
  const q = useQuery({ queryKey: ["system-ai"], queryFn: () => api<{ ai?: { configured?: boolean } }>("/v1/system/status"), staleTime: 5 * 60_000, retry: false });
  return q.data ? q.data.ai?.configured !== false : true;
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") || "";
  const scope = params.get("scope") || "";
  const types = (params.get("types") || "").split(",").filter(Boolean);
  const askRequested = params.get("ask") === "1";
  const [text, setText] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setText(query), [query]);
  useEffect(() => {
    if (!query && window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
  }, [query]);

  const q = useSearch(query ? { query, scope: scope || undefined, resource_types: types } : null);
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    set({ q: text.trim() || null });
  };

  const d = q.data;
  useEffect(() => {
    if (!q.data || !query) return;
    pushRecent({ kind: "search", key: query.toLowerCase(), label: query, detail: `${q.data.verses.length} verses · ${q.data.segments.length} library sections`, href: `/search?q=${encodeURIComponent(query)}` });
  }, [q.data, query]);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Search & Ask"
        icon={Search}
        title={askRequested && !query ? "Ask a question about the Bible" : "Search the Bible by meaning"}
        description={
          askRequested && !query
            ? "Ask in your own words. The AI answers from Scripture and your library, and shows its sources."
            : "Describe what you're looking for in everyday words, or type a reference. Each result shows why it matched."
        }
      />

      <form onSubmit={submit} role="search" className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-3" aria-hidden />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={askRequested ? "e.g. What does the Bible say about worry?" : "Try “hope in suffering” or “Romans 8:28”"}
          aria-label="Search Scripture and your library"
          enterKeyHint="search"
          className="h-14 w-full rounded-2xl border border-input bg-card pr-32 pl-12 text-base text-ink shadow-sm outline-none transition placeholder:text-ink-3 focus:border-ring focus:ring-4 focus:ring-ring/40 sm:text-[17px] dark:bg-white/[0.04]"
        />
        <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
          {text && (
            <button type="button" onClick={() => { setText(""); inputRef.current?.focus(); }} className="grid grid-cols-1 size-9 place-items-center rounded-xl text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Clear">
              <X className="size-4" aria-hidden />
            </button>
          )}
          <button type="submit" className={buttonClass("primary", "md", "h-10")} disabled={!text.trim()}>
            {q.isFetching ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Search
          </button>
        </div>
      </form>

      <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
        <SegmentedControl
          ariaLabel="Where to search"
          value={scope || "both"}
          onChange={(v) => set({ scope: v === "both" ? null : v })}
          options={[
            { value: "both", label: "Bible & library" },
            { value: "bible", label: "Bible", icon: BookOpen },
            { value: "resources", label: "Library", icon: Library },
          ]}
          className="self-start"
        />
        {scope !== "bible" && (
          <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0" aria-label="Library types">
            {TYPES.map(([id, label]) => (
              <FilterChip
                key={id}
                active={types.includes(id)}
                onClick={() => {
                  const s = new Set(types);
                  if (s.has(id)) s.delete(id);
                  else s.add(id);
                  set({ types: [...s].join(",") || null });
                }}
              >
                {label}
              </FilterChip>
            ))}
          </div>
        )}
      </div>

      {!query && <SearchStart askRequested={askRequested} onPick={(v) => set({ q: v })} />}

      {query && (
        <div className="mt-8">
          {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
          {q.isLoading && <ResultsSkeleton />}
          {d && <Results d={d} query={query} askRequested={askRequested} requestedScope={scope} onExample={(v) => set({ q: v, types: null, scope: null })} />}
        </div>
      )}
    </PageContainer>
  );
}

function SearchStart({ askRequested, onPick }: { askRequested: boolean; onPick: (q: string) => void }) {
  const recent = useRecent(["search"], 6);
  return (
    <div className="mt-10 grid grid-cols-1 gap-10">
      {recent.length > 0 && (
        <section aria-labelledby="recent-searches">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="recent-searches" className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.1em] text-ink-3 uppercase"><History className="size-3.5" aria-hidden /> Recent searches</h2>
            <button type="button" onClick={() => clearRecent(["search"])} className="text-xs font-medium text-ink-3 hover:text-ink">Clear</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {recent.map((r) => (
              <span key={r.key} className="group inline-flex h-9 items-center overflow-hidden rounded-full border border-border bg-card text-[13px] text-ink-2 shadow-xs dark:bg-white/[0.03]">
                <button type="button" onClick={() => onPick(r.label)} className="h-full max-w-[18rem] truncate pr-2 pl-3.5 hover:text-ink">{r.label}</button>
                <button type="button" onClick={() => removeRecent("search", r.key)} className="grid grid-cols-1 h-full w-8 place-items-center text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label={`Remove “${r.label}” from recent searches`}>
                  <X className="size-3.5" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="examples-title">
        <h2 id="examples-title" className="font-display text-xl font-semibold text-ink">Not sure where to start?</h2>
        <p className="mt-1 text-sm text-ink-3">Tap an example — you can ask the same way in your own words.</p>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          {EXAMPLES.map((g) => {
            const Icon = g.icon;
            return (
              <div key={g.group} className="rounded-2xl border border-border bg-card p-4 shadow-xs dark:bg-white/[0.03]">
                <p className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold tracking-[0.1em] text-ink-3 uppercase"><Icon className="size-3.5" aria-hidden /> {g.group}</p>
                <div className="grid grid-cols-1 gap-1.5">
                  {g.items.map((item) => (
                    <button key={item} type="button" onClick={() => onPick(item)} className="group flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm/snug text-ink transition hover:bg-surface-2 dark:hover:bg-white/[0.05]">
                      <span>{item}</span>
                      <ArrowRight className="mt-0.5 size-4 shrink-0 text-ink-3 opacity-0 transition group-hover:opacity-100" aria-hidden />
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className={cn("flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center", askRequested ? "border-gold-500/35 bg-gold-50/70 dark:border-gold-400/25 dark:bg-gold-400/[0.06]" : "border-border bg-card dark:bg-white/[0.03]")}>
        <span className="grid grid-cols-1 size-11 shrink-0 place-items-center rounded-xl bg-gold-100 text-gold-700 dark:bg-gold-400/15 dark:text-gold-300"><MessageCircleQuestion className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">How Ask AI works</p>
          <p className="mt-0.5 text-sm/relaxed text-ink-2">Search first — then choose <b>Ask AI</b> on the results. The answer is grounded in the best-matching passage, the verses around it and your library, and every source is linked so you can check it.</p>
        </div>
      </section>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6" aria-hidden>
      <Skeleton className="h-6 w-2/3" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {[0, 1].map((col) => (
          <div key={col} className="grid grid-cols-1 gap-3">
            <Skeleton className="h-4 w-32" />
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function Results({ d, query, askRequested, requestedScope, onExample }: { d: SearchResponse; query: string; askRequested: boolean; requestedScope: string; onExample: (q: string) => void }) {
  const [mobileList, setMobileList] = useState<"verses" | "library">("verses");
  const books = useBooks();
  const showVerses = d.scope !== "resources";
  const showLibrary = d.scope !== "bible";
  const total = (showVerses ? d.verses.length : 0) + (showLibrary ? d.segments.length : 0);
  const understood: { icon: LucideIcon; label: string }[] = [
    ...d.parsed.explicit_refs.map((r) => ({ icon: BookOpen, label: displayCanonical(r, books.data) })),
    ...d.parsed.topics.map((t) => ({ icon: Tags, label: t })),
    ...d.parsed.entities.map((e) => ({ icon: Users, label: e })),
  ];

  if (total === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title={`No results for “${query}”`}
        description={
          <>
            Try fewer or different words, describe the idea instead of exact wording, or search {d.scope === "bible" ? "the library too" : d.scope === "resources" ? "the Bible too" : "for a book and chapter like “Psalm 23”"}.
          </>
        }
        action={
          <>
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => onExample("Verses about hope in suffering")}>Hope in suffering</button>
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => onExample("Psalm 23")}>Psalm 23</button>
          </>
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-[15px] text-ink-2">
          <span className="font-semibold text-ink">{showVerses ? d.verses.length : 0} verses</span>
          {showLibrary && <> and <span className="font-semibold text-ink">{d.segments.length} library sections</span></>} for “{query}”
        </p>
        {d.scope === "resources" && !requestedScope && (
          <p className="text-[13px] text-ink-3">
            Showing your library only, because your search asks for {d.parsed.resource_types.length ? d.parsed.resource_types.join(", ") : "resources"}. Choose <b>Bible</b> above to search verses instead.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
          {understood.length > 0 && <span>Understood:</span>}
          {understood.map((u) => {
            const Icon = u.icon;
            return (
              <span key={u.label} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 font-medium text-ink-2 dark:bg-white/[0.06]">
                <Icon className="size-3" aria-hidden /> {u.label}
              </span>
            );
          })}
          <span className={cn(understood.length > 0 && "ml-1")}>
            {d.semantic ? "Searched by meaning" : "Keyword and reference search"}
            {d.reranked ? " · ranked with AI" : ""} · {d.latency_ms < 1000 ? `${d.latency_ms} ms` : `${(d.latency_ms / 1000).toFixed(1)} s`}
          </span>
        </div>
      </div>

      <AskCard key={query} d={d} query={query} autoAsk={askRequested} books={books.data} />

      {showVerses && showLibrary && (
        <SegmentedControl
          ariaLabel="Show results"
          value={mobileList}
          onChange={setMobileList}
          className="w-full lg:hidden [&>button]:flex-1"
          options={[
            { value: "verses", label: `Scripture (${d.verses.length})`, icon: BookOpen },
            { value: "library", label: `Library (${d.segments.length})`, icon: Library },
          ]}
        />
      )}

      <div className={cn("grid grid-cols-1 items-start gap-8", showVerses && showLibrary && "lg:grid-cols-2")}>
        {showVerses && (
          <section aria-labelledby="verse-results" className={cn(showLibrary && mobileList !== "verses" && "hidden lg:block")}>
            <h2 id="verse-results" className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-ink">
              <BookOpen className="size-[18px] text-gold-600 dark:text-gold-400" aria-hidden /> Scripture <span className="font-sans text-sm font-normal text-ink-3">{d.verses.length}</span>
            </h2>
            {d.verses.length === 0 ? (
              <EmptyState compact icon={BookOpen} title="No verses matched" description="Try describing the idea in different words." />
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {d.verses.map((v) => <VerseResult key={v.ref} v={v} />)}
              </div>
            )}
          </section>
        )}
        {showLibrary && (
          <section aria-labelledby="library-results" className={cn(showVerses && mobileList !== "library" && "hidden lg:block")}>
            <h2 id="library-results" className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-ink">
              <Library className="size-[18px] text-gold-600 dark:text-gold-400" aria-hidden /> From your library <span className="font-sans text-sm font-normal text-ink-3">{d.segments.length}</span>
            </h2>
            {d.segments.length === 0 ? (
              <EmptyState
                compact
                icon={Library}
                title="No library sections matched"
                description="Nothing in your library discusses this yet."
                action={<Link to="/admin/ingest" className={buttonClass("secondary", "sm")}>Add to library</Link>}
              />
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {d.segments.map((s) => <ResourceCard key={s.segment_id} card={s} verseRef={s.verse_ref || undefined} showVerse />)}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function VerseResult({ v }: { v: SearchVerse }) {
  const { chips, explanation } = splitReasons(v.reasons);
  const match = Math.round(Math.min(1, v.score) * 100);
  return (
    <article className="group rounded-2xl border border-border bg-card p-4 shadow-xs transition hover:border-line-2 hover:shadow-md dark:bg-white/[0.03]">
      <div className="flex items-start justify-between gap-3">
        <Link to={readHref(v.ref)} className="font-display text-lg font-semibold text-ink no-underline decoration-gold-500/60 underline-offset-4 hover:underline">
          {v.display_ref}
        </Link>
        <span className="inline-flex shrink-0 items-center gap-2 text-xs text-ink-3" title="How closely this verse matches your search">
          <span className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-2 dark:bg-white/10" aria-hidden>
            <span className="block h-full rounded-full bg-gold-500" style={{ width: `${match}%` }} />
          </span>
          {match}%
        </span>
      </div>
      <p className="mt-1.5 font-serif text-[16px]/relaxed text-ink">{v.text}</p>
      {explanation && <p className="mt-2 text-[13px]/relaxed text-ink-2 italic">{explanation}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {chips.map((c) => {
          const Icon = c.icon;
          return (
            <span key={c.label} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-medium text-ink-2 dark:bg-white/[0.06]">
              <Icon className="size-3" aria-hidden /> {c.label}
            </span>
          );
        })}
        <span className="flex-1" />
        <Link to={`/verse/${encodeURIComponent(v.ref)}`} className={buttonClass("ghost", "sm", "text-ink-3")}>
          <Sparkles aria-hidden /> Insights
        </Link>
        <Link to={readHref(v.ref)} className={buttonClass("secondary", "sm")}>
          Read <ArrowRight aria-hidden />
        </Link>
      </div>
    </article>
  );
}

/** Ask AI about the search: grounded in one passage (a reference in the query, or the best verse match). */
function AskCard({ d, query, autoAsk, books }: { d: SearchResponse; query: string; autoAsk: boolean; books: Book[] | undefined }) {
  const aiConfigured = useAiConfigured();
  const ask = useAsk();
  const candidates = useMemo(() => {
    const list: { ref: string; label: string }[] = [];
    d.parsed.explicit_refs.forEach((r) => {
      const hit = d.verses.find((v) => v.ref === r || r.startsWith(`${v.ref}-`));
      list.push({ ref: r, label: hit?.display_ref || displayCanonical(r, books) });
    });
    d.verses.slice(0, 4).forEach((v) => list.push({ ref: v.ref, label: v.display_ref }));
    d.segments.forEach((s) => s.verse_ref && list.push({ ref: s.verse_ref, label: s.verse_display || s.verse_ref }));
    const seen = new Set<string>();
    return list.filter((c) => (seen.has(c.ref) ? false : (seen.add(c.ref), true))).slice(0, 5);
  }, [d, books]);
  const [ref, setRef] = useState(candidates[0]?.ref ?? "");
  const [askedFor, setAskedFor] = useState<{ ref: string; label: string } | null>(null);
  const autoFired = useRef(false);

  useEffect(() => setRef(candidates[0]?.ref ?? ""), [candidates]);

  const run = (target: string) => {
    const c = candidates.find((x) => x.ref === target);
    if (!c || ask.isPending) return;
    setAskedFor(c);
    ask.mutate({ ref: c.ref, question: query, translation: "web" });
  };

  useEffect(() => {
    if (!autoAsk || !aiConfigured || !candidates[0] || query.trim().length < 3) return;
    if (autoFired.current) return; // once per question — changing filters never re-asks
    autoFired.current = true;
    run(candidates[0].ref);
  }, [autoAsk, aiConfigured, candidates, query]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!aiConfigured || candidates.length === 0 || query.trim().length < 3) return null;

  if (ask.isPending) return <AnswerSkeleton label={`Answering from ${askedFor?.label ?? "the best passage"} and your library…`} />;
  if (ask.data && askedFor) {
    return (
      <div className="grid grid-cols-1 gap-2">
        <AnswerCard data={ask.data} question={query} grounding={askedFor.label} />
        {candidates.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <span>Ask about a different passage:</span>
            {candidates.filter((c) => c.ref !== askedFor.ref).slice(0, 3).map((c) => (
              <button key={c.ref} type="button" onClick={() => run(c.ref)} className="rounded-full border border-border bg-card px-2.5 py-1 font-medium text-ink-2 hover:bg-surface-2 hover:text-ink dark:bg-white/[0.03]">
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-gold-500/30 bg-gold-50/60 p-4 sm:flex-row sm:items-center sm:p-5 dark:border-gold-400/20 dark:bg-gold-400/[0.05]" aria-label="Ask AI">
      <span className="grid grid-cols-1 size-11 shrink-0 place-items-center rounded-xl bg-gold-100 text-gold-700 dark:bg-gold-400/15 dark:text-gold-300"><Sparkles className="size-5" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">Want a direct answer?</p>
        <p className="mt-0.5 text-sm/relaxed text-ink-2">
          Ask AI answers “{query.length > 70 ? `${query.slice(0, 70)}…` : query}” from a passage and your library, with sources. About 10 seconds.
        </p>
        {ask.error && <div className="mt-3"><ErrorState error={ask.error} onRetry={() => run(ref)} /></div>}
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:items-end">
        {candidates.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-ink-3">
            Based on
            <select className="select h-8 w-auto rounded-lg py-0 pr-8 pl-2.5 text-[13px]" value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Passage to ground the answer in">
              {candidates.map((c) => <option key={c.ref} value={c.ref}>{c.label}</option>)}
            </select>
          </label>
        )}
        <button type="button" onClick={() => run(ref)} className={buttonClass("primary")}>
          <Sparkles aria-hidden /> Ask AI{candidates.length === 1 ? ` about ${candidates[0].label}` : ""}
        </button>
      </div>
    </section>
  );
}
