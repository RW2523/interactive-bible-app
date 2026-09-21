/**
 * Explore — Atlas (event list · map · detail tabs) and Timeline workspaces.
 * URL state: /explore?event=<id>&tab=info|family|people|story|graph   and   /explore?view=timeline&t=<timeline event id>
 */
import 'leaflet/dist/leaflet.css';
import './styles.css';
import L from 'leaflet';

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow });

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  BookOpen, CalendarDays, Compass, Film, HelpCircle, Map as MapIcon, MousePointerClick, Network, TreePine, Users, X
} from 'lucide-react';
import { api, getToken } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import localEvents from '@data/explore/bible_events.json';
import lineageTree from './data/bible_lineage_timeline_family_tree.json';
import JourneyMap from './components/JourneyMap.jsx';
import BibleKnowledgeGraph from './components/BibleKnowledgeGraph.jsx';
import LineageTreeModal from './components/LineageTreeModal.jsx';
import BibleTimelineExplorer from './features/timeline/BibleTimelineExplorer.jsx';
import SpriteDebugGrid from './components/SpriteDebugGrid.jsx';
import EventList from './components/EventList.jsx';
import EraBar from './components/EraBar.jsx';
import InfoPanel from './components/panels/InfoPanel.jsx';
import FamilyPanel from './components/panels/FamilyPanel.jsx';
import PeoplePanel from './components/panels/PeoplePanel.jsx';
import StoryPanel from './components/panels/StoryPanel.jsx';
import { buildLineageIndex, matchEventToLineagePersonIds } from './lib/lineageMatch.js';
import { highlightEdgesForNodes, highlightNodesForTargets } from './lib/lineagePath.js';
import { ATLAS_ERAS, timelineMatchFromEventEra } from './lib/timelineEra.js';
import { aiErrorMessage, waitForJob, waitForSharedStory } from './lib/exploreJobs.js';
import { useDocumentTheme } from './lib/useDocumentTheme.js';
import { useEventCard } from './lib/useEventCard.js';
import { getTimelineIdForMapEvent } from './features/timeline/timelineToMapEventMap.js';

const TABS = [
  { id: 'info', label: 'Info', icon: BookOpen },
  { id: 'family', label: 'Family', icon: TreePine },
  { id: 'people', label: 'People', icon: Users },
  { id: 'story', label: 'Video', icon: Film },
  { id: 'graph', label: 'Graph', icon: Network }
];
const TAB_IDS = TABS.map((t) => t.id);
const WIDE_TABS = new Set(['story', 'graph']);
const DEFAULT_EVENT = 'call_of_abraham';
const GUIDE_KEY = 'ibible_explore_guide_hidden';

function readUrlState(params) {
  const ev = params.get('event');
  const tab = params.get('tab');
  return {
    selectedId: ev && localEvents.some((e) => e.id === ev) ? ev : null,
    activeTab: TAB_IDS.includes(tab) ? tab : 'info',
    workspace: params.get('view') === 'timeline' ? 'timeline' : 'journey',
    timelineEventId: params.get('t') || null
  };
}

/* ── Header ─────────────────────────────────────────────────────────── */
function ExploreHeader({ workspace, onWorkspace, guideOpen, onToggleGuide }) {
  return (
    <header className="bjm-header">
      <div className="bjm-header__titles">
        <h1>Explore the Bible</h1>
        <p>
          {workspace === 'timeline'
            ? 'Every major event from Creation to Revelation, in order — with the passages to read.'
            : 'Walk through 50 key events on the map, trace the family line and watch illustrated stories.'}
        </p>
      </div>
      <div className="bjm-header__actions">
        <button
          type="button"
          className={`icon-button${guideOpen ? ' is-active' : ''}`}
          onClick={onToggleGuide}
          aria-pressed={guideOpen}
          aria-label="How Explore works"
          title="How Explore works"
        >
          <HelpCircle size={18} />
        </button>
        <div className="x-segmented x-segmented--lg" role="tablist" aria-label="Explore view">
          <button type="button" role="tab" aria-selected={workspace === 'journey'} onClick={() => onWorkspace('journey')}>
            <MapIcon size={16} aria-hidden /> Atlas
          </button>
          <button type="button" role="tab" aria-selected={workspace === 'timeline'} onClick={() => onWorkspace('timeline')}>
            <CalendarDays size={16} aria-hidden /> Timeline
          </button>
        </div>
      </div>
    </header>
  );
}

