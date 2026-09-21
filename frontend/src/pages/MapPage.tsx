import { ArrowRight, BookOpen, Crosshair, List, Loader2, Network, Play, Search, SlidersHorizontal, Sparkles, Waypoints, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useScriptureMap, useTopics, useWhy } from "../api/hooks";
import type { GraphEdge, GraphNode, Json } from "../api/types";
import { MapGraph, MapLegend, NODE_COLORS, NODE_LABELS } from "../components/MapGraph";
import { buttonClass, EmptyState, FilterChip, HelpTip, PageContainer, PageHeader, SegmentedControl, Skeleton } from "../components/page";
import { ErrorState, useMediaQuery } from "../components/ui";
import { cn } from "../lib/utils";
import { fmtTime, readHref } from "../utils/format";

const TYPE_FILTERS = [
  { id: "verses", label: "Verses", color: NODE_COLORS.verse },
  { id: "themes", label: "Themes", color: NODE_COLORS.topic },
  { id: "people", label: "People", color: NODE_COLORS.person },
  { id: "events", label: "Events", color: NODE_COLORS.event },
  { id: "places", label: "Places", color: NODE_COLORS.place },
  { id: "resources", label: "Library", color: NODE_COLORS.segment },
] as const;
const ALL_TYPES = TYPE_FILTERS.map((t) => t.id as string);

