import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Maximize2, Minimize2, Search, Target } from 'lucide-react';
import { ancestorPathToRoot } from '../lib/lineagePath.js';
import { buildRelationshipIndex, getChildren, getParents, personMatchesGraphFilter, shouldShowLabelAtZoom } from '../lib/lineageUtils.js';

const GraphNode = memo(function GraphNode({ p, targets, highlightNodeIds, selectedId, dim, showLabel, hoverTitle, onClick, onDoubleClick }) {
  const { x, y } = p.layout;
  const onPath = highlightNodeIds.has(p.id);
  const isTarget = targets.has(p.id);
  const isSel = selectedId === p.id;
  const isFemale = p.gender === 'female';
  const eraL = (p.era || '').toLowerCase();
  const isKingNode = eraL.includes('king') && (p.name || '').toLowerCase().includes('king');
  const r = p.isMajor ? 11 : isTarget ? 10 : 5.5;
  let stroke =
    p.app?.colorGroup === 'messianic'
      ? '#c9a227'
      : p.app?.colorGroup === 'priestly'
        ? '#a371f7'
        : p.app?.colorGroup === 'israel'
          ? '#58a6ff'
          : p.app?.colorGroup === 'judge'
            ? '#3fb950'
            : '#8b949e';
  if (isKingNode && p.app?.colorGroup !== 'messianic') stroke = '#c45c4a';
  const op = dim ? 0.26 : onPath || isTarget ? 1 : 0.42;
  const haloStroke = isTarget
    ? 'rgba(12, 91, 90, 0.95)'
    : onPath
      ? isFemale
        ? 'rgba(196, 120, 138, 0.78)'
        : 'rgba(201,162,39,0.55)'
      : 'transparent';
  return (
    <g
      transform={`translate(${x},${y})`}
      className={`lineage-fg-node ${isSel ? 'lineage-fg-node--selected' : ''}`}
      style={{ opacity: op, cursor: 'pointer' }}
      onClick={() => onClick(p)}
      onDoubleClick={() => onDoubleClick(p)}
    >
      <title>{hoverTitle || `${p.displayName || p.name} — ${p.era}`}</title>
      <circle
        r={r + (onPath || isTarget ? 3.5 : 0)}
        className="lineage-fg-halo"
        fill="none"
        stroke={haloStroke}
        strokeWidth={isTarget ? 3 : 2}
      />
      <circle r={r} fill={stroke} fillOpacity={onPath || isTarget ? 1 : 0.55} strokeWidth={0.8} />
      {showLabel ? (
        <text y={r + 15} textAnchor="middle" className="lineage-fg-label" fontSize={p.isMajor ? 12.5 : 10.5}>
          {(p.displayName || p.name).length > 20 ? `${(p.displayName || p.name).slice(0, 18)}…` : p.displayName || p.name}
        </text>
      ) : null}
    </g>
  );
});

/**
 * @param {object} props
 * @param {import('../data/bible_lineage_timeline_family_tree.json')} props.tree
 * @param {Set<string>} props.highlightNodeIds
 * @param {Set<string>} props.highlightEdgeIds
 * @param {string[]} props.targetPersonIds
 * @param {(person: import('../data/bible_lineage_timeline_family_tree.json').people[number]) => void} props.onSelectPerson
 * @param {'selection'|'all'} props.fitMode
 * @param {(mode: 'selection'|'all') => void} props.onFitMode
 * @param {React.RefObject<HTMLDivElement|null>} props.viewportRef
 * @param {number} [props.graphFocusNonce]
 * @param {string|null} [props.graphFocusPersonId]
 */
