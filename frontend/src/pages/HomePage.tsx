import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, BookOpen, CalendarDays, Clapperboard, Clock, Compass, FileText, Headphones, Library, MapPin, Network, PenLine, Plus, Search, Sparkles, Video,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { useBooks, useChapter, useResources } from "@/api/hooks";
import { useAuth } from "@/auth/AuthContext";
import { MediaThumb } from "@/components/MediaThumb";
import { buttonClass, SectionHeading, Skeleton } from "@/components/page";
import { getBibleEventSpriteStyle } from "@/features/explore/utils/bibleEventSprites.js";
import type { SermonListItem } from "@/features/sermons/types";
import { listProgress } from "@/features/sermons/workspace";
import { useRecent } from "@/lib/recent";
import { useScriptureJump } from "@/lib/scripture";
import { cn, timeAgo } from "@/lib/utils";
import { thumbnailFor } from "@/lib/youtube";
import { fmtDuration } from "@/utils/format";

const VERSES_OF_THE_DAY: [string, number, number, string][] = [
  ["JHN", 3, 16, "John 3:16"], ["ROM", 8, 28, "Romans 8:28"], ["PSA", 23, 1, "Psalm 23:1"], ["PHP", 4, 6, "Philippians 4:6"],
  ["ISA", 40, 31, "Isaiah 40:31"], ["PRO", 3, 5, "Proverbs 3:5"], ["JER", 29, 11, "Jeremiah 29:11"], ["MAT", 11, 28, "Matthew 11:28"],
  ["JOS", 1, 9, "Joshua 1:9"], ["2CO", 5, 17, "2 Corinthians 5:17"], ["GAL", 5, 22, "Galatians 5:22"], ["HEB", 11, 1, "Hebrews 11:1"],
  ["1JN", 4, 19, "1 John 4:19"], ["LAM", 3, 22, "Lamentations 3:22"], ["PSA", 46, 1, "Psalm 46:1"], ["MIC", 6, 8, "Micah 6:8"],
  ["EPH", 2, 8, "Ephesians 2:8"], ["ROM", 12, 2, "Romans 12:2"], ["JHN", 14, 27, "John 14:27"], ["ISA", 41, 10, "Isaiah 41:10"],
  ["MAT", 5, 9, "Matthew 5:9"], ["PSA", 119, 105, "Psalm 119:105"], ["COL", 3, 23, "Colossians 3:23"], ["1PE", 5, 7, "1 Peter 5:7"],
  ["JAS", 1, 5, "James 1:5"], ["ZEP", 3, 17, "Zephaniah 3:17"], ["DEU", 31, 8, "Deuteronomy 31:8"], ["2TI", 1, 7, "2 Timothy 1:7"],
  ["MAT", 6, 34, "Matthew 6:34"], ["PSA", 139, 14, "Psalm 139:14"], ["JHN", 16, 33, "John 16:33"],
];

const STARTING_POINTS: { book: string; chapter: number; label: string; note: string }[] = [
  { book: "GEN", chapter: 1, label: "Genesis 1", note: "In the beginning" },
  { book: "PSA", chapter: 23, label: "Psalm 23", note: "The Lord is my shepherd" },
  { book: "JHN", chapter: 1, label: "John 1", note: "The Word became flesh" },
  { book: "ROM", chapter: 8, label: "Romans 8", note: "No condemnation" },
];

function dayOfYear(d = new Date()): number {
  return Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86_400_000);
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Peace to you tonight" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

interface AtlasEvent {
  id: string;
  order?: number;
  title: string;
  era: string;
  timelineDate: string;
  mapLocation: string;
  references: string[];
  summary: string;
  lesson?: string;
  category: string;
}

/* ───────────────────────────── hero */

