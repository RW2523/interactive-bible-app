import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen, BookOpenText, CornerDownLeft, FileText, Headphones, History, Loader2, PenLine, Plus, Search, Sparkles, Video, X, type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, qs } from "@/api/client";
import { useBooks } from "@/api/hooks";
import type { Book } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import type { SermonListItem } from "@/features/sermons/types";
import { listProgress } from "@/features/sermons/workspace";
import { useRecent, type RecentItem } from "@/lib/recent";
import { isWholeQueryReference, parseReferences, referenceReadHref, referenceVerseId, useScriptureJump } from "@/lib/scripture";
import { cn } from "@/lib/utils";
import { navGroups, type NavItem } from "./nav";

/* ───────────────────────────── open state (callable from anywhere) */

let paletteOpen = false;
let paletteSeed = "";
const subscribers = new Set<() => void>();
const emit = () => subscribers.forEach((fn) => fn());

export function openCommandPalette(seed = "") {
  paletteOpen = true;
  paletteSeed = seed;
  emit();
}
export function closeCommandPalette() {
  paletteOpen = false;
  emit();
}
export function toggleCommandPalette() {
  if (paletteOpen) closeCommandPalette();
  else openCommandPalette();
}
function usePaletteOpen() {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    () => paletteOpen,
    () => false,
  );
}

export const isMacLike = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

/* ───────────────────────────── helpers */

