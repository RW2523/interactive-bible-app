import React from 'react';
import { GitBranch } from 'lucide-react';

/**
 * @param {object} props
 * @param {string[]} props.focusIds
 * @param {Map<string, import('../../data/bible_lineage_timeline_family_tree.json').people[number]>} props.peopleById
 * @param {string[]} [props.primaryPathIds]
 * @param {string} [props.description]
 */
export default function LineageFocusStrip({ focusIds, peopleById, primaryPathIds = [], description = '' }) {
  if (!focusIds.length && !primaryPathIds.length) return null;

  const names = focusIds.map((id) => ({ id, label: peopleById.get(id)?.displayName || peopleById.get(id)?.name || id }));
  const pathNames = primaryPathIds.map((id) => peopleById.get(id)?.displayName || peopleById.get(id)?.name || id);

  return (
    <div className="bloodline-focus-strip" role="status">
      <GitBranch size={18} className="bloodline-focus-strip__icon" aria-hidden />
      <div className="bloodline-focus-strip__main">
        <span className="bloodline-focus-strip__kicker">This event on the tree</span>
        {names.length > 0 && (
          <div className="bloodline-focus-strip__pills">
            {names.map(({ id, label }) => (
              <span key={id} className="bloodline-focus-strip__pill">
                {label}
              </span>
            ))}
          </div>
        )}
        {pathNames.length > 0 && (
          <p className="bloodline-focus-strip__path" title={pathNames.join(' → ')}>
            Path: {pathNames.join(' → ')}
          </p>
        )}
        {description ? <p className="bloodline-focus-strip__desc">{description}</p> : null}
      </div>
    </div>
  );
}
