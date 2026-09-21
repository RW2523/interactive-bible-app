/**
 * biblicalRegions.js
 * Simplified educational polygons for ancient biblical kingdoms and regions.
 * Coordinates are WGS84 [lat, lng] — approximate and intended for atlas-style
 * overview maps at zoom 5-9. Not surveyed archaeology.
 *
 * Sources / inspiration: Oxford Bible Atlas, ESV Bible Atlas, BibleMapper.com
 */

/**
 * @typedef {{ id: string, name: string, subtext: string, color: string,
 *   fillOpacity: number, weight: number, labelPos: [number,number],
 *   coords: [number,number][] }} BibleRegion
 */

/** @type {BibleRegion[]} */
export const BIBLICAL_REGIONS = [

  // ── Canaan / Holy Land sub-regions ────────────────────────────────────────

  {
    id: 'galilee',
    name: 'Galilee',
    subtext: "Region of Jesus's ministry (Matt 4:12-17)",
    color: '#3b82f6',
    fillOpacity: 0.10,
    weight: 1.8,
    labelPos: [32.87, 35.28],
    coords: [
      [33.25, 34.90], [33.35, 35.10], [33.30, 35.65],
      [33.05, 35.85], [32.68, 35.72], [32.56, 35.38],
      [32.50, 35.06], [32.68, 34.94], [33.00, 34.87], [33.25, 34.90]
    ]
  },

  {
    id: 'samaria',
    name: 'Samaria',
    subtext: 'Northern Kingdom — fell to Assyria 722 BC',
    color: '#f59e0b',
    fillOpacity: 0.09,
    weight: 1.8,
    labelPos: [32.18, 35.18],
    coords: [
      [32.50, 35.06], [32.56, 35.38], [32.68, 35.72],
      [32.48, 35.65], [32.10, 35.68], [31.88, 35.52],
      [31.82, 35.08], [31.98, 34.92], [32.28, 34.88], [32.50, 35.06]
    ]
  },

  {
    id: 'judea',
    name: 'Judea / Judah',
    subtext: 'Southern Kingdom — Jerusalem, Bethlehem, Hebron',
    color: '#c9a84c',
    fillOpacity: 0.10,
    weight: 1.8,
    labelPos: [31.55, 34.98],
    coords: [
      [31.88, 35.08], [31.82, 35.52], [32.10, 35.68],
      [31.85, 35.75], [31.48, 35.62], [31.18, 35.42],
      [31.00, 35.10], [31.08, 34.76], [31.38, 34.56],
      [31.68, 34.68], [31.88, 35.08]
    ]
  },

  {
    id: 'perea',
    name: 'Perea',
    subtext: 'Transjordan — "beyond the Jordan"',
    color: '#84cc16',
    fillOpacity: 0.07,
    weight: 1.5,
    labelPos: [31.80, 35.92],
    coords: [
      [31.88, 35.52], [32.10, 35.68], [32.10, 36.22],
      [31.85, 36.40], [31.45, 36.30], [31.00, 35.90],
      [31.00, 35.65], [31.18, 35.42], [31.48, 35.62],
      [31.85, 35.75], [31.88, 35.52]
    ]
  },

  {
    id: 'philistia',
    name: 'Philistia',
    subtext: 'Five cities: Gaza, Ashkelon, Ashdod, Ekron, Gath',
    color: '#ef4444',
    fillOpacity: 0.09,
    weight: 1.8,
    labelPos: [31.60, 34.44],
    coords: [
      [31.00, 34.26], [31.50, 34.18], [31.90, 34.42],
      [31.92, 34.72], [31.68, 34.68], [31.38, 34.56],
      [31.08, 34.76], [31.00, 34.26]
    ]
  },

  {
    id: 'phoenicia',
    name: 'Phoenicia',
    subtext: 'Tyre and Sidon — seafaring traders (1 Kgs 5)',
    color: '#8b5cf6',
    fillOpacity: 0.09,
    weight: 1.8,
    labelPos: [33.45, 35.12],
    coords: [
      [33.25, 34.90], [33.00, 34.87], [32.68, 34.94],
      [32.75, 34.52], [33.28, 34.38], [33.68, 34.98],
      [33.62, 35.52], [33.38, 35.65], [33.25, 34.90]
    ]
  },

  {
    id: 'edom',
    name: 'Edom / Idumea',
    subtext: 'Descendants of Esau — Petra region',
    color: '#b45309',
    fillOpacity: 0.08,
    weight: 1.5,
    labelPos: [30.42, 35.50],
    coords: [
      [31.00, 35.10], [31.18, 35.42], [31.00, 35.65],
      [30.68, 35.60], [30.22, 35.22], [29.85, 35.00],
      [29.52, 34.80], [29.82, 34.48], [30.28, 34.48],
      [30.60, 34.68], [31.00, 35.10]
    ]
  },

  {
    id: 'moab',
    name: 'Moab',
    subtext: 'Plateau east of Dead Sea — Ruth 1:1-2',
    color: '#d97706',
    fillOpacity: 0.08,
    weight: 1.5,
    labelPos: [31.28, 35.85],
    coords: [
      [31.85, 35.75], [32.10, 35.68], [32.10, 36.22],
      [31.85, 36.40], [31.45, 36.30], [31.00, 35.90],
      [31.00, 35.65], [31.48, 35.62], [31.85, 35.75]
    ]
  },

  {
    id: 'ammon',
    name: 'Ammon',
    subtext: 'Ammonites — capital Rabbah (modern Amman)',
    color: '#10b981',
    fillOpacity: 0.08,
    weight: 1.5,
    labelPos: [32.08, 36.28],
    coords: [
      [32.10, 35.68], [32.50, 35.65], [32.58, 35.38],
      [32.80, 35.80], [32.60, 36.52], [32.30, 36.82],
      [31.85, 36.40], [32.10, 36.22], [32.10, 35.68]
    ]
  },

  {
    id: 'aram_damascus',
    name: 'Aram / Syria',
    subtext: 'Damascus — rival kingdom of Israel',
    color: '#6366f1',
    fillOpacity: 0.07,
    weight: 1.5,
    labelPos: [33.52, 36.65],
    coords: [
      [33.25, 35.65], [33.38, 35.65], [33.62, 35.52],
      [33.68, 34.98], [33.90, 35.48], [34.22, 36.02],
      [34.12, 36.62], [33.60, 37.22], [33.10, 36.82],
      [32.80, 36.52], [32.80, 35.80], [33.00, 35.52], [33.25, 35.65]
    ]
  },

  {
    id: 'bashan_gilead',
    name: 'Bashan / Gilead',
    subtext: 'Transjordanian highlands — Golan region',
    color: '#059669',
    fillOpacity: 0.07,
    weight: 1.5,
    labelPos: [32.72, 36.12],
    coords: [
      [32.58, 35.38], [32.80, 35.80], [33.00, 35.52],
      [33.25, 35.65], [33.25, 34.90], [33.00, 34.87],
      [32.68, 34.94], [32.56, 35.38], [32.58, 35.38]
    ]
  },

  // ── Egypt ─────────────────────────────────────────────────────────────────

  {
    id: 'egypt_goshen',
    name: 'Egypt / Goshen',
    subtext: "Israel's slavery — Nile Delta (Exod 1:11)",
    color: '#f59e0b',
    fillOpacity: 0.08,
    weight: 1.5,
    labelPos: [30.52, 31.42],
    coords: [
      [31.52, 30.48], [31.62, 31.02], [31.50, 32.02],
      [30.98, 32.50], [30.50, 32.28], [30.00, 31.98],
      [29.50, 31.30], [29.50, 30.48], [30.02, 30.00],
      [30.80, 29.80], [31.52, 30.48]
    ]
  },

  // ── Sinai Peninsula ───────────────────────────────────────────────────────

  {
    id: 'sinai',
    name: 'Sinai Wilderness',
    subtext: '40 years wandering — Mt Sinai / Horeb (Exod 19)',
    color: '#84cc16',
    fillOpacity: 0.06,
    weight: 1.4,
    labelPos: [29.45, 33.60],
    coords: [
      [30.00, 32.00], [30.98, 32.50], [31.10, 33.50],
      [30.52, 34.52], [29.80, 34.90], [28.28, 34.58],
      [27.88, 33.62], [28.22, 32.52], [29.50, 32.28], [30.00, 32.00]
    ]
  },

  // ── Great Empires ─────────────────────────────────────────────────────────

  {
    id: 'assyria',
    name: 'Assyria',
    subtext: 'Northern empire — exiled Israel 722 BC (2 Kgs 17)',
    color: '#dc2626',
    fillOpacity: 0.06,
    weight: 1.4,
    labelPos: [36.52, 42.45],
    coords: [
      [35.50, 40.00], [36.02, 38.48], [37.02, 38.00],
      [37.80, 39.52], [37.48, 41.52], [37.20, 43.02],
      [36.50, 44.02], [35.50, 43.52], [35.00, 42.52],
      [34.80, 41.02], [35.50, 40.00]
    ]
  },

  {
    id: 'babylon',
    name: 'Babylon',
    subtext: 'Empire of exile 605–539 BC (Dan 1:1)',
    color: '#7c3aed',
    fillOpacity: 0.06,
    weight: 1.4,
    labelPos: [33.00, 44.52],
    coords: [
      [34.80, 42.52], [35.00, 43.52], [35.50, 44.02],
      [35.00, 45.52], [34.00, 46.52], [32.50, 47.02],
      [31.00, 46.52], [30.50, 44.52], [31.52, 43.02],
      [33.00, 42.00], [34.80, 42.52]
    ]
  },

  {
    id: 'persia',
    name: 'Persia',
    subtext: "Cyrus's decree freed exiles 539 BC (Ezra 1:1-4)",
    color: '#0891b2',
    fillOpacity: 0.04,
    weight: 1.3,
    labelPos: [33.00, 51.00],
    coords: [
      [36.00, 44.00], [37.02, 45.02], [37.52, 47.02],
      [38.00, 50.00], [36.52, 53.52], [34.52, 56.02],
      [31.52, 56.02], [28.00, 53.00], [26.00, 50.00],
      [27.02, 46.02], [29.00, 44.00], [31.52, 43.02],
      [32.50, 44.00], [35.00, 44.52], [36.00, 44.00]
    ]
  },
];

