import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { GeoJSON, ImageOverlay, MapContainer, Marker, Pane, Polygon, Polyline, Popup, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import {
  BookOpen, CalendarDays, ChevronDown, ChevronUp, ImagePlus, Layers, Loader2, Maximize, Minus, Plus, Sparkles, X
} from 'lucide-react';
import { boundsFromMarkerDisplay, getEventMarkerPosition, getRouteLatLngs } from '../geo/journeyGeo';
import { CLASSIC_JOURNEYS } from '../geo/classicJourneys';
import { BIBLICAL_REGIONS, WATER_BODIES } from '../geo/biblicalRegions';
import EventArtIcon from './EventArtIcon.jsx';
import { getClusterIcon, getStoryMarkerIcon } from '../lib/storyMarkerIcon.js';
import { eraLabel, eventMatchesTimelineFilter, timelineMatchFromEventEra } from '../lib/timelineEra.js';

/* Offline basemaps: Natural Earth shaded relief (image overlay in Web Mercator) + land, lakes and rivers (GeoJSON),
   bundled under /geo and built by scripts/build_geodata.py. No map tiles are fetched from the internet. */
const BASEMAPS = {
  relief:    { label: 'Relief',    sea: '#a9cbe0', land: null,      lake: '#94bfd9', river: '#6a9ec6', riverOpacity: 0.55 },
  parchment: { label: 'Parchment', sea: '#c7d9d8', land: '#f1e6ca', lake: '#b6d0d4', river: '#86aebb', riverOpacity: 0.8 },
  night:     { label: 'Night',     sea: '#0a1628', land: '#1a2a44', lake: '#10233d', river: '#3b6ea8', riverOpacity: 0.7 }
};
const GEO_ATTRIBUTION = 'Map data: <a href="https://www.naturalearthdata.com" target="_blank" rel="noopener">Natural Earth</a> (public domain)';
const CHOICE_KEY = 'ibible_atlas_basemap_choice';
const LEGACY_KEY = 'ibible_atlas_basemap';
const CLUSTER_RADIUS = 40;
const SELECT_ZOOM = 7;

/** The basemap the user picked, or null to follow the app theme (relief in light, night in dark). */
function readBasemapChoice() {
  try {
    const chosen = localStorage.getItem(CHOICE_KEY);
    if (BASEMAPS[chosen]) return chosen;
    // older versions saved the default automatically: only a non-default value was a real choice
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy && legacy !== 'relief' && BASEMAPS[legacy]) return legacy;
  } catch { /* storage unavailable */ }
  return null;
}

let geoPromise = null;
function loadGeo() {
  if (!geoPromise) {
    geoPromise = (async () => {
      const manifest = await fetch('/geo/manifest.json').then((r) => r.json());
      const [land, lakes, rivers] = await Promise.all(['land', 'lakes', 'rivers'].map((k) => fetch(manifest.layers[k]).then((r) => r.json())));
      return { manifest, land, lakes, rivers };
    })().catch((err) => {
      geoPromise = null;
      throw err;
    });
  }
  return geoPromise;
}

function useGeoData() {
  const [geo, setGeo] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadGeo().then((g) => alive && setGeo(g)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);
  return { geo, failed };
}

/** Largest side of a region's bounding box, in degrees. */
function regionSpan(region) {
  const lats = region.coords.map((c) => c[0]);
  const lngs = region.coords.map((c) => c[1]);
  return Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs));
}