function HeroSearch() {
  const jump = useScriptureJump();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (value: string) => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await jump(value);
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(text);
  };
  const examples = ["John 3:16", "Psalm 23", "Hope in suffering", "Forgiveness"];
  return (
    <div>
      <form onSubmit={submit} className="relative" role="search" aria-label="Open a passage or search the Bible">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-white/55" aria-hidden />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a passage or a topic…"
          aria-label="Type a Bible reference to open it, or a topic to search"
          enterKeyHint="search"
          className="h-14 w-full rounded-2xl border border-white/15 bg-white/[0.09] pr-28 pl-12 text-base text-white shadow-lg shadow-black/10 outline-none backdrop-blur-md transition placeholder:text-white/50 focus:border-gold-300/60 focus:bg-white/[0.13] focus:ring-3 focus:ring-gold-300/25"
        />
        <button
          type="submit"
          disabled={busy}
          className="absolute top-1/2 right-2 inline-flex h-10 -translate-y-1/2 items-center gap-1.5 rounded-xl bg-gold-400 px-4 text-sm font-semibold text-navy-900 shadow-sm transition hover:bg-gold-300 disabled:opacity-70"
        >
          {busy ? "Opening…" : "Go"} <ArrowRight className="size-4" aria-hidden />
        </button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-white/60">Try</span>
        {examples.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => void run(c)}
            className="h-8 rounded-full border border-white/15 bg-white/[0.06] px-3 text-[13px] text-white/85 transition hover:border-gold-300/50 hover:bg-white/[0.12] hover:text-white"
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

function VerseOfTheDay() {
  const [book, chapter, verse, label] = VERSES_OF_THE_DAY[dayOfYear() % VERSES_OF_THE_DAY.length];
  const q = useChapter(book, chapter, "web");
  const text = q.data?.verses.find((v) => v.number === verse)?.text;
  return (
    <figure className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.07] p-6 shadow-2xl shadow-black/25 backdrop-blur-md sm:p-7">
      <div className="absolute -top-16 -right-16 size-48 rounded-full bg-gold-400/20 blur-3xl" aria-hidden />
      <figcaption className="relative flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-gold-300 uppercase">
        <CalendarDays className="size-4" aria-hidden /> Verse of the day
      </figcaption>
      <blockquote className="relative mt-4 font-serif text-[21px] leading-relaxed text-balance text-white sm:text-[23px]">
        {text ? `“${text}”` : q.isError ? "Open the reader to see today's verse." : (
          <span className="grid grid-cols-1 gap-2" aria-label="Loading verse">
            <span className="h-5 w-full animate-pulse rounded bg-white/10" />
            <span className="h-5 w-4/5 animate-pulse rounded bg-white/10" />
            <span className="h-5 w-2/3 animate-pulse rounded bg-white/10" />
          </span>
        )}
      </blockquote>
      <div className="relative mt-4 font-display text-base font-semibold text-gold-200">
        {label} <span className="ml-1 font-sans text-xs font-medium text-white/50">World English Bible</span>
      </div>
      <div className="relative mt-6 flex flex-wrap gap-2">
        <Link to={`/read/${book}/${chapter}?v=${verse}`} className={buttonClass("gold", "md")}>
          <BookOpen aria-hidden /> Read in context
        </Link>
        <Link to={`/verse/${book}.${chapter}.${verse}`} className={buttonClass("onDark", "md")}>
          <Sparkles className="text-gold-300" aria-hidden /> Verse insights
        </Link>
      </div>
    </figure>
  );
}

