import perspectives from '../data/eventPersonPerspectives.json';

/**
 * @param {string} eventId
 * @param {string} personName — must match `mainPeople` string in bibleEvents.json
 * @returns {{ perspective: string } | null}
 */
export function getPersonPerspectiveEntry(eventId, personName) {
  const byEvent = perspectives[eventId];
  if (!byEvent || typeof personName !== 'string') return null;
  const row = byEvent[personName];
  if (!row || typeof row.perspective !== 'string' || !row.perspective.trim()) return null;
  return { perspective: row.perspective.trim() };
}
