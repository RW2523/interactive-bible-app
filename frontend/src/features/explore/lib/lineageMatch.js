import eventOverrides from '../data/lineageEventOverrides.json';
import eventLineageMap from '../data/eventLineageMap.json';

const STOP = new Set([
  'the',
  'and',
  'for',
  'his',
  'her',
  'god',
  'nation',
  'nations',
  'earth',
  'land',
  'kingdom',
  'monarchy',
  'exile',
  'covenant',
  'promise',
  'system',
  'worship',
  'slavery',
  'leadership',
  'bridge',
  'prophets',
  'prophet',
  'reform',
  'faithfulness',
  'humanity',
  'sin',
  'tribes',
  'twelve',
  'restoration',
  'jerusalem',
  'philistine',
  'oppression',
  'descendants',
  'family',
  'preserved',
  'delivered',
  'enters',
  'before',
  'during',
  'after',
  'continues',
  'established',
  'begins',
  'fulfills',
  'redemption',
  'teacher',
  'king',
  'public',
  'ministry',
  'major',
  'last',
  'northern',
  'ends',
  'passes',
  'remain',
  'faithful',
  'succession',
  'obedience',
  'call',
  'back',
  'preserves',
  'people',
  'affected',
  'against',
  'from',
  'into',
  'with',
  'without'
]);