interface Command {
  id: string;
  label: string;
  detail?: string;
  icon: LucideIcon;
  tone?: "gold" | "navy";
  hint?: string;
  perform: () => void;
}
interface Section {
  id: string;
  label: string;
  items: Command[];
}
type SermonLite = SermonListItem;
interface ResourceLite {
  id: string;
  title: string;
  type: string;
  speaker?: string | null;
  author?: string | null;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

function matchBooks(books: Book[] | undefined, query: string): Book[] {
  if (!books) return [];
  const s = query.toLowerCase().replace(/\s+/g, " ").trim();
  if (s.length < 2 || s.split(" ").length > 3 || /\d\s*[:.]\s*\d/.test(s)) return [];
  const base = s.replace(/\s+\d+$/, ""); // "genesis 3" → "genesis"
  const compact = base.replace(/\s/g, "");
  return books
    .filter((b) => {
      const name = b.name.toLowerCase();
      return name.startsWith(base) || name.replace(/\s/g, "").startsWith(compact) || b.code.toLowerCase() === compact;
    })
    .slice(0, 4);
}

const RECENT_ICON: Record<string, LucideIcon> = { read: BookOpen, search: Search, resource: FileText, sermon: PenLine, verse: Sparkles };
const TYPE_ICON: Record<string, LucideIcon> = { video: Video, audio: Headphones };

/* ───────────────────────────── component */

export function CommandPalette() {
  const open = usePaletteOpen();
  const navigate = useNavigate();
  const jump = useScriptureJump();
  const { viewer, isEditor } = useAuth();
  const signedIn = !!viewer?.authenticated;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (open) {
      setText(paletteSeed);
      setActive(0);
    }
  }, [open]);

  const q = text.trim();
  const debounced = useDebounced(q, 160);
  const books = useBooks();
  const recent = useRecent(undefined, 5);
  const sermons = useQuery({
    queryKey: ["sermons"],
    queryFn: () => api<{ items: SermonLite[] }>("/v1/sermons"),
    enabled: open && signedIn,
    retry: false,
    staleTime: 30_000,
  });
  const parse = useQuery({
    queryKey: ["palette-parse", debounced],
    queryFn: ({ signal }) => parseReferences(debounced, signal),
    enabled: open && debounced.length >= 2 && /\d/.test(debounced),
    staleTime: Infinity,
    retry: false,
  });
  const library = useQuery({
    queryKey: ["palette-resources", debounced],
    queryFn: ({ signal }) => api<{ items: ResourceLite[] }>(`/v1/resources${qs({ q: debounced, page_size: 4 })}`, { signal }),
    enabled: open && debounced.length >= 3,
    staleTime: 60_000,
    retry: false,
  });

  const close = () => closeCommandPalette();

  const sections = useMemo<Section[]>(() => {
    const go = (href: string) => () => navigate(href);
    const allNav: NavItem[] = navGroups({ signedIn, isEditor }).flatMap((g) => g.items);
    const navCommand = (n: NavItem): Command => ({ id: `nav-${n.to}`, label: n.label, detail: n.description, icon: n.icon, perform: go(n.to) });
    const recentCommand = (r: RecentItem): Command => ({
      id: `recent-${r.kind}-${r.key}`,
      label: r.label,
      detail: r.detail,
      icon: RECENT_ICON[r.kind] || History,
      hint: r.kind === "search" ? "Search" : r.kind === "read" ? "Reader" : r.kind === "resource" ? "Library" : undefined,
      perform: go(r.href),
    });
    const sermonList = sermons.data?.items ?? [];
    const sermonCommand = (s: SermonLite): Command => ({
      id: `sermon-${s.id}`,
      label: s.title || "Untitled sermon",
      detail: [s.scripture_ref, listProgress(s).label].filter(Boolean).join(" · "),
      icon: PenLine,
      hint: "Sermon",
      perform: go(`/sermons/${s.id}`),
    });
    const newSermon: Command = { id: "sermon-new", label: "Start a new sermon", detail: "Collect notes, polish, design slides and publish", icon: Plus, tone: "gold", perform: go("/sermons?new=1") };

    if (!q) {
      const out: Section[] = [];
      if (recent.length) out.push({ id: "recent", label: "Recent", items: recent.map(recentCommand) });
      out.push({ id: "nav", label: "Go to", items: allNav.map(navCommand) });
      if (signedIn) out.push({ id: "sermons", label: "Sermon Studio", items: [...sermonList.slice(0, 3).map(sermonCommand), newSermon] });
      return out;
    }

    const lower = q.toLowerCase();
    const out: Section[] = [];
    const refs = debounced === q ? parse.data ?? [] : [];
    const ref = refs[0];
    const whole = !!ref && isWholeQueryReference(q, ref);
    const scripture: Command[] = [];
    if (ref) {
      scripture.push({ id: `ref-read-${ref.canonical_start}`, label: `Open ${ref.display}`, detail: whole ? "Read it in context" : "Passage mentioned in your text", icon: BookOpen, tone: "navy", hint: "Reader", perform: go(referenceReadHref(ref)) });
      const verseId = referenceVerseId(ref);
      if (verseId) scripture.push({ id: `ref-insights-${verseId}`, label: `Verse insights for ${ref.display}`, detail: "Sermons, related verses, themes and people", icon: Sparkles, tone: "gold", perform: go(`/verse/${encodeURIComponent(verseId)}`) });
    }
    for (const b of matchBooks(books.data, q)) {
      if (ref && ref.book === b.code) continue;
      scripture.push({ id: `book-${b.code}`, label: b.name, detail: `${b.chapters} chapter${b.chapters === 1 ? "" : "s"} · ${b.testament === "OT" ? "Old" : "New"} Testament`, icon: BookOpenText, hint: "Open book", perform: go(`/read/${b.code}/1`) });
    }
    const searchItems: Command[] = [
      { id: "search", label: `Search for “${q}”`, detail: "Find verses and library sections by meaning", icon: Search, perform: go(`/search?q=${encodeURIComponent(q)}`) },
    ];
    if (q.length >= 3) searchItems.push({ id: "ask", label: `Ask AI: “${q}”`, detail: "A grounded answer with citations from Scripture and your library", icon: Sparkles, tone: "gold", perform: go(`/search?q=${encodeURIComponent(q)}&ask=1`) });
    const navMatches = allNav.filter((n) => `${n.label} ${n.description} ${n.keywords ?? ""}`.toLowerCase().includes(lower));
    const navPrefix = allNav.some((n) => n.label.toLowerCase().startsWith(lower));

    if (scripture.length && (whole || !ref)) out.push({ id: "scripture", label: "Scripture", items: scripture });
    if (navMatches.length && navPrefix) out.push({ id: "nav", label: "Go to", items: navMatches.map(navCommand) });
    out.push({ id: "search", label: "Search & Ask", items: searchItems });
    if (scripture.length && ref && !whole) out.push({ id: "scripture", label: "Scripture", items: scripture });
    if (navMatches.length && !navPrefix) out.push({ id: "nav", label: "Go to", items: navMatches.map(navCommand) });
    const sermonMatches = sermonList.filter((s) => `${s.title} ${s.scripture_ref ?? ""}`.toLowerCase().includes(lower)).slice(0, 3);
    if (sermonMatches.length) out.push({ id: "sermons", label: "Your sermons", items: sermonMatches.map(sermonCommand) });
    const resources = debounced === q ? library.data?.items ?? [] : [];
    if (resources.length) {
      out.push({
        id: "library",
        label: "Library",
        items: resources.map((r) => ({
          id: `resource-${r.id}`,
          label: r.title,
          detail: [r.type.charAt(0).toUpperCase() + r.type.slice(1), r.speaker || r.author].filter(Boolean).join(" · "),
          icon: TYPE_ICON[r.type] || FileText,
          hint: "Library",
          perform: go(`/resources/${r.id}`),
        })),
      });
    }
    const recentMatches = recent.filter((r) => r.label.toLowerCase().includes(lower)).slice(0, 3);
    if (recentMatches.length) out.push({ id: "recent", label: "Recent", items: recentMatches.map(recentCommand) });
    return out;
  }, [q, debounced, parse.data, library.data, sermons.data, books.data, recent, signedIn, isEditor, navigate]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (active >= flat.length) setActive(Math.max(0, flat.length - 1));
  }, [flat.length, active]);
  const activeCmd = flat[active];
  useEffect(() => {
    if (!activeCmd) return;
    document.getElementById(`cmdk-${activeCmd.id}`)?.scrollIntoView({ block: "nearest" });
  }, [activeCmd]);

  const run = (cmd: Command | undefined) => {
    if (!cmd) return;
    close();
    cmd.perform();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // A reference typed quickly (before the parser answers) still jumps straight to the passage.
      const pendingReference = /\d/.test(q) && (debounced !== q || parse.isFetching);
      if (q && pendingReference && (!activeCmd || activeCmd.id === "search")) {
        close();
        void jump(q);
        return;
      }
      run(activeCmd);
    }
  };

  const busy = !!q && (parse.isFetching || library.isFetching || debounced !== q);
  let index = -1;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (o ? openCommandPalette(text) : closeCommandPalette())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[80] bg-navy-950/35 backdrop-blur-[2px] duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 dark:bg-black/60" />
        <DialogPrimitive.Popup
          initialFocus={inputRef}
          className="fixed top-3 left-1/2 z-[81] flex max-h-[calc(100dvh-24px)] w-[calc(100%-24px)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl shadow-navy-950/20 outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.97] data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-[0.97] sm:top-[11vh] sm:max-h-[min(640px,78vh)] dark:shadow-black/50"
        >
          <DialogPrimitive.Title className="sr-only">Search, jump to a passage, or go to a page</DialogPrimitive.Title>
          <div className="flex items-center gap-3 border-b border-border px-4">
            {busy ? <Loader2 className="size-5 shrink-0 animate-spin text-ink-3" aria-hidden /> : <Search className="size-5 shrink-0 text-ink-3" aria-hidden />}
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="e.g. John 3:16, “hope”, or Library"
              className="h-14 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
              role="combobox"
              aria-expanded
              aria-controls="cmdk-list"
              aria-activedescendant={activeCmd ? `cmdk-${activeCmd.id}` : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
            />
            {text ? (
              <button type="button" onClick={() => { setText(""); inputRef.current?.focus(); }} className="grid grid-cols-1 size-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Clear search">
                <X className="size-4" aria-hidden />
              </button>
            ) : (
              <DialogPrimitive.Close className="rounded-md px-1.5 py-1 text-xs font-medium text-ink-3 hover:bg-surface-2 hover:text-ink sm:hidden">Close</DialogPrimitive.Close>
            )}
            <kbd className="kbd-hint hidden sm:inline-flex">esc</kbd>
          </div>

          <div ref={listRef} id="cmdk-list" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
            {sections.map((section) => (
              <div key={section.id} role="group" aria-labelledby={`cmdk-group-${section.id}`} className="pb-1">
                <div id={`cmdk-group-${section.id}`} className="px-3 pt-2.5 pb-1.5 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">
                  {section.label}
                </div>
                {section.items.map((cmd) => {
                  index += 1;
                  const i = index;
                  const selected = i === active;
                  const Icon = cmd.icon;
                  return (
                    <div
                      key={cmd.id}
                      id={`cmdk-${cmd.id}`}
                      role="option"
                      aria-selected={selected}
                      onMouseMove={() => active !== i && setActive(i)}
                      onClick={() => run(cmd)}
                      className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors", selected && "bg-surface-2 dark:bg-white/[0.07]")}
                    >
                      <span
                        className={cn(
                          "grid grid-cols-1 size-9 shrink-0 place-items-center rounded-lg border",
                          cmd.tone === "gold"
                            ? "border-gold-500/25 bg-gold-50 text-gold-700 dark:border-gold-400/20 dark:bg-gold-400/10 dark:text-gold-300"
                            : cmd.tone === "navy"
                              ? "border-navy-700 bg-navy-700 text-white dark:border-gold-400/30 dark:bg-gold-400/15 dark:text-gold-200"
                              : "border-border bg-card text-ink-2",
                        )}
                      >
                        <Icon className="size-[18px]" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{cmd.label}</span>
                        {cmd.detail && <span className="block truncate text-xs text-ink-3">{cmd.detail}</span>}
                      </span>
                      {selected ? (
                        <CornerDownLeft className="hidden size-4 shrink-0 text-ink-3 sm:block" aria-hidden />
                      ) : (
                        cmd.hint && <span className="hidden shrink-0 text-xs text-ink-3 sm:block">{cmd.hint}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="hidden items-center gap-4 border-t border-border bg-surface-2/50 px-4 py-2.5 text-xs text-ink-3 sm:flex dark:bg-white/[0.03]">
            <span className="inline-flex items-center gap-1.5"><kbd className="kbd-hint">↑</kbd><kbd className="kbd-hint">↓</kbd> move</span>
            <span className="inline-flex items-center gap-1.5"><kbd className="kbd-hint">↵</kbd> open</span>
            <span className="ml-auto inline-flex items-center gap-1.5">
              Open anytime with <kbd className="kbd-hint">{isMacLike ? "⌘" : "Ctrl"}</kbd><kbd className="kbd-hint">K</kbd>
            </span>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
