/**
 * Approximate coordinates for Bible Journey Map (educational placement).
 * Many sites are debated; anchors follow common atlas conventions.
 */

/** @type {Record<string, [number, number]>} */
export const PLACE_COORDS = {
  ur: [30.962, 46.103],
  haran: [36.86, 39.031],
  canaan: [31.78, 35.22],
  egypt: [29.979, 31.134],
  goshen: [30.72, 31.75],
  'red sea': [29.05, 34.62],
  sinai: [28.539, 33.975],
  horeb: [28.539, 33.975],
  moab: [31.18, 35.7],
  babylon: [32.543, 44.421],
  jerusalem: [31.778, 35.235],
  hebron: [31.524, 35.096],
  bethlehem: [31.705, 35.202],
  jericho: [31.859, 35.464],
  shiloh: [32.056, 35.29],
  shechem: [32.213, 35.282],
  samaria: [32.277, 35.192],
  'mount carmel': [32.732, 35.052],
  tabor: [32.687, 35.39],
  gaza: [31.507, 34.456],
  susa: [32.194, 48.257],
  persia: [32.194, 48.257],
  'mount moriah': [31.7776, 35.2353],
  beersheba: [31.253, 34.791],
  bethel: [31.93, 35.222],
  peniel: [32.04, 35.72],
  jordan: [31.837, 35.549],
  kadesh: [30.68, 34.43],
  mizpah: [31.829, 35.282],
  jezreel: [32.564, 35.329],
  kishon: [32.55, 35.08],
  midian: [28.25, 35.0],
  galilee: [32.88, 35.55],
  wilderness: [31.2, 35.35],
  eden: [30.76, 47.78],
  ararat: [39.702, 44.298],
  babel: [32.543, 44.421],
  shinar: [32.543, 44.421],
  mesopotamia: [33.315, 44.366],
  memphis: [29.84, 31.25],
  'sea of reeds': [30.85, 32.3],
  elah: [31.676, 34.959],
  gilgal: [31.85, 35.45]
};

function normalizePlaceKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} name
 * @returns {{ lat: number, lng: number } | null}
 */
export function latLngForPlaceName(name) {
  const key = normalizePlaceKey(name);
  if (!key) return null;
  if (PLACE_COORDS[key]) {
    const [lat, lng] = PLACE_COORDS[key];
    return { lat, lng };
  }
  const compact = key.replace(/\s+/g, '');
  for (const [k, v] of Object.entries(PLACE_COORDS)) {
    if (k.replace(/\s+/g, '') === compact) {
      const [lat, lng] = v;
      return { lat, lng };
    }
  }
  return null;
}

/** Primary marker per event id (WGS84). */
const EVENT_ANCHORS = {
  creation: [30.76, 47.78],
  fall_of_man: [31.85, 35.22],
  cain_and_abel: [31.82, 35.25],
  noahs_ark: [39.702, 44.298],
  tower_of_babel: [32.543, 44.421],
  call_of_abraham: [30.962, 46.103],
  abrahamic_covenant: [32.213, 35.282],
  birth_of_isaac: [31.253, 34.791],
  abraham_tested_with_isaac: [31.7776, 35.2353],
  jacob_receives_blessing: [31.93, 35.222],
  jacob_becomes_israel: [32.04, 35.72],
  joseph_sold_into_egypt: [32.15, 35.28],
  joseph_rises_to_power: [29.84, 31.25],
  israelites_enslaved: [30.72, 31.75],
  burning_bush: [28.539, 33.975],
  ten_plagues_passover: [29.979, 31.134],
  red_sea_crossing: [29.05, 34.62],
  ten_commandments: [28.539, 33.975],
  golden_calf_tabernacle: [28.539, 33.975],
  spies_enter_canaan: [30.68, 34.43],
  joshua_crosses_jordan: [31.837, 35.549],
  fall_of_jericho: [31.859, 35.464],
  land_divided: [32.213, 35.282],
  judges_period_begins: [32.2, 35.2],
  deborah_and_barak: [32.578, 35.182],
  gideon_defeats_midian: [32.55, 35.35],
  samson_and_philistines: [31.507, 34.456],
  ruth_and_boaz: [31.705, 35.202],
  samuel_called: [32.056, 35.29],
  saul_first_king: [31.829, 35.282],
  david_and_goliath: [31.676, 34.959],
  david_king_jerusalem: [31.778, 35.235],
  davidic_covenant: [31.778, 35.235],
  solomon_builds_temple: [31.778, 35.235],
  kingdom_divides: [32.213, 35.282],
  elijah_mount_carmel: [32.732, 35.052],
  elishas_ministry: [31.85, 35.45],
  assyria_conquers_israel: [32.277, 35.192],
  hezekiah_jerusalem_delivered: [31.778, 35.235],
  josiahs_reform: [31.778, 35.235],
  babylon_destroys_jerusalem: [31.778, 35.235],
  daniel_in_babylon: [32.543, 44.421],
  esther_saves_jews: [32.194, 48.257],
  return_from_exile: [31.778, 35.235],
  nehemiah_rebuilds_walls: [31.778, 35.235],
  john_baptist_prepares_way: [31.836, 35.54],
  birth_of_jesus: [31.705, 35.202],
  baptism_temptation_jesus: [31.84, 35.55],
  sermon_on_mount: [32.88, 35.55],
  crucifixion_resurrection: [31.778, 35.229]
};