/** @param {string} s */
export function norm(s) {
  return String(s)
    .toLowerCase()
    .replace(/[''']/g, "'")
    .replace(/[^a-z0-9\s/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when every word of `needle` appears, in order, as whole words inside `haystack` ("abram / abraham" contains "abraham").
 * @param {string} haystack normalised text
 * @param {string} needle normalised text
 */
function containsWords(haystack, needle) {
  const h = ` ${haystack.replace(/\//g, ' ').replace(/\s+/g, ' ').trim()} `;
  const n = needle.replace(/\//g, ' ').replace(/\s+/g, ' ').trim();
  return Boolean(n) && h.includes(` ${n} `);
}

/** @param {string} s */
function tokens(s) {
  return norm(s)
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

const PHRASE_ALIASES = {
  'jacob / israel': 'jacob_israel',
  'israel nation': 'jacob_israel',
  'israel as covenant nation': 'jacob_israel',
  'israel before the monarchy': 'jacob_israel',
  "israel's family preserved": 'jacob_israel',
  'israel delivered from slavery': 'moses',
  'israel enters the land': 'joshua',
  'twelve tribes': 'jacob_israel',
  'twelve tribes settled in land': 'jacob_israel',
  'davidic kingdom established': 'david',
  'davidic line continues in judah': 'judah',
  'judah preserved for davidic line': 'david',
  'judah enters exile': 'jehoiachin',
  'jesus as teacher and king': 'jesus_messiah',
  'jesus begins public ministry': 'jesus_messiah',
  'jesus fulfills redemption promise': 'jesus_messiah',
  'prophetic bridge to jesus': 'jesus_messiah',
  'moses leadership passes to joshua': 'joshua',
  "moses' leadership passes to joshua": 'joshua',
  'joshua and caleb remain faithful': 'joshua',
  'prophets call israel back to god': 'samuel',
  'northern kingdom ends': 'ephraim',
  'last major reform before exile': 'josiah',
  'faithfulness during exile': 'daniel',
  'restoration after exile': 'zerubbabel',
  'israel worship system begins': 'aaron',
  'judge against philistine oppression': 'dan',
  'monarchy begins': 'saul'
};

/**
 * @param {import('../data/bible_lineage_timeline_family_tree.json').people[number]} p
 */
function personTokens(p) {
  const t = new Set();
  for (const part of [p.id.replace(/_/g, ' '), p.name, p.displayName || '']) {
    for (const tok of tokens(part)) t.add(tok);
    for (const seg of norm(p.name).split('/')) {
      for (const tok of tokens(seg)) t.add(tok);
    }
  }
  return t;
}

/**
 * @param {string} q
 * @param {Map<string, import('../data/bible_lineage_timeline_family_tree.json').people[number]>} peopleById
 * @param {{ p: import('../data/bible_lineage_timeline_family_tree.json').people[number]; toks: Set<string> }[]} indexed
 */
function scoreQuery(q, peopleById, indexed) {
  const nq = norm(q);
  const aliasId = PHRASE_ALIASES[nq];
  if (aliasId && peopleById.has(aliasId)) return aliasId;

  const qt = tokens(q);
  if (qt.length === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const { p, toks } of indexed) {
    let s = 0;
    const nn = norm(p.name);
    const nd = norm(p.displayName || '');
    const nid = norm(p.id.replace(/_/g, ' '));
    if (nq === nn || nq === nd || nq === nid) s += 100;
    // whole words only: "Israelites" must not match Eli, "Babel" must not match Abel, "Haman" must not match Ham
    else if (containsWords(nn, nq) || containsWords(nq, nn)) s += 40;
    for (const t of qt) {
      if (toks.has(t)) s += 15;
    }
    if (p.isMajor) s += 4;
    if (s > bestScore) {
      bestScore = s;
      best = p.id;
    }
  }
  return bestScore >= 22 ? best : null;
}

/**
 * @param {import('../data/bibleEvents.json')[number]} event
 * @param {Map<string, import('../data/bible_lineage_timeline_family_tree.json').people[number]>} peopleById
 * @param {{ p: import('../data/bible_lineage_timeline_family_tree.json').people[number]; toks: Set<string> }[]} indexed
 */
export function matchEventToLineagePersonIds(event, peopleById, indexed) {
  const out = new Set();
  const overrideList = eventOverrides[event.id];
  if (Array.isArray(overrideList)) {
    for (const id of overrideList) {
      if (peopleById.has(id)) out.add(id);
    }
    const mapWithOverride = eventLineageMap[event.id];
    if (mapWithOverride?.extraFocusIds?.length) {
      for (const id of mapWithOverride.extraFocusIds) {
        if (peopleById.has(id)) out.add(id);
      }
    }
    if (mapWithOverride?.focusPeople?.length) {
      for (const id of mapWithOverride.focusPeople) {
        if (peopleById.has(id)) out.add(id);
      }
    }
    if (out.size) return [...out];
  }

  const mapEntry = eventLineageMap[event.id];
  if (mapEntry?.extraFocusIds?.length) {
    for (const id of mapEntry.extraFocusIds) {
      if (peopleById.has(id)) out.add(id);
    }
  }
  if (mapEntry?.focusPeople?.length) {
    for (const id of mapEntry.focusPeople) {
      if (peopleById.has(id)) out.add(id);
    }
  }

  for (const str of event.lineageConnection || []) {
    const id = scoreQuery(str, peopleById, indexed);
    if (id) out.add(id);
  }
  for (const str of event.mainPeople || []) {
    const id = scoreQuery(str, peopleById, indexed);
    if (id) out.add(id);
  }

  return [...out];
}

/** @param {string} eventId */
export function getEventLineageMapEntry(eventId) {
  return eventLineageMap[eventId] || null;
}

/**
 * All lineage ids to treat as “event focus” for chips and emphasis.
 * @param {string} eventId
 * @param {Map<string, import('../data/bible_lineage_timeline_family_tree.json').people[number]>} peopleById
 * @returns {string[]}
 */
export function getMergedEventFocusIds(eventId, peopleById) {
  const e = eventLineageMap[eventId];
  if (!e) return [];
  const out = new Set();
  if (e.centerPersonId && peopleById.has(e.centerPersonId)) out.add(e.centerPersonId);
  for (const id of e.extraFocusIds || []) {
    if (peopleById.has(id)) out.add(id);
  }
  for (const id of e.focusPeople || []) {
    if (peopleById.has(id)) out.add(id);
  }
  return [...out];
}

/**
 * Curated highlight path for storybook / graph (ids must exist in dataset).
 * @param {string} eventId
 * @param {Map<string, import('../data/bible_lineage_timeline_family_tree.json').people[number]>} peopleById
 * @returns {string[]}
 */
export function getEventPrimaryPathIds(eventId, peopleById) {
  const e = eventLineageMap[eventId];
  if (!e?.primaryPath?.length) return [];
  return e.primaryPath.filter((id) => peopleById.has(id));
}

/**
 * @param {import('../data/bible_lineage_timeline_family_tree.json').people} people
 */
export function buildLineageIndex(people) {
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const indexed = people.map((p) => ({ p, toks: personTokens(p) }));
  return { peopleById, indexed };
}