/** Bodies of water (rendered as blue-fill polygons) */
export const WATER_BODIES = [
  {
    id: 'dead_sea',
    name: 'Dead Sea',
    color: '#1d4ed8',
    fillOpacity: 0.35,
    weight: 1,
    labelPos: [31.50, 35.48],
    coords: [
      [31.78, 35.40], [31.82, 35.55], [31.70, 35.60],
      [31.50, 35.58], [31.20, 35.52], [31.00, 35.45],
      [31.05, 35.38], [31.25, 35.35], [31.55, 35.38], [31.78, 35.40]
    ]
  },
  {
    id: 'sea_of_galilee',
    name: 'Sea of Galilee',
    color: '#1d4ed8',
    fillOpacity: 0.38,
    weight: 1,
    labelPos: [32.82, 35.60],
    coords: [
      [32.92, 35.53], [32.90, 35.65], [32.82, 35.68],
      [32.70, 35.65], [32.68, 35.55], [32.74, 35.50],
      [32.85, 35.50], [32.92, 35.53]
    ]
  },
  {
    id: 'jordan_river',
    name: 'Jordan River',
    color: '#1d4ed8',
    fillOpacity: 0.0,
    weight: 2.5,
    labelPos: [32.10, 35.53],
    // Rendered as a path not polygon — special case
    coords: [
      [33.00, 35.58], [32.88, 35.62], [32.72, 35.54],
      [32.40, 35.55], [32.10, 35.54], [31.88, 35.52],
      [31.78, 35.45], [31.50, 35.52], [31.25, 35.42]
    ]
  }
];
