const BOOK_AND_PLACE = /^((?:[1-3]\s*)?[A-Za-z][A-Za-z .']*?)\s+(\d.*)$/;

/**
 * Split a timeline reference text into single, readable references.
 * "1 Kings 12, 13" → ["1 Kings 12", "1 Kings 13"]; "Luke 2:6, 8" → ["Luke 2:6", "Luke 2:8"];
 * "2 Samuel 5,\n1 Chronicles 11" → ["2 Samuel 5", "1 Chronicles 11"].
 * @param {string} [referenceText]
 * @returns {string[]}
 */
export function parseReferenceText(referenceText) {
  if (!referenceText) return [];
  const out = [];
  let book = null;
  let chapter = null;
  for (const raw of String(referenceText).split(/[;,\n]|\s+and\s+/i)) {
    const part = raw.trim().replace(/[.;,]+$/, '');
    if (!part) continue;
    const m = part.match(BOOK_AND_PLACE);
    if (m) {
      book = m[1].trim();
      const place = m[2].trim();
      chapter = place.match(/^(\d+):/)?.[1] ?? null;
      out.push(`${book} ${place}`);
    } else if (book && /^\d/.test(part)) {
      // a bare number continues the previous reference: a verse when that one had chapter:verse, otherwise a chapter
      if (part.includes(':')) {
        chapter = part.match(/^(\d+):/)?.[1] ?? chapter;
        out.push(`${book} ${part}`);
      } else {
        out.push(chapter ? `${book} ${chapter}:${part}` : `${book} ${part}`);
      }
    } else {
      out.push(part);
    }
  }
  return out;
}

/**
 * @param {{ referenceText?: string; references?: string[] }} event
 * @returns {string[]}
 */
export function getReferencesForEvent(event) {
  const pieces = [
    ...(Array.isArray(event.references) ? event.references.flatMap((r) => parseReferenceText(r)) : []),
    ...parseReferenceText(event.referenceText)
  ];
  const out = [];
  const seen = new Set();
  for (const r of pieces) {
    const k = r.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}