function ExploreGuide({ onClose, onTimeline }) {
  return (
    <section className="bjm-guide" aria-labelledby="bjm-guide-title">
      <div className="bjm-guide__intro">
        <span className="bjm-guide__icon" aria-hidden><Compass size={20} /></span>
        <div>
          <p className="x-eyebrow">Three simple steps</p>
          <h2 id="bjm-guide-title">How Explore works</h2>
        </div>
      </div>
      <ol className="bjm-guide__steps">
        <li>
          <span className="bjm-guide__num" aria-hidden><MousePointerClick size={16} /></span>
          <div><strong>Pick an event</strong><p>Tap a pin on the map or a card in the list.</p></div>
        </li>
        <li>
          <span className="bjm-guide__num" aria-hidden><BookOpen size={16} /></span>
          <div><strong>Explore its tabs</strong><p>Read the story, the family line, the people, or watch the video.</p></div>
        </li>
        <li>
          <span className="bjm-guide__num" aria-hidden><CalendarDays size={16} /></span>
          <div>
            <strong>See the whole story</strong>
            <p>Switch to <button type="button" className="link-button link-button--inline" onClick={onTimeline}>Timeline</button> for all 583 events in order.</p>
          </div>
        </li>
      </ol>
      <button type="button" className="secondary btn-sm bjm-guide__close" onClick={onClose}>
        <X size={15} aria-hidden /> Got it
      </button>
    </section>
  );
}

