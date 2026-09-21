import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Maximize2, Trees, X } from 'lucide-react';
import { highlightEdgesForNodes } from '../../lib/lineagePath.js';
import { getEventLineageMapEntry, getEventPrimaryPathIds, getMergedEventFocusIds } from '../../lib/lineageMatch.js';
import { buildRelationshipIndex, getAncestors, getDescendants, getLineagePathToJesus } from '../../lib/lineageUtils.js';
import FullGraphTreeView from '../../components/FullGraphTreeView.jsx';
import LineagePosterView from '../../components/LineagePosterView.jsx';
import PersonDetailDrawer from '../../components/PersonDetailDrawer.jsx';
import LineageFocusStrip from './LineageFocusStrip.jsx';
import LineageModeToggle from './LineageModeToggle.jsx';

/**
 * Bible Bloodline Explorer — premium two-mode lineage experience.
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {import('../../data/bible_lineage_timeline_family_tree.json')} props.tree
 * @param {Set<string>} props.highlightNodeIds
 * @param {Set<string>} props.highlightEdgeIds
 * @param {string[]} props.targetPersonIds
 * @param {string} props.eventTitle
 * @param {string} [props.selectedEventId]
 * @param {'default'|'fullMap'} [props.entryMode] — `fullMap` opens straight to zoomable graph with fit-all
 */