/** Lighten a #rrggbb colour so routes stay visible on the dark Night basemap. */
function lighten(hex, amount = 0.35) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255); const g = mix((n >> 8) & 255); const b = mix(n & 255);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function LocalBasemap({ basemap, geo }) {
  const map = useMap();
  const style = BASEMAPS[basemap] || BASEMAPS.relief;
  useEffect(() => {
    map.getContainer().style.background = style.sea;
  }, [map, style.sea]);
  if (!geo) return null;
  return (
    <>
      <Pane name="base-land" style={{ zIndex: 180 }}>
        {basemap === 'relief' ? (
          <ImageOverlay url={geo.manifest.relief.url} bounds={geo.manifest.relief.bounds} attribution={GEO_ATTRIBUTION} />
        ) : (
          <GeoJSON key={`land-${basemap}`} data={geo.land} interactive={false} attribution={GEO_ATTRIBUTION} style={{ stroke: false, fillColor: style.land, fillOpacity: 1 }} />
        )}
      </Pane>
      <Pane name="base-water" style={{ zIndex: 190 }}>
        <GeoJSON key={`lakes-${basemap}`} data={geo.lakes} interactive={false} style={{ stroke: false, fillColor: style.lake, fillOpacity: basemap === 'relief' ? 0.9 : 1 }} />
        <GeoJSON key={`rivers-${basemap}`} data={geo.rivers} interactive={false} style={{ color: style.river, weight: basemap === 'relief' ? 1 : 1.3, opacity: style.riverOpacity }} />
      </Pane>
    </>
  );
}

/** Keep Leaflet's size in sync with its container (layout changes, tab switches, window resizes). */
function MapResize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(frame); };
  }, [map]);
  return null;
}

function fitEvents(map, events, activeEra, animate = true) {
  const subset = activeEra && activeEra !== 'All' ? events.filter((e) => eventMatchesTimelineFilter(e, activeEra)) : events;
  const b = boundsFromMarkerDisplay(subset.length ? subset : events);
  if (!b) return;
  map.fitBounds(b, { padding: [48, 48], maxZoom: activeEra && activeEra !== 'All' ? 8 : 7, animate });
}

/** Fit the map to all pins, or to the chosen era */
function MapEraBounds({ events, activeEra }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    if (!events.length) return;
    fitEvents(map, events, activeEra, !first.current);
    first.current = false;
  }, [map, events, activeEra]);
  return null;
}

/** After the user picks a different event outside the map (list, timeline), bring its pin into view at a comfortable zoom.
    A pin clicked on the map is already in view: its popup pans the map just enough instead. */
function MapFlyToSelection({ events, selectedEvent, clickedOnMap }) {
  const map = useMap();
  const prev = useRef(selectedEvent?.id);
  useEffect(() => {
    if (!selectedEvent || prev.current === selectedEvent.id) return;
    prev.current = selectedEvent.id;
    if (clickedOnMap.current === selectedEvent.id) {
      clickedOnMap.current = null;
      return;
    }
    const p = getEventMarkerPosition(selectedEvent, events);
    const zoom = Math.max(map.getZoom(), SELECT_ZOOM);
    requestAnimationFrame(() => map.flyTo([p.lat, p.lng], Math.min(zoom, map.getMaxZoom()), { duration: 0.7 }));
  }, [map, events, selectedEvent]);
  return null;
}

function DismissPopups({ nonce }) {
  const map = useMap();
  useEffect(() => { if (nonce) map.closePopup(); }, [nonce, map]);
  // small regions' names only appear once zoomed in, so the Holy Land is not a pile of overlapping labels
  useEffect(() => {
    const sync = () => map.getContainer().classList.toggle('is-zoomed-out', map.getZoom() < 7);
    sync();
    map.on('zoomend', sync);
    return () => { map.off('zoomend', sync); };
  }, [map]);
  // hide hover labels while a popup is open so they never cover it
  useMapEvents({
    popupopen: () => map.getContainer().classList.add('has-popup'),
    popupclose: () => map.getContainer().classList.remove('has-popup')
  });
  return null;
}

function MapControls({ events, activeEra, layersOpen, onToggleLayers }) {
  const map = useMap();
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      L.DomEvent.disableClickPropagation(ref.current);
      L.DomEvent.disableScrollPropagation(ref.current);
    }
  }, []);
  return (
    <div className="x-map-ctrls" ref={ref}>
      <div className="x-map-ctrls__group">
        <button type="button" onClick={() => map.zoomIn()} aria-label="Zoom in" title="Zoom in"><Plus size={17} /></button>
        <button type="button" onClick={() => map.zoomOut()} aria-label="Zoom out" title="Zoom out"><Minus size={17} /></button>
        <button type="button" onClick={() => fitEvents(map, events, activeEra)} aria-label="Show all events" title="Show all events"><Maximize size={15} /></button>
      </div>
      <button
        type="button"
        className={`x-map-ctrls__single${layersOpen ? ' is-active' : ''}`}
        onClick={onToggleLayers}
        aria-expanded={layersOpen}
        aria-controls="map-layers-panel"
        aria-label="Map layers"
        title="Base map and layers"
      >
        <Layers size={17} />
      </button>
    </div>
  );
}