function Hero() {
  const { viewer } = useAuth();
  const name = viewer?.authenticated ? viewer.display_name?.split(" ")[0] : null;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return (
    <section className="hero-sky relative overflow-hidden rounded-[28px] px-5 py-8 text-white shadow-xl shadow-navy-950/15 sm:px-8 sm:py-10 lg:px-12 lg:py-12 dark:ring-1 dark:ring-white/10" aria-labelledby="home-title">
      <div className="star-field absolute inset-0 opacity-30" aria-hidden />
      <div className="relative grid grid-cols-1 items-center gap-8 lg:grid-cols-[1.15fr_1fr] lg:gap-12">
        <div className="animate-fade-up">
          <p className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-[13px] font-medium text-gold-200 backdrop-blur">
            <Sparkles className="size-3.5" aria-hidden />
            <span>{greeting()}{name ? `, ${name}` : ""}</span>
            <span className="text-white/35" aria-hidden>·</span>
            <span className="text-white/65">{today}</span>
          </p>
          <h1 id="home-title" className="mt-5 font-display text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl">
            What would you like to <span className="bg-gradient-to-r from-gold-200 via-gold-300 to-gold-400 bg-clip-text text-transparent">study</span> today?
          </h1>
          <p className="mt-4 max-w-xl text-[16px]/relaxed text-white/75">
            Open a passage, search Scripture by meaning, or pick up where you left off. Sermons, maps and stories are one click away.
          </p>
          <div className="mt-7 max-w-xl">
            <HeroSearch />
          </div>
        </div>
        <div className="animate-fade-up [animation-delay:120ms]">
          <VerseOfTheDay />
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────── daily cards */

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-6", className)}>{children}</div>;
}

function ContinueReading() {
  const last = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("ibible_last_read") || "null") as { book: string; chapter: number; v?: string | null } | null;
    } catch {
      return null;
    }
  }, []);
  const recentReads = useRecent(["read"], 5);
  const books = useBooks();
  const book = last?.book;
  const chapter = Number(last?.chapter || 1);
  const q = useChapter(book || "GEN", chapter, "web");
  const meta = books.data?.find((b) => b.code === book);
  const firstVerse = q.data?.verses.find((v) => String(v.number) === String(last?.v?.split("-")[0])) || q.data?.verses[0];
  const others = recentReads.filter((r) => r.key !== `${book}.${chapter}`).slice(0, 3);

  if (!last?.book) {
    return (
      <Card className="flex h-full flex-col">
        <SectionHeading icon={BookOpen} title="Start reading" description="Pick a well-loved chapter, or open any book from the reader." />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {STARTING_POINTS.map((p) => (
            <Link key={p.label} to={`/read/${p.book}/${p.chapter}`} className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2/40 px-4 py-3 no-underline transition hover:border-line-2 hover:bg-surface-2 hover:no-underline dark:bg-white/[0.03]">
              <span className="min-w-0">
                <span className="block font-display text-base font-semibold text-ink">{p.label}</span>
                <span className="block truncate text-[13px] text-ink-3">{p.note}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-ink-3 transition group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />
            </Link>
          ))}
        </div>
      </Card>
    );
  }

  const progress = meta ? Math.round((chapter / meta.chapters) * 100) : null;
  return (
    <Card className="flex h-full flex-col">
      <SectionHeading icon={BookOpen} title="Continue reading" />
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{meta ? `${meta.name} ${chapter}` : q.data ? `${q.data.book.name} ${chapter}` : <Skeleton className="h-8 w-40" />}</div>
        {meta && <span className="shrink-0 text-xs text-ink-3">Chapter {chapter} of {meta.chapters}</span>}
      </div>
      {progress !== null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Progress through ${meta?.name}`}>
          <div className="h-full rounded-full bg-gradient-to-r from-gold-400 to-gold-500" style={{ width: `${progress}%` }} />
        </div>
      )}
      {q.isLoading && !firstVerse?.text ? (
        <div className="mt-4 grid flex-1 grid-cols-1 content-start gap-2" aria-hidden>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ) : (
        <p className="mt-4 line-clamp-3 flex-1 font-serif text-[16px]/relaxed text-ink-2">
          {firstVerse?.text ? (
            <>
              <span className="mr-1 align-super font-sans text-[10px] font-bold text-gold-700 dark:text-gold-300">{firstVerse.number}</span>
              {firstVerse.text}
            </>
          ) : null}
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link to={`/read/${book}/${chapter}${last.v ? `?v=${last.v}` : ""}`} className={buttonClass("primary")}>
          Resume reading <ArrowRight aria-hidden />
        </Link>
        {others.map((r) => (
          <Link key={r.key} to={r.href} className={buttonClass("ghost", "sm", "text-ink-3")}>
            <Clock aria-hidden /> {r.label}
          </Link>
        ))}
      </div>
    </Card>
  );
}

function RecentSermons() {
  const { viewer, singleUser } = useAuth();
  const signedIn = !!viewer?.authenticated;
  const q = useQuery({ queryKey: ["sermons"], queryFn: () => api<{ items: SermonListItem[] }>("/v1/sermons"), enabled: signedIn, retry: false });
  const items = [...(q.data?.items || [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 3);
  return (
    <Card className="flex h-full flex-col">
      <SectionHeading
        icon={PenLine}
        title="Your sermons"
        action={
          signedIn && items.length > 0 ? (
            <Link to="/sermons?new=1" className={buttonClass("secondary", "sm")}>
              <Plus aria-hidden /> New sermon
            </Link>
          ) : null
        }
      />
      {!signedIn && !singleUser ? (
        <div className="flex flex-1 flex-col items-start justify-center gap-3 rounded-xl bg-surface-2/60 p-5 dark:bg-white/[0.03]">
          <p className="text-sm text-ink-2">Sign in to collect notes, polish a sermon with AI, design slides and publish a share page.</p>
          <Link to="/login" state={{ from: "/sermons" }} className={buttonClass("primary", "sm")}>Sign in to start</Link>
        </div>
      ) : q.isLoading ? (
        <div className="grid grid-cols-1 gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 flex-col items-start justify-center gap-3 rounded-xl border border-dashed border-line-2 p-5">
          <p className="font-display text-lg font-semibold text-ink">Your first sermon starts here</p>
          <p className="text-sm/relaxed text-ink-2">Bring notes, a voice memo or a passage. Sermon Studio helps you shape it, design slides and publish a share page.</p>
          <Link to="/sermons?new=1" className={buttonClass("primary", "sm")}><Plus aria-hidden /> Start a sermon</Link>
        </div>
      ) : (
        <ul className="-mx-2 grid grid-cols-1 gap-1">
          {items.map((s) => {
            const progress = listProgress(s);
            const published = progress.done >= 4;
            return (
              <li key={s.id}>
                <Link to={`/sermons/${s.id}`} className="group flex items-center gap-3 rounded-xl p-2 no-underline transition hover:bg-surface-2/70 hover:no-underline dark:hover:bg-white/[0.04]">
                  <span className="grid grid-cols-1 size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-2 text-gold-700 ring-1 ring-border dark:text-gold-300">
                    {s.cover_url ? <img src={s.cover_url} alt="" className="size-full object-cover" loading="lazy" /> : <FileText className="size-5" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{s.title || "Untitled sermon"}</span>
                    <span className="mt-0.5 block truncate text-xs text-ink-3">
                      {[s.scripture_ref, `Edited ${timeAgo(s.updated_at)}`].filter(Boolean).join(" · ")}
                    </span>
                    {progress.next ? (
                      <span className="mt-0.5 block truncate text-xs font-medium text-gold-700 dark:text-gold-300">Next: {progress.next}</span>
                    ) : (
                      <span className="mt-0.5 block text-xs font-medium text-ok sm:hidden">Published</span>
                    )}
                  </span>
                  <span className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
                    <span className={cn("text-[11px] font-semibold", published ? "text-ok" : "text-ink-3")}>{progress.label}</span>
                    <span className="flex gap-1" role="img" aria-label={`${progress.done} of 4 steps done`}>
                      {[1, 2, 3, 4].map((n) => (
                        <span key={n} className={cn("h-1.5 w-5 rounded-full", n <= progress.done ? "bg-gold-400" : "bg-surface-2 dark:bg-white/10")} />
                      ))}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {signedIn && items.length > 0 && (
        <Link to="/sermons" className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-semibold text-link no-underline hover:no-underline">
          All sermons <ArrowRight className="size-4" aria-hidden />
        </Link>
      )}
    </Card>
  );
}

/* ───────────────────────────── explore story */

function EventArt({ order }: { order?: number }) {
  let style: CSSProperties | null = null;
  try {
    style = typeof order === "number" ? (getBibleEventSpriteStyle(order, 132, 132) as CSSProperties | null) : null;
  } catch {
    style = null;
  }
  if (!style) return <Compass className="size-14 text-gold-300" aria-hidden />;
  return <span role="img" aria-hidden className="block overflow-hidden rounded-2xl shadow-2xl shadow-black/40 ring-1 ring-white/15" style={style} />;
}

function TodayStory() {
  const jump = useScriptureJump();
  const q = useQuery({ queryKey: ["atlas-events-static"], queryFn: async () => (await import("@data/explore/bible_events.json")).default as AtlasEvent[], staleTime: Infinity });
  const ev = q.data ? q.data[(dayOfYear() * 7) % q.data.length] : null;
  return (
    <section aria-labelledby="today-story" className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] lg:grid-cols-[340px_1fr]">
        <div className="hero-sky relative grid grid-cols-1 min-h-44 place-items-center overflow-hidden p-6">
          <div className="star-field absolute inset-0 opacity-40" aria-hidden />
          <div className="relative">{ev ? <EventArt order={ev.order} /> : <Skeleton className="size-32 rounded-2xl bg-white/10" />}</div>
          {ev && <span className="absolute top-4 left-4 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-gold-200 backdrop-blur">{ev.era}</span>}
        </div>
        <div className="p-5 sm:p-7">
          <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-gold-700 uppercase dark:text-gold-300">
            <Compass className="size-4" aria-hidden /> Today's story · Explore
          </p>
          {ev ? (
            <>
              <h2 id="today-story" className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{ev.title}</h2>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-3">
                <span className="inline-flex items-center gap-1.5"><BookOpen className="size-3.5" aria-hidden /> {ev.references.join(", ")}</span>
                <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" aria-hidden /> {ev.mapLocation}</span>
                <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5" aria-hidden /> {ev.timelineDate}</span>
              </div>
              <p className="mt-3 max-w-2xl text-[15px]/relaxed text-ink-2">{ev.summary}</p>
              {ev.lesson && <p className="mt-3 max-w-2xl border-l-2 border-gold-400 pl-3 font-serif text-[15px] text-ink-2 italic">{ev.lesson}</p>}
              <div className="mt-5 flex flex-wrap gap-2">
                <Link to={`/explore?event=${encodeURIComponent(ev.id)}`} className={buttonClass("primary")}><Compass aria-hidden /> Open on the atlas</Link>
                <Link to={`/explore?event=${encodeURIComponent(ev.id)}&tab=story`} className={buttonClass("secondary")}><Clapperboard aria-hidden /> Story video</Link>
                {ev.references[0] && (
                  <button type="button" onClick={() => void jump(ev.references[0])} className={buttonClass("ghost")}>
                    <BookOpen aria-hidden /> Read {ev.references[0]}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-16 w-full" /></div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────── modules */

const MODULES: { to: string; title: string; text: string; icon: LucideIcon; points: string[]; create?: boolean; cta: string }[] = [
  { to: "/read", title: "Read", icon: BookOpen, cta: "Open the Bible", text: "Read WEB, KJV or ASV. Tap any verse to see sermons, related passages, themes and people.", points: ["Verse insights", "Related Scripture", "Ask AI"] },
  { to: "/search", title: "Search & Ask", icon: Search, cta: "Start searching", text: "Describe what you're looking for in plain words and get passages and library sections by meaning.", points: ["Search by meaning", "Answers with sources"] },
  { to: "/library", title: "Library", icon: Library, cta: "Browse the library", text: "Sermons, podcasts, studies and articles — each linked to the exact verses they discuss.", points: ["Watch the clip", "Read the transcript"] },
  { to: "/map", title: "Scripture Map", icon: Network, cta: "Open the map", text: "See how a verse connects to themes, people, events and resources on one interactive map.", points: ["Connections", "List view"] },
  { to: "/explore", title: "Explore", icon: Compass, cta: "Explore the story", create: true, text: "Walk major Bible events on an atlas and timeline, trace the family line and watch story videos.", points: ["Atlas & timeline", "Family line", "Story videos"] },
  { to: "/sermons", title: "Sermon Studio", icon: PenLine, cta: "Open Sermon Studio", create: true, text: "Turn notes, voice memos and Scripture into a finished sermon with slides, visuals and a share page.", points: ["Collect & polish", "Slides & visuals", "Publish"] },
];

function ModuleGrid() {
  return (
    <section aria-labelledby="modules-title">
      <SectionHeading id="modules-title" title="Everything in one place" description="Each area of the app, and what it helps you do." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((m, i) => {
          const Icon = m.icon;
          return (
            <Link
              key={m.to}
              to={m.to}
              className="group flex animate-fade-up flex-col rounded-2xl border border-border bg-card p-5 no-underline shadow-xs transition hover:border-gold-500/40 hover:no-underline hover:shadow-md dark:hover:border-gold-400/30"
              style={{ animationDelay: `${60 + i * 50}ms` }}
            >
              <div className="flex items-center gap-3">
                <span className={cn(
                  "grid grid-cols-1 size-11 shrink-0 place-items-center rounded-xl ring-1",
                  m.create
                    ? "bg-gold-50 text-gold-700 ring-gold-500/20 dark:bg-gold-400/10 dark:text-gold-300 dark:ring-gold-400/20"
                    : "bg-navy-700 text-white ring-navy-800/10 dark:bg-white/[0.07] dark:text-gold-200 dark:ring-white/10",
                )}>
                  <Icon className="size-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="font-display text-lg font-semibold tracking-tight text-ink">{m.title}</h3>
                  <p className="text-[11px] font-semibold tracking-wider text-ink-3 uppercase">{m.create ? "Create & explore" : "Read & study"}</p>
                </div>
              </div>
              <p className="mt-3 flex-1 text-sm/relaxed text-ink-2">{m.text}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {m.points.map((p) => (
                  <span key={p} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[11.5px] font-medium text-ink-2 dark:bg-white/[0.06]">{p}</span>
                ))}
              </div>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-link">
                {m.cta} <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/* ───────────────────────────── library */

const TYPE_LABELS: Record<string, string> = { video: "Video", audio: "Audio", pdf: "PDF", document: "Document", article: "Article", native: "Note", generated: "Generated" };
const TYPE_ICONS: Record<string, LucideIcon> = { video: Video, audio: Headphones, pdf: FileText, document: FileText, article: FileText, native: FileText, generated: Sparkles };

interface LibraryItem {
  id: string;
  title: string;
  type: string;
  category: string;
  author?: string | null;
  speaker?: string | null;
  duration_ms?: number | null;
  visible_mappings?: number;
  segment_count?: number;
  created_at?: string;
  thumbnail_url?: string | null;
  youtube?: { video_id?: string | null } | null;
}

function LibraryHighlights() {
  const q = useResources({ page_size: 6 });
  const items = (q.data?.items || []) as LibraryItem[];
  if (!q.isLoading && items.length === 0) {
    return (
      <section aria-labelledby="library-title">
        <SectionHeading id="library-title" icon={Library} title="From your library" />
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line-2 bg-card/60 p-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm/relaxed text-ink-2">Add a sermon video, podcast, PDF study or article. The app finds the verses it discusses so they show up while you read.</p>
          <Link to="/admin/ingest" className={buttonClass("primary", "sm")}><Plus aria-hidden /> Add to library</Link>
        </div>
      </section>
    );
  }
  return (
    <section aria-labelledby="library-title">
      <SectionHeading
        id="library-title"
        icon={Library}
        title="From your library"
        description="Recently added sermons, podcasts and studies."
        action={<Link to="/library" className={buttonClass("ghost", "sm", "text-link")}>View all <ArrowRight aria-hidden /></Link>}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(q.isLoading ? Array.from({ length: 3 }) : items).map((r, i) => {
          if (!r) return <Skeleton key={i} className="h-[84px] rounded-2xl" />;
          const item = r as LibraryItem;
          const Icon = TYPE_ICONS[item.type] || FileText;
          const videoId = item.youtube?.video_id ?? null;
          const still = thumbnailFor({ thumbnail_url: item.thumbnail_url, youtube_id: videoId });
          const meta = [videoId ? "YouTube" : (TYPE_LABELS[item.type] ?? item.type), item.speaker || item.author, item.duration_ms ? fmtDuration(item.duration_ms) : null]
            .filter(Boolean)
            .join(" · ");
          return (
            <Link key={item.id} to={`/resources/${item.id}`} className="group flex items-center gap-3.5 rounded-2xl border border-border bg-card p-4 no-underline shadow-xs transition hover:border-gold-500/40 hover:no-underline hover:shadow-md dark:hover:border-gold-400/30">
              {still ? (
                <MediaThumb
                  src={still}
                  videoId={videoId}
                  alt=""
                  kind={item.type === "audio" ? "listen" : "watch"}
                  badgeSize="sm"
                  youtube={!!videoId}
                  className="aspect-video w-24 shrink-0"
                />
              ) : (
                <span className="grid grid-cols-1 size-12 shrink-0 place-items-center rounded-xl bg-surface-2 text-navy-700 dark:bg-white/[0.06] dark:text-gold-300">
                  <Icon className="size-5" aria-hidden />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{item.title}</span>
                <span className="block truncate text-xs text-ink-3">{meta}</span>
                {!!item.visible_mappings && <span className="mt-1 block text-xs font-medium text-gold-700 dark:text-gold-300">{item.visible_mappings} linked verse{item.visible_mappings === 1 ? "" : "s"}</span>}
              </span>
              <ArrowRight className="size-4 shrink-0 text-ink-3 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function HomePage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-4 pb-16 sm:px-6 lg:px-8 lg:pt-6">
      <Hero />
      <section className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr]" aria-label="Pick up where you left off">
        <ContinueReading />
        <RecentSermons />
      </section>
      <div className="mt-10">
        <TodayStory />
      </div>
      <div className="mt-12">
        <ModuleGrid />
      </div>
      <div className="mt-12">
        <LibraryHighlights />
      </div>
      <footer className="mt-14 flex flex-col items-center gap-2 border-t border-border pt-6 text-center text-xs text-ink-3">
        <div className="flex items-center gap-2"><BookOpen className="size-3.5" aria-hidden /> Interactive Bible App · runs on this computer · AI by Google Gemini only when you use an AI feature</div>
        <div>Bible texts: World English Bible, KJV, ASV (public domain) · Cross references: OpenBible.info (CC-BY) · Map data: Natural Earth</div>
      </footer>
    </div>
  );
}
