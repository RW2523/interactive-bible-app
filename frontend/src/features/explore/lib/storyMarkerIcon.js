import L from 'leaflet';
import { getIcon } from './eventIcons.js';
import { BIBLE_SPRITE_VARIANT, getBibleEventSpriteStyleAttr } from '../utils/bibleEventSprites.js';

/* Map pins are Leaflet divIcons (plain HTML strings). Colours come from the Explore theme variables in styles.css,
   so the same icon works on every basemap and in light and dark mode. */

const cache = new Map();
const MAX_CACHE = 240;

function remember(key, icon) {
  cache.set(key, icon);
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return icon;
}

function artHtml(event, className) {
  const order = typeof event.order === 'number' && event.order >= 1 && event.order <= 50 ? event.order : null;
  if (order == null) return `<span class="${className} ${className}--emoji" aria-hidden="true">${getIcon(event.mapIcon)}</span>`;
  const [w, h] = BIBLE_SPRITE_VARIANT.pin;
  return `<span class="${className}" aria-hidden="true"><span class="${className}-fill" style="${getBibleEventSpriteStyleAttr(order, w, h)}"></span></span>`;
}

/**
 * One event pin: a round illustrated badge with the event number.
 * @param {{ id: string; mapIcon?: string; order?: number; title?: string }} event
 * @param {boolean} isSelected
 * @param {boolean} [isMuted] — de-emphasised when an era filter hides it
 */
export function getStoryMarkerIcon(event, isSelected, isMuted = false) {
  const key = `pin:${event.id}:${isSelected ? 1 : 0}:${isMuted ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cls = ['x-pin', isSelected ? 'x-pin--selected' : '', isMuted ? 'x-pin--muted' : ''].filter(Boolean).join(' ');
  const num = event.order != null ? `<span class="x-pin__num" aria-hidden="true">${escapeHtml(String(event.order))}</span>` : '';
  return remember(key, L.divIcon({
    className: 'x-pin-host',
    html: `<span class="${cls}">${artHtml(event, 'x-pin__art')}${num}</span>`,
    iconSize: [44, 50],
    iconAnchor: [22, 48],
    popupAnchor: [0, -46],
    tooltipAnchor: [0, -44],
  }));
}

/**
 * A group of pins that would overlap at the current zoom: a numbered bubble. With `plus`, a small "+N" badge that sits
 * at the top-right of the selected pin for the pins hidden under it.
 * @param {{ id: string; order?: number; mapIcon?: string }[]} events
 * @param {boolean} [isMuted]
 * @param {boolean} [plus]
 */
export function getClusterIcon(events, isMuted = false, plus = false) {
  const key = `cluster:${plus ? 'plus:' : ''}${events.map((e) => e.id).join(',')}:${isMuted ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (plus) {
    return remember(key, L.divIcon({
      className: 'x-pin-host',
      html: `<span class="x-cluster x-cluster--plus"><span class="x-cluster__count">+${events.length}</span></span>`,
      iconSize: [38, 26],
      iconAnchor: [-28, 64],
      tooltipAnchor: [0, 0],
    }));
  }
  const cls = ['x-cluster', isMuted ? 'x-cluster--muted' : ''].filter(Boolean).join(' ');
  return remember(key, L.divIcon({
    className: 'x-pin-host',
    html: `<span class="${cls}"><span class="x-cluster__count">${events.length}</span></span>`,
    iconSize: [50, 50],
    iconAnchor: [25, 25],
    popupAnchor: [0, -22],
    tooltipAnchor: [0, -24],
  }));
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
