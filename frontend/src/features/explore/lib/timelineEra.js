/**
 * Shared timeline / era helpers for event list, map, and bottom bar.
 */

/** Map an event's `era` string to bottom timeline `match` keys */
export function timelineMatchFromEventEra(era) {
  if (!era || typeof era !== 'string') return null;
  const e = era.toLowerCase();
  if (e.includes('primeval')) return 'Primeval';
  if (e.includes('patriarch')) return 'Patriarchs';
  if (e.includes('wilderness') || e.includes('exodus')) return 'Exodus';
  if (e.includes('conquest')) return 'Conquest';
  if (e.includes('judge') || e.includes('ruth')) return 'Judges';
  if (
    e.includes('exile warning') ||
    e.includes('united kingdom') ||
    e.includes('divided kingdom') ||
    e.includes('judah kingdom') ||
    e.includes('transition to monarchy')
  ) {
    return 'Kingdom';
  }
  if (e.includes('exile') || e.includes('persian') || e.includes('return')) return 'Exile';
  if (e.includes('jesus') || e.includes('resurrection') || e.includes('ministry') || e.includes('church')) return 'Jesus';
  return null;
}

/**
 * Era chips shown above the atlas. `match` is the key returned by timelineMatchFromEventEra, so every atlas event
 * belongs to exactly one chip (e.g. "Death and Resurrection" → Jesus, "Persian Period" → Exile & Return).
 */
export const ATLAS_ERAS = [
  { label: 'Primeval', match: 'Primeval', sub: 'Beginning' },
  { label: 'Patriarchs', match: 'Patriarchs', sub: '2000–1700 BC' },
  { label: 'Exodus', match: 'Exodus', sub: '1600–1400 BC' },
  { label: 'Conquest', match: 'Conquest', sub: '1406 BC' },
  { label: 'Judges', match: 'Judges', sub: '1350–1050 BC' },
  { label: 'Kingdom', match: 'Kingdom', sub: '1050–586 BC' },
  { label: 'Exile & Return', match: 'Exile', sub: '586–430 BC' },
  { label: 'Jesus', match: 'Jesus', sub: '5 BC–AD 30' }
];

export function eraLabel(match) {
  return ATLAS_ERAS.find((e) => e.match === match)?.label || match;
}

/** Same rule for the event list, the map pins and the era chips */
export function eventMatchesTimelineFilter(event, activeEra) {
  if (!activeEra || activeEra === 'All') return true;
  return timelineMatchFromEventEra(event?.era) === activeEra;
}
