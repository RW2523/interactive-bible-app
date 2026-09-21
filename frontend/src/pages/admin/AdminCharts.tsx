import { ChartBar, Table2 } from "lucide-react";
import { useMemo, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import type { Json } from "@/api/types";
import { cn } from "@/lib/utils";
import { REL_TYPES, relLabel, VISIBILITY_BUCKETS } from "./adminLabels";

/*
 * Chart colours (validated with the dataviz palette checker against the card surfaces #ffffff / #111d35):
 * - Visibility buckets are ORDINAL (most → least visible): one hue, monotone lightness.
 *   light #104281 #256abf #5598e7 #86b6ef · dark #f0dca6 #e3b448 #c9962c #a8761d — all checks pass.
 * - Single-series bars: light #256abf, dark #a8761d — band, chroma and 3:1 contrast pass.
 */
const BUCKET_FILL = ["bg-[#104281] dark:bg-[#f0dca6]", "bg-[#256abf] dark:bg-[#e3b448]", "bg-[#5598e7] dark:bg-[#c9962c]", "bg-[#86b6ef] dark:bg-[#a8761d]"];
const SERIES_FILL = "bg-[#256abf] dark:bg-[#a8761d]";

// ───────────────────────────────────────────────────────────── tooltip

interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

function useTooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const place = (clientX: number, clientY: number, content: ReactNode) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: clientX - box.left, y: clientY - box.top, content });
  };
  const bind = (content: ReactNode) => ({
    onPointerMove: (e: PointerEvent<HTMLElement>) => place(e.clientX, e.clientY, content),
    onPointerLeave: () => setTip(null),
    onFocus: (e: FocusEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      place(r.left + r.width / 2, r.top, content);
    },
    onBlur: () => setTip(null),
  });
  const layer = tip ? (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 w-max max-w-56 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs text-ink shadow-md"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.content}
    </div>
  ) : null;
  return { ref, bind, layer };
}

function TipBody({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <>
      <span className="block text-sm font-semibold text-ink">{value}</span>
      <span className="block text-ink-2">{label}</span>
    </>
  );
}

/** Chart ⇄ table switch — every chart has an accessible table twin. */
function ViewSwitch({ table, onChange, className }: { table: boolean; onChange: (t: boolean) => void; className?: string }) {
  return (
    <div role="group" aria-label="Show as" className={cn("inline-flex rounded-lg border border-border bg-surface-2/60 p-0.5", className)}>
      {[
        [false, "Chart", ChartBar],
        [true, "Table", Table2],
      ].map(([value, label, Icon]) => {
        const I = Icon as typeof ChartBar;
        const active = table === value;
        return (
          <button
            key={String(label)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(value as boolean)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition outline-none focus-visible:ring-3 focus-visible:ring-ring",
              active ? "bg-card text-ink shadow-xs" : "text-ink-2 hover:text-ink",
            )}
          >
            <I className="size-3.5" aria-hidden /> {String(label)}
          </button>
        );
      })}
    </div>
  );
}

const th = "px-3 py-2 text-left text-xs font-semibold text-ink-2";
const td = "px-3 py-2 text-sm text-ink tabular-nums";

// ───────────────────────────────────────────────────────────── verse links by visibility

export interface VisibilityRow {
  type: string;
  total: number;
  buckets: number[];
}

export function visibilityRows(byTypeStatus: Json[] | null | undefined): VisibilityRow[] {
  const rows = byTypeStatus || [];
  const types = [...REL_TYPES, ...new Set(rows.map((r) => r.relationship_type).filter((t: string) => !REL_TYPES.includes(t)))];
  return types
    .map((type) => {
      const buckets = VISIBILITY_BUCKETS.map((b) => rows.filter((r) => r.relationship_type === type && (b.statuses as readonly string[]).includes(r.review_status)).reduce((s, r) => s + Number(r.n || 0), 0));
      return { type, buckets, total: buckets.reduce((a, b) => a + b, 0) };
    })
    .filter((r) => r.total > 0);
}

