import {
  ArrowRight, BookOpen, CalendarDays, ChevronDown, ChevronRight, Copy, ExternalLink, Headphones, Info, LayoutGrid, Library, Link2, Loader2, MapPin, MessageCircleQuestion,
  LogIn, Network, PenLine, PlayCircle, Plus, Send, Sparkles, Tags, Users, X, type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAsk, useExploreByVerse, useScriptureMap, useVerseIntelligence, useVerseResources, useWhy } from "../api/hooks";
import type { MediaKind, RelatedVerse, ResourceCardData, VerseIntelligence } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { shareableUrl } from "../lib/share";
import { cn } from "../lib/utils";
import { copyText, readHref } from "../utils/format";
import { AnswerCard, AnswerSkeleton } from "./AnswerCard";
import { MapGraph, NODE_COLORS, NODE_LABELS } from "./MapGraph";
import { buttonClass, EmptyState, FilterChip, HelpTip, SegmentedControl, Skeleton } from "./page";
import { ResourceCard } from "./ResourceCard";
import { ErrorState } from "./ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type Tab = "overview" | "resources" | "related" | "themes" | "people" | "map" | "ask";

const KIND_META: Record<MediaKind, { label: string; icon: LucideIcon; empty: string }> = {
  watch: { label: "Watch", icon: PlayCircle, empty: "No video clips discuss this passage yet." },
  listen: { label: "Listen", icon: Headphones, empty: "No audio or podcast clips discuss this passage yet." },
  study: { label: "Read", icon: BookOpen, empty: "No studies, articles or notes discuss this passage yet." },
};

function kindCount(d: VerseIntelligence, kind: MediaKind) {
  return kind === "watch" ? d.counts.video : kind === "listen" ? d.counts.audio : d.counts.study;
}

