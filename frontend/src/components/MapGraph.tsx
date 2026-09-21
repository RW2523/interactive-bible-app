import { Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import type { GraphEdge, GraphNode, ScriptureMap } from "../api/types";

export const NODE_COLORS: Record<string, string> = {
  verse: "#3f51b5",
  topic: "#b9832c",
  segment: "#00897b",
  resource: "#1e6fa8",
  person: "#c2185b",
  event: "#7b5e57",
  place: "#5b8c2a",
  book: "#7a8190",
  creator: "#8d6e63",
};
export const NODE_LABELS: Record<string, string> = {
  verse: "Verse", topic: "Theme", segment: "Clip / section", resource: "Resource", person: "Person", event: "Event", place: "Place", book: "Book", creator: "Speaker / author",
};
const EDGE_COLORS: Record<string, string> = {
  direct_reference: "#3949ab", scripture_quote: "#00796b", contextual_reference: "#a86b00", ai_related: "#7b4fc4",
};
const SECTOR: Record<string, number> = { verse: 0, topic: -90, person: 180, event: 150, place: 210, segment: 90, resource: 90, book: -150, creator: 120 };

interface Positioned extends GraphNode {
  x: number;
  y: number;
  r: number;
  ring: number;
}

function layout(data: ScriptureMap): { nodes: Positioned[]; edges: GraphEdge[] } {
  const root = data.nodes.find((n) => n.id === data.root) || data.nodes[0];
  if (!root) return { nodes: [], edges: [] };
  const adjacency = new Map<string, Set<string>>();
  data.edges.forEach((e) => {
    if (!adjacency.has(e.source)) adjacency.set(e.source, new Set());
    if (!adjacency.has(e.target)) adjacency.set(e.target, new Set());
    adjacency.get(e.source)!.add(e.target);
    adjacency.get(e.target)!.add(e.source);
  });
  const ring1 = data.nodes.filter((n) => n.id !== root.id && adjacency.get(root.id)?.has(n.id));
  const ring1Ids = new Set(ring1.map((n) => n.id));
  const ring2 = data.nodes.filter((n) => n.id !== root.id && !ring1Ids.has(n.id));
  const out: Positioned[] = [{ ...root, x: 0, y: 0, r: 24, ring: 0 }];
  const order = ["verse", "segment", "resource", "person", "event", "place", "topic", "book", "creator"];
  const groups = order
    .map((t) => [t, ring1.filter((n) => n.type === t).sort((a, b) => b.score - a.score)] as const)
    .filter(([, nodes]) => nodes.length > 0);
  const other = ring1.filter((n) => !order.includes(n.type));
  if (other.length) groups.push(["other", other] as const);
  const total = Math.max(1, ring1.length);
  const gapDeg = groups.length > 1 ? 10 : 0;
  const available = 360 - gapDeg * groups.length;
  const baseRadius = Math.max(170, total * 9);
  let cursor = -90 - (available * (groups[0]?.[1].length || 0)) / total / 2;
  groups.forEach(([, nodes]) => {
    const width = (available * nodes.length) / total;
    nodes.forEach((node, i) => {
      const angle = ((cursor + (width * (i + 0.5)) / nodes.length) * Math.PI) / 180;
      const radius = baseRadius + (total > 10 ? (i % 2) * 58 : 0);
      out.push({ ...node, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, r: 7 + node.score * 7, ring: 1 });
    });
    cursor += width + gapDeg;
  });
  const placed = new Map(out.map((n) => [n.id, n]));
  const siblingsAt = new Map<string, number>();
  ring2.forEach((node) => {
    const parentId = [...(adjacency.get(node.id) || [])].find((p) => placed.has(p) && placed.get(p)!.ring === 1);
    const parent = parentId ? placed.get(parentId)! : out[0];
    const base = Math.atan2(parent.y, parent.x);
    const count = siblingsAt.get(parent.id) || 0;
    siblingsAt.set(parent.id, count + 1);
    const angle = base + (count % 2 === 0 ? 1 : -1) * Math.ceil(count / 2) * 0.16;
    const radius = Math.hypot(parent.x, parent.y) + 120 + (count % 2) * 30;
    const p = { ...node, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, r: 6 + node.score * 5, ring: 2 };
    out.push(p);
    placed.set(p.id, p);
  });
  return { nodes: out, edges: data.edges };
}

export function MapGraph({ data, selectedId, onSelect, height = "100%", compact = false }: { data: ScriptureMap; selectedId?: string | null; onSelect?: (node: GraphNode, edge: GraphEdge | null) => void; height?: number | string; compact?: boolean }) {
  const { nodes, edges } = useMemo(() => layout(data), [data]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const initialView = useMemo(() => {
    const extent = Math.max(260, ...nodes.map((n) => Math.max(Math.abs(n.x), Math.abs(n.y)))) + 90;
    return { x: -extent, y: -extent, w: extent * 2, h: extent * 2 };
  }, [nodes]);
  const [view, setView] = useState(initialView);
  useEffect(() => setView(initialView), [initialView]);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // Keep labels readable on small screens: grow text and dots when the map is drawn small.
  const [boxSize, setBoxSize] = useState(720);
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height: h } = entry.contentRect;
      if (width > 0 && h > 0) setBoxSize(Math.min(width, h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const k = Math.min(1.8, Math.max(1, 640 / boxSize));

  const zoom = (factor: number) => setView((v) => ({ x: v.x + (v.w * (1 - factor)) / 2, y: v.y + (v.h * (1 - factor)) / 2, w: v.w * factor, h: v.h * factor }));
  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    if (compact) return;
    e.preventDefault();
    zoom(e.deltaY > 0 ? 1.1 : 0.9);
  };
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest(".map-node")) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scale = view.w / rect.width;
    setView((v) => ({ ...v, x: drag.current!.vx - (e.clientX - drag.current!.x) * scale, y: drag.current!.vy - (e.clientY - drag.current!.y) * scale }));
  };
  const edgeToRoot = (id: string) => data.edges.find((e) => (e.source === id && e.target === data.root) || (e.target === id && e.source === data.root)) || data.edges.find((e) => e.source === id || e.target === id) || null;

  return (
    <div style={{ position: "relative", height }}>
      <svg
        ref={svgRef}
        className="map-svg"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        role="group"
        aria-label="Scripture Map graph. Use Tab to move between nodes and Enter to select."
      >
        <g>
          {edges.map((e) => {
            const a = byId.get(e.source);
            const b = byId.get(e.target);
            if (!a || !b) return null;
            const rel = e.relationship_type || "";
            const color = EDGE_COLORS[rel] || (e.ai ? EDGE_COLORS.ai_related : "var(--line-2)");
            const dashed = rel === "ai_related" || e.ai || e.type === "HAS_THEME" || e.type === "INVOLVES";
            const highlighted = selectedId && (e.source === selectedId || e.target === selectedId);
            return (
              <line
                key={e.id}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={color}
                strokeOpacity={highlighted ? 0.95 : 0.55}
                strokeWidth={(highlighted ? 2.5 : 1.3) + (e.confidence ?? 0.5) * 1.2}
                strokeDasharray={dashed ? "5 4" : undefined}
              >
                <title>{`${e.label}${e.confidence != null ? ` (${Math.round(e.confidence * 100)}%)` : ""}`}</title>
              </line>
            );
          })}
        </g>
        <g>
          {nodes.map((n) => {
            const color = NODE_COLORS[n.type] || "#777";
            const label = n.label.length > (compact ? 16 : 24) ? `${n.label.slice(0, compact ? 15 : 23)}…` : n.label;
            return (
              <g
                key={n.id}
                className={`map-node ${selectedId === n.id ? "selected" : ""}`}
                transform={`translate(${n.x},${n.y})`}
                tabIndex={0}
                role="button"
                aria-label={`${NODE_LABELS[n.type] || n.type}: ${n.label}`}
                onClick={() => onSelect?.(n, n.id === data.root ? null : edgeToRoot(n.id))}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect?.(n, n.id === data.root ? null : edgeToRoot(n.id)))}
              >
                <circle r={n.r * Math.sqrt(k)} fill={color} fillOpacity={n.ring === 0 ? 1 : 0.88} stroke="var(--paper-2)" strokeWidth={2} />
                {n.ring === 0 && <circle r={n.r * Math.sqrt(k) + 6} fill="none" stroke={color} strokeOpacity={0.3} strokeWidth={4} />}
                <text y={n.r * Math.sqrt(k) + (n.ring === 0 ? 17 : 14) * k} textAnchor="middle" style={{ fontWeight: n.ring === 0 ? 700 : 500, fontSize: (n.ring === 0 ? 15 : compact ? 13 : 12.5) * k, strokeWidth: 3 * k }}>
                  {label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      {!compact && (
        <div className="absolute right-3 bottom-3 flex items-center overflow-hidden rounded-xl border border-border bg-card/95 shadow-md backdrop-blur dark:bg-navy-900/90" role="group" aria-label="Zoom">
          <button type="button" className="grid grid-cols-1 size-10 place-items-center text-ink-2 transition hover:bg-surface-2 hover:text-ink" onClick={() => zoom(0.8)} aria-label="Zoom in" title="Zoom in">
            <Plus className="size-4" aria-hidden />
          </button>
          <span className="h-5 w-px bg-border" aria-hidden />
          <button type="button" className="grid grid-cols-1 size-10 place-items-center text-ink-2 transition hover:bg-surface-2 hover:text-ink" onClick={() => zoom(1.25)} aria-label="Zoom out" title="Zoom out">
            <Minus className="size-4" aria-hidden />
          </button>
          <span className="h-5 w-px bg-border" aria-hidden />
          <button type="button" className="flex h-10 items-center gap-1.5 px-3 text-[13px] font-medium text-ink-2 transition hover:bg-surface-2 hover:text-ink" onClick={() => setView(initialView)} title="Fit the whole map">
            <RotateCcw className="size-3.5" aria-hidden /> Reset
          </button>
        </div>
      )}
    </div>
  );
}

export function MapLegend() {
  return (
    <div className="map-legend" aria-hidden>
      {Object.entries(NODE_LABELS)
        .filter(([k]) => k !== "resource")
        .map(([k, v]) => (
          <span key={k} className="inline-flex items-center">
            <span className="legend-dot" style={{ background: NODE_COLORS[k] }} />
            {v}
          </span>
        ))}
      <span className="inline-flex items-center gap-1.5">
        <svg width="22" height="8" aria-hidden><line x1="0" y1="4" x2="22" y2="4" stroke="var(--line-2)" strokeWidth="2" /></svg> Named or quoted
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="22" height="8" aria-hidden><line x1="0" y1="4" x2="22" y2="4" stroke="#7b4fc4" strokeWidth="2" strokeDasharray="4 3" /></svg> AI related
      </span>
    </div>
  );
}
