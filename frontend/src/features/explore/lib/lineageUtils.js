import { ancestorPathToRoot } from './lineagePath.js';

/**
 * @typedef {import('../data/bible_lineage_timeline_family_tree.json').people[number]} LineagePerson
 * @typedef {import('../data/bible_lineage_timeline_family_tree.json').relationships[number]} LineageRel
 */

/**
 * @param {LineagePerson[]} people
 * @param {LineageRel[]} relationships
 */
export function buildRelationshipIndex(people, relationships) {
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const childrenByParent = new Map();
  const parentsByChild = new Map();
  const parentChild = [];

  for (const rel of relationships) {
    if (rel.relationship !== 'parent-child') continue;
    parentChild.push(rel);
    if (!childrenByParent.has(rel.source)) childrenByParent.set(rel.source, []);
    childrenByParent.get(rel.source).push(rel.target);
    if (!parentsByChild.has(rel.target)) parentsByChild.set(rel.target, []);
    parentsByChild.get(rel.target).push(rel.source);
  }

  return { peopleById, childrenByParent, parentsByChild, parentChild };
}

/** @param {Map<string, LineagePerson>} peopleById */
export function getPersonById(peopleById, id) {
  return peopleById.get(id) || null;
}

/** @param {ReturnType<typeof buildRelationshipIndex>} idx */
export function getChildren(id, idx) {
  return idx.childrenByParent.get(id) ? [...idx.childrenByParent.get(id)] : [];
}

/** @param {ReturnType<typeof buildRelationshipIndex>} idx */
export function getParents(id, idx) {
  return idx.parentsByChild.get(id) ? [...idx.parentsByChild.get(id)] : [];
}

/** Spouse not in dataset relationships — optional label map from caller */
export function getSpouseLabel(personId, spouseLabelMap) {
  return spouseLabelMap?.[personId] || null;
}

/**
 * Ancestors toward root (first parent chain).
 * @param {string} personId
 * @param {Map<string, LineagePerson>} peopleById
 * @param {string} [rootId]
 */
export function getAncestors(personId, peopleById, rootId = 'adam') {
  return ancestorPathToRoot(personId, peopleById, rootId);
}

/**
 * Limited descendants BFS.
 * @param {ReturnType<typeof buildRelationshipIndex>} idx
 */
export function getDescendants(personId, idx, max = 80) {
  const out = [];
  const q = [...getChildren(personId, idx)];
  const seen = new Set([personId]);
  while (q.length && out.length < max) {
    const id = q.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const c of getChildren(id, idx)) {
      if (!seen.has(c)) q.push(c);
    }
  }
  return out;
}

/**
 * Undirected BFS path between two person ids (parent-child edges).
 * @returns {string[]|null}
 */
export function getPathBetween(a, b, idx) {
  if (a === b) return [a];
  const adj = new Map();
  for (const rel of idx.parentChild) {
    const { source: u, target: v } = rel;
    if (!adj.has(u)) adj.set(u, []);
    if (!adj.has(v)) adj.set(v, []);
    adj.get(u).push(v);
    adj.get(v).push(u);
  }
  const prev = new Map();
  const q = [a];
  prev.set(a, null);
  while (q.length) {
    const u = q.shift();
    if (u === b) {
      const path = [];
      let cur = b;
      while (cur != null) {
        path.push(cur);
        cur = prev.get(cur);
      }
      return path.reverse();
    }
    for (const v of adj.get(u) || []) {
      if (!prev.has(v)) {
        prev.set(v, u);
        q.push(v);
      }
    }
  }
  return null;
}

export function getLineagePathToJesus(personId, peopleById, messiahId = 'jesus_messiah', idx) {
  if (!idx) {
    return ancestorPathToRoot(personId, peopleById, 'adam');
  }
  const path = getPathBetween(personId, messiahId, idx);
  return path || ancestorPathToRoot(personId, peopleById, 'adam');
}

/** @alias getLineagePathToJesus */
export const getPathToJesus = getLineagePathToJesus;