export function VerseIntelligencePanel({ refId, translation, onClose, variant }: { refId: string; translation: string; onClose?: () => void; variant: "panel" | "sheet" | "page" }) {
  const q = useVerseIntelligence(refId, translation);
  const [tab, setTab] = useState<Tab>("overview");
  const [kind, setKind] = useState<MediaKind>("watch");
  const bodyRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const page = variant === "page";
  const d = q.data;

  useEffect(() => {
    setTab("overview");
    bodyRef.current?.scrollTo({ top: 0 });
  }, [refId]);

  useEffect(() => {
    if (!d) return;
    // start the Resources tab on the first kind that has something
    const first = (["watch", "listen", "study"] as MediaKind[]).find((k) => kindCount(d, k) > 0);
    if (first) setKind(first);
  }, [d?.verse.ref]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (next: Tab, nextKind?: MediaKind) => {
    if (nextKind) setKind(nextKind);
    setTab(next);
    window.requestAnimationFrame(() => tabRefs.current[next]?.scrollIntoView({ inline: "nearest", block: "nearest" }));
    if (page) window.scrollTo({ top: 0, behavior: "smooth" });
    else bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resourcesTotal = d ? d.counts.video + d.counts.audio + d.counts.study : 0;
  const tabs: { id: Tab; label: string; icon: LucideIcon; count?: number }[] = d
    ? [
        { id: "overview", label: "Overview", icon: LayoutGrid },
        { id: "resources", label: "Resources", icon: Library, count: resourcesTotal },
        { id: "related", label: "Related", icon: Link2, count: d.counts.related_verses },
        { id: "themes", label: "Themes", icon: Tags, count: d.counts.themes },
        { id: "people", label: "People", icon: Users, count: d.counts.people_events },
        { id: "map", label: "Map", icon: Network },
        { id: "ask", label: "Ask AI", icon: Sparkles },
      ]
    : [];

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    go(next.id);
    tabRefs.current[next.id]?.focus();
  };

  const displayRef = d?.verse.display_ref ?? refId;
  const copyVerse = async () => {
    if (!d) return;
    const ok = await copyText(`“${d.verse.text}” — ${d.verse.display_ref} (${d.verse.translation.toUpperCase()})`);
    if (ok) toast.success("Verse copied", { description: d.verse.display_ref });
    else toast.error("Couldn't copy the verse");
  };
  const copyLink = async () => {
    const ok = await copyText(shareableUrl(readHref(d?.verse.ref || refId)));
    if (ok) toast.success("Link copied");
    else toast.error("Couldn't copy the link");
  };

  return (
    <div className={cn("flex min-h-0 flex-col", !page && "h-full")} aria-live="polite">
      <header className={cn("shrink-0 border-b border-border bg-paper-2/95 backdrop-blur-xl", page && "sticky top-[var(--header-h)] z-10")}>
        <div className="flex items-start gap-2 px-5 pt-4">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] text-gold-700 uppercase dark:text-gold-300">
              <Sparkles className="size-3.5" aria-hidden /> Verse insights
            </p>
            <h2 className="mt-1 truncate font-display text-2xl font-semibold tracking-tight text-ink">{displayRef}</h2>
          </div>
          <div className="-mr-2 flex shrink-0 items-center">
            <HeaderAction label="Copy verse text" onClick={copyVerse} icon={Copy} disabled={!d} />
            <HeaderAction label="Copy link to this passage" onClick={copyLink} icon={Link2} />
            {variant !== "page" ? (
              <HeaderAction label="Open as a full page" to={`/verse/${encodeURIComponent(refId)}?t=${translation}`} icon={ExternalLink} />
            ) : (
              <HeaderAction label="Read in context" to={readHref(d?.verse.ref || refId)} icon={BookOpen} />
            )}
            {onClose && <HeaderAction label={variant === "sheet" ? "Close insights" : "Close insights and clear selection"} onClick={onClose} icon={X} />}
          </div>
        </div>

        {q.isLoading && (
          <div className="grid grid-cols-1 gap-2 px-5 pt-3 pb-4" aria-hidden>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        )}
        {d && (
          <blockquote className="scripture-quote mx-5 mt-3 max-h-[24dvh] overflow-y-auto pr-1 text-[17px]/relaxed">
            {d.verse.verses.length > 1
              ? d.verse.verses.map((v) => (
                  <span key={v.ref}>
                    <sup className="verse-num">{v.number}</sup>
                    {v.text}{" "}
                  </span>
                ))
              : d.verse.text}
            <span className="ml-1.5 align-middle font-sans text-[11px] font-semibold tracking-wide text-ink-3">{d.verse.translation.toUpperCase()}</span>
          </blockquote>
        )}

        {d && (
          <div role="tablist" aria-label="Verse insight sections" className="no-scrollbar fade-x mt-3 flex gap-0.5 overflow-x-auto px-3" data-base-ui-swipe-ignore>
            {tabs.map((t, i) => {
              const Icon = t.icon;
              const selected = tab === t.id;
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    tabRefs.current[t.id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`vi-tab-${t.id}`}
                  aria-selected={selected}
                  aria-controls="vi-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => go(t.id)}
                  onKeyDown={(e) => onTabKey(e, i)}
                  className={cn(
                    "relative inline-flex h-11 shrink-0 items-center gap-1.5 rounded-t-lg px-2.5 text-[13px] font-medium whitespace-nowrap transition outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset",
                    selected ? "text-ink" : "text-ink-3 hover:text-ink",
                    t.id === "ask" && !selected && "text-gold-700 dark:text-gold-300",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {t.label}
                  {t.count !== undefined && t.count > 0 && (
                    <span className={cn("rounded-full px-1.5 text-[11px] font-semibold tabular-nums", selected ? "bg-primary text-primary-foreground" : "bg-surface-2 text-ink-3 dark:bg-white/[0.07]")}>{t.count}</span>
                  )}
                  {selected && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" aria-hidden />}
                </button>
              );
            })}
          </div>
        )}
      </header>

      <div ref={bodyRef} id="vi-panel" role="tabpanel" aria-labelledby={`vi-tab-${tab}`} className={cn("min-h-0 flex-1 px-5 pt-5 pb-14", !page && "overflow-y-auto overscroll-contain")}>
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.isLoading && (
          <div className="grid grid-cols-1 gap-3" aria-hidden>
            <div className="grid grid-cols-4 gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </div>
        )}
        {d && tab === "overview" && <Overview d={d} go={go} />}
        {d && tab === "resources" && <Resources d={d} kind={kind} setKind={setKind} />}
        {d && tab === "related" && (
          <div className="grid grid-cols-1 gap-3">
            <TabIntro
              title="Related Scripture"
              help="Cross-references come from trusted Bible reference lists. Passages marked “AI related” were suggested by meaning — treat them as leads."
            >
              Passages that echo, explain or connect to {d.verse.display_ref}. Open “Why related?” to see the connection.
            </TabIntro>
            <RelatedList refId={d.verse.ref} items={d.related_verses} aiAvailable={d.ai_available} />
          </div>
        )}
        {d && tab === "themes" && <Themes d={d} />}
        {d && tab === "people" && <People d={d} />}
        {d && tab === "map" && <MapPreview refId={d.verse.ref} displayRef={d.verse.display_ref} />}
        {d && tab === "ask" && <AskPanel refId={d.verse.ref} displayRef={d.verse.display_ref} translation={translation} aiAvailable={d.ai_available} />}
        {d && (
          <p className="mt-10 flex gap-2 border-t border-border pt-4 text-xs/relaxed text-ink-3">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {d.provenance.confidence_note}
              {d.provenance.last_updated && <> Connections last updated {new Date(d.provenance.last_updated).toLocaleDateString()}.</>}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

function HeaderAction({ label, icon: Icon, onClick, to, disabled }: { label: string; icon: LucideIcon; onClick?: () => void; to?: string; disabled?: boolean }) {
  const cls = "grid grid-cols-1 size-9 place-items-center rounded-xl text-ink-3 no-underline transition outline-none hover:bg-surface-2 hover:text-ink hover:no-underline focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-40 dark:hover:bg-white/[0.06]";
  return (
    <Tooltip>
      {to ? (
        <TooltipTrigger render={<Link to={to} aria-label={label} className={cls} />}>
          <Icon className="size-[18px]" aria-hidden />
        </TooltipTrigger>
      ) : (
        <TooltipTrigger onClick={onClick} aria-label={label} disabled={disabled} className={cls}>
          <Icon className="size-[18px]" aria-hidden />
        </TooltipTrigger>
      )}
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function TabIntro({ title, help, children }: { title: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-1">
      <div className="flex items-center gap-1.5">
        <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
        {help && <HelpTip label={title}>{help}</HelpTip>}
      </div>
      <p className="mt-0.5 text-[13px]/relaxed text-ink-3">{children}</p>
    </div>
  );
}

function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-7 mb-3 flex items-center justify-between gap-2 first:mt-0">
      <h3 className="text-[11px] font-semibold tracking-[0.1em] text-ink-3 uppercase">{children}</h3>
      {action}
    </div>
  );
}

/* ───────────────────────────── overview */

function Overview({ d, go }: { d: VerseIntelligence; go: (tab: Tab, kind?: MediaKind) => void }) {
  const stats: { label: string; count: number; icon: LucideIcon; onClick: () => void }[] = [
    { label: "Watch", count: d.counts.video, icon: PlayCircle, onClick: () => go("resources", "watch") },
    { label: "Listen", count: d.counts.audio, icon: Headphones, onClick: () => go("resources", "listen") },
    { label: "Read", count: d.counts.study, icon: BookOpen, onClick: () => go("resources", "study") },
    { label: "Related", count: d.counts.related_verses, icon: Link2, onClick: () => go("related") },
  ];
  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.label}
              type="button"
              onClick={s.onClick}
              disabled={!s.count}
              className="group flex flex-col items-center gap-1 rounded-xl border border-border bg-card px-1 py-2.5 text-center transition hover:border-line-2 hover:shadow-sm disabled:cursor-default disabled:opacity-55 disabled:hover:border-border disabled:hover:shadow-none dark:bg-white/[0.03]"
              aria-label={`${s.label}: ${s.count}`}
            >
              <Icon className="size-4 text-ink-3 group-enabled:group-hover:text-gold-700 dark:group-enabled:group-hover:text-gold-300" aria-hidden />
              <span className="font-display text-xl leading-none font-semibold text-ink tabular-nums">{s.count}</span>
              <span className="text-[11px] font-medium text-ink-3">{s.label}</span>
            </button>
          );
        })}
      </div>

      <BringToLife refId={d.verse.ref} displayRef={d.verse.display_ref} />

      <SectionLabel action={d.top_resources.length > 0 && <button type="button" onClick={() => go("resources")} className="text-[13px] font-semibold text-link hover:underline">See all</button>}>
        From your library
      </SectionLabel>
      {d.top_resources.length > 0 ? (
        <div className="grid grid-cols-1 gap-2.5">
          {d.top_resources.slice(0, 3).map((c) => (
            <ResourceCard key={c.segment_id} card={c} verseRef={d.verse.ref} />
          ))}
        </div>
      ) : (
        <EmptyState
          compact
          icon={Library}
          title="No library resources yet"
          description="When a sermon, podcast or study in your library talks about this passage, it will show up here."
          action={<Link to="/admin/ingest" className={buttonClass("secondary", "sm")}><Plus aria-hidden /> Add to library</Link>}
        />
      )}

      {d.related_verses.length > 0 && (
        <>
          <SectionLabel action={<button type="button" onClick={() => go("related")} className="text-[13px] font-semibold text-link hover:underline">See all</button>}>
            Related Scripture
          </SectionLabel>
          <RelatedList refId={d.verse.ref} items={d.related_verses.slice(0, 3)} aiAvailable={d.ai_available} />
        </>
      )}

      {d.themes.length > 0 && (
        <>
          <SectionLabel action={<button type="button" onClick={() => go("themes")} className="text-[13px] font-semibold text-link hover:underline">Details</button>}>Themes</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {d.themes.slice(0, 8).map((t) => (
              <Link key={t.id} to={`/map?root=topic:${t.slug}`} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[13px] font-medium text-ink-2 no-underline transition hover:border-line-2 hover:bg-surface-2 hover:text-ink hover:no-underline dark:bg-white/[0.03]">
                <span className="size-1.5 rounded-full bg-gold-500" aria-hidden /> {t.name}
              </Link>
            ))}
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => go("ask")}
        className="group mt-7 flex w-full items-center gap-3 rounded-2xl border border-gold-500/25 bg-gold-50/70 p-4 text-left transition hover:border-gold-500/45 hover:bg-gold-50 dark:border-gold-400/20 dark:bg-gold-400/[0.06] dark:hover:bg-gold-400/10"
      >
        <span className="grid grid-cols-1 size-10 shrink-0 place-items-center rounded-xl bg-gold-100 text-gold-700 dark:bg-gold-400/15 dark:text-gold-300">
          <MessageCircleQuestion className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink">Have a question about {d.verse.display_ref}?</span>
          <span className="block text-[13px] text-ink-2">Ask AI — answers cite this passage and your library.</span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-ink-3 transition group-hover:translate-x-0.5" aria-hidden />
      </button>

      <SectionLabel>About the book</SectionLabel>
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 dark:bg-white/[0.03]">
        <span className="grid grid-cols-1 size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-2 dark:bg-white/[0.06]"><BookOpen className="size-5" aria-hidden /></span>
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-ink">{d.book_context.name}</p>
          <p className="text-ink-3">{[d.book_context.testament, d.book_context.genre, d.book_context.attribution ? (/^traditionally/i.test(d.book_context.attribution) ? d.book_context.attribution : `By ${d.book_context.attribution}`) : null].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
    </div>
  );
}

/** Cross-links into the other modules: start a sermon on the passage, open matching atlas/timeline events. */
function BringToLife({ refId, displayRef }: { refId: string; displayRef: string }) {
  const q = useExploreByVerse(refId);
  const events = q.data?.events ?? [];
  const timeline = (q.data?.timeline ?? []).filter((t) => !events.some((e) => e.title === t.title));
  const rows: { key: string; to: string; icon: LucideIcon; title: string; detail: string; tone: "gold" | "navy" | "plain" }[] = [
    { key: "sermon", to: `/sermons?new=1&scripture=${encodeURIComponent(displayRef)}`, icon: PenLine, title: `Start a sermon on ${displayRef}`, detail: "Sermon Studio · collect notes, polish, design slides", tone: "gold" },
    ...events.slice(0, 2).map((e) => ({ key: `ev-${e.id}`, to: `/explore?event=${encodeURIComponent(e.id)}`, icon: MapPin, title: e.title, detail: `On the atlas · ${e.era}`, tone: "navy" as const })),
    ...timeline.slice(0, 2).map((t) => ({ key: `tl-${t.id}`, to: `/explore?view=timeline&t=${encodeURIComponent(t.id)}`, icon: CalendarDays, title: t.title, detail: `On the timeline · ${t.dateLabel}`, tone: "navy" as const })),
    { key: "map", to: `/map?root=verse:${encodeURIComponent(refId)}`, icon: Network, title: "See its connections", detail: "Scripture Map · themes, people and resources", tone: "plain" },
  ];
  return (
    <>
      <SectionLabel>Bring it to life</SectionLabel>
      <div className="overflow-hidden rounded-2xl border border-border bg-card dark:bg-white/[0.03]">
        {rows.map((r, i) => {
          const Icon = r.icon;
          return (
            <Link
              key={r.key}
              to={r.to}
              className={cn("group flex items-center gap-3 px-3.5 py-3 no-underline transition hover:bg-surface-2/70 hover:no-underline dark:hover:bg-white/[0.04]", i > 0 && "border-t border-border")}
            >
              <span
                className={cn(
                  "grid grid-cols-1 size-9 shrink-0 place-items-center rounded-lg",
                  r.tone === "gold" && "bg-gold-100 text-gold-700 dark:bg-gold-400/15 dark:text-gold-300",
                  r.tone === "navy" && "bg-navy-700/10 text-navy-700 dark:bg-white/[0.07] dark:text-gold-200",
                  r.tone === "plain" && "bg-surface-2 text-ink-2 dark:bg-white/[0.06]",
                )}
              >
                <Icon className="size-[18px]" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{r.title}</span>
                <span className="block truncate text-xs text-ink-3">{r.detail}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-ink-3 transition group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />
            </Link>
          );
        })}
        {q.isLoading && <div className="border-t border-border px-3.5 py-3"><Skeleton className="h-9 w-2/3" /></div>}
      </div>
    </>
  );
}

/* ───────────────────────────── resources */

function Resources({ d, kind, setKind }: { d: VerseIntelligence; kind: MediaKind; setKind: (k: MediaKind) => void }) {
  return (
    <div className="grid grid-cols-1 gap-4">
      <TabIntro
        title="Library resources"
        help={
          <>
            <b>Direct mention</b>: the passage is named. <b>Quote</b>: its words are quoted. <b>Contextual</b>: discussed without naming it. <b>AI related</b>: suggested by meaning.
            <br />
            <b>Human verified</b> means an editor checked the connection.
          </>
        }
      >
        Sermons, podcasts and studies that discuss {d.verse.display_ref}, with the exact moment or section.
      </TabIntro>
      <SegmentedControl
        ariaLabel="Resource type"
        value={kind}
        onChange={setKind}
        className="w-full [&>button]:flex-1"
        options={(["watch", "listen", "study"] as MediaKind[]).map((k) => ({ value: k, icon: KIND_META[k].icon, label: <>{KIND_META[k].label} <span className="text-ink-3 tabular-nums">{kindCount(d, k)}</span></> }))}
      />
      <ResourceSection key={kind} refId={d.verse.ref} kind={kind} initial={d.sections[kind]} total={kindCount(d, kind)} />
    </div>
  );
}

function ResourceSection({ refId, kind, initial, total }: { refId: string; kind: MediaKind; initial: ResourceCardData[]; total: number }) {
  const [filters, setFilters] = useState<{ relationship?: string; human_verified?: boolean; sort: string }>({ sort: "relevance" });
  const custom = !!filters.relationship || !!filters.human_verified || filters.sort !== "relevance" || total > initial.length;
  const q = useVerseResources(custom ? refId : "", { kind, relationship: filters.relationship, human_verified: filters.human_verified, sort: filters.sort, page_size: 50 });
  const items: ResourceCardData[] = custom ? q.data?.items ?? [] : initial;
  const relOptions: [string, string][] = [
    ["", "All"],
    ["direct_reference,scripture_quote", "Direct & quotes"],
    ["contextual_reference", "Contextual"],
    ["ai_related", "AI related"],
  ];
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="no-scrollbar -mx-5 flex items-center gap-2 overflow-x-auto px-5 pb-1" data-base-ui-swipe-ignore>
        {relOptions.map(([value, label]) => (
          <FilterChip key={label} active={(filters.relationship || "") === value} onClick={() => setFilters((f) => ({ ...f, relationship: value || undefined }))} className="h-8 px-3">
            {label}
          </FilterChip>
        ))}
        <FilterChip variant="soft" active={!!filters.human_verified} onClick={() => setFilters((f) => ({ ...f, human_verified: !f.human_verified || undefined }))} className="h-8 px-3">
          Human verified
        </FilterChip>
        <select
          className="select h-8 w-auto shrink-0 rounded-full py-0 pr-8 pl-3 text-[13px]"
          value={filters.sort}
          onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}
          aria-label="Sort resources"
        >
          <option value="relevance">Most relevant</option>
          <option value="confidence">Most confident</option>
          <option value="title">Title A–Z</option>
        </select>
      </div>
      {custom && q.isLoading && <div className="grid grid-cols-1 gap-2.5">{[0, 1].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {items.length === 0 && !(custom && q.isLoading) && (
        <EmptyState
          compact
          icon={KIND_META[kind].icon}
          title={filters.relationship || filters.human_verified ? "Nothing matches these filters" : "Nothing here yet"}
          description={filters.relationship || filters.human_verified ? "Try “All” or turn off “Human verified”." : KIND_META[kind].empty}
          action={
            filters.relationship || filters.human_verified ? (
              <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setFilters({ sort: filters.sort })}>Clear filters</button>
            ) : (
              <Link to="/admin/ingest" className={buttonClass("secondary", "sm")}><Plus aria-hidden /> Add to library</Link>
            )
          }
        />
      )}
      {items.map((c) => (
        <ResourceCard key={c.segment_id} card={c} verseRef={refId} />
      ))}
    </div>
  );
}

