/**
 * classicJourneys.js
 * Illustrative multi-stop biblical journey routes (educational, not surveyed).
 * Inspired by Oxford Bible Atlas and ESV Bible Atlas corridor diagrams.
 *
 * Each entry:
 *   id        – unique string
 *   label     – display name
 *   testament – 'OT' | 'NT' | 'BOTH'
 *   path      – [lat, lng][] waypoints
 *   color     – stroke colour
 *   dashArray – SVG dash pattern
 *   weight    – stroke width (px)
 *   opacity   – 0-1
 */

export const CLASSIC_JOURNEYS = [

  // ════════════════════════════════════════════════════════════════
  //  OLD TESTAMENT
  // ════════════════════════════════════════════════════════════════

  {
    id: 'abraham',
    label: 'Abraham — Ur → Haran → Canaan (Gen 12)',
    testament: 'OT',
    path: [
      [30.96, 46.10],   // Ur (Mesopotamia)
      [32.80, 42.50],   // Crossing Euphrates
      [36.86, 39.03],   // Haran
      [35.20, 37.80],   // Through Syria
      [32.21, 35.28],   // Shechem (Canaan)
      [31.93, 35.22],   // Bethel
      [29.98, 31.13],   // Egypt (famine trip)
      [31.25, 34.79],   // Return → Beersheba
      [31.78, 35.24],   // Jerusalem/Moriah
    ],
    color: '#b45309',
    dashArray: '8 10',
    weight: 3,
    opacity: 0.82
  },

  {
    id: 'jacob_egypt',
    label: 'Jacob — Canaan → Egypt (Gen 46)',
    testament: 'OT',
    path: [
      [31.25, 34.79],   // Beersheba
      [30.68, 34.43],   // Kadesh (Negev)
      [30.42, 33.60],   // Sinai crossing
      [29.98, 31.13],   // Egypt / Goshen
    ],
    color: '#d97706',
    dashArray: '5 9',
    weight: 2.5,
    opacity: 0.75
  },

  {
    id: 'exodus',
    label: 'Exodus — Egypt → Sinai → Canaan (Exod 12–Josh 3)',
    testament: 'OT',
    path: [
      [30.72, 31.75],   // Goshen / Rameses
      [30.45, 32.35],   // Succoth
      [30.05, 33.05],   // Etham
      [29.35, 33.95],   // Wilderness of Sin
      [29.05, 34.62],   // Red Sea crossing (Gulf of Aqaba)
      [28.72, 33.85],   // Wilderness of Paran
      [28.54, 33.98],   // Mt Sinai / Horeb
      [29.05, 34.35],   // Ezion-Geber
      [30.68, 34.43],   // Kadesh-Barnea
      [30.88, 34.82],   // Wilderness of Zin
      [31.18, 35.70],   // Moab plains
      [31.84, 35.55],   // Jordan crossing
    ],
    color: '#1f6f54',
    dashArray: '10 14',
    weight: 3.5,
    opacity: 0.85
  },

  {
    id: 'david_flight',
    label: "David's flight from Saul (1 Sam 21-24)",
    testament: 'OT',
    path: [
      [31.83, 35.28],   // Jerusalem/Nob
      [31.73, 35.10],   // Adullam cave
      [31.52, 35.10],   // Mizpeh (Moab)
      [31.68, 34.96],   // Forest of Hereth
      [31.25, 34.79],   // Beersheba area
      [31.55, 35.12],   // Wilderness of Ziph
      [31.47, 35.28],   // En-gedi
    ],
    color: '#6366f1',
    dashArray: '4 7',
    weight: 2,
    opacity: 0.70
  },

  {
    id: 'exile_babylon',
    label: 'Exile — Judah → Babylon (2 Kgs 25)',
    testament: 'OT',
    path: [
      [31.78, 35.24],   // Jerusalem
      [33.51, 36.29],   // Damascus
      [34.80, 39.20],   // Palmyra crossing
      [33.10, 42.00],   // Along Euphrates
      [32.54, 44.42],   // Babylon
    ],
    color: '#7c3aed',
    dashArray: '6 10',
    weight: 3,
    opacity: 0.78
  },

  {
    id: 'return_exile',
    label: "Return from Exile — Ezra / Nehemiah (Ezra 7)",
    testament: 'OT',
    path: [
      [32.19, 48.26],   // Susa (Persia)
      [32.54, 44.42],   // Babylon
      [33.10, 42.00],   // Along Euphrates
      [34.80, 39.20],   // Palmyra
      [33.51, 36.29],   // Damascus
      [31.78, 35.24],   // Jerusalem
    ],
    color: '#1a4340',
    dashArray: '8 12',
    weight: 2.5,
    opacity: 0.72
  },

  // ════════════════════════════════════════════════════════════════
  //  NEW TESTAMENT
  // ════════════════════════════════════════════════════════════════

  {
    id: 'jesus_birth_egypt',
    label: 'Holy Family — Bethlehem → Egypt → Nazareth (Matt 2)',
    testament: 'NT',
    path: [
      [31.71, 35.20],   // Bethlehem
      [31.78, 35.24],   // Jerusalem (Magi visit)
      [30.42, 33.60],   // Route through Sinai
      [29.98, 31.13],   // Egypt
      [30.42, 33.60],   // Return through Sinai
      [32.70, 35.30],   // Nazareth
    ],
    color: '#f59e0b',
    dashArray: '5 8',
    weight: 2,
    opacity: 0.75
  },

  {
    id: 'jesus_ministry_galilee',
    label: "Jesus's Galilean Ministry (Matt 4 – Luke 9)",
    testament: 'NT',
    path: [
      [32.70, 35.30],   // Nazareth
      [32.88, 35.55],   // Sea of Galilee (Capernaum)
      [32.72, 35.58],   // Sea shore ministry
      [32.79, 35.58],   // Chorazin / Bethsaida
      [32.69, 35.51],   // Tiberias
      [32.88, 35.55],   // Capernaum (return)
      [32.80, 35.08],   // Cana
      [32.70, 35.30],   // Nazareth (rejected)
      [32.73, 35.05],   // Nain
      [33.00, 35.38],   // Tyre region
      [32.88, 35.55],   // Back to Galilee
    ],
    color: '#06b6d4',
    dashArray: '6 8',
    weight: 2.5,
    opacity: 0.80
  },

  {
    id: 'jesus_jerusalem_ministry',
    label: "Jesus — Galilee → Samaria → Jerusalem (Luke 9-19)",
    testament: 'NT',
    path: [
      [32.88, 35.55],   // Capernaum
      [32.21, 35.28],   // Samaria / Sychar (Well)
      [31.86, 35.45],   // Jericho (Zacchaeus)
      [31.78, 35.24],   // Jerusalem (Temple)
      [31.76, 35.27],   // Mount of Olives
      [31.71, 35.20],   // Bethany
    ],
    color: '#ec4899',
    dashArray: '7 9',
    weight: 2.5,
    opacity: 0.80
  },

  {
    id: 'paul_journey_1',
    label: "Paul — 1st Missionary Journey (Acts 13-14)",
    testament: 'NT',
    path: [
      [36.20, 36.16],   // Antioch (Syria)
      [36.78, 34.58],   // Seleucia → Cyprus
      [35.12, 33.32],   // Salamis (Cyprus)
      [34.67, 32.99],   // Paphos (Cyprus)
      [36.90, 30.68],   // Perga (Pamphylia)
      [37.86, 30.55],   // Antioch (Pisidia)
      [37.98, 31.48],   // Iconium
      [37.57, 32.48],   // Lystra
      [37.98, 31.48],   // Derbe → return
      [36.20, 36.16],   // Back to Antioch
    ],
    color: '#1a4d6e',
    dashArray: '5 8',
    weight: 2.5,
    opacity: 0.78
  },

  {
    id: 'paul_journey_2',
    label: "Paul — 2nd Missionary Journey (Acts 15:36-18:22)",
    testament: 'NT',
    path: [
      [36.20, 36.16],   // Antioch (Syria)
      [37.57, 32.48],   // Derbe / Lystra
      [39.78, 32.50],   // Ancyra (Galatia)
      [38.42, 27.14],   // Troas
      [40.62, 22.94],   // Philippi (Macedonia)
      [40.63, 22.94],   // Thessalonica
      [40.52, 22.95],   // Berea
      [37.98, 23.73],   // Athens
      [37.94, 22.93],   // Corinth (18 months)
      [37.90, 27.36],   // Ephesus
      [36.20, 36.16],   // Return to Antioch
    ],
    color: '#0d9488',
    dashArray: '4 7',
    weight: 2.5,
    opacity: 0.72
  },

  {
    id: 'paul_journey_3',
    label: "Paul — 3rd Missionary Journey (Acts 18:23-21:17)",
    testament: 'NT',
    path: [
      [36.20, 36.16],   // Antioch
      [37.86, 30.55],   // Galatia / Phrygia
      [37.90, 27.36],   // Ephesus (2+ years)
      [40.93, 28.95],   // Troas
      [40.62, 22.94],   // Macedonia
      [37.98, 23.73],   // Athens
      [37.94, 22.93],   // Corinth
      [38.42, 27.14],   // Troas
      [39.17, 26.52],   // Assos / Miletus
      [36.78, 34.58],   // Caesarea (Maritima)
      [31.78, 35.24],   // Jerusalem
    ],
    color: '#7c3aed',
    dashArray: '4 8',
    weight: 2.5,
    opacity: 0.70
  },

  {
    id: 'paul_rome',
    label: "Paul — Journey to Rome (Acts 27-28)",
    testament: 'NT',
    path: [
      [32.50, 34.90],   // Caesarea Maritima
      [33.88, 35.51],   // Sidon
      [36.78, 34.58],   // Myra (Lycia)
      [35.36, 23.59],   // Crete (Fair Havens)
      [36.03, 14.24],   // Malta (shipwreck)
      [37.52, 15.09],   // Syracuse (Sicily)
      [40.90, 14.25],   // Puteoli
      [41.90, 12.50],   // Rome
    ],
    color: '#dc2626',
    dashArray: '3 7',
    weight: 2.5,
    opacity: 0.72
  },
];
