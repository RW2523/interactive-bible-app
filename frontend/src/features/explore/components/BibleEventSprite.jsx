import React from 'react';
import { getBibleEventSpriteStyleForVariant } from '../utils/bibleEventSprites.js';
import { getIcon } from '../lib/eventIcons.js';

/**
 * @param {{
 *   order?: number;
 *   mapIcon?: string;
 *   variant?: 'list' | 'popover' | 'strip' | 'pin' | 'drawer' | 'hero';
 *   className?: string;
 * }} props
 */
export default function BibleEventSprite({ order, mapIcon, variant = 'list', className = '' }) {
  const sprite =
    typeof order === 'number' && order >= 1 && order <= 50 ? getBibleEventSpriteStyleForVariant(order, variant) : null;

  const extra = className ? ` ${className}` : '';

  if (!sprite) {
    if (variant === 'popover') {
      return <div className={`popover-icon popover-icon--emoji${extra}`}>{getIcon(mapIcon)}</div>;
    }
    if (variant === 'strip') {
      return <span className={`event-popover-strip__icon event-popover-strip__icon--emoji${extra}`}>{getIcon(mapIcon)}</span>;
    }
    if (variant === 'drawer' || variant === 'hero') {
      return (
        <span className={`bible-event-sprite-fallback bible-event-sprite-fallback--${variant}${extra}`} aria-hidden>
          {getIcon(mapIcon)}
        </span>
      );
    }
    return <span className={`event-icon${extra}`}>{getIcon(mapIcon)}</span>;
  }

  if (variant === 'popover') {
    return (
      <div className={`popover-icon popover-icon--art${extra}`} role="img" aria-hidden>
        <span className="popover-icon__fill" style={sprite} />
      </div>
    );
  }

  if (variant === 'strip') {
    return (
      <span className={`event-popover-strip__icon event-popover-strip__icon--art${extra}`} aria-hidden>
        <span className="event-popover-strip__fill" style={sprite} />
      </span>
    );
  }

  if (variant === 'drawer') {
    return (
      <span className={`bible-event-sprite bible-event-sprite--drawer event-icon event-icon--art${extra}`} role="img" aria-hidden>
        <span className="event-icon__fill" style={sprite} />
      </span>
    );
  }

  if (variant === 'hero') {
    return (
      <span className={`bible-event-sprite bible-event-sprite--hero event-icon event-icon--art${extra}`} role="img" aria-hidden>
        <span className="event-icon__fill event-icon__fill--hero" style={sprite} />
      </span>
    );
  }

  if (variant === 'pin') {
    return (
      <span className={`bible-event-sprite bible-event-sprite--pin${extra}`} role="img" aria-hidden>
        <span className="bible-event-sprite__fill" style={sprite} />
      </span>
    );
  }

  return (
    <span className={`event-icon event-icon--art${extra}`} role="img" aria-hidden>
      <span className="event-icon__fill" style={sprite} />
    </span>
  );
}