/** Part-to-whole per relationship type: how many verse links are shown, search-only, waiting or hidden. */
export function VisibilityChart({ byTypeStatus, compact }: { byTypeStatus: Json[] | null | undefined; compact?: boolean }) {
  const rows = useMemo(() => visibilityRows(byTypeStatus), [byTypeStatus]);
  const [table, setTable] = useState(false);
  const { ref, bind, layer } = useTooltip();
  const totals = VISIBILITY_BUCKETS.map((_, i) => rows.reduce((s, r) => s + r.buckets[i], 0));
  const grand = totals.reduce((a, b) => a + b, 0);
  if (!grand) return <p className="text-sm text-ink-2">No verse links yet. They appear here after the first item is processed.</p>;
  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <ul className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Legend">
          {VISIBILITY_BUCKETS.map((b, i) => (
            <li key={b.key} className="flex items-center gap-2 text-sm text-ink-2">
              <span className={cn("size-3 rounded-[3px]", BUCKET_FILL[i])} aria-hidden />
              {b.label} <span className="font-semibold text-ink tabular-nums">{totals[i]}</span>
            </li>
          ))}
        </ul>
        {!compact && <ViewSwitch table={table} onChange={setTable} />}
      </div>
      {table ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[520px] border-collapse">
            <caption className="sr-only">Verse links by how they are used and whether readers can see them</caption>
            <thead className="bg-surface-2/60">
              <tr>
                <th scope="col" className={th}>How the verse is used</th>
                {VISIBILITY_BUCKETS.map((b) => (
                  <th key={b.key} scope="col" className={cn(th, "text-right")}>{b.label}</th>
                ))}
                <th scope="col" className={cn(th, "text-right")}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.type} className="border-t border-border">
                  <th scope="row" className={cn(td, "text-left font-medium")}>{relLabel(r.type)}</th>
                  {r.buckets.map((n, i) => (
                    <td key={i} className={cn(td, "text-right")}>{n}</td>
                  ))}
                  <td className={cn(td, "text-right font-semibold")}>{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative grid grid-cols-1 gap-3.5">
          {rows.map((r) => (
            <div key={r.type} className="min-w-0">
              <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-ink">{relLabel(r.type)}</span>
                <span className="text-ink-2 tabular-nums">{r.total} {r.total === 1 ? "link" : "links"}</span>
              </div>
              <div className="flex h-3.5 gap-0.5" role="list" aria-label={`${relLabel(r.type)} verse links`}>
                {r.buckets.map((n, i) =>
                  n ? (
                    <span
                      key={i}
                      role="listitem"
                      tabIndex={0}
                      aria-label={`${VISIBILITY_BUCKETS[i].label}: ${n} of ${r.total}`}
                      className={cn("h-full min-w-1 outline-none last:rounded-r-[4px] hover:opacity-85 focus-visible:ring-3 focus-visible:ring-ring", BUCKET_FILL[i])}
                      style={{ flexGrow: n, flexBasis: 0 }}
                      {...bind(<TipBody value={`${n} · ${Math.round((n / r.total) * 100)}%`} label={`${relLabel(r.type)} — ${VISIBILITY_BUCKETS[i].label.toLowerCase()}`} />)}
                    />
                  ) : null,
                )}
              </div>
            </div>
          ))}
          {layer}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── confidence histogram

const ZONES = [
  { from: 0, to: 0.65, label: "Discarded" },
  { from: 0.65, to: 0.8, label: "Review or search" },
  { from: 0.8, to: 0.9, label: "Flagged" },
  { from: 0.9, to: 1, label: "Shown" },
];

/** Distribution of confidence across all verse links, in 5% steps, with the routing thresholds marked. */
export function ConfidenceHistogram({ bins, height = 132, step = 0.05 }: { bins: { from: number; n: number }[] | null | undefined; height?: number; step?: number }) {
  const [table, setTable] = useState(false);
  const { ref, bind, layer } = useTooltip();
  const count = Math.round(1 / step);
  const width = Math.round(step * 100);
  const data = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const n = (bins || []).filter((x) => Math.round(Number(x.from) / step) === i).reduce((s, x) => s + Number(x.n || 0), 0);
        return { from: i * width, to: (i + 1) * width, n };
      }),
    [bins, count, step, width],
  );
  const max = Math.max(0, ...data.map((d) => d.n));
  const total = data.reduce((s, d) => s + d.n, 0);
  if (!total) return <p className="text-sm text-ink-2">No verse links yet.</p>;
  const niceMax = max <= 5 ? max : Math.ceil(max / 5) * 5;
  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          {total} verse links · most sit at <span className="font-semibold text-ink">{data.reduce((a, b) => (b.n > a.n ? b : a)).from}–{data.reduce((a, b) => (b.n > a.n ? b : a)).to}%</span>
        </p>
        <ViewSwitch table={table} onChange={setTable} />
      </div>
      {table ? (
        <div className="max-h-72 overflow-auto rounded-xl border border-border">
          <table className="w-full border-collapse">
            <caption className="sr-only">Number of verse links in each confidence range</caption>
            <thead className="sticky top-0 bg-surface-2">
              <tr>
                <th scope="col" className={th}>Confidence</th>
                <th scope="col" className={cn(th, "text-right")}>Verse links</th>
              </tr>
            </thead>
            <tbody>
              {data.filter((d) => d.n).map((d) => (
                <tr key={d.from} className="border-t border-border">
                  <th scope="row" className={cn(td, "text-left font-medium")}>{d.from}–{d.to}%</th>
                  <td className={cn(td, "text-right")}>{d.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="@container relative">
          <div className="relative flex items-stretch gap-2" style={{ height }}>
            <div className="flex w-6 shrink-0 flex-col justify-between text-right text-[11px] text-ink-2 tabular-nums" aria-hidden>
              <span className="-translate-y-1/2">{niceMax}</span>
              <span className="translate-y-1/2">0</span>
            </div>
            <div className="relative flex-1 border-b border-[var(--line-2)]">
              <div className="absolute inset-x-0 top-0 border-t border-border" aria-hidden />
              {[0.65, 0.8, 0.9].map((t) => (
                <div key={t} className="absolute inset-y-0 w-px bg-[var(--line-2)]" style={{ left: `${t * 100}%` }} aria-hidden />
              ))}
              <div className={cn("absolute inset-0 flex items-end", count > 12 ? "gap-[2px]" : "gap-1.5")} role="list" aria-label="Verse links by confidence">
                {data.map((d) => (
                  <div key={d.from} className="flex h-full min-w-0 flex-1 items-end justify-center">
                    {d.n > 0 && (
                      <span
                        role="listitem"
                        tabIndex={0}
                        aria-label={`${d.from} to ${d.to}% confidence: ${d.n} verse links`}
                        className={cn("block w-full max-w-6 rounded-t-[4px] outline-none hover:opacity-85 focus-visible:ring-3 focus-visible:ring-ring", SERIES_FILL)}
                        style={{ height: `${Math.max(3, (d.n / (niceMax || 1)) * 100)}%` }}
                        {...bind(<TipBody value={`${d.n} ${d.n === 1 ? "link" : "links"}`} label={`${d.from}–${d.to}% confidence`} />)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="relative ml-8 h-4 text-[11px] text-ink-2 tabular-nums" aria-hidden>
            {[0, 65, 80, 90].map((t) => (
              <span key={t} className={cn("absolute top-1", t === 0 ? "left-0" : "-translate-x-1/2", t === 80 && "@max-md:hidden")} style={t > 0 ? { left: `${t}%` } : undefined}>
                {t}%
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-2">
            {ZONES.map((z, i) => (
              <span key={z.label}>
                {i > 0 && " · "}
                <span className="whitespace-nowrap">
                  {i === 0 ? "below 65%" : i === ZONES.length - 1 ? "90%+" : `${Math.round(z.from * 100)}–${Math.round(z.to * 100) - 1}%`} {z.label.toLowerCase()}
                </span>
              </span>
            ))}
          </p>
          {layer}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── horizontal bars (one series)

export interface BarItem {
  key: string;
  label: ReactNode;
  value: number;
  display: string;
  sub?: ReactNode;
  tip?: string;
}

/** Ranked horizontal bars with the value at the tip, for timing and cost breakdowns. */
export function BarList({ items, caption, valueHeader, labelHeader, emptyText = "Nothing to show yet.", maxRows }: { items: BarItem[]; caption: string; valueHeader: string; labelHeader: string; emptyText?: string; maxRows?: number }) {
  const [table, setTable] = useState(false);
  const [all, setAll] = useState(false);
  const { ref, bind, layer } = useTooltip();
  if (!items.length) return <p className="text-sm text-ink-2">{emptyText}</p>;
  const max = Math.max(...items.map((i) => i.value), 0) || 1;
  const shown = maxRows && !all ? items.slice(0, maxRows) : items;
  return (
    <div className="min-w-0">
      <div className="mb-3 flex justify-end">
        <ViewSwitch table={table} onChange={setTable} />
      </div>
      {table ? (
        <div className="max-h-96 overflow-auto rounded-xl border border-border">
          <table className="w-full border-collapse">
            <caption className="sr-only">{caption}</caption>
            <thead className="sticky top-0 bg-surface-2">
              <tr>
                <th scope="col" className={th}>{labelHeader}</th>
                <th scope="col" className={cn(th, "text-right")}>{valueHeader}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.key} className="border-t border-border">
                  <th scope="row" className={cn(td, "text-left font-medium")}>
                    {i.label}
                    {i.sub && <span className="block text-xs font-normal text-ink-2">{i.sub}</span>}
                  </th>
                  <td className={cn(td, "text-right")}>{i.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative">
          <ul className="grid grid-cols-1 gap-3" aria-label={caption}>
            {shown.map((i) => (
              <li key={i.key} className="min-w-0">
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium text-ink">{i.label}</span>
                  <span className="shrink-0 font-semibold text-ink tabular-nums">{i.display}</span>
                </div>
                <div className="h-2.5 border-l border-[var(--line-2)]">
                  <span
                    tabIndex={0}
                    aria-label={`${i.tip ?? ""} ${i.display}`.trim()}
                    className={cn("block h-full min-w-1 rounded-r-[4px] outline-none hover:opacity-85 focus-visible:ring-3 focus-visible:ring-ring", SERIES_FILL)}
                    style={{ width: `${Math.max(0.5, (i.value / max) * 100)}%` }}
                    {...bind(<TipBody value={i.display} label={i.tip ?? i.label} />)}
                  />
                </div>
                {i.sub && <p className="mt-1 text-xs text-ink-2">{i.sub}</p>}
              </li>
            ))}
          </ul>
          {maxRows && items.length > maxRows && (
            <button type="button" onClick={() => setAll((a) => !a)} className="mt-3 min-h-10 rounded-lg text-sm font-semibold text-link hover:underline">
              {all ? "Show fewer" : `Show all ${items.length}`}
            </button>
          )}
          {layer}
        </div>
      )}
    </div>
  );
}
