const ROOT_FALLBACK = 'adam';

/**
 * @param {string} personId
 * @param {Map<string, { parentIds?: string[] }>} peopleById
 * @param {string} [rootId]
 */
export function ancestorPathToRoot(personId, peopleById, rootId = ROOT_FALLBACK) {
  const path = [];
  let cur = personId;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    path.push(cur);
    if (cur === rootId) break;
    const p = peopleById.get(cur);
    if (!p || !p.parentIds?.length) break;
    cur = p.parentIds[0];
  }
  return path;
}

/**
 * @param {string[]} targetPersonIds
 * @param {Map<string, { parentIds?: string[] }>} peopleById
 * @param {string} [rootId]
 */
export function highlightNodesForTargets(targetPersonIds, peopleById, rootId = ROOT_FALLBACK) {
  const nodes = new Set();
  for (const tid of targetPersonIds) {
    for (const id of ancestorPathToRoot(tid, peopleById, rootId)) nodes.add(id);
  }
  return nodes;
}

/**
 * @param {Set<string>} nodeIds
 * @param {{ source: string; target: string }[]} relationships
 */
export function highlightEdgesForNodes(nodeIds, relationships) {
  const edges = new Set();
  for (const rel of relationships) {
    if (rel.relationship !== 'parent-child') continue;
    if (nodeIds.has(rel.source) && nodeIds.has(rel.target)) edges.add(rel.id);
  }
  return edges;
}
