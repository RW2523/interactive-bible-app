import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookMarked, BookOpen, CalendarDays, ChevronLeft, ChevronRight, Download, Film, GitBranch, Loader2, Map as MapIcon,
  MapPin, MousePointerClick, PenLine, RotateCcw, Search, SearchX, Sparkles, Star, X
} from 'lucide-react';
import { api } from '@/api/client';
import BibleEventSprite from '../../components/BibleEventSprite.jsx';
import { EmptyState, Modal } from '../../components/ExploreUi.jsx';
import { aiErrorMessage } from '../../lib/exploreJobs.js';
import styles from './BibleTimelineExplorer.module.css';
import {
  attachMapIcons,
  filterByTestament,
  getRelatedEvents,
  getTimelineDateDisplay,
  groupEventsByEra,
  loadTimelineEvents,
  searchTimelineEvents,
  sortTimelineEvents
} from './timelineUtils.js';
import { getReferencesForEvent } from './timelineReferenceParser.js';
import { getLineageContextForTimeline } from './timelineToLineageMap.js';
import { EXPLAIN_MODES } from './timelineGeminiPrompts.js';

const SCRUB_LABELS = [
  { match: /primeval|before time/i, short: 'Creation' },
  { match: /patriarch/i, short: 'Patriarchs' },
  { match: /egypt and exodus|exodus/i, short: 'Exodus' },
  { match: /wilderness|law/i, short: 'Wilderness' },
  { match: /conquest/i, short: 'Conquest' },
  { match: /judges/i, short: 'Judges' },
  { match: /united kingdom/i, short: 'United Kingdom' },
  { match: /divided/i, short: 'Divided Kingdom' },
  { match: /^exile$/i, short: 'Exile' },
  { match: /return|restoration/i, short: 'Return' },
  { match: /jesus/i, short: 'Jesus' },
  { match: /early church|apostolic/i, short: 'Early Church' }
];

const MODE_HINTS = {
  simple: 'A clear, short explanation for anyone.',
  study: 'More detail for a Bible study group.',
  pastor: 'Notes for preaching and teaching.',
  kids: 'Simple words for children aged 8–12.'
};

const EXPLAIN_LABELS = { simple: 'Explain simply', study: 'Explain for Bible study', pastor: 'Explain for pastors', kids: 'Explain for kids' };

const STORY_POOL = 24;

function scrubLabelForEra(name) {
  for (const { match, short } of SCRUB_LABELS) if (match.test(name)) return short;
  return name.length > 18 ? `${name.slice(0, 16)}…` : name;
}

function formatYear(y) {
  if (typeof y !== 'number' || !Number.isFinite(y)) return '';
  if (y <= -5000) return 'the beginning';
  if (y < 0) return `${-y} BC`;
  return `AD ${y}`;
}

function formatRange(min, max) {
  if (min == null || max == null) return '';
  if (min === max) return formatYear(min);
  const a = formatYear(min);
  const b = formatYear(max);
  if (min < 0 && max < 0 && min > -5000) return `${-min}–${-max} BC`;
  return `${a} – ${b}`;
}