export default function FamilyLineage({
  open,
  onClose,
  tree,
  highlightNodeIds,
  highlightEdgeIds: _highlightEdgeIds,
  targetPersonIds,
  eventTitle,
  selectedEventId = '',
  entryMode = 'default'
}) {
  const viewportRef = useRef(null);
  const [fitMode, setFitMode] = useState('selection');
  const [view, setView] = useState('poster');
  const { people, relationships, metadata } = tree;

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const relIdx = useMemo(() => buildRelationshipIndex(people, relationships || []), [people, relationships]);

  const [drawerPersonId, setDrawerPersonId] = useState(null);
  const drawerPersonIdRef = useRef(null);
  const [auxHighlightNodes, setAuxHighlightNodes] = useState(null);
  const [graphFocusNonce, setGraphFocusNonce] = useState(0);
  const [graphFocusPersonId, setGraphFocusPersonId] = useState(null);

  drawerPersonIdRef.current = drawerPersonId;

  const mapEntry = useMemo(() => (selectedEventId ? getEventLineageMapEntry(selectedEventId) : null), [selectedEventId]);

  const primaryPathIds = useMemo(() => {
    if (!selectedEventId) return [];
    return getEventPrimaryPathIds(selectedEventId, peopleById);
  }, [selectedEventId, peopleById]);

  const mergedFocusIds = useMemo(() => {
    if (!selectedEventId) return targetPersonIds;
    const merged = new Set(getMergedEventFocusIds(selectedEventId, peopleById));
    for (const id of targetPersonIds) merged.add(id);
    return [...merged];
  }, [selectedEventId, peopleById, targetPersonIds]);

  const mergedHighlightNodes = useMemo(() => {
    const s = new Set(highlightNodeIds);
    for (const id of primaryPathIds) s.add(id);
    if (auxHighlightNodes && auxHighlightNodes.size) {
      auxHighlightNodes.forEach((id) => s.add(id));
    }
    return s;
  }, [highlightNodeIds, primaryPathIds, auxHighlightNodes]);

  const mergedHighlightEdges = useMemo(
    () => highlightEdgesForNodes(mergedHighlightNodes, relationships || []),
    [mergedHighlightNodes, relationships]
  );

  const drawerPerson = drawerPersonId ? peopleById.get(drawerPersonId) || null : null;

  const targetDisplayNames = useMemo(
    () =>
      mergedFocusIds.map((id) => {
        const p = peopleById.get(id);
        return p?.displayName || p?.name || id;
      }),
    [mergedFocusIds, peopleById]
  );

  useEffect(() => {
    if (!open) return;
    setDrawerPersonId(null);
    setAuxHighlightNodes(null);
    setGraphFocusPersonId(null);
    if (entryMode === 'fullMap') {
      setFitMode('all');
      setView('full');
      return;
    }
    setFitMode('selection');
    const e = selectedEventId ? getEventLineageMapEntry(selectedEventId) : null;
    setView(e?.defaultMode === 'full' ? 'full' : 'poster');
  }, [open, selectedEventId, entryMode]);

  useEffect(() => {
    if (!open) return;
    setAuxHighlightNodes(null);
  }, [selectedEventId, open]);

  /** Stale or missing graph ids should never leave an invisible “open” drawer. */
  useEffect(() => {
    if (!drawerPersonId) return;
    if (!peopleById.has(drawerPersonId)) setDrawerPersonId(null);
  }, [drawerPersonId, peopleById]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (drawerPersonIdRef.current) {
        e.preventDefault();
        e.stopPropagation();
        setDrawerPersonId(null);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const handleShowPathToJesus = useCallback(
    (personId) => {
      const path = getLineagePathToJesus(personId, relIdx.peopleById, metadata?.messiahId || 'jesus_messiah', relIdx);
      if (path?.length) setAuxHighlightNodes(new Set(path));
      setView('full');
    },
    [relIdx, metadata?.messiahId]
  );

  const handleShowAncestors = useCallback(
    (personId) => {
      const anc = getAncestors(personId, relIdx.peopleById, metadata?.rootId || 'adam');
      setAuxHighlightNodes(new Set(anc));
      setView('full');
    },
    [relIdx.peopleById, metadata?.rootId]
  );

  const handleShowChildren = useCallback(
    (personId) => {
      const desc = getDescendants(personId, relIdx, 140);
      setAuxHighlightNodes(new Set([personId, ...desc]));
      setView('full');
    },
    [relIdx]
  );

  const handleGraphFocus = useCallback((personId) => {
    setDrawerPersonId(personId);
    setGraphFocusPersonId(personId);
    setGraphFocusNonce((n) => n + 1);
    setView('full');
  }, []);

  const handleNavigateDrawer = useCallback((id) => {
    setDrawerPersonId(id);
  }, []);

  const handleFocusSelection = useCallback(() => {
    setFitMode('selection');
    const id =
      mapEntry?.centerPersonId && peopleById.has(mapEntry.centerPersonId)
        ? mapEntry.centerPersonId
        : targetPersonIds[0] || mergedFocusIds[0] || null;
    if (id) {
      setGraphFocusPersonId(id);
      setGraphFocusNonce((n) => n + 1);
      setView('full');
    }
  }, [mapEntry, peopleById, targetPersonIds, mergedFocusIds]);

  const handleFitAll = useCallback(() => {
    setFitMode('all');
    setView('full');
  }, []);

  if (!open) return null;

  const displayTitle = mapEntry?.title || eventTitle || '';
  const posterSubtitle =
    mapEntry?.storyNote || 'Trace the biblical family tree through promise, people, and covenant.';
  const focusDescription = mapEntry?.description || '';

  return (
    <div className="lineage-modal-root" role="dialog" aria-modal="true" aria-labelledby="lineage-modal-title">
      <button type="button" className="lineage-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div
        className={`lineage-modal bloodline-explorer ${view === 'poster' ? 'lineage-modal--poster' : 'lineage-modal--fullmap'}`}
      >
        <header className="lineage-modal__header lineage-modal__header--rich bloodline-explorer__header">
          <div className="lineage-modal__lead">
            <div className="bloodline-explorer__icon" aria-hidden>
              <Trees size={26} strokeWidth={1.5} />
            </div>
            <div className="lineage-modal__lead-copy">
              <h2 id="lineage-modal-title" className="bloodline-explorer__title">
                Family lineage
              </h2>
              <p className="lineage-modal__sub bloodline-explorer__subtitle">
                {view === 'poster'
                  ? posterSubtitle
                  : `Full bloodline map · ${metadata.nodeCount} people · zoom, search, and covenant paths.`}
              </p>
              {displayTitle ? <span className="lineage-modal__event-chip bloodline-explorer__chip">{displayTitle}</span> : null}
            </div>
          </div>
          <div className="lineage-modal__actions lineage-modal__actions--wrap bloodline-explorer__actions">
            <LineageModeToggle view={view} onViewChange={setView} />
            <button type="button" className="secondary bloodline-explorer__tool" onClick={handleFocusSelection} title="Open full map and frame this story">
              <Crosshair size={16} aria-hidden /> Focus selection
            </button>
            <button type="button" className="secondary bloodline-explorer__tool" onClick={handleFitAll} title="Show entire tree">
              <Maximize2 size={16} aria-hidden /> Fit all
            </button>
            <button type="button" className="icon-button lineage-modal__close bloodline-explorer__close" aria-label="Close" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </header>

        {mergedFocusIds.length > 0 || primaryPathIds.length > 0 ? (
          <div className="bloodline-explorer__focus-wrap">
            <LineageFocusStrip
              focusIds={mergedFocusIds}
              peopleById={peopleById}
              primaryPathIds={primaryPathIds}
              description={focusDescription}
            />
          </div>
        ) : null}

        <div className={`bloodline-explorer__body bloodline-explorer__body--${view}`} key={view}>
          {view === 'poster' ? (
            <div className="lineage-modal__body lineage-modal__body--poster">
              <LineagePosterView
                tree={tree}
                highlightNodeIds={mergedHighlightNodes}
                targetPersonIds={mergedFocusIds}
                selectedEventId={selectedEventId}
                centerPersonId={mapEntry?.centerPersonId || null}
                onRequestPersonDetail={(id) => setDrawerPersonId(id)}
                suppressEventInsight
              />
            </div>
          ) : (
            <div className="lineage-modal__body lineage-modal__body--full">
              <FullGraphTreeView
                tree={tree}
                highlightNodeIds={mergedHighlightNodes}
                highlightEdgeIds={mergedHighlightEdges}
                targetPersonIds={mergedFocusIds}
                onSelectPerson={(p) => setDrawerPersonId(p.id)}
                fitMode={fitMode}
                onFitMode={setFitMode}
                viewportRef={viewportRef}
                graphFocusNonce={graphFocusNonce}
                graphFocusPersonId={graphFocusPersonId}
              />
            </div>
          )}
        </div>

        <footer className={`lineage-modal__footer bloodline-explorer__footer ${view === 'poster' ? 'lineage-modal__footer--compact' : ''}`}>
          <span className="bloodline-explorer__footer-lead">
            {view === 'poster'
              ? 'Storybook mode follows the golden line toward Jesus — open Full map for every person.'
              : `Root ${metadata.rootId} · Messiah ${metadata.messiahId}`}
          </span>
          {targetDisplayNames.length > 0 && (
            <span className="lineage-modal__targets lineage-modal__targets--names bloodline-explorer__footer-focus">
              Story focus: {targetDisplayNames.join(' · ')}
            </span>
          )}
        </footer>

        <PersonDetailDrawer
          open={Boolean(drawerPersonId && drawerPerson)}
          person={drawerPerson}
          tree={tree}
          onClose={() => setDrawerPersonId(null)}
          onFocusPerson={handleNavigateDrawer}
          onGraphFocus={handleGraphFocus}
          onShowPathToJesus={handleShowPathToJesus}
          onShowChildren={handleShowChildren}
          onShowAncestors={handleShowAncestors}
          targetPersonIds={mergedFocusIds}
          premium
        />
      </div>
    </div>
  );
}