function EventPopup({ event, onShowEra, onOpenTimeline, onReadRef }) {
  const era = timelineMatchFromEventEra(event.era);
  return (
    <div className="x-popup__inner">
      <p className="x-popup__eyebrow">{[event.timelineDate, era ? eraLabel(era) : event.era].filter(Boolean).join(' · ')}</p>
      <strong className="x-popup__title">{event.title}</strong>
      {event.mapLocation ? <p className="x-popup__meta">{event.mapLocation}</p> : null}
      <div className="x-popup__actions">
        {event.references?.[0] ? (
          <button type="button" className="x-popup__btn" onClick={() => onReadRef(event.references[0])}>
            <BookOpen size={13} aria-hidden /> {event.references[0]}
          </button>
        ) : null}
        {era ? (
          <button type="button" className="x-popup__btn" onClick={() => onShowEra(event.id)} title="Show only this era on the map and in the list">
            <Sparkles size={13} aria-hidden /> Show this era
          </button>
        ) : null}
        <button type="button" className="x-popup__btn x-popup__btn--primary" onClick={() => onOpenTimeline(event.id)}>
          <CalendarDays size={13} aria-hidden /> Open in Timeline
        </button>
      </div>
    </div>
  );
}

const SingleMarker = memo(function SingleMarker({ event, position, selected, muted, onSelect, onShowEra, onOpenTimeline, onReadRef, clickedOnMap }) {
  const icon = useMemo(() => getStoryMarkerIcon(event, selected, muted), [event, selected, muted]);
  const handlers = useMemo(() => ({
    click: (e) => { e.target.closeTooltip(); clickedOnMap.current = event.id; onSelect(event.id); },
    add: (e) => {
      const el = e.target.getElement();
      if (el) el.setAttribute('aria-label', `${event.order}. ${event.title}`);
    }
  }), [event, onSelect, clickedOnMap]);
  return (
    <Marker position={position} icon={icon} eventHandlers={handlers} zIndexOffset={selected ? 1000 : muted ? -500 : 0} keyboard>
      <Tooltip direction="top" offset={[0, -2]} opacity={1} className="x-map-tip">{event.title}</Tooltip>
      <Popup className="x-popup" autoPan autoPanPadding={[24, 24]} closeButton>
        <EventPopup event={event} onShowEra={onShowEra} onOpenTimeline={onOpenTimeline} onReadRef={onReadRef} />
      </Popup>
    </Marker>
  );
});

function ClusterMarker({ cluster, onOpenList, plus = false }) {
  const map = useMap();
  const members = useMemo(() => cluster.members.map((m) => m.event), [cluster]);
  const icon = useMemo(() => getClusterIcon(members, cluster.muted, plus), [members, cluster.muted, plus]);
  const handlers = useMemo(() => ({
    click: () => {
      const all = plus ? [...cluster.members, cluster.anchor] : cluster.members;
      const bounds = L.latLngBounds(all.map((m) => [m.pos.lat, m.pos.lng]));
      // can the pins be told apart if we zoom in? otherwise list them
      const maxZoom = map.getMaxZoom();
      const pts = all.map((m) => map.project([m.pos.lat, m.pos.lng], maxZoom));
      let spread = 0;
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) spread = Math.max(spread, pts[i].distanceTo(pts[j]));
      if (map.getZoom() >= maxZoom || spread < CLUSTER_RADIUS * 1.2) onOpenList(cluster);
      else map.flyToBounds(bounds, { padding: [70, 70], maxZoom, duration: 0.7 });
    },
    add: (e) => {
      const el = e.target.getElement();
      if (el) el.setAttribute('aria-label', `${plus ? `${members.length} more events nearby` : `${members.length} events here`}: ${members.map((m) => m.title).join(', ')}. Press Enter to zoom in.`);
    }
  }), [cluster, map, members, onOpenList, plus]);
  const where = plus ? cluster.anchor.pos : cluster;
  return (
    <Marker position={[where.lat, where.lng]} icon={icon} eventHandlers={handlers} zIndexOffset={plus ? 1100 : cluster.muted ? -600 : 200} keyboard>
      <Tooltip direction="top" offset={plus ? [18, -52] : [0, -18]} opacity={1} className="x-map-tip">
        {plus ? `${members.length} more here` : `${members.length} events`} · {members.slice(0, 3).map((m) => m.title).join(', ')}{members.length > 3 ? '…' : ''}
      </Tooltip>
    </Marker>
  );
}