/* ───────────────────────────── related */

export function RelatedList({ refId, items, aiAvailable }: { refId: string; items: RelatedVerse[]; aiAvailable: boolean }) {
  if (!items.length) return <EmptyState compact icon={Link2} title="No related verses yet" description="Cross-references for this passage will appear here." />;
  return (
    <div className="grid grid-cols-1 gap-2.5">
      {items.map((r) => (
        <RelatedItem key={r.ref} fromRef={refId} item={r} aiAvailable={aiAvailable} />
      ))}
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = { openbible: "OpenBible.info", tsk: "Treasury of Scripture Knowledge", ai: "AI suggestion", embeddings: "Similar meaning", mapped_resources: "Your library" };

function RelatedItem({ fromRef, item, aiAvailable }: { fromRef: string; item: RelatedVerse; aiAvailable: boolean }) {
  const [open, setOpen] = useState(false);
  const why = useWhy(fromRef, item.ref, open && item.why_status !== "ready" && aiAvailable);
  const text = why.data?.why || item.why;
  const aiExplained = why.data?.status === "generated" || item.why_status === "ready";
  const confidence = why.data?.confidence ?? item.why_confidence;
  const sources = item.sources.map((s) => SOURCE_LABEL[s] || s.replace(/_/g, " ")).join(", ");
  return (
    <div className="rounded-2xl border border-border bg-card p-4 transition hover:border-line-2 dark:bg-white/[0.03]">
      <div className="flex items-start justify-between gap-3">
        <Link to={readHref(item.ref)} className="font-display text-[17px] font-semibold text-ink no-underline decoration-gold-500/60 underline-offset-4 hover:underline">
          {item.display_ref}
        </Link>
        {item.is_ai ? (
          <span className="rel rel-ai_related shrink-0"><Sparkles aria-hidden /> AI related</span>
        ) : (
          <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-0.5 text-[11.5px] font-semibold text-ink-2 dark:bg-white/[0.07]">{item.label}</span>
        )}
      </div>
      <p className="mt-1.5 font-serif text-[15px]/relaxed text-ink-2">{item.text}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[13px] font-semibold text-ink transition hover:bg-surface-2 dark:bg-white/[0.04]"
        >
          Why related? <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
        <span className="inline-flex items-center gap-2 text-xs text-ink-3" title="How closely the two passages are connected">
          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-2 dark:bg-white/10" aria-hidden>
            <span className="block h-full rounded-full bg-gold-500" style={{ width: `${Math.round(Math.min(1, item.score) * 100)}%` }} />
          </span>
          {Math.round(Math.min(1, item.score) * 100)}% match
        </span>
        {sources && <span className="text-xs text-ink-3">· {sources}</span>}
      </div>
      {open && (
        <div className="mt-3 rounded-xl bg-surface-2/70 px-3.5 py-3 text-sm dark:bg-white/[0.04]">
          {why.isFetching ? (
            <span className="inline-flex items-center gap-2 text-ink-3"><Loader2 className="size-4 animate-spin" aria-hidden /> Explaining the connection…</span>
          ) : (
            <>
              <p className="leading-relaxed text-ink">{text || "No explanation is available yet."}</p>
              <p className="mt-1.5 text-xs text-ink-3">
                {aiExplained
                  ? `AI explanation grounded in both passages${confidence != null ? ` · ${Math.round(confidence * 100)}% confident` : ""}`
                  : "Based on stored cross-reference evidence."}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── themes & people */

function Themes({ d }: { d: VerseIntelligence }) {
  if (!d.themes.length) {
    return (
      <EmptyState
        compact
        icon={Tags}
        title="No themes yet"
        description={d.ai_available ? "Themes are being identified for this passage — check back in a moment." : "Themes appear when resources that discuss this passage are processed."}
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3">
      <TabIntro title="Themes" help="Themes come from the resources that discuss this passage and from AI analysis. The bar shows how strongly the theme is supported.">
        Big ideas connected to {d.verse.display_ref}. Map a theme to see every passage and resource that shares it.
      </TabIntro>
      <div className="overflow-hidden rounded-2xl border border-border bg-card dark:bg-white/[0.03]">
        {d.themes.map((t, i) => (
          <div key={t.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", i > 0 && "border-t border-border")}>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">{t.name}</p>
              <div className="mt-1 flex items-center gap-2 text-xs text-ink-3">
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2 dark:bg-white/10" aria-hidden>
                  <span className="block h-full rounded-full bg-gold-500" style={{ width: `${Math.round(t.confidence * 100)}%` }} />
                </span>
                {Math.round(t.confidence * 100)}% · {(t.sources || []).map((s) => SOURCE_LABEL[s] || s.replace(/_/g, " ")).join(", ")}
              </div>
            </div>
            <div className="flex gap-1.5">
              <Link className={buttonClass("secondary", "sm")} to={`/map?root=topic:${t.slug}`}><Network aria-hidden /> Map</Link>
              <Link className={buttonClass("ghost", "sm")} to={`/search?q=${encodeURIComponent(t.name)}`}>Search</Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function People({ d }: { d: VerseIntelligence }) {
  const groups = [
    ["People", d.entities.people, Users],
    ["Events", d.entities.events, CalendarDays],
    ["Places", d.entities.places, MapPin],
  ] as const;
  const total = groups.reduce((n, [, items]) => n + items.length, 0);
  return (
    <div className="grid grid-cols-1 gap-3">
      <TabIntro title="People, places & events">Who and what this passage involves. “Explore” centres the Scripture Map on them.</TabIntro>
      {total === 0 && <EmptyState compact icon={Users} title="No people or events identified" description="They appear when resources about this passage mention them." />}
      {groups.map(([label, items, Icon]) =>
        items.length ? (
          <div key={label}>
            <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.1em] text-ink-3 uppercase"><Icon className="size-3.5" aria-hidden /> {label}</h4>
            <div className="overflow-hidden rounded-2xl border border-border bg-card dark:bg-white/[0.03]">
              {items.map((e, i) => (
                <div key={e.id} className={cn("flex items-center gap-3 px-4 py-3", i > 0 && "border-t border-border")}>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{e.name}</p>
                    {(e.description || e.passage) && <p className="truncate text-xs text-ink-3">{[e.description, e.passage].filter(Boolean).join(" · ")}</p>}
                  </div>
                  <Link className={buttonClass("secondary", "sm")} to={`/map?root=entity:${e.id}`}>Explore</Link>
                </div>
              ))}
            </div>
          </div>
        ) : null,
      )}
      <BringToLife refId={d.verse.ref} displayRef={d.verse.display_ref} />
    </div>
  );
}

/* ───────────────────────────── map */

function MapPreview({ refId, displayRef }: { refId: string; displayRef: string }) {
  const q = useScriptureMap({ root_type: "verse", root_id: refId });
  return (
    <div className="grid grid-cols-1 gap-3">
      <TabIntro title="Scripture Map">A close-up of what connects to {displayRef}. Open the full map to filter, recentre and explore further.</TabIntro>
      {q.isLoading && <Skeleton className="h-[340px] rounded-2xl" />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <div className="map-wrap" style={{ height: 340 }} data-base-ui-swipe-ignore>
          <MapGraph data={q.data} compact />
        </div>
      )}
      <Link className={buttonClass("primary", "md", "w-full")} to={`/map?root=verse:${encodeURIComponent(refId)}`}>
        <Network aria-hidden /> Open the Scripture Map
      </Link>
      {q.data && q.data.list.length > 0 && (
        <div className="grid grid-cols-1 gap-2.5 rounded-2xl border border-border bg-card p-4 dark:bg-white/[0.03]">
          {q.data.list.map((g) => (
            <div key={g.type} className="text-sm">
              <span className="mr-1.5 inline-flex items-center gap-1.5 font-semibold text-ink">
                <span className="legend-dot" style={{ background: NODE_COLORS[g.type], margin: 0 }} aria-hidden />
                {NODE_LABELS[g.type] || g.type} ({g.items.length})
              </span>
              <span className="text-ink-2">{g.items.slice(0, 6).map((i) => i.node.label).join(" · ")}{g.items.length > 6 ? " …" : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── ask */

// Same wording as before the redesign so previously saved (cached) answers still come back instantly.
const SUGGESTIONS = ["What does this verse mean in context?", "How can I apply this today?", "How do the related passages connect to it?", "What do the mapped sermons emphasise?"];

function AskPanel({ refId, displayRef, translation, aiAvailable }: { refId: string; displayRef: string; translation: string; aiAvailable: boolean }) {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const ask = useAsk();
  const navigate = useNavigate();
  const location = useLocation();
  const { viewer } = useAuth();
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ask.isPending || ask.data || ask.error) resultRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [ask.isPending, ask.data, ask.error]);
  if (!aiAvailable) {
    return (
      <EmptyState
        compact
        icon={Sparkles}
        title="Ask AI isn't set up yet"
        description="Add a Google Gemini API key on the server (GEMINI_API_KEY in the .env file), then restart the app."
        action={<button type="button" className={buttonClass("secondary", "sm")} onClick={() => navigate("/admin/system")}>Open System settings</button>}
      />
    );
  }
  if (viewer && !viewer.authenticated) {
    return (
      <EmptyState
        compact
        icon={LogIn}
        title="Sign in to ask AI"
        description={`Ask AI answers questions about ${displayRef} from the passage, related Scripture and the library, with sources. It needs an account because each answer uses the app's Gemini key.`}
        action={<button type="button" className={buttonClass("primary", "sm")} onClick={() => navigate("/login", { state: { from: location.pathname + location.search } })}>Sign in</button>}
      />
    );
  }
  const submit = (text: string) => {
    const t = text.trim();
    if (t.length < 3 || ask.isPending) return;
    setAsked(t);
    ask.mutate({ ref: refId, question: t, translation });
  };
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="rounded-2xl border border-gold-500/25 bg-gold-50/60 p-4 dark:border-gold-400/20 dark:bg-gold-400/[0.06]">
        <p className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
          <Sparkles className="size-4 text-gold-700 dark:text-gold-300" aria-hidden /> Ask about {displayRef}
        </p>
        <p className="mt-1 text-[13px]/relaxed text-ink-2">
          The answer uses only this passage, the verses around it, related Scripture and your library — and lists its sources. It usually takes 5–15 seconds.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={ask.isPending}
            onClick={() => {
              setQuestion(s);
              submit(s);
            }}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-left text-[13px] text-ink-2 transition hover:border-line-2 hover:bg-surface-2 hover:text-ink disabled:opacity-50 dark:bg-white/[0.03]"
          >
            {s}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
      >
        <label htmlFor="vi-ask" className="mb-1.5 block text-sm font-medium text-ink">Your question</label>
        <textarea
          id="vi-ask"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submit(question);
            }
          }}
          rows={3}
          maxLength={800}
          placeholder="Ask anything about this passage…"
          className="w-full resize-y rounded-xl border border-input bg-card px-3.5 py-3 text-[15px]/relaxed text-ink shadow-xs outline-none placeholder:text-ink-3 focus:border-ring focus:ring-3 focus:ring-ring/40 dark:bg-white/[0.04]"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-ink-3">{question.length > 600 ? `${question.length}/800` : "Answers are saved, so asking again is instant."}</span>
          <button type="submit" disabled={ask.isPending || question.trim().length < 3} className={buttonClass("primary")}>
            {ask.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
            {ask.isPending ? "Thinking…" : "Ask AI"}
          </button>
        </div>
      </form>
      <div ref={resultRef} className="grid grid-cols-1 gap-3 empty:hidden">
        {ask.isPending && <AnswerSkeleton />}
        {ask.error && !ask.isPending && <ErrorState error={ask.error} onRetry={asked ? () => submit(asked) : undefined} />}
        {ask.data && !ask.isPending && <AnswerCard data={ask.data} question={asked} />}
      </div>
    </div>
  );
}
