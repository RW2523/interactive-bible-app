import { useMemo, useSyncExternalStore } from "react";

/** Things the owner opened recently — shown in the command palette and on Home. Stored only in this browser. */
export type RecentKind = "read" | "search" | "resource" | "sermon" | "verse";

export interface RecentItem {
  kind: RecentKind;
  /** stable identity within a kind (e.g. "ROM.8", a resource id, a lower-cased query) */
  key: string;
  label: string;
  detail?: string;
  href: string;
  at: number;
}

const STORAGE_KEY = "ibible_recent";
const MAX_ITEMS = 30;
const EMPTY: RecentItem[] = [];
const listeners = new Set<() => void>();
let cache: RecentItem[] | null = null;

function load(): RecentItem[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    cache = Array.isArray(parsed) ? (parsed as RecentItem[]).filter((r) => r && typeof r.href === "string" && typeof r.label === "string") : [];
  } catch {
    cache = [];
  }
  return cache;
}

function save(next: RecentItem[]) {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — keep the in-memory copy */
  }
  listeners.forEach((l) => l());
}

export function pushRecent(item: Omit<RecentItem, "at">) {
  const list = load();
  const first = list[0];
  if (first && first.kind === item.kind && first.key === item.key && first.label === item.label && first.href === item.href) return;
  save([{ ...item, at: Date.now() }, ...list.filter((r) => !(r.kind === item.kind && r.key === item.key))].slice(0, MAX_ITEMS));
}

export function removeRecent(kind: RecentKind, key: string) {
  save(load().filter((r) => !(r.kind === kind && r.key === key)));
}

export function clearRecent(kinds?: RecentKind[]) {
  save(kinds ? load().filter((r) => !kinds.includes(r.kind)) : []);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cache = null;
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useRecent(kinds?: RecentKind[], limit = 6): RecentItem[] {
  const all = useSyncExternalStore(subscribe, load, () => EMPTY);
  const kindKey = kinds?.join(",") ?? "";
  return useMemo(() => {
    const wanted = kindKey ? kindKey.split(",") : null;
    return all.filter((r) => !wanted || wanted.includes(r.kind)).slice(0, limit);
  }, [all, kindKey, limit]);
}