export default function FullGraphTreeView({
  tree,
  highlightNodeIds,
  highlightEdgeIds,
  targetPersonIds,
  onSelectPerson,
  fitMode,
  onFitMode,
  viewportRef,
  graphFocusNonce = 0,
  graphFocusPersonId = null
}) {
  const { people, relationships, metadata } = tree;
  const { width: W, height: H } = metadata.layoutSize;
  const messiahId = metadata.messiahId || 'jesus_messiah';
  const rootId = metadata.rootId || 'adam';

  const tribeIds = useMemo(() => (tree.featuredLineages?.twelveTribesOfIsrael || []).map((t) => t.id), [tree]);
  const idx = useMemo(() => buildRelationshipIndex(people, relationships || []), [people, relationships]);
  const targets = useMemo(() => new Set(targetPersonIds), [targetPersonIds]);

  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [zoom, setZoom] = useState(0.22);
  const [labels, setLabels] = useState('smart');
  const [sideBranches, setSideBranches] = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  const zoom01 = Math.min(1, Math.max(0, (zoom - 0.12) / 0.88));

  const filteredIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people
      .filter((p) => personMatchesGraphFilter(p, filter, tribeIds, targetPersonIds))
      .filter((p) => !q || (p.displayName || p.name || '').toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
      .map((p) => p.id);
  }, [people, filter, tribeIds, targetPersonIds, search]);

  const filteredSet = useMemo(() => new Set(filteredIds), [filteredIds]);

  const hoverTitles = useMemo(() => {
    const m = new Map();
    for (const p of people) {
      const pn = getParents(p.id, idx);
      const ch = getChildren(p.id, idx);
      const parL = pn
        .slice(0, 4)
        .map((id) => idx.peopleById.get(id)?.displayName || idx.peopleById.get(id)?.name || id)
        .join(', ');
      const chL = ch
        .slice(0, 5)
        .map((id) => idx.peopleById.get(id)?.displayName || idx.peopleById.get(id)?.name || id)
        .join(', ');
      const lines = [
        `${p.displayName || p.name}`,
        `Era: ${p.era || '—'}`,
        parL ? `Parents: ${parL}` : null,
        chL ? `Children: ${chL}` : null
      ].filter(Boolean);
      m.set(p.id, lines.join('\n'));
    }
    return m;
  }, [people, idx]);

  const breadcrumb = useMemo(() => {
    const path = ancestorPathToRoot(messiahId, idx.peopleById, rootId).reverse();
    const names = path.map((id) => idx.peopleById.get(id)?.displayName || idx.peopleById.get(id)?.name || id);
    if (names.length > 14) return `${names.slice(0, 6).join(' → ')} → … → ${names.slice(-4).join(' → ')}`;
    return names.join(' → ');
  }, [messiahId, idx.peopleById, rootId]);

  const scrollToFit = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ids =
      fitMode === 'selection' && highlightNodeIds.size
        ? highlightNodeIds
        : new Set(people.map((p) => p.id));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of ids) {
      const p = idx.peopleById.get(id);
      if (!p?.layout) continue;
      const { x, y } = p.layout;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    if (!Number.isFinite(minX)) return;
    const pad = 140;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(W, maxX + pad);
    maxY = Math.min(H, maxY + pad);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    el.scrollTo({
      left: Math.max(0, midX * zoom - el.clientWidth / 2),
      top: Math.max(0, midY * zoom - el.clientHeight / 2),
      behavior: 'smooth'
    });
  }, [fitMode, highlightNodeIds, people, idx.peopleById, W, H, zoom, viewportRef]);

  useEffect(() => {
    const t = requestAnimationFrame(() => scrollToFit());
    return () => cancelAnimationFrame(t);
  }, [fitMode, highlightNodeIds, scrollToFit]);

  useEffect(() => {
    if (!graphFocusNonce || !graphFocusPersonId) return;
    const p = idx.peopleById.get(graphFocusPersonId);
    if (!p?.layout) return;
    setSelectedId(graphFocusPersonId);
    onSelectPerson(p);
    const z = 0.5;
    setZoom(z);
    const run = () => {
      const el = viewportRef.current;
      if (!el) return;
      const { x, y } = p.layout;
      el.scrollTo({
        left: Math.max(0, x * z - el.clientWidth / 2),
        top: Math.max(0, y * z - el.clientHeight / 2),
        behavior: 'smooth'
      });
    };
    window.setTimeout(run, 90);
  }, [graphFocusNonce, graphFocusPersonId, idx.peopleById, onSelectPerson, viewportRef]);

  const pick = useCallback(
    (p) => {
      setSelectedId(p.id);
      onSelectPerson(p);
    },
    [onSelectPerson]
  );

  const doublePick = useCallback(
    (p) => {
      setSelectedId(p.id);
      onSelectPerson(p);
      const el = viewportRef.current;
      if (!el || !p.layout) return;
      const { x, y } = p.layout;
      const nextZoom = Math.min(0.85, Math.max(0.35, zoom * 1.35));
      setZoom(nextZoom);
      requestAnimationFrame(() => {
        el.scrollTo({
          left: Math.max(0, x * nextZoom - el.clientWidth / 2),
          top: Math.max(0, y * nextZoom - el.clientHeight / 2),
          behavior: 'smooth'
        });
      });
    },
    [onSelectPerson, viewportRef, zoom]
  );

  const firstSearchHit = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.trim().toLowerCase();
    return people.find((p) => (p.displayName || p.name || '').toLowerCase().includes(q)) || null;
  }, [people, search]);

  const jumpSearch = useCallback(() => {
    if (!firstSearchHit?.layout) return;
    const el = viewportRef.current;
    if (!el) return;
    const { x, y } = firstSearchHit.layout;
    pick(firstSearchHit);
    el.scrollTo({
      left: Math.max(0, x * zoom - el.clientWidth / 2),
      top: Math.max(0, y * zoom - el.clientHeight / 2),
      behavior: 'smooth'
    });
  }, [firstSearchHit, viewportRef, zoom, pick]);

  const edgeOpacity = (rel) => {
    const onPath = highlightEdgeIds.has(rel.id);
    if (onPath) return 1;
    if (!sideBranches && !rel.isMessianicLine) return 0.05;
    if (rel.isMessianicLine) return 0.62;
    return 0.18;
  };

  return (
    <div className="lineage-full">
      <div className="lineage-full__toolbar">
        <div className="lineage-full__search">
          <Search size={16} aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search person…"
            onKeyDown={(e) => e.key === 'Enter' && jumpSearch()}
          />
          <button type="button" className="secondary" onClick={jumpSearch}>
            Find
          </button>
        </div>
        <select className="lineage-full__select" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter graph">
          <option value="all">All people</option>
          <option value="messianic">Messianic line</option>
          <option value="patriarchs">Patriarchs</option>
          <option value="tribes">Twelve tribes</option>
          <option value="priestly">Priestly line</option>
          <option value="kings">Kings / kingdom</option>
          <option value="judges">Judges</option>
          <option value="women">Women</option>
          <option value="event">This event</option>
        </select>
        <div className="lineage-full__toggles">
          <button type="button" className={`secondary ${fitMode === 'selection' ? 'active' : ''}`} onClick={() => onFitMode('selection')}>
            <Target size={16} /> Fit selection
          </button>
          <button type="button" className={`secondary ${fitMode === 'all' ? 'active' : ''}`} onClick={() => onFitMode('all')}>
            {fitMode === 'all' ? <Minimize2 size={16} /> : <Maximize2 size={16} />} Fit all
          </button>
          <button type="button" className="secondary" onClick={() => setZoom(0.22)} title="Reset zoom">
            Reset zoom
          </button>
          <button
            type="button"
            className={`secondary ${labels === 'all' ? 'active' : ''}`}
            onClick={() => setLabels((v) => (v === 'all' ? 'smart' : 'all'))}
            title="Toggle labels"
          >
            {labels === 'all' ? <Eye size={16} /> : <EyeOff size={16} />} Labels
          </button>
          <button type="button" className={`secondary ${sideBranches ? 'active' : ''}`} onClick={() => setSideBranches((v) => !v)}>
            Branches
          </button>
        </div>
      </div>

      <div className="lineage-full__stage">
        <div className="lineage-full__legend" aria-label="Legend">
          <span>
            <i className="lineage-leg-dot lineage-leg-dot--gold" /> Messianic
          </span>
          <span>
            <i className="lineage-leg-dot lineage-leg-dot--teal" /> Event focus
          </span>
          <span>
            <i className="lineage-leg-dot lineage-leg-dot--purple" /> Priestly
          </span>
          <span>
            <i className="lineage-leg-dot lineage-leg-dot--rose" /> Women on path
          </span>
          <span>
            <i className="lineage-leg-dot lineage-leg-dot--king" /> Kings
          </span>
        </div>

        <div ref={viewportRef} className="lineage-full__viewport">
          <div className="lineage-full__scaled" style={{ width: W * zoom, height: H * zoom }}>
            <svg width={W * zoom} height={H * zoom} viewBox={`0 0 ${W} ${H}`} className="lineage-fg-svg" aria-label="Full lineage graph">
              <rect x={0} y={0} width={W} height={H} className="lineage-fg-bg" />
              <g className="lineage-fg-edges">
                {relationships.map((rel) => {
                  const [sx, sy] = rel.layout.source;
                  const [tx, ty] = rel.layout.target;
                  const onPath = highlightEdgeIds.has(rel.id);
                  const srcOk = filteredSet.has(rel.source);
                  const tgtOk = filteredSet.has(rel.target);
                  const dimEdge = filter !== 'all' && (!srcOk || !tgtOk);
                  return (
                    <line
                      key={rel.id}
                      x1={sx}
                      y1={sy}
                      x2={tx}
                      y2={ty}
                      className={`lineage-fg-edge ${onPath ? 'lineage-fg-edge--path' : ''} ${rel.isMessianicLine ? 'lineage-fg-edge--messianic' : ''}`}
                      strokeWidth={onPath ? 3.2 : rel.isMessianicLine ? 2.4 : 0.85}
                      strokeOpacity={dimEdge ? 0.04 : edgeOpacity(rel)}
                    />
                  );
                })}
              </g>
              <g className="lineage-fg-nodes">
                {people.map((p) => {
                  const dim = filter !== 'all' && !filteredSet.has(p.id);
                  const showLabel = labels === 'all' || (labels === 'smart' && shouldShowLabelAtZoom(p.id, p.isMajor, zoom01));
                  return (
                    <GraphNode
                      key={p.id}
                      p={p}
                      targets={targets}
                      highlightNodeIds={highlightNodeIds}
                      selectedId={selectedId}
                      dim={dim}
                      showLabel={showLabel}
                      hoverTitle={hoverTitles.get(p.id)}
                      onClick={pick}
                      onDoubleClick={doublePick}
                    />
                  );
                })}
              </g>
            </svg>
          </div>
        </div>

        <div className="lineage-full__minimap" aria-hidden>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="lineage-full__minimap-svg">
            <rect x={0} y={0} width={W} height={H} className="lineage-full__minimap-frame" />
            {people.map((p) => (
              <circle key={p.id} cx={p.layout.x} cy={p.layout.y} r={p.isMajor ? 10 : 4} className="lineage-full__minimap-dot" />
            ))}
          </svg>
        </div>
      </div>

      <footer className="lineage-full__crumb" role="navigation" aria-label="Messianic spine">
        <span className="lineage-full__crumb-label">Messianic line</span>
        <span className="lineage-full__crumb-path">{breadcrumb}</span>
      </footer>
    </div>
  );
}