/* ── Main ───────────────────────────────────────────────────────────── */
export default function BibleJourneyApp() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { viewer } = useAuth();
  const signedIn = Boolean(viewer?.authenticated);
  const theme = useDocumentTheme();
  const events = localEvents;

  const initial = useMemo(() => readUrlState(searchParams), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [selectedId, setSelectedId] = useState(initial.selectedId || DEFAULT_EVENT);
  const [activeTab, setActiveTab] = useState(initial.activeTab);
  const [workspace, setWorkspaceState] = useState(initial.workspace);
  const [timelineEventId, setTimelineEventId] = useState(initial.timelineEventId);
  const pushNextUrl = useRef(false);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [activeEra, setActiveEra] = useState('All');
  const [eraPulse, setEraPulse] = useState(0);
  const [lineageTreeOpen, setLineageTreeOpen] = useState(false);
  const [lineageTreeEntry, setLineageTreeEntry] = useState('default');
  const [mapPopupDismissNonce, setMapPopupDismissNonce] = useState(0);
  const [listSelectSignal, setListSelectSignal] = useState(0);
  const [guideOpen, setGuideOpen] = useState(() => {
    try { return localStorage.getItem(GUIDE_KEY) !== '1'; } catch { return true; }
  });
  const spriteDebug = import.meta.env.DEV && new URLSearchParams(location.search).get('spriteDebug') === '1';

  const [content, setContent] = useState(null);
  const [contentState, setContentState] = useState({ loading: false, error: null });

  const [story, setStory] = useState(null);
  const [storyFormats, setStoryFormats] = useState(null);
  const [storyLoading, setStoryLoading] = useState(false);
  const [storyProgress, setStoryProgress] = useState(null);
  const [storyShared, setStoryShared] = useState(false);
  const [storyError, setStoryError] = useState(null);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mp4, setMp4] = useState(null);
  const lastStoryRequest = useRef({ force: false, imageFormat: 'landscape' });
  const storyRun = useRef(0);

  const selected = useMemo(() => events.find((e) => e.id === selectedId) || events[0], [events, selectedId]);
  const card = useEventCard(selected.id);
  const currentEventId = useRef(selectedId);
  currentEventId.current = selectedId;

  /* URL ⇄ state. Switching Atlas/Timeline adds a history entry; tab and event changes replace it. */
  const setWorkspace = useCallback((ws) => {
    setWorkspaceState((prev) => {
      if (prev !== ws) pushNextUrl.current = true;
      return ws;
    });
  }, []);

  useEffect(() => {
    const next = new URLSearchParams();
    next.set('event', selectedId);
    if (activeTab !== 'info') next.set('tab', activeTab);
    if (workspace === 'timeline') {
      next.set('view', 'timeline');
      if (timelineEventId) next.set('t', timelineEventId);
    }
    const push = pushNextUrl.current;
    pushNextUrl.current = false;
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: !push });
  }, [selectedId, activeTab, workspace, timelineEventId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // back / forward: adopt what the URL says
    const s = readUrlState(searchParams);
    if (s.selectedId && s.selectedId !== selectedId) setSelectedId(s.selectedId);
    if (searchParams.has('event') && s.activeTab !== activeTab) setActiveTab(s.activeTab);
    if (searchParams.has('event') && s.workspace !== workspace) setWorkspaceState(s.workspace);
    if (s.workspace === 'timeline' && s.timelineEventId && s.timelineEventId !== timelineEventId) setTimelineEventId(s.timelineEventId);
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Navigation helpers */
  const requireSignIn = useCallback((why) => {
    toast.info(why);
    navigate('/login', { state: { from: location.pathname + location.search } });
  }, [navigate, location]);

  const readReference = useCallback(async (ref) => {
    try {
      const parsed = await api(`/v1/bible/parse?q=${encodeURIComponent(ref)}`);
      const first = parsed.references?.[0];
      if (first?.book && first?.chapter) {
        navigate(`/read/${first.book}/${first.chapter}${first.verse ? `?v=${first.verse}` : ''}`);
        return;
      }
    } catch { /* fall back to search */ }
    navigate(`/search?q=${encodeURIComponent(ref)}`);
  }, [navigate]);

  const startSermon = useCallback(async (event) => {
    let scripture = '';
    try {
      const parsed = await api(`/v1/bible/parse?q=${encodeURIComponent(event.references?.[0] || '')}`);
      scripture = parsed.references?.[0]?.display || '';
    } catch { /* optional */ }
    const target = `/sermons?new=1${scripture ? `&scripture=${encodeURIComponent(scripture)}` : ''}&title=${encodeURIComponent(event.title)}`;
    if (!signedIn) {
      toast.info('Sign in to start a sermon.');
      navigate('/login', { state: { from: target } });
      return;
    }
    navigate(target);
  }, [navigate, signedIn]);

  /* Selection */
  const selectFromMap = useCallback((id) => setSelectedId(id), []);
  const selectFromList = useCallback((id) => {
    setMapPopupDismissNonce((n) => n + 1);
    setListSelectSignal((n) => n + 1);
    setSelectedId(id);
  }, []);
  const showEraFor = useCallback((eventId) => {
    const ev = events.find((e) => e.id === eventId);
    const match = timelineMatchFromEventEra(ev?.era);
    setSelectedId(eventId);
    setActiveEra(match ?? 'All');
    setEraPulse((n) => n + 1);
  }, [events]);
  const openTimelineFor = useCallback((mapEventId) => {
    setMapPopupDismissNonce((n) => n + 1);
    setTimelineEventId(getTimelineIdForMapEvent(mapEventId));
    setWorkspace('timeline');
  }, [setWorkspace]);
  const handleTimelineOpenMap = useCallback((id) => {
    if (!id) return;
    setSelectedId(id);
    setWorkspace('journey');
  }, [setWorkspace]);
  const handleTimelineOpenLineage = useCallback((id) => {
    if (!id) return;
    setSelectedId(id);
    setLineageTreeEntry('default');
    setLineageTreeOpen(true);
    setWorkspace('journey');
  }, [setWorkspace]);

  const eraCounts = useMemo(() => {
    const c = { All: events.length };
    for (const era of ATLAS_ERAS) c[era.match] = 0;
    for (const e of events) {
      const m = timelineMatchFromEventEra(e.era);
      if (m) c[m] += 1;
    }
    return c;
  }, [events]);

  const closeGuide = () => {
    setGuideOpen(false);
    try { localStorage.setItem(GUIDE_KEY, '1'); } catch { /* ignore */ }
  };
  const toggleGuide = () => {
    if (guideOpen) closeGuide();
    else setGuideOpen(true);
  };

  /* Family tree matching */
  const { peopleById: lineagePeopleById, indexed: lineageIndexed } = useMemo(() => buildLineageIndex(lineageTree.people), []);
  const lineageTargetIds = useMemo(() => matchEventToLineagePersonIds(selected, lineagePeopleById, lineageIndexed), [selected, lineagePeopleById, lineageIndexed]);
  const lineageHighlightNodes = useMemo(() => highlightNodesForTargets(lineageTargetIds, lineagePeopleById, lineageTree.metadata?.rootId || 'adam'), [lineageTargetIds, lineagePeopleById]);
  const lineageHighlightEdges = useMemo(() => highlightEdgesForNodes(lineageHighlightNodes, lineageTree.relationships || []), [lineageHighlightNodes]);
  const lineageFocusLabels = useMemo(() => lineageTargetIds.map((id) => lineagePeopleById.get(id)?.displayName || lineagePeopleById.get(id)?.name || id), [lineageTargetIds, lineagePeopleById]);

  /* Stories */
  const pollStoryJob = useCallback(async (eventId, jobId, imageFormat = 'landscape') => {
    const run = ++storyRun.current;
    setStoryLoading(true);
    setStoryError(null);
    setStoryProgress(jobId ? (p) => p || { step: 'script' } : null);
    setStoryShared(!jobId);
    try {
      if (jobId) {
        await waitForJob(jobId, { onProgress: (p) => run === storyRun.current && setStoryProgress(p), isCancelled: () => run !== storyRun.current });
      } else {
        await waitForSharedStory(eventId, imageFormat, { isCancelled: () => run !== storyRun.current });
      }
      const data = await api(`/v1/explore/events/${eventId}/story?format=${imageFormat}`);
      if (run !== storyRun.current) return;
      setStory(data);
      setSceneIndex(0);
      setStoryFormats((f) => ({ ...(f || {}), [imageFormat]: { ...(f?.[imageFormat] || {}), cached: true, generating: false } }));
      toast.success(data.mode === 'partial' ? 'Story ready — some scenes could not be illustrated' : 'Your story video is ready');
    } catch (err) {
      if (run !== storyRun.current || err.message === 'cancelled') return;
      setStoryError(aiErrorMessage(err, 'Story generation failed. Please try again.'));
    } finally {
      if (run === storyRun.current) {
        setStoryLoading(false);
        setStoryProgress(null);
        setStoryShared(false);
      }
    }
  }, []);

  useEffect(() => {
    storyRun.current += 1; // stop following the previous event's story
    setContent(null);
    setContentState({ loading: false, error: null });
    setStory(null);
    setStoryFormats(null);
    setSceneIndex(0);
    setPlaying(false);
    setStoryError(null);
    setStoryLoading(false);
    setStoryProgress(null);
    setStoryShared(false);
    setMp4(null);

    const ac = new AbortController();
    (async () => {
      try {
        const meta = await api(`/v1/explore/events/${selectedId}/story/meta`, { signal: ac.signal });
        if (ac.signal.aborted) return;
        setStoryFormats(meta.formats || null);
        if (meta.job?.job_id) {
          pollStoryJob(selectedId, meta.job.job_id, meta.job.format || 'landscape');
          return;
        }
        const busy = ['landscape', 'portrait'].find((f) => meta.formats?.[f]?.generating);
        if (busy && !meta.formats?.[busy]?.cached) {
          pollStoryJob(selectedId, null, busy);
          return;
        }
        const fmt = meta.formats?.landscape?.cached ? 'landscape' : meta.formats?.portrait?.cached ? 'portrait' : null;
        if (!fmt) return;
        setStoryLoading(true);
        const data = await api(`/v1/explore/events/${selectedId}/story?format=${fmt}`, { signal: ac.signal });
        if (ac.signal.aborted) return;
        setStory(data);
        setSceneIndex(0);
        setStoryLoading(false);
      } catch {
        if (!ac.signal.aborted) setStoryLoading(false); // no saved story yet — the Video tab offers to create one
      }
    })();
    (async () => {
      try {
        const cached = await api(`/v1/explore/events/${selectedId}/content`, { signal: ac.signal });
        if (!ac.signal.aborted) setContent(cached);
      } catch { /* not generated yet */ }
    })();
    return () => ac.abort();
  }, [selectedId, pollStoryJob]);

  const generateContent = async () => {
    if (!signedIn) { requireSignIn('Sign in to enhance events with AI.'); return; }
    if (content?.teachingSummary) return;
    const id = selected.id;
    setContentState({ loading: true, error: null });
    try {
      const data = await api(`/v1/explore/events/${id}/content`, { method: 'POST' });
      if (id !== currentEventId.current) return;
      setContent(data);
      setContentState({ loading: false, error: null });
      toast.success('Teaching notes added — saved for everyone');
    } catch (err) {
      if (id !== currentEventId.current) return;
      const message = aiErrorMessage(err, 'Could not write teaching notes. Please try again.');
      setContentState({ loading: false, error: message });
    }
  };

  const generateStory = async ({ force = false, imageFormat = 'landscape' } = {}) => {
    if (!signedIn) { requireSignIn('Sign in to create AI story videos.'); return; }
    lastStoryRequest.current = { force, imageFormat };
    const id = selected.id;
    setStoryLoading(true);
    setStoryError(null);
    setStoryProgress({ step: 'script' });
    setActiveTab('story');
    try {
      const res = await api(`/v1/explore/events/${id}/story`, { method: 'POST', body: { sceneCount: 4, force, imageFormat } });
      if (res.status === 'ready' && res.story) {
        setStory(res.story);
        setSceneIndex(0);
        setStoryLoading(false);
        setStoryProgress(null);
        return;
      }
      await pollStoryJob(id, res.job_id, imageFormat);
    } catch (err) {
      setStoryError(aiErrorMessage(err, 'Story generation failed. Please try again.'));
      setStoryLoading(false);
      setStoryProgress(null);
    }
  };

  const switchStoryFormat = async (fmt) => {
    const id = selected.id;
    setStoryLoading(true);
    try {
      const data = await api(`/v1/explore/events/${id}/story?format=${fmt}`);
      if (id !== currentEventId.current) return;
      setPlaying(false);
      setStory(data);
      setSceneIndex(0);
    } catch (err) {
      toast.error(err.message || 'Could not load that version');
    } finally {
      setStoryLoading(false);
    }
  };

  const exportMp4 = async (format = 'landscape') => {
    if (!signedIn) { requireSignIn('Sign in to export the story as MP4.'); return; }
    const id = selected.id;
    setMp4({ status: 'working', label: 'Preparing the MP4…' });
    try {
      const { job_id: jobId } = await api(`/v1/explore/events/${id}/story/video`, { method: 'POST', body: { format } });
      const job = await waitForJob(jobId, { onProgress: (p) => setMp4({ status: 'working', label: p.message || 'Rendering the MP4…' }) });
      const res = await fetch(job.download_url || `/v1/jobs/${jobId}/download`, { headers: { authorization: `Bearer ${getToken() || ''}` } });
      if (!res.ok) throw new Error('The download failed. Please try again.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `${id}-story${format === 'portrait' ? '-vertical' : ''}.mp4` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMp4({ status: 'done' });
      toast.success('MP4 downloaded');
    } catch (err) {
      setMp4({ status: 'error' });
      toast.error(err.message || 'MP4 export failed');
    }
  };

  const openLineage = () => {
    setLineageTreeEntry('default');
    setLineageTreeOpen(true);
  };

  const wide = WIDE_TABS.has(activeTab);

  return (
    <div className="bjm-root bjm-app" data-workspace={workspace}>
      {lineageTreeOpen ? (
        <LineageTreeModal
          open={lineageTreeOpen}
          onClose={() => { setLineageTreeOpen(false); setLineageTreeEntry('default'); }}
          tree={lineageTree}
          highlightNodeIds={lineageHighlightNodes}
          highlightEdgeIds={lineageHighlightEdges}
          targetPersonIds={lineageTargetIds}
          eventTitle={selected.title}
          selectedEventId={selected.id}
          entryMode={lineageTreeEntry}
        />
      ) : null}

      <ExploreHeader workspace={workspace} onWorkspace={setWorkspace} guideOpen={guideOpen} onToggleGuide={toggleGuide} />
      {guideOpen ? <ExploreGuide onClose={closeGuide} onTimeline={() => { closeGuide(); setWorkspace('timeline'); }} /> : null}

      <div className="bjm-body">
        {workspace === 'timeline' ? (
          <BibleTimelineExplorer
            mapEvents={events}
            onReadRef={readReference}
            onStartSermon={startSermon}
            initialEventId={timelineEventId}
            onSelectedChange={setTimelineEventId}
            onClose={() => setWorkspace('journey')}
            onOpenMapEvent={handleTimelineOpenMap}
            onOpenLineage={handleTimelineOpenLineage}
          />
        ) : (
          <>
            <aside className="bjm-sidebar">
              {spriteDebug ? <SpriteDebugGrid /> : null}
              <EventList
                events={events}
                selectedId={selected.id}
                onSelect={selectFromList}
                query={query}
                setQuery={setQuery}
                category={category}
                setCategory={setCategory}
                activeEra={activeEra}
                onClearEra={() => setActiveEra('All')}
              />
            </aside>

            <div className="bjm-canvas" data-active-tab={activeTab} data-wide={wide ? 'true' : 'false'}>
              <section className="bjm-mapcol" aria-label="Atlas map">
                <EraBar activeEra={activeEra} setActiveEra={setActiveEra} counts={eraCounts} focusPulse={eraPulse} />
                <JourneyMap
                  events={events}
                  selected={selected}
                  activeEra={activeEra}
                  theme={theme}
                  onSelect={selectFromMap}
                  onShowEra={showEraFor}
                  onOpenTimeline={openTimelineFor}
                  onReadRef={readReference}
                  listSelectSignal={listSelectSignal}
                  mapPopupDismissNonce={mapPopupDismissNonce}
                  card={card}
                />
              </section>

              <section className="bjm-detail" aria-label={`${selected.title} details`}>
                <div
                  className="bjm-tabs"
                  role="tablist"
                  aria-label="Event details"
                  onKeyDown={(e) => {
                    const i = TAB_IDS.indexOf(activeTab);
                    const next = e.key === 'ArrowRight' ? (i + 1) % TAB_IDS.length
                      : e.key === 'ArrowLeft' ? (i - 1 + TAB_IDS.length) % TAB_IDS.length
                        : e.key === 'Home' ? 0 : e.key === 'End' ? TAB_IDS.length - 1 : -1;
                    if (next < 0) return;
                    e.preventDefault();
                    setActiveTab(TAB_IDS[next]);
                    document.getElementById(`bjm-tab-${TAB_IDS[next]}`)?.focus();
                  }}
                >
                  {TABS.map((t) => {
                    const Icon = t.icon;
                    const on = activeTab === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="tab"
                        id={`bjm-tab-${t.id}`}
                        aria-selected={on}
                        aria-controls="bjm-tabpanel"
                        tabIndex={on ? 0 : -1}
                        className={`bjm-tab${on ? ' is-active' : ''}`}
                        onClick={() => setActiveTab(t.id)}
                      >
                        <Icon size={16} aria-hidden /> {t.label}
                        {t.id === 'story' && storyLoading && storyProgress ? <span className="bjm-tab__pulse" aria-label="Creating story" /> : null}
                      </button>
                    );
                  })}
                  {wide ? (
                    <span className="bjm-tabs__event" aria-hidden>
                      <strong>{selected.title}</strong>
                      <small>{selected.references?.[0]}</small>
                    </span>
                  ) : null}
                </div>

                <div
                  id="bjm-tabpanel"
                  role="tabpanel"
                  aria-labelledby={`bjm-tab-${activeTab}`}
                  className={`bjm-tab-content${activeTab === 'graph' ? ' bjm-tab-content--graph' : ''}`}
                  key={`${activeTab}-${activeTab === 'graph' ? 'graph' : selected.id}`}
                >
                  {activeTab === 'info' ? (
                    <InfoPanel
                      selected={selected}
                      content={content}
                      contentState={contentState}
                      onGenerate={generateContent}
                      onReadRef={readReference}
                      onStartSermon={startSermon}
                      onOpenTimeline={openTimelineFor}
                      card={card}
                    />
                  ) : null}
                  {activeTab === 'family' ? (
                    <FamilyPanel
                      selected={selected}
                      content={content}
                      lineageFocusLabels={lineageFocusLabels}
                      onOpenLineageTree={openLineage}
                      treeSize={lineageTree.metadata?.nodeCount}
                    />
                  ) : null}
                  {activeTab === 'people' ? <PeoplePanel selected={selected} onReadRef={readReference} /> : null}
                  {activeTab === 'story' ? (
                    <StoryPanel
                      selected={selected}
                      story={story}
                      loading={storyLoading}
                      progress={storyProgress}
                      sharedGeneration={storyShared}
                      error={storyError}
                      formats={storyFormats}
                      cardUrl={card.url}
                      sceneIndex={sceneIndex}
                      setSceneIndex={setSceneIndex}
                      playing={playing}
                      setPlaying={setPlaying}
                      mp4={mp4}
                      onCreate={(fmt) => generateStory({ imageFormat: fmt })}
                      onRegenerate={(fmt) => generateStory({ force: true, imageFormat: fmt })}
                      onRetry={() => generateStory(lastStoryRequest.current)}
                      onDismissError={() => setStoryError(null)}
                      onExportMp4={exportMp4}
                      onSwitchFormat={switchStoryFormat}
                    />
                  ) : null}
                  {activeTab === 'graph' ? <BibleKnowledgeGraph theme={theme} /> : null}
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
