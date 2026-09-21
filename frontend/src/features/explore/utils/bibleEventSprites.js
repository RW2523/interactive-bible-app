/**
 * Bible event icon sheets: 5 files × 10 icons (orders 1–50), 5×2 grid per sheet.
 * Coordinates are defined on the original 1254×1254 export; scale when using other file sizes.
 */

/** Loaded image pixel width/height (square). Change to 1024 if assets are resized. */
export const SPRITE_SHEET_SIZE = 1024;

/** Reference coordinate system for ICON_GRID (original generated artboard). */
export const BASE_SHEET_SIZE = 1254;

/** First icon tile top-left and stride on BASE_SHEET_SIZE (excludes sheet title area). */
export const ICON_GRID = {
  left: 36,
  top: 294,
  tileW: 216,
  tileH: 300,
  stepX: 240,
  stepY: 432
};

const COLS = 5;
const ROWS = 2;

const SHEETS = [
  '/bible-event-icons/sheet-01-10.png',
  '/bible-event-icons/sheet-11-20.png',
  '/bible-event-icons/sheet-21-30.png',
  '/bible-event-icons/sheet-31-40.png',
  '/bible-event-icons/sheet-41-50.png'
];

/** @type {Record<string, [number, number]>} */
export const BIBLE_SPRITE_VARIANT = {
  list: [44, 44],
  popover: [52, 52],
  strip: [40, 40],
  pin: [36, 36],
  drawer: [56, 56],
  hero: [72, 72]
};

/** @deprecated Use BIBLE_SPRITE_VARIANT — kept for existing imports */
export const BIBLE_SPRITE_BOX = BIBLE_SPRITE_VARIANT;

function r4(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

/**
 * @param {number} order 1–50
 * @returns {{ sheet: number; col: number; row: number } | null}
 */
export function getBibleEventSpriteCell(order) {
  if (typeof order !== 'number' || !Number.isFinite(order) || order < 1 || order > 50) return null;
  const z = order - 1;
  const sheet = Math.floor(z / 10);
  const i = z % 10;
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  if (row >= ROWS) return null;
  return { sheet, col, row };
}

/**
 * Pixel rect of one icon on the **current** sheet size (after scale from BASE).
 */
function cellRectScaled(col, row) {
  const k = SPRITE_SHEET_SIZE / BASE_SHEET_SIZE;
  const cellLeft = (ICON_GRID.left + col * ICON_GRID.stepX) * k;
  const cellTop = (ICON_GRID.top + row * ICON_GRID.stepY) * k;
  const cellW = ICON_GRID.tileW * k;
  const cellH = ICON_GRID.tileH * k;
  return { cellLeft, cellTop, cellW, cellH };
}

/**
 * Cover-style CSS background sprite for one event icon.
 * @param {number} order 1–50
 * @param {number} boxW
 * @param {number} boxH
 * @returns {import('react').CSSProperties | null}
 */
export function getBibleEventSpriteStyle(order, boxW, boxH) {
  const cell = getBibleEventSpriteCell(order);
  if (!cell) return null;
  if (typeof boxW !== 'number' || typeof boxH !== 'number' || boxW < 8 || boxH < 8) return null;

  const { sheet, col, row } = cell;
  const { cellLeft, cellTop, cellW, cellH } = cellRectScaled(col, row);
  const sheetPx = SPRITE_SHEET_SIZE;

  const sCover = Math.max(boxW / cellW, boxH / cellH);
  const bgW = r4(sheetPx * sCover);
  const bgH = r4(sheetPx * sCover);
  const scaledCellW = r4(cellW * sCover);
  const scaledCellH = r4(cellH * sCover);
  const offsetX = r4((boxW - scaledCellW) / 2);
  const offsetY = r4((boxH - scaledCellH) / 2);
  const posX = r4(-cellLeft * sCover + offsetX);
  const posY = r4(-cellTop * sCover + offsetY);

  return {
    width: r4(boxW),
    height: r4(boxH),
    display: 'block',
    overflow: 'hidden',
    backgroundColor: 'transparent',
    backgroundImage: `url(${SHEETS[sheet]})`,
    backgroundSize: `${bgW}px ${bgH}px`,
    backgroundPosition: `${posX}px ${posY}px`,
    backgroundRepeat: 'no-repeat',
    backgroundOrigin: 'border-box'
  };
}

/**
 * @param {number} order
 * @param {'list' | 'popover' | 'strip' | 'pin' | 'drawer' | 'hero'} variant
 */
export function getBibleEventSpriteStyleForVariant(order, variant) {
  const key = variant && BIBLE_SPRITE_VARIANT[variant] ? variant : 'list';
  const [w, h] = BIBLE_SPRITE_VARIANT[key];
  return getBibleEventSpriteStyle(order, w, h);
}

/**
 * Inline `style=""` for Leaflet divIcon HTML (no single quotes in values).
 * @param {number} order
 * @param {number} boxW
 * @param {number} boxH
 */
export function getBibleEventSpriteStyleAttr(order, boxW, boxH) {
  const s = getBibleEventSpriteStyle(order, boxW, boxH);
  if (!s) return '';
  const bi = String(s.backgroundImage).replace(/'/g, '%27');
  return [
    `width:${s.width}px`,
    `height:${s.height}px`,
    `display:block`,
    `overflow:hidden`,
    `background-color:transparent`,
    `background-image:${bi}`,
    `background-size:${s.backgroundSize}`,
    `background-position:${s.backgroundPosition}`,
    'background-repeat:no-repeat',
    'background-origin:border-box'
  ].join(';');
}