export function MapPage() {
  const [search, setSearch] = useSearchParams();
  const root = search.get("root") || "verse:ROM.8.28";
  const [rootType, ...rest] = root.split(":");
  const rootId = rest.join(":");
  const view = search.get("view") || "graph";
  const types = (search.get("types") || "").split(",").filter(Boolean);
  const flag = (k: string) => search.get(k) === "1";
  const depth = Number(search.get("depth") || 1);
  const q = useScriptureMap({
    root_type: rootType, root_id: rootId, depth, types: types.join(",") || undefined,
    direct_only: flag("direct") || undefined, explicit_only: flag("explicit") || undefined, human_verified_only: flag("human") || undefined,
  });
  const [selected, setSelected] = useState<{ node: GraphNode; edge: GraphEdge | null } | null>(null);
  const [refInput, setRefInput] = useState("");
  const [refBusy, setRefBusy] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);
  const topics = useTopics();
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => setSelected(null), [root]);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(search);
    Object.entries(patch).forEach(([k, v]) => (v === null || v === "" ? next.delete(k) : next.set(k, v)));
    setSearch(next, { replace: true });
  };
  const isShown = (t: string) => types.length === 0 || types.includes(t);
  const toggleType = (t: string) => {
    const current = new Set(types.length ? types : ALL_TYPES);
    if (current.has(t)) current.delete(t);
    else current.add(t);
    if (current.size === 0) return; // keep at least one kind visible
    update({ types: current.size === ALL_TYPES.length ? null : [...current].join(",") });
  };
  const relationFilter = flag("direct") ? "direct" : flag("explicit") ? "explicit" : "all";
  const activeFilters = (types.length ? 1 : 0) + (relationFilter !== "all" ? 1 : 0) + (flag("human") ? 1 : 0) + (depth > 1 ? 1 : 0);
  const goVerse = async (e: FormEvent) => {
    e.preventDefault();
    if (!refInput.trim()) return;
    setRefBusy(true);
    setRefError(null);
    try {
      const parsed = await api<Json>(`/v1/bible/parse?q=${encodeURIComponent(refInput)}`);
      if (parsed.canonical) {
        update({ root: `verse:${parsed.canonical}` });
        setRefInput("");
      } else setRefError("That doesn't look like a Bible reference — try “John 3:16”.");
    } catch {
      setRefError("Couldn't read that reference. Please try again.");
    } finally {
      setRefBusy(false);
    }
  };

  const rootNode = q.data?.nodes.find((n) => n.id === q.data?.root);
  const rootLabel = rootNode?.label || rootId.replace(/\./g, " ");
  const recenter = (r: string) => update({ root: r });

  return (
    <PageContainer size="wide">
      <PageHeader
        eyebrow="Scripture Map"
        icon={Network}
        title="Scripture Map"
        description="See how a passage connects to other verses, themes, people, events and your library. Start from a verse or a theme, then tap anything to explore further."
      />

      <div className="grid grid-cols-1 gap-4 rounded-2xl border border-border bg-card p-4 shadow-xs sm:p-5 dark:bg-white/[0.03]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <form onSubmit={goVerse} className="min-w-0 lg:w-[380px]">
            <label htmlFor="map-verse" className="mb-1.5 block text-[13px] font-medium text-ink-2">Start from a verse</label>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
                <input
                  id="map-verse"
                  value={refInput}
                  onChange={(e) => {
                    setRefInput(e.target.value);
                    setRefError(null);
                  }}
                  placeholder="e.g. Romans 8:28"
                  aria-invalid={!!refError}
                  aria-describedby={refError ? "map-verse-error" : undefined}
                  className="h-10 w-full rounded-xl border border-input bg-card pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ring focus:ring-3 focus:ring-ring/40 aria-invalid:border-danger dark:bg-white/[0.04]"
                />
              </div>
              <button type="submit" className={buttonClass("primary")} disabled={refBusy || !refInput.trim()}>
                {refBusy ? <Loader2 className="animate-spin" aria-hidden /> : <Crosshair aria-hidden />} Map it
              </button>
            </div>
            {refError && <p id="map-verse-error" className="mt-1.5 text-xs text-danger">{refError}</p>}
          </form>
          <div className="min-w-0 lg:w-64">
            <label htmlFor="map-theme" className="mb-1.5 block text-[13px] font-medium text-ink-2">…or a theme</label>
            <select id="map-theme" className="select h-10 rounded-xl" value={rootType === "topic" ? rootId : ""} onChange={(e) => e.target.value && update({ root: `topic:${e.target.value}` })}>
              <option value="">Choose a theme…</option>
              {(topics.data || []).map((t: Json) => <option key={t.id} value={t.slug}>{t.name}</option>)}
            </select>
          </div>
          <div className="flex items-end justify-between gap-3 lg:ml-auto">
            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-ink-2">View</span>
              <SegmentedControl
                ariaLabel="View"
                value={view === "list" ? "list" : "graph"}
                onChange={(v) => update({ view: v === "graph" ? null : v })}
                options={[
                  { value: "graph", label: "Map", icon: Waypoints },
                  { value: "list", label: "List", icon: List, title: "An accessible list of every connection" },
                ]}
              />
            </div>
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              aria-controls="map-filters"
              className={buttonClass(filtersOpen || activeFilters ? "primary" : "secondary", "md", "lg:hidden")}
            >
              <SlidersHorizontal aria-hidden /> Filters{activeFilters ? ` · ${activeFilters}` : ""}
            </button>
          </div>
        </div>

        <div id="map-filters" className={cn("flex-col gap-3 border-t border-border pt-4 xl:flex-row xl:flex-wrap xl:items-center xl:gap-x-6", filtersOpen ? "flex" : "hidden lg:flex")}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-[11px] font-semibold tracking-[0.1em] text-ink-3 uppercase">Show</span>
            <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto">
              {TYPE_FILTERS.map((t) => (
                <FilterChip key={t.id} variant="soft" dot={t.color} active={isShown(t.id)} onClick={() => toggleType(t.id)} className="h-8 px-3">
                  {t.label}
                </FilterChip>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold tracking-[0.1em] text-ink-3 uppercase">Links</span>
            <SegmentedControl
              ariaLabel="Which links to show"
              size="sm"
              value={relationFilter}
              onChange={(v) => update({ direct: v === "direct" ? "1" : null, explicit: v === "explicit" ? "1" : null })}
              options={[
                { value: "all", label: "All" },
                { value: "explicit", label: "Named & quoted" },
                { value: "direct", label: "Named only" },
              ]}
            />
            <HelpTip label="Kinds of links">
              <b>Named</b>: a resource names the verse. <b>Quoted</b>: it quotes the words. <b>All</b> also includes passages discussed by context and AI-suggested connections (dashed purple lines).
            </HelpTip>
          </div>
          <FilterChip variant="soft" active={flag("human")} onClick={() => update({ human: flag("human") ? null : "1" })} className="h-8 self-start px-3 xl:self-auto">
            Verified by an editor
          </FilterChip>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold tracking-[0.1em] text-ink-3 uppercase">Reach</span>
            <SegmentedControl
              ariaLabel="How far to explore"
              size="sm"
              value={String(depth)}
              onChange={(v) => update({ depth: v === "1" ? null : v })}
              options={[
                { value: "1", label: "Close connections" },
                { value: "2", label: "One step further" },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="mt-5 mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-3">Centered on</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-navy-700 px-3 py-1 font-semibold text-white dark:bg-gold-400 dark:text-navy-900">
          <span className="size-2 rounded-full bg-gold-300 dark:bg-navy-900" aria-hidden />
          {rootLabel}
        </span>
        {rootType === "verse" && (
          <Link to={readHref(rootId.split("-")[0])} className={buttonClass("ghost", "sm")}><BookOpen aria-hidden /> Read it</Link>
        )}
        {q.isFetching && <Loader2 className="size-4 animate-spin text-ink-3" aria-label="Updating" />}
        {q.data && <span className="ml-auto text-xs text-ink-3">{Math.max(0, q.data.nodes.length - 1)} connections{q.data.truncated ? " · strongest shown" : ""}</span>}
      </div>

      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading && <Skeleton className="h-[min(70vh,760px)] rounded-[18px]" />}

      {q.data && view === "graph" && (
        <>
          <div className="map-wrap">
            <MapGraph data={q.data} selectedId={selected?.node.id} onSelect={(node, edge) => setSelected({ node, edge })} />
            <MapLegend />
            {selected && desktop && <NodePanel root={q.data.root} node={selected.node} edge={selected.edge} onClose={() => setSelected(null)} onRecenter={recenter} overlay />}
            {q.data.nodes.length <= 1 && (
              <div className="absolute inset-0 grid grid-cols-1 place-items-center p-6">
                <EmptyState compact icon={Network} title="No connections with these filters" description="Show more kinds of items, or choose “All” links." className="max-w-sm bg-card" />
              </div>
            )}
            {!selected && q.data.nodes.length > 1 && (
              <p className="pointer-events-none absolute top-3 left-3 rounded-full border border-border bg-card/90 px-3 py-1 text-xs text-ink-3 shadow-xs backdrop-blur">
                Tap a circle for details · drag to move · + / − to zoom
              </p>
            )}
          </div>
          {selected && !desktop && (
            <div className="mt-4">
              <NodePanel root={q.data.root} node={selected.node} edge={selected.edge} onClose={() => setSelected(null)} onRecenter={recenter} />
            </div>
          )}
        </>
      )}

      {q.data && view === "list" && (
        <div className="grid grid-cols-1 gap-4">
          {q.data.list.length === 0 && <EmptyState icon={List} title="No connections with these filters" description="Show more kinds of items, or choose “All” links." />}
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {q.data.list.map((group) => (
              <section key={group.type} className="rounded-2xl border border-border bg-card shadow-xs dark:bg-white/[0.03]">
                <h2 className="flex items-center gap-2 border-b border-border px-4 py-3 font-display text-lg font-semibold text-ink">
                  <span className="legend-dot" style={{ background: NODE_COLORS[group.type], margin: 0 }} aria-hidden />
                  {NODE_LABELS[group.type] || group.type}
                  <span className="font-sans text-sm font-normal text-ink-3">{group.items.length}</span>
                </h2>
                <ul className="divide-y divide-border">
                  {group.items.map(({ node, edge }) => (
                    <li key={node.id} className="grid grid-cols-1 gap-1.5 px-4 py-3">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <button type="button" className="text-left font-semibold text-link hover:underline" onClick={() => setSelected({ node, edge })}>{node.label}</button>
                        <span className="text-xs text-ink-3">
                          {edge.label}
                          {edge.confidence != null ? ` · ${Math.round(edge.confidence * 100)}%` : ""}
                          {edge.human_verified ? " · verified" : ""}
                        </span>
                      </div>
                      {edge.why && <p className="text-[13px]/relaxed text-ink-2">{edge.why}</p>}
                      <div className="flex flex-wrap gap-1.5"><NodeActions node={node} onRecenter={recenter} /></div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {selected && <NodePanel root={q.data.root} node={selected.node} edge={selected.edge} onClose={() => setSelected(null)} onRecenter={recenter} />}
        </div>
      )}

      <p className="mt-4 text-xs/relaxed text-ink-3">
        Solid lines are verses a resource names or quotes; dashed purple lines are AI-suggested connections — treat those as leads. Keyboard: <kbd className="kbd-hint">Tab</kbd> moves between circles, <kbd className="kbd-hint">Enter</kbd> opens details.
      </p>
    </PageContainer>
  );
}

function NodeActions({ node, onRecenter }: { node: GraphNode; onRecenter: (root: string) => void }) {
  const center = (r: string) => (
    <button type="button" className={buttonClass("secondary", "sm")} onClick={() => onRecenter(r)}>
      <Crosshair aria-hidden /> Center here
    </button>
  );
  return (
    <>
      {node.type === "verse" && node.ref && (
        <>
          <Link className={buttonClass("primary", "sm")} to={readHref(node.ref)}><BookOpen aria-hidden /> Read</Link>
          {center(`verse:${node.ref}`)}
        </>
      )}
      {node.type === "topic" && node.slug && (
        <>
          {center(`topic:${node.slug}`)}
          <Link className={buttonClass("ghost", "sm")} to={`/search?q=${encodeURIComponent(node.label)}`}><Search aria-hidden /> Search</Link>
        </>
      )}
      {node.type === "segment" && (
        <>
          {node.start_ms != null ? <Link className={buttonClass("primary", "sm")} to={`/clip/${node.id.replace("segment:", "")}`}><Play className="fill-current" aria-hidden /> Play clip</Link> : null}
          {node.resource_id && <Link className={buttonClass("secondary", "sm")} to={`/resources/${node.resource_id}?segment=${node.id.replace("segment:", "")}`}>Open section <ArrowRight aria-hidden /></Link>}
        </>
      )}
      {node.type === "resource" && (
        <>
          <Link className={buttonClass("primary", "sm")} to={`/resources/${node.id.replace("resource:", "")}`}>Open resource</Link>
          {center(node.id)}
        </>
      )}
      {["person", "event", "place"].includes(node.type) && node.entity_id && center(`entity:${node.entity_id}`)}
    </>
  );
}

function NodePanel({ root, node, edge, onClose, onRecenter, overlay }: { root: string; node: GraphNode; edge: GraphEdge | null; onClose: () => void; onRecenter: (r: string) => void; overlay?: boolean }) {
  const rootRef = root.startsWith("verse:") ? root.slice(6) : null;
  const canWhy = !!rootRef && node.type === "verse" && !!node.ref && edge?.type === "RELATED_TO" && edge.why_status !== "ready";
  const [ask, setAsk] = useState(false);
  const why = useWhy(rootRef || "", node.ref || "", ask && canWhy);
  const whyText = why.data?.why || edge?.why;
  return (
    <div
      className={cn("rounded-2xl border border-border bg-card p-4 shadow-lg", overlay && "map-side")}
      role="region"
      aria-label={`Details for ${node.label}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-ink-2 dark:bg-white/[0.07]">
          <span className="legend-dot" style={{ background: NODE_COLORS[node.type], margin: 0 }} aria-hidden />
          {NODE_LABELS[node.type] || node.type}
        </span>
        <button type="button" className="grid grid-cols-1 size-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink" onClick={onClose} aria-label="Close details">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <h3 className="mt-2 font-display text-xl font-semibold text-ink">{node.label}</h3>
      {node.text && <p className="scripture-quote mt-2 text-[15px]/relaxed text-ink-2">{node.text}</p>}
      {node.summary && <p className="mt-2 text-sm/relaxed text-ink-2">{node.summary}</p>}
      {node.description && <p className="mt-2 text-sm text-ink-3">{node.description}</p>}
      {node.start_ms != null && <p className="mt-2 text-xs text-ink-3">Starts at {fmtTime(node.start_ms)}</p>}
      {edge && (
        <div className="mt-3 rounded-xl bg-surface-2/70 px-3 py-2.5 text-sm dark:bg-white/[0.04]">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
            <span className="font-semibold text-ink">{edge.label}</span>
            {edge.confidence != null && <span className="text-ink-3">{Math.round(edge.confidence * 100)}% confident</span>}
            {edge.human_verified && <span className="text-ok">· verified</span>}
            {edge.ai && <span className="inline-flex items-center gap-1 text-rel-ai"><Sparkles className="size-3" aria-hidden /> AI related</span>}
          </p>
          {whyText && <p className="mt-1.5 text-[13px]/relaxed text-ink-2"><span className="font-semibold">Why related? </span>{whyText}</p>}
          {canWhy && !why.data && (
            <button type="button" className={buttonClass("secondary", "sm", "mt-2")} onClick={() => setAsk(true)} disabled={why.isFetching} title="Uses AI to explain the link between the two passages">
              {why.isFetching ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
              {why.isFetching ? "Explaining…" : "Explain with AI"}
            </button>
          )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <NodeActions node={node} onRecenter={onRecenter} />
      </div>
    </div>
  );
}