function eraDomId(eraName) {
  return `bt-era-${encodeURIComponent(eraName).replace(/%/g, '_')}`;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Bible Timeline workspace: 583 events grouped by era, with a detail panel, AI explanations and a guided story mode.
 */
export default function BibleTimelineExplorer({ mapEvents, onClose, onOpenMapEvent, onOpenLineage, onReadRef, onStartSermon, initialEventId, onSelectedChange }) {
  const [bundle, setBundle] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [testament, setTestament] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeEra, setActiveEra] = useState(null);
  const [selectedId, setSelectedId] = useState(initialEventId || null);
  const [filterMajor, setFilterMajor] = useState(false);
  const [filterJesus, setFilterJesus] = useState(false);
  const [filterMap, setFilterMap] = useState(false);
  const [aiMode, setAiMode] = useState('simple');
  const [aiResult, setAiResult] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [story, setStory] = useState({ open: false, step: 'intro', title: '', scenes: [], index: 0, error: null });
  const [dataView, setDataView] = useState(false);
  const listRef = useRef(null);
  const scrubRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const b = await loadTimelineEvents();
        if (!cancelled) setBundle(b);
      } catch (e) {
        if (!cancelled) setLoadError(e?.message || 'The timeline could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const enrichedEvents = useMemo(() => (bundle?.events ? attachMapIcons(bundle.events, mapEvents || []) : []), [bundle, mapEvents]);

  useEffect(() => { onSelectedChange?.(selectedId); }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  // back / forward to another timeline link while the timeline is open
  useEffect(() => {
    if (initialEventId && initialEventId !== selectedId) setSelectedId(initialEventId);
  }, [initialEventId]); // eslint-disable-line react-hooks/exhaustive-deps

  // a new event: forget the previous AI explanation
  useEffect(() => { setAiResult(null); setAiError(null); }, [selectedId]);

  const grouped = useMemo(() => groupEventsByEra(enrichedEvents), [enrichedEvents]);
  const eraOrder = useMemo(() => {
    const fromMeta = bundle?.eraGroups?.map((g) => g.name) || [];
    const seen = new Set(fromMeta);
    for (const e of enrichedEvents) {
      if (e.eraGroup && !seen.has(e.eraGroup)) {
        fromMeta.push(e.eraGroup);
        seen.add(e.eraGroup);
      }
    }
    return fromMeta;
  }, [bundle, enrichedEvents]);

  const filteredEvents = useMemo(() => {
    let list = filterByTestament([...enrichedEvents], testament === 'OT' ? 'OT' : testament === 'NT' ? 'NT' : 'all');
    list = searchTimelineEvents(debouncedSearch, list);
    if (filterMajor) list = list.filter((e) => e._computed?.importance === 'major');
    if (filterJesus) list = list.filter((e) => (e.eraGroup || '').toLowerCase().includes('jesus') || (e.title || '').toLowerCase().includes('jesus'));
    if (filterMap) list = list.filter((e) => Boolean(e._computed?.mapEventId));
    return sortTimelineEvents(list);
  }, [enrichedEvents, testament, debouncedSearch, filterMajor, filterJesus, filterMap]);
  const filteredIds = useMemo(() => new Set(filteredEvents.map((e) => e.id)), [filteredEvents]);

  const selected = useMemo(() => enrichedEvents.find((e) => e.id === selectedId) || null, [enrichedEvents, selectedId]);
  const related = useMemo(() => (selected ? getRelatedEvents(selected.id, enrichedEvents).slice(0, 8) : []), [selected, enrichedEvents]);

  const eraStats = useMemo(() => {
    const stats = new Map();
    for (const name of eraOrder) {
      const evs = grouped.get(name) || [];
      const years = evs.map((e) => e?.date?.sortYear).filter((y) => typeof y === 'number');
      stats.set(name, {
        count: evs.length,
        shown: evs.filter((e) => filteredIds.has(e.id)).length,
        range: years.length ? formatRange(Math.min(...years), Math.max(...years)) : ''
      });
    }
    return stats;
  }, [eraOrder, grouped, filteredIds]);

  // Deep link (/explore?view=timeline&t=<id>): bring the linked event card into view once the data is loaded.
  const initialScrollDone = useRef(false);
  useEffect(() => {
    if (initialScrollDone.current || !initialEventId || !enrichedEvents.length) return;
    initialScrollDone.current = true;
    requestAnimationFrame(() => {
      const card = document.querySelector(`[data-tid="${CSS.escape(initialEventId)}"]`);
      card?.scrollIntoView({ block: 'center' });
    });
  }, [enrichedEvents, initialEventId]);

  const scrollToEra = useCallback((eraName) => setActiveEra(eraName), []);
  const showAllEras = () => setActiveEra(null);

  // after picking an era (or all eras): start the list at the top and keep the chosen era chip in view
  const firstEraRun = useRef(true);
  useEffect(() => {
    if (firstEraRun.current) {
      firstEraRun.current = false;
      return;
    }
    const list = listRef.current;
    const scrub = scrubRef.current;
    if (list && list.scrollHeight > list.clientHeight + 1) list.scrollTo({ top: 0 });
    else if (scrub && scrub.getBoundingClientRect().top < 0) scrub.scrollIntoView({ block: 'start' }); // phones: the page scrolls
    const chip = scrub?.querySelector('[aria-pressed="true"]');
    if (scrub && chip) {
      const sr = scrub.getBoundingClientRect();
      const cr = chip.getBoundingClientRect();
      const left = scrub.scrollLeft + (cr.left - sr.left) - sr.width / 2 + cr.width / 2;
      scrub.scrollTo({ left, behavior: Math.abs(left - scrub.scrollLeft) > sr.width ? 'auto' : 'smooth' });
    }
  }, [activeEra]);

  const clearFilters = () => {
    setSearchInput('');
    setDebouncedSearch('');
    setFilterMajor(false);
    setFilterJesus(false);
    setFilterMap(false);
    setTestament('all');
    setActiveEra(null);
  };

  const runAiExplain = useCallback(async () => {
    if (!selected) return;
    const id = selected.id;
    setAiLoading(true);
    setAiResult(null);
    setAiError(null);
    try {
      const data = await api('/v1/explore/timeline/explain', { method: 'POST', body: { eventId: id, mode: aiMode } });
      setAiResult({ ...data, forId: id, forMode: aiMode });
    } catch (e) {
      setAiError(e?.status === 401 ? 'Sign in to use AI explanations.' : aiErrorMessage(e, 'Could not get an explanation. Please try again.'));
    } finally {
      setAiLoading(false);
    }
  }, [selected, aiMode]);

  const storyPool = useMemo(() => (activeEra ? (grouped.get(activeEra) || []).filter((e) => filteredIds.has(e.id)) : filteredEvents).slice(0, STORY_POOL), [activeEra, grouped, filteredIds, filteredEvents]);

  const openStoryMode = () => setStory({ open: true, step: 'intro', title: '', scenes: [], index: 0, error: null });
  const runStoryMode = useCallback(async () => {
    if (!storyPool.length) return;
    setStory((s) => ({ ...s, step: 'loading', error: null }));
    try {
      const data = await api('/v1/explore/timeline/story-mode', { method: 'POST', body: { eventIds: storyPool.map((e) => e.id), audience: 'general', duration: 'short' } });
      const scenes = Array.isArray(data.scenes) ? data.scenes : [];
      setStory((s) => ({ ...s, step: scenes.length ? 'play' : 'error', title: data.title || 'Timeline story', scenes, index: 0, error: scenes.length ? null : 'No scenes came back. Please try again.' }));
    } catch (e) {
      setStory((s) => ({ ...s, step: 'error', error: e?.status === 401 ? 'Sign in to create a guided story.' : aiErrorMessage(e, 'Story mode is not available right now.') }));
    }
  }, [storyPool]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), events: filteredEvents }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bible-timeline-export.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (loading) {
    return (
      <div className={styles.root}>
        <div className={styles.skeleton} role="status" aria-label="Loading the Bible timeline">
          <span /><span /><span /><span /><span />
        </div>
      </div>
    );
  }

  if (loadError || !bundle) {
    return (
      <div className={styles.root}>
        <EmptyState
          icon={<CalendarDays size={22} />}
          title="The timeline could not be loaded"
          action={
            <div className={styles.row}>
              <button type="button" className="primary" onClick={() => setReloadKey((k) => k + 1)}><RotateCcw size={16} aria-hidden /> Try again</button>
              <button type="button" className="secondary" onClick={onClose}><MapIcon size={16} aria-hidden /> Back to the atlas</button>
            </div>
          }
        >
          {loadError || 'Please try again in a moment.'}
        </EmptyState>
      </div>
    );
  }

  const mapId = selected?._computed?.mapEventId;
  const lineageCtx = selected ? getLineageContextForTimeline(selected.id, selected.title) : null;
  const refs = selected ? (getReferencesForEvent(selected).length ? getReferencesForEvent(selected) : [selected.referenceText]).filter(Boolean) : [];
  const filtersOn = Boolean(debouncedSearch.trim()) || filterMajor || filterJesus || filterMap || testament !== 'all';
  const showExplain = aiResult && selected && aiResult.forId === selected.id;
  const selectedEraStats = selected ? eraStats.get(selected.eraGroup) : null;

  const renderCard = (e) => {
    const nt = (e.scriptureTestament || '').toLowerCase().includes('new');
    const major = e._computed?.importance === 'major';
    const isSel = selectedId === e.id;
    return (
      <li key={e.id}>
        <button
          type="button"
          data-tid={e.id}
          className={`${styles.card} ${isSel ? styles.cardSelected : ''}`}
          onClick={() => setSelectedId(e.id)}
          aria-current={isSel ? 'true' : undefined}
        >
          <span className={styles.cardArt} aria-hidden>
            {e._computed?.iconOrder ? (
              <BibleEventSprite order={e._computed.iconOrder} mapIcon="book" variant="list" />
            ) : (
              <span className={`${styles.cardDot} ${major ? styles.cardDotMajor : ''}`} />
            )}
          </span>
          <span className={styles.cardBody}>
            <span className={styles.cardDate}>{e.dateLabel}</span>
            <span className={styles.cardTitle}>{e.title}</span>
            {e.referenceText ? <span className={styles.cardRef}>{e.referenceText}</span> : null}
          </span>
          <span className={styles.cardMarks}>
            {e._computed?.mapEventId ? <span className={styles.mark} title="On the atlas map"><MapPin size={13} aria-label="On the atlas map" /></span> : null}
            {major ? <span className={`${styles.mark} ${styles.markGold}`} title="Major event"><Star size={12} aria-label="Major event" /></span> : null}
            {nt ? <span className={styles.markText} title="New Testament">NT</span> : null}
          </span>
        </button>
      </li>
    );
  };

  const visibleEras = activeEra ? [activeEra] : eraOrder;
  const anyVisible = filteredEvents.length > 0;

  return (
    <div className={styles.root}>
      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarMain}>
          <label className={`x-search ${styles.search}`}>
            <Search size={16} aria-hidden />
            <input
              type="search"
              placeholder="Search events, books, references…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search the timeline"
            />
            {searchInput ? (
              <button type="button" className="x-search__clear" onClick={() => setSearchInput('')} aria-label="Clear search"><X size={14} /></button>
            ) : null}
          </label>
          <div className={styles.filters} role="group" aria-label="Show only">
            <button type="button" className="x-chip x-chip--sm" aria-pressed={filterMajor} onClick={() => setFilterMajor((v) => !v)}>
              <Star size={13} aria-hidden /> Major events
            </button>
            <button type="button" className="x-chip x-chip--sm" aria-pressed={filterJesus} onClick={() => setFilterJesus((v) => !v)}>
              Life of Jesus
            </button>
            <button type="button" className="x-chip x-chip--sm" aria-pressed={filterMap} onClick={() => setFilterMap((v) => !v)} title="Events you can also open on the atlas map">
              <MapPin size={13} aria-hidden /> On the map
            </button>
          </div>
          <span className={styles.count} aria-live="polite">
            {filtersOn ? `${plural(filteredEvents.length, 'event')} of ${enrichedEvents.length}` : plural(enrichedEvents.length, 'event')}
          </span>
        </div>
        <div className={styles.toolbarSide}>
          <div className="x-segmented" role="group" aria-label="Testament">
            <button type="button" aria-pressed={testament === 'all'} onClick={() => setTestament('all')}>Whole Bible</button>
            <button type="button" aria-pressed={testament === 'OT'} onClick={() => setTestament('OT')}>Old</button>
            <button type="button" aria-pressed={testament === 'NT'} onClick={() => setTestament('NT')}>New</button>
          </div>
          <button type="button" className="secondary btn-sm" onClick={openStoryMode} disabled={!storyPool.length} title="A short guided walk through the events you are viewing">
            <Film size={15} aria-hidden /> Story mode
          </button>
          <button type="button" className="icon-button" onClick={exportJson} aria-label="Download these events as a file" title="Download these events (JSON file)">
            <Download size={17} />
          </button>
        </div>
      </div>

      {/* ── Era chips (smaller screens) ── */}
      <div className={styles.scrubber} ref={scrubRef} role="group" aria-label="Jump to an era">
        <button type="button" className="x-chip x-chip--sm" aria-pressed={activeEra === null} onClick={showAllEras}>All eras</button>
        {eraOrder.map((name) => (
          <button key={name} type="button" className="x-chip x-chip--sm" aria-pressed={activeEra === name} onClick={() => scrollToEra(name)} title={name}>
            {scrubLabelForEra(name)}
          </button>
        ))}
      </div>

      <div className={styles.main}>
        {/* ── Eras ── */}
        <nav className={styles.eras} aria-label="Bible eras">
          <p className={styles.erasTitle}>Eras</p>
          <button type="button" className={`${styles.era} ${activeEra === null ? styles.eraActive : ''}`} onClick={showAllEras} aria-pressed={activeEra === null}>
            <strong>All eras</strong>
            <span>{plural(enrichedEvents.length, 'event')} · Creation to Revelation</span>
          </button>
          {eraOrder.map((name) => {
            const st = eraStats.get(name);
            const isCurrent = selected?.eraGroup === name;
            return (
              <button
                key={name}
                type="button"
                className={`${styles.era} ${activeEra === name ? styles.eraActive : ''} ${isCurrent ? styles.eraCurrent : ''}`}
                onClick={() => scrollToEra(name)}
                aria-pressed={activeEra === name}
              >
                <strong>{name}</strong>
                <span>
                  {filtersOn ? `${st?.shown ?? 0} of ${st?.count ?? 0}` : plural(st?.count ?? 0, 'event')}
                  {st?.range ? ` · ${st.range}` : ''}
                </span>
              </button>
            );
          })}
        </nav>

        {/* ── Events ── */}
        <section className={styles.list} ref={listRef} aria-label="Timeline events">
          {activeEra ? (
            <div className={styles.eraBanner}>
              <div>
                <p className="x-eyebrow"><CalendarDays size={13} aria-hidden /> Era</p>
                <h2>{activeEra}</h2>
                <p>{plural(eraStats.get(activeEra)?.count ?? 0, 'event')}{eraStats.get(activeEra)?.range ? ` · ${eraStats.get(activeEra).range}` : ''}</p>
              </div>
              <button type="button" className="secondary btn-sm" onClick={showAllEras}>Show all eras</button>
            </div>
          ) : null}

          {anyVisible ? visibleEras.map((eraName) => {
            const visible = (grouped.get(eraName) || []).filter((e) => filteredIds.has(e.id));
            if (!visible.length) {
              return activeEra ? (
                <EmptyState key={eraName} icon={<SearchX size={22} />} title="No events in this era match" compact action={<button type="button" className="secondary btn-sm" onClick={clearFilters}>Clear filters</button>}>
                  Try another search, or show every event.
                </EmptyState>
              ) : null;
            }
            return (
              <div key={eraName} id={eraDomId(eraName)} className={styles.group}>
                {!activeEra ? (
                  <h3 className={styles.groupTitle}>
                    <span>{eraName}</span>
                    <small>{eraStats.get(eraName)?.range}</small>
                  </h3>
                ) : null}
                <ol className={styles.cards}>{visible.map(renderCard)}</ol>
              </div>
            );
          }) : (
            <EmptyState icon={<SearchX size={22} />} title="No events match" action={<button type="button" className="secondary btn-sm" onClick={clearFilters}>Clear filters</button>}>
              Try a different word — for example a book like “Exodus” or a name like “David”.
            </EmptyState>
          )}
        </section>

        {/* ── Detail ── */}
        {selected ? <button type="button" className={styles.sheetBackdrop} aria-label="Close event details" onClick={() => setSelectedId(null)} /> : null}
        <aside className={`${styles.detail} ${selected ? styles.detailOpen : ''}`} aria-label="Event details">
          {!selected ? (
            <div className={styles.detailEmpty}>
              <EmptyState icon={<MousePointerClick size={22} />} title="Pick an event">
                Choose any card to see its passages, open it on the map or family tree, and get a short explanation.
              </EmptyState>
            </div>
          ) : (
            <div className={styles.detailInner}>
              <div className={styles.sheetHandle} aria-hidden />
              <button type="button" className={`icon-button icon-button--ghost ${styles.detailClose}`} onClick={() => setSelectedId(null)} aria-label="Close event details">
                <X size={18} />
              </button>
              <header className={styles.detailHead}>
                {selected._computed?.iconOrder ? <BibleEventSprite order={selected._computed.iconOrder} mapIcon="book" variant="drawer" /> : null}
                <div>
                  <p className="x-eyebrow">{getTimelineDateDisplay(selected)}</p>
                  <h2>{selected.title}</h2>
                  <p className={styles.detailMeta}>
                    <span>{selected.eraGroup}</span>
                    <span aria-hidden> · </span>
                    <span>{selected.scriptureTestament || selected.section}</span>
                    {selected._computed?.importance === 'major' ? <span className="x-badge"><Star size={11} aria-hidden /> Major</span> : null}
                  </p>
                </div>
              </header>

              {refs.length ? (
                <div className={styles.block}>
                  <p className="x-label">Read the passage</p>
                  <div className="x-chip-row">
                    {refs.map((r) => (
                      <button key={r} type="button" className="x-chip x-chip--ref" onClick={() => onReadRef?.(r)} title={`Read ${r}`}>
                        <BookOpen size={13} aria-hidden /> {r}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className={styles.actions}>
                <button type="button" className="primary" onClick={() => refs[0] && onReadRef?.(refs[0])} disabled={!refs.length}>
                  <BookMarked size={16} aria-hidden /> Read passage
                </button>
                <button type="button" className="secondary" onClick={() => onStartSermon?.({ title: selected.title, references: refs })}>
                  <PenLine size={16} aria-hidden /> Start a sermon
                </button>
                <button type="button" className="secondary" disabled={!mapId} onClick={() => mapId && onOpenMapEvent(mapId)} title={mapId ? 'Open this event on the atlas map' : 'This event is not on the atlas map'}>
                  <MapIcon size={16} aria-hidden /> Open on map
                </button>
                <button type="button" className="secondary" disabled={!lineageCtx?.mapEventId} onClick={() => lineageCtx?.mapEventId && onOpenLineage(lineageCtx.mapEventId)} title={lineageCtx?.mapEventId ? 'Open the family tree for this event' : 'No family tree link for this event'}>
                  <GitBranch size={16} aria-hidden /> Family tree
                </button>
              </div>
              {!mapId ? <p className={styles.note}>Only the 50 key events have a map pin and family tree — this one is on the timeline only.</p> : null}

              <section className={styles.explain} aria-labelledby="bt-explain-title">
                <div className={styles.explainHead}>
                  <p className="x-eyebrow x-eyebrow--ai"><Sparkles size={13} aria-hidden /> Explain with AI</p>
                  <h3 id="bt-explain-title">What does this event mean?</h3>
                  <p>Pick who it is for. Each explanation is written once and saved for everyone.</p>
                </div>
                <div className={`x-segmented x-segmented--block ${styles.modes}`} role="group" aria-label="Explain for">
                  {EXPLAIN_MODES.map((m) => (
                    <button key={m.id} type="button" aria-pressed={aiMode === m.id} onClick={() => setAiMode(m.id)}>{m.label}</button>
                  ))}
                </div>
                <p className={styles.modeHint}>{MODE_HINTS[aiMode]}</p>
                <button type="button" className="primary" onClick={runAiExplain} disabled={aiLoading || (showExplain && aiResult.forMode === aiMode)}>
                  {aiLoading ? <Loader2 className="spin" size={16} aria-hidden /> : <Sparkles size={16} aria-hidden />}
                  {aiLoading ? 'Writing the explanation…' : EXPLAIN_LABELS[aiMode] || 'Explain'}
                </button>
                {aiLoading ? <div className="x-skeleton-lines" aria-hidden><span /><span /><span /></div> : null}
                {aiError ? <p className="x-inline-error" role="alert">{aiError}</p> : null}
                {showExplain ? (
                  <div className={styles.explainResult}>
                    {aiResult.summary ? <p className={styles.explainLead}>{aiResult.summary}</p> : null}
                    {aiResult.whyItMatters ? <div><h4>Why it matters</h4><p>{aiResult.whyItMatters}</p></div> : null}
                    {aiResult.historicalContext ? <div><h4>Background</h4><p>{aiResult.historicalContext}</p></div> : null}
                    {aiResult.spiritualLesson ? <div><h4>Lesson</h4><p>{aiResult.spiritualLesson}</p></div> : null}
                    {aiResult.keyPeople?.length || aiResult.keyPlaces?.length ? (
                      <div className="x-chip-row">
                        {(aiResult.keyPeople || []).map((p) => <span key={`p-${p}`} className="x-tag">{p}</span>)}
                        {(aiResult.keyPlaces || []).map((p) => <span key={`l-${p}`} className="x-tag"><MapPin size={11} aria-hidden /> {p}</span>)}
                      </div>
                    ) : null}
                    {aiResult.crossReferences?.length ? (
                      <div>
                        <h4>See also</h4>
                        <div className="x-chip-row">
                          {aiResult.crossReferences.map((r) => (
                            <button key={r} type="button" className="x-chip x-chip--sm x-chip--ref" onClick={() => onReadRef?.(r)}><BookOpen size={12} aria-hidden /> {r}</button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {aiResult.discussionQuestions?.length ? (
                      <div>
                        <h4>Questions to discuss</h4>
                        <ol className={styles.questions}>{aiResult.discussionQuestions.map((q, i) => <li key={i}>{q}</li>)}</ol>
                      </div>
                    ) : null}
                    <p className={styles.note}>Written with AI for “{EXPLAIN_MODES.find((m) => m.id === aiResult.forMode)?.label}”. Check it against Scripture before teaching.</p>
                  </div>
                ) : null}
              </section>

              {related.length ? (
                <section className={styles.block} aria-label="Related events">
                  <p className="x-label">Nearby in {selected.eraGroup}{selectedEraStats ? ` (${selectedEraStats.count})` : ''}</p>
                  <ul className={styles.related}>
                    {related.map((r) => (
                      <li key={r.id}>
                        <button type="button" onClick={() => setSelectedId(r.id)}>
                          <small>{r.dateLabel}</small>
                          <span>{r.title}</span>
                          <ChevronRight size={15} aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <p className={styles.note}>{bundle.metadata?.sourceNote}</p>

              {import.meta.env.DEV ? (
                <>
                  <button type="button" className="link-button" onClick={() => setDataView((v) => !v)}>{dataView ? 'Hide data' : 'View data (developer)'}</button>
                  {dataView ? <pre className={styles.dataPre}>{JSON.stringify({ event: selected, mapId, lineageCtx }, null, 2)}</pre> : null}
                </>
              ) : null}
            </div>
          )}
        </aside>
      </div>

      {/* ── Story mode ── */}
      <Modal
        open={story.open}
        onClose={() => setStory((s) => ({ ...s, open: false }))}
        title={story.step === 'play' ? story.title : 'Story mode'}
        description={story.step === 'intro' ? 'A short guided walk through the events you are viewing, scene by scene — good for opening a class or a family devotion.' : undefined}
        icon={<Film size={20} />}
        size="md"
        busy={story.step === 'loading'}
      >
        {story.step === 'intro' ? (
          <div className={styles.storyIntro}>
            <p>
              It will use <strong>{plural(storyPool.length, 'event')}</strong>
              {activeEra ? <> from <strong>{activeEra}</strong></> : filtersOn ? ' that match your filters' : ' from the start of the timeline'}
              {storyPool.length === STORY_POOL ? ' (the first 24)' : ''}. Pick an era or search first to choose different events.
            </p>
            <ol className={styles.storyPreview}>
              {storyPool.slice(0, 5).map((e) => <li key={e.id}><small>{e.dateLabel}</small> {e.title}</li>)}
              {storyPool.length > 5 ? <li className={styles.storyMore}>and {storyPool.length - 5} more</li> : null}
            </ol>
            <p className={styles.note}>AI writes up to 6 short scenes in about 15 seconds. The result is saved for everyone.</p>
            <div className={styles.row}>
              <button type="button" className="primary" onClick={runStoryMode} data-autofocus><Sparkles size={16} aria-hidden /> Create the walk-through</button>
              <button type="button" className="secondary" onClick={() => setStory((s) => ({ ...s, open: false }))}>Cancel</button>
            </div>
          </div>
        ) : story.step === 'loading' ? (
          <div className={styles.storyLoading} role="status">
            <Loader2 className="spin" size={22} aria-hidden />
            <p>Writing the scenes… this usually takes about 15 seconds.</p>
            <div className="x-skeleton-lines" aria-hidden><span /><span /><span /></div>
          </div>
        ) : story.step === 'error' ? (
          <div className={styles.storyIntro}>
            <p className="x-inline-error" role="alert">{story.error}</p>
            <div className={styles.row}>
              <button type="button" className="primary" onClick={runStoryMode}><RotateCcw size={16} aria-hidden /> Try again</button>
              <button type="button" className="secondary" onClick={() => setStory((s) => ({ ...s, open: false }))}>Close</button>
            </div>
          </div>
        ) : (
          (() => {
            const scene = story.scenes[story.index];
            return (
              <div className={styles.storyPlay}>
                <div className={styles.storyDots} aria-hidden>
                  {story.scenes.map((_, i) => <span key={i} className={i === story.index ? styles.storyDotOn : i < story.index ? styles.storyDotDone : ''} />)}
                </div>
                <p className="x-eyebrow">Scene {story.index + 1} of {story.scenes.length}</p>
                <h3>{scene.title}</h3>
                <p className={styles.storyVoice}>{scene.voiceText}</p>
                <div className={styles.row}>
                  {scene.scriptureReference ? (
                    <button type="button" className="x-chip x-chip--ref" onClick={() => onReadRef?.(scene.scriptureReference)}><BookOpen size={13} aria-hidden /> {scene.scriptureReference}</button>
                  ) : null}
                  {scene.eventId && enrichedEvents.some((e) => e.id === scene.eventId) ? (
                    <button type="button" className="link-button" onClick={() => { setSelectedId(scene.eventId); setStory((s) => ({ ...s, open: false })); requestAnimationFrame(() => document.querySelector(`[data-tid="${CSS.escape(scene.eventId)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })); }}>
                      Show this event
                    </button>
                  ) : null}
                </div>
                <div className={styles.storyNav}>
                  <button type="button" className="secondary" disabled={story.index <= 0} onClick={() => setStory((s) => ({ ...s, index: s.index - 1 }))}>
                    <ChevronLeft size={16} aria-hidden /> Previous
                  </button>
                  {story.index < story.scenes.length - 1 ? (
                    <button type="button" className="primary" onClick={() => setStory((s) => ({ ...s, index: s.index + 1 }))} data-autofocus>
                      Next <ChevronRight size={16} aria-hidden />
                    </button>
                  ) : (
                    <button type="button" className="primary" onClick={() => setStory((s) => ({ ...s, open: false }))}>Finish</button>
                  )}
                </div>
              </div>
            );
          })()
        )}
      </Modal>
    </div>
  );
}
