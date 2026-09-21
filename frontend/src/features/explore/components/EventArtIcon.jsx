import React from 'react';
import BibleEventSprite from './BibleEventSprite.jsx';

/**
 * @param {{ order?: number; mapIcon?: string; variant?: 'list' | 'popover' | 'strip' | 'drawer' | 'hero' }} props
 */
export default function EventArtIcon({ order, mapIcon, variant = 'list' }) {
  return <BibleEventSprite order={order} mapIcon={mapIcon} variant={variant} />;
}
