/**
 * BibleKnowledgeGraph — Interactive force-directed graph of 100 Bible concepts
 * Uses react-force-graph-2d (canvas-based, D3 force simulation)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { GRAPH_NODES, GRAPH_EDGES, GRAPH_CATEGORIES, computeNodeDegrees } from '../data/bibleGraphData.js';
import { Network, Search, X, ZoomIn, ZoomOut, Maximize2, RotateCcw } from 'lucide-react';
import { readCssVars } from '../lib/useDocumentTheme.js';

const COLOR_VARS = ['--x-graph-bg', '--x-graph-label', '--x-graph-label-bg', '--x-graph-ring'];
const FALLBACK_COLORS = { '--x-graph-bg': '#fbf9f4', '--x-graph-label': '#152036', '--x-graph-label-bg': 'rgba(255,255,255,0.9)', '--x-graph-ring': '#152036' };

// ── Build graph data ──────────────────────────────────────────────────────────
const ALL_NODES = GRAPH_NODES;
const ALL_EDGES = GRAPH_EDGES;
const DEGREES   = computeNodeDegrees(ALL_NODES, ALL_EDGES);

const NODE_SIZE_BASE = 6;
const NODE_SIZE_SCALE = 3;

function nodeRadius(node) {
  const imp = node.importance || 1;
  const deg = DEGREES[node.id] || 0;
  return NODE_SIZE_BASE + imp * NODE_SIZE_SCALE * 0.5 + deg * 0.5;
}

// ── Category colours ──────────────────────────────────────────────────────────
const CAT_COLORS = Object.fromEntries(
  Object.entries(GRAPH_CATEGORIES).map(([k, v]) => [k, v.color])
);

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function nodeColor(node) { return CAT_COLORS[node.category] || '#94a3b8'; }

// ── Component ─────────────────────────────────────────────────────────────────
export default function BibleKnowledgeGraph({ theme = 'light' }) {
  const fgRef    = useRef(null);
  const [dimensions, setDimensions] = useState({ w: 900, h: 600 });
  const containerRef = useRef(null);
  const rootRef = useRef(null);
  const [colors, setColors] = useState(FALLBACK_COLORS);

  // spread the nodes out a little more than the default force layout so labels stay readable
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('charge')?.strength(-150);
    fg.d3Force('link')?.distance(48);
    fg.d3ReheatSimulation?.();
  }, []);

  // canvas drawing cannot use CSS variables directly: read the theme's graph colours whenever the theme changes
  useEffect(() => {
    const read = readCssVars(rootRef.current, COLOR_VARS);
    setColors(Object.fromEntries(COLOR_VARS.map((k) => [k, read[k] || FALLBACK_COLORS[k]])));
  }, [theme]);

  const [search,       setSearch]       = useState('');
  const [activeCategories, setActiveCategories] = useState(new Set(Object.keys(GRAPH_CATEGORIES)));
  const [hoveredNode,  setHoveredNode]  = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [highlightNodes, setHighlightNodes] = useState(new Set());
  const [highlightLinks, setHighlightLinks] = useState(new Set());
  const [showInfo,     setShowInfo]     = useState(false);

  // Responsive resize — fire immediately on mount and on every size change
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        const w = Math.floor(width);
        const h = Math.floor(height);
        if (w > 0 && h > 0) setDimensions({ w, h });
      }
    };
    measure(); // fire once immediately
    const obs = new ResizeObserver(measure);
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Filter graph by category + search
  const graphData = useMemo(() => {
    const q = search.trim().toLowerCase();
    const nodes = ALL_NODES.filter(n => {
      const catOk = activeCategories.has(n.category);
      const searchOk = !q || n.label.toLowerCase().includes(q) || n.desc?.toLowerCase().includes(q);
      return catOk && searchOk;
    });
    const nodeIds = new Set(nodes.map(n => n.id));
    const links = ALL_EDGES.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map(e => ({ ...e })); // shallow copy so d3 can mutate
    return { nodes, links };
  }, [search, activeCategories]);

  // Build neighbour maps when graphData changes
  const { neighbourNodes, neighbourLinks } = useMemo(() => {
    const nn = {};
    const nl = {};
    graphData.nodes.forEach(n => { nn[n.id] = new Set(); });
    graphData.links.forEach(l => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      if (!nn[s]) nn[s] = new Set();
      if (!nn[t]) nn[t] = new Set();
      nn[s].add(t); nn[t].add(s);
      nl[`${s}__${t}`] = true;
      nl[`${t}__${s}`] = true;
    });
    return { neighbourNodes: nn, neighbourLinks: nl };
  }, [graphData]);

  const updateHighlight = useCallback((node) => {
    if (!node) { setHighlightNodes(new Set()); setHighlightLinks(new Set()); return; }
    const nn = neighbourNodes[node.id] || new Set();
    setHighlightNodes(new Set([node.id, ...nn]));
    const hl = new Set();
    Object.keys(neighbourLinks).forEach(k => {
      if (k.startsWith(node.id + '__') || k.endsWith('__' + node.id)) hl.add(k);
    });
    setHighlightLinks(hl);
  }, [neighbourNodes, neighbourLinks]);

  const handleNodeHover = useCallback((node) => {
    setHoveredNode(node || null);
    updateHighlight(node || null);
    if (containerRef.current) {
      containerRef.current.style.cursor = node ? 'pointer' : 'default';
    }
  }, [updateHighlight]);

  const handleNodeClick = useCallback((node) => {
    setSelectedNode(node);
    setShowInfo(true);
    // Pan + zoom to node
    if (Number.isFinite(node.x) && Number.isFinite(node.y)) {
      fgRef.current?.centerAt(node.x, node.y, 600);
      fgRef.current?.zoom(3.5, 600);
    }
  }, []);

  const handleBackgroundClick = useCallback(() => {
    setSelectedNode(null);
    setShowInfo(false);
    setHighlightNodes(new Set());
    setHighlightLinks(new Set());
  }, []);

  // ── Custom node renderer ───────────────────────────────────────────────────
  const paintNode = useCallback((node, ctx, globalScale) => {
    // Guard: node positions are NaN/undefined during first simulation ticks
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;

    const r   = nodeRadius(node);
    const col = nodeColor(node);
    const isHighlighted = highlightNodes.size === 0 || highlightNodes.has(node.id);
    const isSelected    = selectedNode?.id === node.id;
    const isHovered     = hoveredNode?.id  === node.id;
    const alpha = isHighlighted ? 1 : 0.18;

    ctx.globalAlpha = alpha;

    // Outer glow ring
    if (isSelected || isHovered) {
      const glowR = r + 5 + Math.sin(Date.now() / 350) * 2.5;
      const gradient = ctx.createRadialGradient(node.x, node.y, r, node.x, node.y, glowR + 6);
      const { r: cr, g: cg, b: cb } = hexToRgb(col);
      gradient.addColorStop(0, `rgba(${cr},${cg},${cb},0.55)`);
      gradient.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.beginPath();
      ctx.arc(node.x, node.y, glowR + 6, 0, 2 * Math.PI);
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    // Main circle with radial gradient fill
    const { r: cr, g: cg, b: cb } = hexToRgb(col);
    const fill = ctx.createRadialGradient(
      node.x - r * 0.3, node.y - r * 0.3, r * 0.1,
      node.x, node.y, r
    );
    fill.addColorStop(0, `rgba(${cr},${cg},${cb}, 1)`);
    fill.addColorStop(0.6, `rgba(${cr * 0.7},${cg * 0.7},${cb * 0.7}, 1)`);
    fill.addColorStop(1, `rgba(${Math.max(cr - 40, 0)},${Math.max(cg - 40, 0)},${Math.max(cb - 40, 0)}, 1)`);

    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = fill;
    ctx.fill();

    // Selection ring
    if (isSelected) {
      ctx.strokeStyle = colors['--x-graph-ring'];
      ctx.lineWidth = 2.5 / globalScale;
      ctx.stroke();
    }

    // Label — always show for important or highlighted nodes
    const showLabel = isHighlighted && (globalScale > 1.4 || node.importance >= 4 || isSelected || isHovered);
    if (showLabel) {
      const fontSize = Math.max(8, Math.min(14, 12 / globalScale));
      ctx.font = `${isSelected || isHovered ? '700' : '500'} ${fontSize}px "Inter Variable", Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = node.label;
      const tw = ctx.measureText(label).width;
      const pad = 3 / globalScale;

      // Label background pill
      ctx.fillStyle = colors['--x-graph-label-bg'];
      ctx.beginPath();
      const bx = node.x - tw / 2 - pad;
      const by = node.y + r + 3 / globalScale - pad; // the pill sits under the circle, around the text
      const bw = tw + pad * 2;
      const bh = fontSize + pad * 2;
      const br = 3 / globalScale;
      ctx.roundRect(bx, by, bw, bh, br);
      ctx.fill();

      ctx.fillStyle = colors['--x-graph-label'];
      ctx.fillText(label, node.x, node.y + r + 3 / globalScale + fontSize / 2);
    }

    ctx.globalAlpha = 1;
  }, [hoveredNode, selectedNode, highlightNodes, colors]);

  // ── Custom link renderer ────────────────────────────────────────────────────
  const paintLink = useCallback((link, ctx) => {
    const s = link.source;
    const t = link.target;
    if (!Number.isFinite(s?.x) || !Number.isFinite(s?.y) ||
        !Number.isFinite(t?.x) || !Number.isFinite(t?.y)) return;
    const key1 = `${s.id}__${t.id}`;
    const key2 = `${t.id}__${s.id}`;
    const isActive = highlightLinks.size === 0 || highlightLinks.has(key1) || highlightLinks.has(key2);
    const sCat = GRAPH_CATEGORIES[s.category];
    const tCat = GRAPH_CATEGORIES[t.category];
    const sCol = sCat?.color || '#64748b';
    const tCol = tCat?.color || '#64748b';

    ctx.globalAlpha = isActive ? (highlightLinks.size > 0 ? 0.85 : 0.4) : 0.06;
    ctx.lineWidth   = isActive && highlightLinks.size > 0 ? 1.8 : 0.8;

    const grad = ctx.createLinearGradient(s.x, s.y, t.x, t.y);
    grad.addColorStop(0, sCol);
    grad.addColorStop(1, tCol);

    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(t.x, t.y);
    ctx.strokeStyle = grad;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }, [highlightLinks]);

  // ── Category toggle ────────────────────────────────────────────────────────
  const toggleCategory = (cat) => {
    setActiveCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) { if (next.size > 1) next.delete(cat); }
      else next.add(cat);
      return next;
    });
    setSelectedNode(null); setShowInfo(false);
  };

  const resetView = () => {
    fgRef.current?.zoomToFit(600, 40);
    setSelectedNode(null); setShowInfo(false);
    setHighlightNodes(new Set()); setHighlightLinks(new Set());
  };

  // Category counts
  const catCounts = useMemo(() => {
    const counts = {};
    ALL_NODES.forEach(n => { counts[n.category] = (counts[n.category] || 0) + 1; });
    return counts;
  }, []);

  // Degree of selected node connections
  const selectedConnections = useMemo(() => {
    if (!selectedNode) return [];
    return ALL_EDGES
      .filter(e => e.source === selectedNode.id || e.target === selectedNode.id)
      .map(e => {
        const otherId = e.source === selectedNode.id ? e.target : e.source;
        const other   = ALL_NODES.find(n => n.id === otherId);
        return { node: other, label: e.label, dir: e.source === selectedNode.id ? 'out' : 'in' };
      })
      .filter(c => c.node);
  }, [selectedNode]);

  const allOn = activeCategories.size === Object.keys(GRAPH_CATEGORIES).length;

  return (
    <div className="bkg-root" ref={rootRef}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bkg-header">
        <div className="bkg-header__left">
          <p className="x-eyebrow"><Network size={13} aria-hidden /> Knowledge graph</p>
          <h2 className="bkg-title">How the Bible connects</h2>
          <p className="bkg-subtitle">
            {graphData.nodes.length} people, events, places and ideas · {graphData.links.length} links. Click a circle to see what it connects to.
          </p>
        </div>

        <div className="bkg-tools">
          <label className="x-search bkg-search">
            <Search size={15} aria-hidden />
            <input
              type="search"
              placeholder="Find a person, event or place"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Search the knowledge graph"
            />
            {search && (
              <button type="button" className="x-search__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </label>
          <div className="bkg-zoom-btns" role="group" aria-label="Zoom">
            <button type="button" className="icon-button" title="Zoom in" aria-label="Zoom in" onClick={() => fgRef.current?.zoom(fgRef.current.zoom() * 1.4, 300)}><ZoomIn size={17} /></button>
            <button type="button" className="icon-button" title="Zoom out" aria-label="Zoom out" onClick={() => fgRef.current?.zoom(fgRef.current.zoom() / 1.4, 300)}><ZoomOut size={17} /></button>
            <button type="button" className="icon-button" title="Fit everything" aria-label="Fit everything" onClick={() => fgRef.current?.zoomToFit(600, 40)}><Maximize2 size={16} /></button>
            <button type="button" className="icon-button" title="Reset" aria-label="Reset the view" onClick={resetView}><RotateCcw size={16} /></button>
          </div>
        </div>
      </div>

      {/* ── Category filter pills ─────────────────────────────────────────── */}
      <div className="bkg-cats" role="group" aria-label="Show kinds">
        {Object.entries(GRAPH_CATEGORIES).map(([key, cfg]) => (
          <button
            key={key}
            type="button"
            className="x-chip x-chip--sm x-chip--toggle"
            aria-pressed={activeCategories.has(key)}
            onClick={() => toggleCategory(key)}
            title={activeCategories.has(key) ? `Hide ${cfg.label.toLowerCase()}s` : `Show ${cfg.label.toLowerCase()}s`}
          >
            <span className="x-dot" style={{ background: cfg.color }} aria-hidden />
            {cfg.label}
            <span className="x-chip__count">{catCounts[key] || 0}</span>
          </button>
        ))}
        {!allOn ? (
          <button type="button" className="link-button" onClick={() => setActiveCategories(new Set(Object.keys(GRAPH_CATEGORIES)))}>
            Show all
          </button>
        ) : null}
      </div>

      {/* ── Graph canvas ──────────────────────────────────────────────────── */}
      <div className="bkg-canvas-wrap" ref={containerRef}>
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          width={dimensions.w}
          height={dimensions.h}
          backgroundColor={colors['--x-graph-bg']}
          nodeRelSize={1}
          nodeVal={(n) => nodeRadius(n) ** 1.5}
          nodeLabel={() => ''}
          nodeCanvasObject={paintNode}
          nodeCanvasObjectMode={() => 'replace'}
          linkCanvasObject={paintLink}
          linkCanvasObjectMode={() => 'replace'}
          onNodeHover={handleNodeHover}
          onNodeClick={handleNodeClick}
          onBackgroundClick={handleBackgroundClick}
          linkDirectionalParticles={(link) => {
            const s = typeof link.source === 'object' ? link.source.id : link.source;
            const t = typeof link.target === 'object' ? link.target.id : link.target;
            return (highlightLinks.has(`${s}__${t}`) || highlightLinks.has(`${t}__${s}`)) ? 3 : 0;
          }}
          linkDirectionalParticleSpeed={0.006}
          linkDirectionalParticleWidth={2}
          linkDirectionalParticleColor={(link) => {
            const s = typeof link.source === 'object' ? link.source : ALL_NODES.find(n => n.id === link.source);
            return s ? nodeColor(s) : '#c9a84c';
          }}
          warmupTicks={80}
          cooldownTicks={80}
          onEngineStop={() => fgRef.current?.zoomToFit(400, 30)}
          d3AlphaDecay={0.025}
          d3VelocityDecay={0.4}
          enableNodeDrag
          enableZoomInteraction
          enablePanInteraction
        />

        {/* Hover tooltip */}
        {hoveredNode && !showInfo && (
          <div className="bkg-tooltip" role="status">
            <span className="bkg-tooltip__label">
              <span className="x-dot" style={{ background: nodeColor(hoveredNode) }} aria-hidden /> {hoveredNode.label}
            </span>
            <span className="bkg-tooltip__cat">{GRAPH_CATEGORIES[hoveredNode.category]?.label} · {DEGREES[hoveredNode.id] || 0} connections</span>
          </div>
        )}

        {/* Legend overlay */}
        <div className="bkg-legend" aria-hidden>
          <p className="bkg-legend__title">Bigger circle = more important</p>
          {Object.entries(GRAPH_CATEGORIES).map(([key, cfg]) => (
            <div key={key} className="bkg-legend__row">
              <span className="x-dot" style={{ background: cfg.color }} />
              <span>{cfg.label}</span>
            </div>
          ))}
        </div>

        {graphData.nodes.length === 0 ? (
          <div className="bkg-empty" role="status">
            <p>Nothing matches “{search}”.</p>
            <button type="button" className="secondary btn-sm" onClick={() => setSearch('')}>Clear search</button>
          </div>
        ) : null}

        {/* ── Selected node detail panel ────────────────────────────────────── */}
        {showInfo && selectedNode && (
          <div className="bkg-info-panel" role="region" aria-label={`${selectedNode.label} details`}>
            <div className="bkg-info-panel__header">
              <div>
                <span className="bkg-info-cat" style={{ '--cat': nodeColor(selectedNode) }}>
                  <span className="x-dot" style={{ background: nodeColor(selectedNode) }} aria-hidden />
                  {GRAPH_CATEGORIES[selectedNode.category]?.label}
                </span>
                <h3>{selectedNode.label}</h3>
                <p className="bkg-info-desc">{selectedNode.desc}</p>
              </div>
              <button type="button" className="icon-button icon-button--ghost icon-button--sm" aria-label="Close details" onClick={() => { setShowInfo(false); setSelectedNode(null); }}>
                <X size={16} />
              </button>
            </div>

            <div className="bkg-info-connections">
              <h4>{selectedConnections.length} direct connections</h4>
              <div className="bkg-connections-grid">
                {selectedConnections.map((c, i) => (
                  <button
                    key={i} type="button"
                    className="bkg-conn-chip"
                    onClick={() => {
                      // the simulation keeps positions on the node objects it was given
                      const gNode = graphData.nodes.find(n => n.id === c.node.id);
                      if (gNode) handleNodeClick(gNode);
                      else { setSearch(''); setActiveCategories(new Set(Object.keys(GRAPH_CATEGORIES))); setSelectedNode(c.node); setShowInfo(true); }
                    }}
                  >
                    <span className="x-dot" style={{ background: nodeColor(c.node) }} aria-hidden />
                    <span className="bkg-conn-name">{c.node.label}</span>
                    {c.label ? <span className="bkg-conn-rel">{c.label}</span> : null}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
