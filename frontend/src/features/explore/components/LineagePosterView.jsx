import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Crosshair, GitBranch, Minus, Plus, Search, Sparkles } from 'lucide-react';
import {
  POSTER_CARD_COPY,
  POSTER_EMOJI,
  POSTER_EXTRA_BRANCHES,
  POSTER_SIDE_BRANCH,
  POSTER_SPINE_IDS,
  POSTER_SPOUSE_LABEL,
  POSTER_TIMELINE
} from '../lib/lineagePosterData.js';

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function branchesForRow(anchorId, shem, peopleById) {
  const left = [];
  const right = [];
  for (const b of POSTER_SIDE_BRANCH) {
    if (b.anchorAfterId === anchorId && b.side === 'left' && b.id === 'shem' && shem) {
      left.push({ branch: b, person: shem });
    }
  }
  for (const b of POSTER_EXTRA_BRANCHES) {
    if (b.anchorAfterId !== anchorId) continue;
    const person = peopleById.get(b.id);
    if (!person) continue;
    if (b.side === 'left') left.push({ branch: b, person });
    else if (b.side === 'right') right.push({ branch: b, person });
  }
  return { left, right };
}

function BranchTwigCard({ person, branch, messiahOnly, selectedId, onOpen, highlightNodeIds, targetSet, eventDim }) {
  const id = person.id;
  const emoji = POSTER_EMOJI[id] || '📖';
  const copy = POSTER_CARD_COPY[id];
  const dim = messiahOnly;
  const isHi = highlightNodeIds.has(id) || targetSet.has(id);
  const evDim = eventDim && !isHi;
  return (
    <button
      type="button"
      data-poster-id={id}
      className={`lineage-poster__twig ${dim ? 'is-dim' : ''} ${evDim ? 'is-dim' : ''} ${isHi ? 'is-highlight' : ''} ${selectedId === id ? 'is-selected' : ''}`}
      onClick={() => onOpen(id)}
    >
      <span className="lineage-poster__twig-tag">{branch.tag}</span>
      <span className="lineage-poster__twig-emoji" aria-hidden>
        {emoji}
      </span>
      <strong>{person.displayName || person.name}</strong>
      {copy && <small>{copy.line}</small>}
    </button>
  );
}

function ShemTwigCard({ person, messiahOnly, selectedId, onOpen, highlightNodeIds, targetSet, eventDim }) {
  const id = person.id;
  const dim = messiahOnly;
  const isHi = highlightNodeIds.has(id) || targetSet.has(id);
  const evDim = eventDim && !isHi;
  return (
    <button
      type="button"
      data-poster-id={id}
      className={`lineage-poster__twig lineage-poster__twig--shem ${dim ? 'is-dim' : ''} ${evDim ? 'is-dim' : ''} ${isHi ? 'is-highlight' : ''} ${selectedId === id ? 'is-selected' : ''}`}
      onClick={() => onOpen(id)}
    >
      <span className="lineage-poster__twig-tag">Nations line</span>
      <span className="lineage-poster__twig-emoji" aria-hidden>
        {POSTER_EMOJI.shem}
      </span>
      <strong>Shem</strong>
      <small>{POSTER_CARD_COPY.shem?.line}</small>
      <cite>{POSTER_CARD_COPY.shem?.ref}</cite>
    </button>
  );
}

/**
 * @param {object} props
 * @param {import('../data/bible_lineage_timeline_family_tree.json')} props.tree
 * @param {Set<string>} props.highlightNodeIds
 * @param {string[]} props.targetPersonIds
 * @param {string} [props.selectedEventId]
 * @param {string|null} [props.centerPersonId]
 * @param {(id: string) => void} props.onRequestPersonDetail
 * @param {boolean} [props.suppressEventInsight] — hide duplicate strip when parent shows focus strip
 */