const DEFAULT_CENTER = { lat: 31.5, lng: 35.5 };

/**
 * @param {{ id: string, route?: string[] }} event
 */
export function getEventLatLng(event) {
  const pair = EVENT_ANCHORS[event.id];
  if (pair) {
    return { lat: pair[0], lng: pair[1] };
  }
  const route = event.route || [];
  for (const step of route) {
    const p = latLngForPlaceName(step);
    if (p) return p;
  }
  return DEFAULT_CENTER;
}

function coordBucket(lat, lng, precision = 3) {
  return `${lat.toFixed(precision)}_${lng.toFixed(precision)}`;
}

/**
 * Spread markers that share the same anchor (e.g. many Jerusalem events) in a small ring
 * so all numbered pins remain visible and clickable.
 * @param {{ id: string }} event
 * @param {Array<{ id: string }>} allEvents
 */
export function getEventMarkerPosition(event, allEvents) {
  const base = getEventLatLng(event);
  const key = coordBucket(base.lat, base.lng);
  const same = allEvents.filter((e) => coordBucket(getEventLatLng(e).lat, getEventLatLng(e).lng) === key);
  if (same.length <= 1) return base;
  const sorted = [...same].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const idx = sorted.findIndex((e) => e.id === event.id);
  if (idx < 0) return base;
  const n = sorted.length;
  const radius = 0.014 + Math.min(n * 0.0012, 0.04);
  const angle = (2 * Math.PI * idx) / n - Math.PI / 2;
  return {
    lat: base.lat + radius * Math.sin(angle),
    lng: base.lng + radius * Math.cos(angle)
  };
}

/**
 * @param {{ route?: string[] }} event
 * @returns {Array<[number, number]>}
 */
export function getRouteLatLngs(event) {
  const route = event.route || [];
  const out = [];
  for (const step of route) {
    const p = latLngForPlaceName(step);
    if (p) out.push([p.lat, p.lng]);
  }
  return out;
}

/**
 * @param {Array<{ id: string, route?: string[] }>} events
 */
export function boundsFromEvents(events) {
  const pts = [];
  for (const e of events) {
    const { lat, lng } = getEventLatLng(e);
    pts.push([lat, lng]);
    for (const [la, ln] of getRouteLatLngs(e)) {
      pts.push([la, ln]);
    }
  }
  if (!pts.length) return null;
  let minLat = pts[0][0];
  let maxLat = pts[0][0];
  let minLng = pts[0][1];
  let maxLng = pts[0][1];
  for (const [la, ln] of pts) {
    minLat = Math.min(minLat, la);
    maxLat = Math.max(maxLat, la);
    minLng = Math.min(minLng, ln);
    maxLng = Math.max(maxLng, ln);
  }
  const pad = 0.25;
  if (Math.abs(maxLat - minLat) < 0.08 && Math.abs(maxLng - minLng) < 0.08) {
    return [
      [minLat - pad, minLng - pad],
      [maxLat + pad, maxLng + pad]
    ];
  }
  return [
    [minLat, minLng],
    [maxLat, maxLng]
  ];
}

/**
 * Bounds using dispersed marker positions (matches pins shown on the map).
 * @param {Array<{ id: string; order?: number }>} events
 */
export function boundsFromMarkerDisplay(events) {
  const pts = [];
  for (const e of events) {
    const { lat, lng } = getEventMarkerPosition(e, events);
    pts.push([lat, lng]);
  }
  if (!pts.length) return null;
  let minLat = pts[0][0];
  let maxLat = pts[0][0];
  let minLng = pts[0][1];
  let maxLng = pts[0][1];
  for (const [la, ln] of pts) {
    minLat = Math.min(minLat, la);
    maxLat = Math.max(maxLat, la);
    minLng = Math.min(minLng, ln);
    maxLng = Math.max(maxLng, ln);
  }
  const pad = 0.28;
  if (Math.abs(maxLat - minLat) < 0.1 && Math.abs(maxLng - minLng) < 0.1) {
    return [
      [minLat - pad, minLng - pad],
      [maxLat + pad, maxLng + pad]
    ];
  }
  return [
    [minLat - pad * 0.35, minLng - pad * 0.35],
    [maxLat + pad * 0.35, maxLng + pad * 0.35]
  ];
}
