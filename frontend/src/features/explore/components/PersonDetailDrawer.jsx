import React, { useMemo } from 'react';
import { BookOpen, ChevronRight, Crosshair, GitBranch, Users, X } from 'lucide-react';
import { POSTER_CARD_COPY, POSTER_SPOUSE_LABEL } from '../lib/lineagePosterData.js';
import { buildRelationshipIndex, getChildren, getLineagePathToJesus, getParents } from '../lib/lineageUtils.js';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {import('../data/bible_lineage_timeline_family_tree.json').people[number] | null} props.person
 * @param {import('../data/bible_lineage_timeline_family_tree.json')} props.tree
 * @param {() => void} props.onClose
 * @param {(id: string) => void} props.onFocusPerson
 * @param {(id: string) => void} [props.onGraphFocus] — open full map centered on this person
 * @param {(id: string) => void} props.onShowPathToJesus
 * @param {(id: string) => void} [props.onShowChildren]
 * @param {(id: string) => void} [props.onShowAncestors]
 * @param {string[]} [props.targetPersonIds]
 * @param {boolean} [props.premium] — luxury glass styling for Bloodline Explorer
 */
export default function PersonDetailDrawer({
  open,
  person,
  tree,
  onClose,
  onFocusPerson,
  onGraphFocus,
  onShowPathToJesus,
  onShowChildren,
  onShowAncestors,
  targetPersonIds = [],
  premium = false
}) {
  const idx = useMemo(() => buildRelationshipIndex(tree.people, tree.relationships || []), [tree.people, tree.relationships]);
  const peopleById = idx.peopleById;

  if (!open || !person) return null;

  const parents = getParents(person.id, idx);
  const children = getChildren(person.id, idx);
  const spouse = POSTER_SPOUSE_LABEL[person.id];
  const card = POSTER_CARD_COPY[person.id];
  const types = person.lineageTypes || [];
  const isEventPerson = targetPersonIds.includes(person.id);

  const badges = [];
  if (types.includes('messianic')) badges.push('Messianic line');
  if (person.isMajor) badges.push('Major figure');
  if (person.era?.toLowerCase().includes('king')) badges.push('Royal line');
  if (peopleById.get('aaron') && person.id === 'aaron') badges.push('High priest');
  if (types.includes('priestly') || person.app?.colorGroup === 'priestly') badges.push('Priestly');
  if (person.app?.colorGroup === 'judge') badges.push('Judge');
  if (isEventPerson) badges.push('This event');

  const pathToJesus = getLineagePathToJesus(person.id, peopleById, tree.metadata?.messiahId || 'jesus_messiah', idx);

  return (
    <div className={`lineage-drawer-root ${premium ? 'lineage-drawer-root--premium' : ''}`} role="dialog" aria-modal="true" aria-labelledby="lineage-drawer-title">
      <button type="button" className="lineage-drawer-backdrop" aria-label="Close drawer" onClick={onClose} />
      <aside className={`lineage-drawer ${premium ? 'lineage-drawer--premium' : ''}`}>
        <header className="lineage-drawer__head">
          <button type="button" className="icon-button lineage-drawer__close" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
          <p className="lineage-drawer__kicker">Person</p>
          <h2 id="lineage-drawer-title">{person.displayName || person.name}</h2>
          <p className="lineage-drawer__era">{person.era}</p>
          {badges.length ? (
            <div className="lineage-drawer__badges">
              {badges.map((b) => (
                <span key={b} className="lineage-drawer__badge">
                  {b}
                </span>
              ))}
            </div>
          ) : null}
        </header>

        <div className="lineage-drawer__body">
          {card ? (
            <section className="lineage-drawer__section">
              <h3>Why this person matters</h3>
              <p className="lineage-drawer__lead">{card.line}</p>
              <p className="lineage-drawer__ref">
                <BookOpen size={14} aria-hidden /> {card.ref}
              </p>
            </section>
          ) : (
            <section className="lineage-drawer__section">
              <h3>Why this person matters</h3>
              <p className="lineage-drawer__lead">A named person in the biblical genealogy dataset — tap the full map to see how they connect.</p>
            </section>
          )}

          <section className="lineage-drawer__section">
            <h3>Family links</h3>
            <dl className="lineage-drawer__dl">
              {parents.length ? (
                <div>
                  <dt>Parents</dt>
                  <dd>
                    {parents.map((pid) => (
                      <button key={pid} type="button" className="lineage-drawer__link" onClick={() => onFocusPerson(pid)}>
                        {peopleById.get(pid)?.displayName || peopleById.get(pid)?.name || pid}
                      </button>
                    ))}
                  </dd>
                </div>
              ) : null}
              {spouse ? (
                <div>
                  <dt>Spouse (tradition)</dt>
                  <dd>{spouse}</dd>
                </div>
              ) : null}
              {children.length ? (
                <div>
                  <dt>Children (in data)</dt>
                  <dd className="lineage-drawer__dd-stack">
                    {children.slice(0, 24).map((cid) => (
                      <button key={cid} type="button" className="lineage-drawer__link" onClick={() => onFocusPerson(cid)}>
                        {peopleById.get(cid)?.displayName || peopleById.get(cid)?.name || cid}
                      </button>
                    ))}
                    {children.length > 24 ? <span className="lineage-drawer__muted">+{children.length - 24} more</span> : null}
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>

          {pathToJesus?.length ? (
            <section className="lineage-drawer__section">
              <h3>Path toward Jesus (graph)</h3>
              <p className="lineage-drawer__path-preview">
                {pathToJesus
                  .slice(0, 12)
                  .map((id) => peopleById.get(id)?.displayName || peopleById.get(id)?.name || id)
                  .join(' → ')}
                {pathToJesus.length > 12 ? ' → …' : ''}
              </p>
            </section>
          ) : null}
        </div>

        <footer className="lineage-drawer__actions">
          <button type="button" className="secondary lineage-drawer__btn" onClick={() => onShowAncestors?.(person.id)}>
            <GitBranch size={16} /> Show ancestors
          </button>
          <button type="button" className="secondary lineage-drawer__btn" onClick={() => onShowChildren?.(person.id)}>
            <Users size={16} /> Show children
          </button>
          <button type="button" className="primary lineage-drawer__btn" onClick={() => onShowPathToJesus(person.id)}>
            <Crosshair size={16} /> Show path to Jesus
          </button>
          <button
            type="button"
            className="secondary lineage-drawer__btn"
            onClick={() => (onGraphFocus || onFocusPerson)(person.id)}
          >
            Focus this person <ChevronRight size={16} aria-hidden />
          </button>
        </footer>
      </aside>
    </div>
  );
}