/**
 * Siblings = other children of any shared parent (parent-child edges only).
 * @param {ReturnType<typeof buildRelationshipIndex>} idx
 */
export function getSiblings(personId, idx) {
  const parents = getParents(personId, idx);
  if (!parents.length) return [];
  const sibs = new Set();
  for (const pid of parents) {
    for (const c of getChildren(pid, idx)) {
      if (c !== personId) sibs.add(c);
    }
  }
  return [...sibs];
}

/** Spouse edges are not in the graph JSON; use POSTER_SPOUSE_LABEL in UI. */
export function getSpouses(_personId, _idx) {
  return [];
}

export function normalizePersonName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const ID_ALIASES = new Map([
  ['abraham', 'abram_abraham'],
  ['abram', 'abram_abraham'],
  ['jesus', 'jesus_messiah'],
  ['jesus christ', 'jesus_messiah'],
  ['messiah', 'jesus_messiah'],
  ['yeshua', 'jesus_messiah'],
  ['jacob', 'jacob_israel'],
  ['israel', 'jacob_israel']
]);

/**
 * Resolve a loose name or alias to a person id when unambiguous in the dataset.
 * @param {string} needle
 * @param {LineagePerson[]} people
 * @returns {string | null}
 */
export function resolvePersonId(needle, people) {
  const n = normalizePersonName(needle);
  if (!n) return null;
  const alias = ID_ALIASES.get(n);
  if (alias && people.some((p) => p.id === alias)) return alias;
  const byId = people.find((p) => normalizePersonName(p.id) === n.replace(/_/g, ' '));
  if (byId) return byId.id;
  const exactId = people.find((p) => p.id === needle);
  if (exactId) return exactId.id;
  const matches = people.filter((p) => {
    const dn = normalizePersonName(p.displayName || '');
    const pn = normalizePersonName(p.name || '');
    return dn === n || pn === n || p.id.toLowerCase() === n.replace(/\s/g, '_');
  });
  if (matches.length === 1) return matches[0].id;
  return null;
}

/**
 * @param {string[]} targetPersonIds
 * @param {Map<string, LineagePerson>} peopleById
 */
export function getEventFocusPeople(targetPersonIds, peopleById) {
  return targetPersonIds.map((id) => peopleById.get(id)).filter(Boolean);
}

/**
 * Graph filter for full map.
 * @param {'all'|'messianic'|'patriarchs'|'tribes'|'priestly'|'kings'|'judges'|'women'|'event'} key
 * @param {string[]} tribeIds
 */
export function personMatchesGraphFilter(p, key, tribeIds, eventTargetIds) {
  if (key === 'all') return true;
  const era = (p.era || '').toLowerCase();
  const name = (p.name || '').toLowerCase();
  const types = p.lineageTypes || [];
  const cg = p.app?.colorGroup || '';

  if (key === 'messianic') return types.includes('messianic');
  if (key === 'priestly') return cg === 'priestly' || era.includes('levite') || name.includes('aaron') || name.includes('eli');
  if (key === 'patriarchs') return era.includes('patriarch') || era.includes('primeval');
  if (key === 'tribes') return tribeIds.includes(p.id);
  if (key === 'kings') return era.includes('kingdom') || era.includes('king') || name.includes('king');
  if (key === 'judges') return cg === 'judge' || era.includes('judge');
  if (key === 'women') return p.gender === 'female';
  if (key === 'event') return eventTargetIds.includes(p.id);
  return true;
}

const ALWAYS_LABEL = new Set([
  'adam',
  'noah',
  'shem',
  'abram_abraham',
  'isaac',
  'jacob_israel',
  'judah',
  'david',
  'solomon',
  'mary',
  'joseph_3',
  'jesus_messiah',
  'moses',
  'aaron'
]);

export function shouldShowLabelAlways(personId) {
  return ALWAYS_LABEL.has(personId);
}

export function shouldShowLabelAtZoom(personId, isMajor, zoom01) {
  if (shouldShowLabelAlways(personId)) return true;
  if (isMajor && zoom01 > 0.35) return true;
  if (zoom01 > 0.55) return true;
  return false;
}
