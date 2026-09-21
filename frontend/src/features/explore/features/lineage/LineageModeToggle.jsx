import React from 'react';
import { LayoutGrid, Trees } from 'lucide-react';

/**
 * @param {object} props
 * @param {'poster'|'full'} props.view
 * @param {(v: 'poster'|'full') => void} props.onViewChange
 */
export default function LineageModeToggle({ view, onViewChange }) {
  return (
    <div className="bloodline-mode-toggle" role="tablist" aria-label="Bloodline view mode">
      <button
        type="button"
        role="tab"
        aria-selected={view === 'poster'}
        className={`bloodline-mode-toggle__btn ${view === 'poster' ? 'bloodline-mode-toggle__btn--active' : ''}`}
        onClick={() => onViewChange('poster')}
      >
        <Trees size={16} aria-hidden /> Storybook tree
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'full'}
        className={`bloodline-mode-toggle__btn ${view === 'full' ? 'bloodline-mode-toggle__btn--active' : ''}`}
        onClick={() => onViewChange('full')}
      >
        <LayoutGrid size={16} aria-hidden /> Full map
      </button>
    </div>
  );
}