export default function LineagePosterView({
  tree,
  highlightNodeIds,
  targetPersonIds,
  selectedEventId = '',
  centerPersonId = null,
  onRequestPersonDetail,
  suppressEventInsight = false
}) {
  const canopyGradId = useId().replace(/:/g, '');
  const peopleById = useMemo(() => new Map(tree.people.map((p) => [p.id, p])), [tree.people]);
  const tribeList = useMemo(() => tree.featuredLineages?.twelveTribesOfIsrael || [], [tree]);

  const spine = useMemo(() => {
    return POSTER_SPINE_IDS.map((id) => peopleById.get(id)).filter(Boolean);
  }, [peopleById]);

  const shem = peopleById.get('shem');
  const [messiahOnly, setMessiahOnly] = useState(false);
  const [lineExplore, setLineExplore] = useState('full');
  const [scale, setScale] = useState(1.05);
  const [selectedId, setSelectedId] = useState(null);
  const [posterSearch, setPosterSearch] = useState('');
  const [railActive, setRailActive] = useState(0);
  const stageRef = useRef(null);

  const targetSet = useMemo(() => new Set(targetPersonIds), [targetPersonIds]);
  const eventDim = lineExplore === 'event';

  useEffect(() => {
    if (lineExplore === 'jesus') {
      setMessiahOnly(true);
    } else {
      setMessiahOnly(false);
    }
  }, [lineExplore]);

  const scrollToId = useCallback((id) => {
    const el = stageRef.current;
    if (!el) return;
    const card = el.querySelector(`[data-poster-id="${id}"]`);
    if (card && typeof card.scrollIntoView === 'function') {
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, []);

  const scrollToFirstHighlight = useCallback(() => {
    const pool = [...POSTER_SPINE_IDS, ...POSTER_EXTRA_BRANCHES.map((b) => b.id), 'shem'];
    const first = pool.find((id) => highlightNodeIds.has(id) || targetSet.has(id));
    if (first) scrollToId(first);
  }, [highlightNodeIds, targetSet, scrollToId]);

  const scrollToCenterFromEvent = useCallback(() => {
    if (centerPersonId && peopleById.has(centerPersonId)) {
      scrollToId(centerPersonId);
      return;
    }
    scrollToFirstHighlight();
  }, [centerPersonId, peopleById, scrollToId, scrollToFirstHighlight]);

  useEffect(() => {
    scrollToFirstHighlight();
  }, [highlightNodeIds, targetPersonIds, scrollToFirstHighlight]);

  useEffect(() => {
    if (!centerPersonId && !selectedEventId) return;
    const t = window.setTimeout(() => scrollToCenterFromEvent(), 120);
    return () => window.clearTimeout(t);
  }, [centerPersonId, selectedEventId, scrollToCenterFromEvent]);

  useEffect(() => {
    const scrollId =
      lineExplore === 'abraham'
        ? 'abram_abraham'
        : lineExplore === 'tribes'
          ? 'jacob_israel'
          : lineExplore === 'priestly'
            ? 'aaron'
            : lineExplore === 'kings'
              ? 'david'
              : null;
    if (!scrollId) return;
    const t = window.setTimeout(() => scrollToId(scrollId), 60);
    return () => window.clearTimeout(t);
  }, [lineExplore, scrollToId]);

  useEffect(() => {
    if (lineExplore === 'event') {
      const t = window.setTimeout(() => scrollToFirstHighlight(), 80);
      return () => window.clearTimeout(t);
    }
  }, [lineExplore, scrollToFirstHighlight]);

  const onWheel = useCallback((e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.06 : 0.06;
    setScale((s) => clamp(Number((s + delta).toFixed(2)), 0.75, 1.55));
  }, []);

  const onStageScroll = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const frac = max > 0 ? el.scrollTop / max : 0;
    const spinePos = frac * Math.max(1, POSTER_SPINE_IDS.length - 1);
    let best = 0;
    let bestD = Infinity;
    POSTER_TIMELINE.forEach((tick, i) => {
      const d = Math.abs(tick.spineIndex - spinePos);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setRailActive(best);
  }, []);

  const openPerson = useCallback(
    (id) => {
      setSelectedId(id);
      onRequestPersonDetail(id);
    },
    [onRequestPersonDetail]
  );

  const runPosterSearch = useCallback(() => {
    const q = posterSearch.trim().toLowerCase();
    if (!q) return;
    const pool = [
      ...POSTER_SPINE_IDS,
      ...POSTER_EXTRA_BRANCHES.map((b) => b.id),
      'shem',
      ...tribeList.map((t) => t.id)
    ];
    const hit = pool.find((id) => {
      const p = peopleById.get(id);
      if (!p) return false;
      const n = (p.displayName || p.name || '').toLowerCase();
      return n.includes(q) || id.toLowerCase().includes(q);
    });
    if (hit) scrollToId(hit);
  }, [posterSearch, peopleById, tribeList, scrollToId]);

  const selectedIsTribe = selectedId && tribeList.some((t) => t.id === selectedId);

  const timelineMinHeight = Math.max(1760, POSTER_SPINE_IDS.length * 118 + 360);

  return (
    <div className="lineage-poster">
      <div className="lineage-poster__toolbar lineage-poster__toolbar--rich">
        <label className="lineage-poster__field-label">
          <span className="lineage-poster__field-kicker">Line</span>
          <select
            className="lineage-poster__line-select"
            value={lineExplore}
            onChange={(e) => setLineExplore(e.target.value)}
            aria-label="Lineage line focus"
          >
            <option value="full">Full poster</option>
            <option value="jesus">Line of Jesus</option>
            <option value="abraham">Abraham&apos;s family</option>
            <option value="tribes">Twelve tribes</option>
            <option value="priestly">Priestly line</option>
            <option value="kings">Kings of Judah</option>
            <option value="event">Event related people</option>
          </select>
        </label>
        <button type="button" className={`secondary ${messiahOnly ? 'active' : ''}`} onClick={() => setMessiahOnly((v) => !v)} title="Dim side branches">
          <Sparkles size={16} /> Dim branches
        </button>
        <div className="lineage-poster__zoom">
          <button type="button" className="icon-button" aria-label="Zoom out" onClick={() => setScale((s) => clamp(s - 0.08, 0.75, 1.55))}>
            <Minus size={18} />
          </button>
          <span className="lineage-poster__zoom-label">{Math.round(scale * 100)}%</span>
          <button type="button" className="icon-button" aria-label="Zoom in" onClick={() => setScale((s) => clamp(s + 0.08, 0.75, 1.55))}>
            <Plus size={18} />
          </button>
        </div>
        <div className="lineage-poster__search">
          <Search size={16} aria-hidden />
          <input
            type="search"
            value={posterSearch}
            onChange={(e) => setPosterSearch(e.target.value)}
            placeholder="Search name…"
            onKeyDown={(e) => e.key === 'Enter' && runPosterSearch()}
            aria-label="Search poster tree"
          />
          <button type="button" className="secondary" onClick={runPosterSearch}>
            Find
          </button>
        </div>
        <button type="button" className="secondary lineage-poster__center-btn" onClick={scrollToCenterFromEvent}>
          <Crosshair size={16} /> Center selected event
        </button>
        <p className="lineage-poster__hint">Scroll the tree. Ctrl or Cmd + scroll to zoom.</p>
      </div>

      {!suppressEventInsight && (targetPersonIds.length > 0 || highlightNodeIds.size > 0) && (
        <div className="lineage-poster__insight" role="status">
          <GitBranch size={16} className="lineage-poster__insight-branch" aria-hidden />
          <div className="lineage-poster__insight-main">
            <span className="lineage-poster__insight-kicker">This event on the tree</span>
            <div className="lineage-poster__insight-pills">
              {targetPersonIds.slice(0, 6).map((id) => {
                const p = peopleById.get(id);
                return (
                  <span key={id} className="lineage-poster__insight-pill">
                    {p?.displayName || p?.name || id}
                  </span>
                );
              })}
              {highlightNodeIds.size > 0 ? (
                <span className="lineage-poster__insight-meta">{highlightNodeIds.size} nodes along the highlighted path</span>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <div className="lineage-poster__stage" ref={stageRef} onWheel={onWheel} onScroll={onStageScroll}>
        <div
          className="lineage-poster__scalable"
          style={{
            transform: `scale(${scale})`,
            transformOrigin: 'center top'
          }}
        >
          <div className="lineage-poster__layout">
            <aside className="lineage-poster__timeline" style={{ minHeight: timelineMinHeight }} aria-hidden>
              {POSTER_TIMELINE.map((t, i) => (
                <div
                  key={t.label}
                  className={`lineage-poster__tick ${i === railActive ? 'is-active' : ''}`}
                  style={{ top: `${(t.spineIndex / Math.max(1, POSTER_SPINE_IDS.length - 1)) * 100}%` }}
                >
                  <span className="lineage-poster__tick-line" />
                  <span className="lineage-poster__tick-label">{t.label}</span>
                </div>
              ))}
            </aside>

            <div className="lineage-poster__main">
              <header className="lineage-poster__hero">
                <div className="lineage-poster__canopy" aria-hidden>
                  <svg className="lineage-poster__canopy-svg" viewBox="0 0 400 120" preserveAspectRatio="xMidYMin slice">
                    <defs>
                      <linearGradient id={canopyGradId} x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#2d7a5c" />
                        <stop offset="1" stopColor="#5cb88a" />
                      </linearGradient>
                    </defs>
                    <ellipse cx="200" cy="118" rx="190" ry="36" fill={`url(#${canopyGradId})`} opacity="0.35" />
                    <circle cx="90" cy="55" r="38" fill={`url(#${canopyGradId})`} opacity="0.5" />
                    <circle cx="200" cy="35" r="48" fill={`url(#${canopyGradId})`} opacity="0.55" />
                    <circle cx="310" cy="58" r="34" fill={`url(#${canopyGradId})`} opacity="0.48" />
                  </svg>
                </div>
                <div className="lineage-poster__title-block">
                  <img
                    className="lineage-poster__thumb"
                    src="/bible-family-tree-kids-reference.png"
                    alt=""
                    width={72}
                    height={72}
                    loading="lazy"
                  />
                  <div>
                    <h3>From Adam to the Messiah</h3>
                    <p>One continuous line through Scripture—tap any card to explore. Side branches show other key figures.</p>
                  </div>
                </div>
              </header>

              <div className="lineage-poster__legend">
                <span>
                  <i className="lineage-poster__legend-line lineage-poster__legend-line--solid" /> Descent
                </span>
                <span>
                  <i className="lineage-poster__legend-line lineage-poster__legend-line--dotted" /> Marriage
                </span>
                <span>
                  <i className="lineage-poster__legend-line lineage-poster__legend-line--gold" /> Line of Jesus
                </span>
              </div>

              <div className="lineage-poster__tree-board">
                <div className="lineage-poster__vine" aria-hidden />
                <div className="lineage-poster__vine-glow" aria-hidden />

                <div className="lineage-poster__trunk">
                  {spine.map((person, idx) => {
                    const id = person.id;
                    const emoji = POSTER_EMOJI[id] || '✝️';
                    const copy = POSTER_CARD_COPY[id];
                    const spouse = POSTER_SPOUSE_LABEL[id];
                    const onMessiahPath = person.lineageTypes?.includes('messianic') || POSTER_SPINE_IDS.includes(id);
                    const isHi = highlightNodeIds.has(id) || targetSet.has(id);
                    const evDim = eventDim && !isHi;
                    const { left, right } = branchesForRow(id, shem, peopleById);

                    return (
                      <React.Fragment key={id}>
                        {idx > 0 && (
                          <div className="lineage-poster__vine-gap">
                            <span className={`lineage-poster__vine-join ${onMessiahPath ? 'lineage-poster__vine-join--gold' : ''}`} />
                          </div>
                        )}

                        <div className="lineage-poster__tree-row">
                          <div className="lineage-poster__branch-col lineage-poster__branch-col--left">
                            {left.map(({ branch, person: p }) =>
                              p.id === 'shem' ? (
                                <ShemTwigCard
                                  key="shem"
                                  person={p}
                                  messiahOnly={messiahOnly}
                                  selectedId={selectedId}
                                  onOpen={openPerson}
                                  highlightNodeIds={highlightNodeIds}
                                  targetSet={targetSet}
                                  eventDim={eventDim}
                                />
                              ) : (
                                <BranchTwigCard
                                  key={p.id}
                                  person={p}
                                  branch={branch}
                                  messiahOnly={messiahOnly}
                                  selectedId={selectedId}
                                  onOpen={openPerson}
                                  highlightNodeIds={highlightNodeIds}
                                  targetSet={targetSet}
                                  eventDim={eventDim}
                                />
                              )
                            )}
                          </div>

                          <div className="lineage-poster__trunk-col">
                            <button
                              type="button"
                              data-poster-id={id}
                              className={`lineage-poster__trunk-card ${isHi ? 'is-highlight' : ''} ${evDim ? 'is-dim' : ''} ${selectedId === id ? 'is-selected' : ''} ${
                                id === 'jesus_messiah' ? 'lineage-poster__trunk-card--messiah' : ''
                              }`}
                              onClick={() => openPerson(id)}
                            >
                              <span className="lineage-poster__trunk-ring" aria-hidden />
                              <div className="lineage-poster__avatar">{emoji}</div>
                              <strong>
                                {person.displayName || person.name}
                                {spouse ? <span className="lineage-poster__spouse"> ({spouse})</span> : null}
                              </strong>
                              {copy && <small>{copy.line}</small>}
                              {copy && <cite>{copy.ref}</cite>}
                            </button>
                          </div>

                          <div className="lineage-poster__branch-col lineage-poster__branch-col--right">
                            {right.map(({ branch, person: p }) => (
                              <BranchTwigCard
                                key={p.id}
                                person={p}
                                branch={branch}
                                messiahOnly={messiahOnly}
                                selectedId={selectedId}
                                onOpen={openPerson}
                                highlightNodeIds={highlightNodeIds}
                                targetSet={targetSet}
                                eventDim={eventDim}
                              />
                            ))}
                          </div>
                        </div>

                        {id === 'jacob_israel' && tribeList.length > 0 && (
                          <div className={`lineage-poster__tribes ${messiahOnly ? 'is-dim' : ''}`}>
                            <span className="lineage-poster__tribes-title">Twelve tribes of Israel</span>
                            <div className="lineage-poster__tribes-grid">
                              {tribeList.map((t) => (
                                <button key={t.id} type="button" className="lineage-poster__tribe-chip" onClick={() => openPerson(t.id)}>
                                  {t.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
