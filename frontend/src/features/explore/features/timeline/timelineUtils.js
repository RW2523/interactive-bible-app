import { enrichTimelineEvent } from './timelineImportance.js';
import { getMapEventIdForTimelineEvent } from './timelineToMapEventMap.js';
import { getReferencesForEvent } from './timelineReferenceParser.js';

/** The 583-event timeline ships with the app (data/explore/bible_timeline_events.json) — no network needed. */
export async function loadTimelineEvents() {
  const mod = await import('@data/explore/bible_timeline_events.json');
  return normalizeBundle(mod.default || mod);
}

/**
 * @param {object} bundle
 */
export function normalizeBundle(bundle) {
  const raw = bundle.events || [];
  return {
    ...bundle,
    events: raw.map((e) => enrichStub(e))
  };
}

/** @param {object} e */
function enrichStub(e) {
  const mapId = getMapEventIdForTimelineEvent(e.id, e.title);
  return enrichTimelineEvent(e, mapId, []);
}

/**
 * @param {object[]} events
 * @param {{ id: string; order?: number }[]} mapEvents
 */
export function attachMapIcons(events, mapEvents) {
  return events.map((e) => {
    const mapId = getMapEventIdForTimelineEvent(e.id, e.title);
    return enrichTimelineEvent(e, mapId, mapEvents);
  });
}

/**
 * @param {object} event
 */
export function getTimelineDateSortValue(event) {
  const sy = event?.date?.sortYear;
  if (typeof sy === 'number' && Number.isFinite(sy)) return sy;
  return (event.order ?? 0) * 1e-6;
}

/**
 * @param {object} event
 */
export function getTimelineDateDisplay(event) {
  return event.dateLabel || event?.date?.label || '—';
}

/**
 * @param {object[]} events
 */
export function sortTimelineEvents(events) {
  const arr = [...events];
  arr.sort((a, b) => {
    const oa = a.order ?? 0;
    const ob = b.order ?? 0;
    if (oa !== ob) return oa - ob;
    const da = getTimelineDateSortValue(a);
    const db = getTimelineDateSortValue(b);
    if (da !== db) return da - db;
    return String(a.id).localeCompare(String(b.id));
  });
  return arr;
}

/**
 * @param {object[]} events
 * @returns {Map<string, object[]>}
 */
export function groupEventsByEra(events) {
  const m = new Map();
  for (const e of events) {
    const g = e.eraGroup || 'Other';
    if (!m.has(g)) m.set(g, []);
    m.get(g).push(e);
  }
  for (const [, list] of m) sortTimelineEvents(list);
  return m;
}

/**
 * @param {'OT'|'NT'|'all'} t
 * @param {object[]} events
 */
export function filterByTestament(events, t) {
  if (t === 'all') return events;
  return events.filter((e) => {
    const sec = (e.section || '').toLowerCase();
    const scr = (e.scriptureTestament || '').toLowerCase();
    if (t === 'OT') return sec.includes('old') || scr.includes('old testament');
    if (t === 'NT') return sec.includes('new') || scr.includes('new testament');
    return true;
  });
}

/**
 * @param {string} query
 * @param {object[]} events
 */
export function searchTimelineEvents(query, events) {
  const q = query.trim().toLowerCase();
  if (!q) return events;
  return events.filter((e) => {
    const blob = [
      e.title,
      e.dateLabel,
      e.referenceText,
      e.eraGroup,
      e.section,
      e.scriptureTestament,
      ...(e.references || []),
      e.id
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return blob.includes(q);
  });
}

/**
 * @param {string} eventId
 * @param {object[]} all
 */
export function getRelatedEvents(eventId, all) {
  const cur = all.find((e) => e.id === eventId);
  if (!cur) return [];
  const era = cur.eraGroup;
  const order = cur.order ?? 0;
  return all
    .filter((e) => e.id !== eventId && e.eraGroup === era)
    .sort((a, b) => Math.abs((a.order ?? 0) - order) - Math.abs((b.order ?? 0) - order))
    .slice(0, 12);
}

/**
 * @param {number} startYear inclusive sortYear
 * @param {number} endYear inclusive
 * @param {object[]} events
 */
export function getEventsByDateRange(startYear, endYear, events) {
  return events.filter((e) => {
    const y = getTimelineDateSortValue(e);
    return y >= startYear && y <= endYear;
  });
}

/**
 * @param {string} eraGroup
 * @param {Map<string, object[]>} grouped
 */
export function getEventsByEra(eraGroup, grouped) {
  return grouped.get(eraGroup) || [];
}

export { getReferencesForEvent };