/**
 * Pins that would overlap at the current zoom are grouped into one numbered bubble. The selected pin always stays
 * visible: any pins hidden under it are shown as a small "+N" badge beside it.
 */
function ClusteredMarkers({ events, selectedId, activeEra, onSelect, onShowEra, onOpenTimeline, onReadRef, clickedOnMap }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  const [listCluster, setListCluster] = useState(null);
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  const items = useMemo(() => events.map((event) => ({
    event,
    pos: getEventMarkerPosition(event, events),
    muted: Boolean(activeEra && activeEra !== 'All' && !eventMatchesTimelineFilter(event, activeEra))
  })), [events, activeEra]);

  const groups = useMemo(() => {
    const out = [];
    const rank = (it) => (it.event.id === selectedId ? -1 : Number(it.muted));
    const ordered = [...items].sort((a, b) => rank(a) - rank(b) || (a.event.order ?? 0) - (b.event.order ?? 0));
    for (const item of ordered) {
      const point = map.project([item.pos.lat, item.pos.lng], zoom);
      const g = out.find((grp) => (grp.selected ? true : grp.muted === item.muted) && grp.point.distanceTo(point) < CLUSTER_RADIUS);
      if (g) g.members.push(item);
      else out.push({ members: [item], point, muted: item.muted, selected: item.event.id === selectedId });
    }
    return out.map((g) => {
      const key = g.members.map((m) => m.event.id).join('|');
      if (g.selected) {
        const [anchor, ...rest] = g.members;
        return { ...g, key, anchor, rest };
      }
      const lat = g.members.reduce((a, m) => a + m.pos.lat, 0) / g.members.length;
      const lng = g.members.reduce((a, m) => a + m.pos.lng, 0) / g.members.length;
      return { ...g, key, lat, lng };
    });
  }, [items, map, zoom, selectedId]);

  useEffect(() => { setListCluster(null); }, [zoom, selectedId]);

  const single = (item, selected) => (
    <SingleMarker
      key={item.event.id}
      event={item.event}
      position={item.pos}
      selected={selected}
      muted={item.muted && !selected}
      onSelect={onSelect}
      onShowEra={onShowEra}
      onOpenTimeline={onOpenTimeline}
      onReadRef={onReadRef}
      clickedOnMap={clickedOnMap}
    />
  );

  return (
    <>
      {/* a flat list with stable keys, so a pin keeps its open popup when it becomes the selected one */}
      {groups.flatMap((g) => {
        if (g.selected) {
          return g.rest.length
            ? [single(g.anchor, true), <ClusterMarker key={`plus-${g.key}`} cluster={{ ...g, members: g.rest }} onOpenList={setListCluster} plus />]
            : [single(g.anchor, true)];
        }
        return g.members.length === 1 ? [single(g.members[0], false)] : [<ClusterMarker key={g.key} cluster={g} onOpenList={setListCluster} />];
      })}
      {listCluster ? (
        <Popup position={listCluster.anchor ? [listCluster.anchor.pos.lat, listCluster.anchor.pos.lng] : [listCluster.lat, listCluster.lng]} className="x-popup" eventHandlers={{ remove: () => setListCluster(null) }}>
          <div className="x-popup__inner">
            <p className="x-popup__eyebrow">{listCluster.members.length} events in this place</p>
            <ul className="x-popup__list">
              {listCluster.members.map(({ event }) => (
                <li key={event.id}>
                  <button type="button" onClick={() => { setListCluster(null); map.closePopup(); onSelect(event.id); }}>
                    <span className="x-popup__num">{event.order}</span>
                    <span>{event.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Popup>
      ) : null}
    </>
  );
}

function MapLayersPanel({ basemap, basemapChosen, onBasemap, onResetBasemap, layers, setLayer, journeyFilter, setJourneyFilter, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      L.DomEvent.disableClickPropagation(ref.current);
      L.DomEvent.disableScrollPropagation(ref.current);
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const checks = [
    ['regions', 'Ancient kingdoms and borders', 'var(--x-map-legend-region)'],
    ['water', 'Rivers and seas', 'var(--x-map-legend-water)'],
    ['routes', 'Journey routes', 'var(--x-map-legend-route)'],
    ['labels', 'Place and route names', 'var(--x-ink-3)'],
    ['warm', 'Warm atlas tone', 'var(--x-map-legend-warm)']
  ];
  return (
    <div id="map-layers-panel" className="x-layers" role="dialog" aria-label="Map layers" ref={ref}>
      <div className="x-layers__head">
        <strong>Map layers</strong>
        <button type="button" className="icon-button icon-button--ghost icon-button--sm" onClick={onClose} aria-label="Close map layers"><X size={16} /></button>
      </div>
      <p className="x-layers__label">Base map</p>
      <div className="x-segmented x-segmented--block" role="group" aria-label="Base map">
        {Object.entries(BASEMAPS).map(([id, b]) => (
          <button key={id} type="button" aria-pressed={basemap === id} onClick={() => onBasemap(id)}>{b.label}</button>
        ))}
      </div>
      <p className="x-layers__hint">
        {basemapChosen ? 'Saved on this device.' : 'Follows your light or dark theme until you pick one.'}
        {basemapChosen ? <button type="button" className="link-button" onClick={onResetBasemap}>Match theme</button> : null}
      </p>
      <p className="x-layers__label">Show on the map</p>
      <div className="x-layers__checks">
        {checks.map(([key, label, color]) => (
          <label key={key} className="x-check">
            <input type="checkbox" checked={layers[key]} onChange={(e) => setLayer(key, e.target.checked)} />
            <span className="x-check__swatch" style={{ background: color }} aria-hidden />
            <span>{label}</span>
          </label>
        ))}
      </div>
      {layers.routes ? (
        <>
          <p className="x-layers__label">Routes from</p>
          <div className="x-segmented x-segmented--block" role="group" aria-label="Routes from">
            {[['ALL', 'Whole Bible'], ['OT', 'Old Test.'], ['NT', 'New Test.']].map(([id, label]) => (
              <button key={id} type="button" aria-pressed={journeyFilter === id} onClick={() => setJourneyFilter(id)}>{label}</button>
            ))}
          </div>
        </>
      ) : null}
      <p className="x-layers__hint">Point at a route for its name. Click a kingdom to learn more.</p>
    </div>
  );
}

/** Selected event card over the map (smaller layouts, where the details sit below the map). */
function SelectedCard({ selected, card, openSignal, onReadRef }) {
  const [open, setOpen] = useState(false);
  const last = useRef(openSignal);
  useEffect(() => {
    setOpen(openSignal > last.current);
    last.current = openSignal;
  }, [selected.id, openSignal]);

  if (!open) {
    return (
      <button type="button" className="x-map-card x-map-card--chip" onClick={() => setOpen(true)} aria-expanded={false} aria-controls="map-selected-card">
        <EventArtIcon order={selected.order} mapIcon={selected.mapIcon} variant="strip" />
        <span className="x-map-card__text">
          <strong>{selected.title}</strong>
          <small>{[selected.references?.[0], selected.timelineDate].filter(Boolean).join(' · ')}</small>
        </span>
        <ChevronUp size={18} className="x-map-card__chev" aria-hidden />
      </button>
    );
  }
  return (
    <div className="x-map-card x-map-card--open" id="map-selected-card">
      {card.url ? <img className="x-map-card__art" src={card.url} alt="" aria-hidden /> : null}
      <button type="button" className="icon-button icon-button--glass icon-button--sm x-map-card__close" onClick={() => setOpen(false)} aria-label="Hide event summary" aria-expanded>
        <ChevronDown size={17} />
      </button>
      <div className="x-map-card__body">
        {!card.url ? <EventArtIcon order={selected.order} mapIcon={selected.mapIcon} variant="popover" /> : null}
        <div className="x-map-card__copy">
          <strong>{selected.title}</strong>
          {selected.references?.[0] ? (
            <button type="button" className="link-button" onClick={() => onReadRef(selected.references[0])}>
              <BookOpen size={14} aria-hidden /> {selected.references.join(', ')}
            </button>
          ) : null}
          <p>{selected.summary}</p>
          {!card.url ? (
            <button type="button" className="secondary btn-sm" onClick={() => card.illustrate()} disabled={card.loading} title="AI paints one scene in about 15 seconds and saves it for everyone">
              {card.loading ? <Loader2 size={14} className="spin" aria-hidden /> : <ImagePlus size={14} aria-hidden />}
              {card.loading ? 'Painting the scene…' : 'Illustrate with AI'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function JourneyMap({
  events, selected, activeEra = 'All', theme = 'light', onSelect, onShowEra, onOpenTimeline, onReadRef, listSelectSignal = 0,
  mapPopupDismissNonce = 0, card
}) {
  const [choice, setChoice] = useState(readBasemapChoice);
  const basemap = choice || (theme === 'dark' ? 'night' : 'relief');
  const { geo, failed } = useGeoData();
  const [layers, setLayers] = useState({ regions: true, water: true, routes: true, labels: true, warm: false });
  const [journeyFilter, setJourneyFilter] = useState('ALL');
  const [layersOpen, setLayersOpen] = useState(false);

  const pickBasemap = useCallback((id) => {
    setChoice(id);
    try { localStorage.setItem(CHOICE_KEY, id); localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
  }, []);
  const resetBasemap = useCallback(() => {
    setChoice(null);
    try { localStorage.removeItem(CHOICE_KEY); localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
  }, []);
  const setLayer = useCallback((key, value) => setLayers((l) => ({ ...l, [key]: value })), []);
  const closeLayers = useCallback(() => setLayersOpen(false), []);

  const mapEvents = useMemo(() => [...events].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [events]);
  const routePts = useMemo(() => getRouteLatLngs(selected), [selected]);
  const journeys = useMemo(() => CLASSIC_JOURNEYS.filter((j) => journeyFilter === 'ALL' || j.testament === journeyFilter), [journeyFilter]);
  const clickedOnMap = useRef(null);
  const initialCenter = useRef(null);
  if (!initialCenter.current) {
    const p = getEventMarkerPosition(selected, mapEvents);
    initialCenter.current = [p.lat, p.lng];
  }
  const night = basemap === 'night';
  const routeColor = (c) => (night ? lighten(c, 0.3) : c);

  return (
    <div className={`x-map x-map--${basemap}${layers.warm ? ' x-map--warm' : ''}${layers.labels ? '' : ' x-map--no-labels'}`}>
      <MapContainer
        center={initialCenter.current}
        zoom={6}
        minZoom={4}
        maxZoom={10}
        maxBounds={[[4, -22], [54, 74]]}
        maxBoundsViscosity={0.85}
        className="x-map__leaflet"
        scrollWheelZoom
        zoomControl={false}
        attributionControl
      >
        <LocalBasemap basemap={basemap} geo={geo} />
        <MapResize />
        <DismissPopups nonce={mapPopupDismissNonce} />
        <MapEraBounds events={mapEvents} activeEra={activeEra} />
        <MapFlyToSelection events={mapEvents} selectedEvent={selected} clickedOnMap={clickedOnMap} />
        <MapControls events={mapEvents} activeEra={activeEra} layersOpen={layersOpen} onToggleLayers={() => setLayersOpen((v) => !v)} />

        <Pane name="bible-regions" style={{ zIndex: 350 }}>
          {layers.regions && BIBLICAL_REGIONS.map((r) => (
            <Polygon
              key={r.id}
              positions={r.coords}
              pathOptions={{ color: routeColor(r.color), weight: r.weight ?? 1.5, opacity: 0.7, fillColor: r.color, fillOpacity: r.fillOpacity ?? 0.08, dashArray: '5 6', lineCap: 'round' }}
            >
              {layers.labels ? (
                <Tooltip direction="center" permanent className={`x-region-label${regionSpan(r) < 2.2 ? ' x-region-label--small' : ''}`} offset={[0, 0]}>{r.name}</Tooltip>
              ) : null}
              <Popup className="x-popup">
                <div className="x-popup__inner">
                  <p className="x-popup__eyebrow">Region</p>
                  <strong className="x-popup__title">{r.name}</strong>
                  <p className="x-popup__meta">{r.subtext}</p>
                </div>
              </Popup>
            </Polygon>
          ))}
        </Pane>

        <Pane name="water-bodies" style={{ zIndex: 360 }}>
          {layers.water && WATER_BODIES.map((w) => (w.id === 'jordan_river' ? (
            <Polyline key={w.id} positions={w.coords} pathOptions={{ color: night ? '#6aa7ff' : '#2f6fdb', weight: 2.5, opacity: 0.75 }}>
              {layers.labels ? <Tooltip sticky className="x-map-tip x-map-tip--water">{w.name}</Tooltip> : null}
            </Polyline>
          ) : (
            <Polygon key={w.id} positions={w.coords} pathOptions={{ color: night ? '#6aa7ff' : '#1d4ed8', weight: 1, opacity: 0.55, fillColor: '#3b82f6', fillOpacity: w.fillOpacity }}>
              {layers.labels ? <Tooltip direction="center" permanent className="x-water-label">{w.name}</Tooltip> : null}
            </Polygon>
          )))}
        </Pane>

        <Pane name="classic-routes" style={{ zIndex: 399 }}>
          {layers.routes && journeys.map((j) => (
            <Polyline
              key={j.id}
              positions={j.path}
              pathOptions={{ color: routeColor(j.color), weight: j.weight ?? 3, opacity: j.opacity ?? 0.75, dashArray: j.dashArray ?? '8 12', lineCap: 'round', lineJoin: 'round' }}
            >
              {layers.labels ? (
                <Tooltip sticky className="x-map-tip">
                  <span className="x-map-tip__swatch" style={{ background: routeColor(j.color) }} aria-hidden />{j.label}
                </Tooltip>
              ) : null}
            </Polyline>
          ))}
        </Pane>

        <Pane name="event-routes" style={{ zIndex: 400 }}>
          {routePts.length >= 2 ? (
            <Polyline positions={routePts} pathOptions={{ color: night ? '#f0c75e' : '#b8860b', weight: 4, opacity: 0.95, dashArray: '14 10', lineCap: 'round', lineJoin: 'round' }} />
          ) : null}
        </Pane>

        <Pane name="story-markers" style={{ zIndex: 650 }}>
          <ClusteredMarkers
            events={mapEvents}
            selectedId={selected.id}
            activeEra={activeEra}
            onSelect={onSelect}
            onShowEra={onShowEra}
            onOpenTimeline={onOpenTimeline}
            onReadRef={onReadRef}
            clickedOnMap={clickedOnMap}
          />
        </Pane>
      </MapContainer>

      {layersOpen ? (
        <MapLayersPanel
          basemap={basemap}
          basemapChosen={Boolean(choice)}
          onBasemap={pickBasemap}
          onResetBasemap={resetBasemap}
          layers={layers}
          setLayer={setLayer}
          journeyFilter={journeyFilter}
          setJourneyFilter={setJourneyFilter}
          onClose={closeLayers}
        />
      ) : null}

      {failed ? <p className="x-map__notice" role="status">The offline map could not be loaded. Pins still work — reload the page to try again.</p> : null}

      <SelectedCard selected={selected} card={card} openSignal={listSelectSignal} onReadRef={onReadRef} />
    </div>
  );
}
