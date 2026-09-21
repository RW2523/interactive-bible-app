/** Kid-poster milestones (royal / messianic story spine). Order = top → bottom. */
export const POSTER_SPINE_IDS = [
  'adam',
  'seth',
  'noah',
  'terah',
  'abram_abraham',
  'isaac',
  'jacob_israel',
  'judah',
  'boaz',
  'jesse',
  'david',
  'solomon',
  'hezekiah',
  'joseph_3',
  'mary',
  'jesus_messiah'
];

/**
 * Side branches keyed to the spine row they share (anchor = that row’s center person id).
 */
export const POSTER_SIDE_BRANCH = [{ id: 'shem', side: 'left', anchorAfterId: 'noah' }];

/** Extra main figures (must exist in `people`); shown on same row as anchor. */
export const POSTER_EXTRA_BRANCHES = [
  { id: 'moses', anchorAfterId: 'jacob_israel', side: 'right', tag: 'Covenant' },
  { id: 'samuel', anchorAfterId: 'david', side: 'left', tag: 'Prophet' }
];

/** Approximate timeline ticks (visual only); spineIndex indexes into POSTER_SPINE_IDS. */
export const POSTER_TIMELINE = [
  { label: 'Creation', spineIndex: 0 },
  { label: 'Flood', spineIndex: 2 },
  { label: 'Patriarchs', spineIndex: 4 },
  { label: 'Exodus era', spineIndex: 6 },
  { label: 'Kingdom', spineIndex: 10 },
  { label: 'Exile & reform', spineIndex: 12 },
  { label: 'Jesus', spineIndex: 14 }
];

/** Emoji per person id for the poster cards. */
export const POSTER_EMOJI = {
  adam: '🌳',
  seth: '👶',
  noah: '🌈',
  terah: '🛤️',
  shem: '🛶',
  abram_abraham: '⭐',
  isaac: '🔥',
  jacob_israel: '🪜',
  judah: '🦁',
  moses: '📜',
  boaz: '🌾',
  jesse: '🌿',
  david: '🎯',
  samuel: '⚖️',
  solomon: '🏛',
  hezekiah: '☀️',
  joseph_3: '💒',
  mary: '🕊️',
  jesus_messiah: '✨'
};

/** Short tagline + verse hint for poster cards (not exhaustive theology). */
export const POSTER_CARD_COPY = {
  adam: { line: 'First family; covenant story begins.', ref: 'Genesis 2–5' },
  seth: { line: 'Son of Adam in the line toward Noah.', ref: 'Genesis 4:25' },
  noah: { line: 'Walked with God; the flood and new start.', ref: 'Genesis 5–9' },
  terah: { line: 'Father of Abraham; journey toward Canaan.', ref: 'Genesis 11:27–32' },
  shem: { line: 'Son of Noah; line toward Abraham.', ref: 'Genesis 5:32' },
  abram_abraham: { line: 'Friend of God; promise of blessing to all nations.', ref: 'Genesis 12, 17' },
  isaac: { line: 'Child of promise; covenant son.', ref: 'Genesis 21, 22' },
  jacob_israel: { line: 'Renamed Israel; father of twelve tribes.', ref: 'Genesis 25–35' },
  moses: { line: 'Law and Passover; mediator of Sinai covenant.', ref: 'Exodus 2–20' },
  judah: { line: 'Royal tribe; line toward the Messiah.', ref: 'Genesis 49:10' },
  boaz: { line: 'Kinsman-redeemer in Bethlehem.', ref: 'Ruth 2–4' },
  jesse: { line: 'Bethlehemite; father of King David.', ref: 'Ruth 4:17; 1 Sam. 16' },
  david: { line: 'Shepherd king; a man after God’s heart.', ref: '1 Samuel 16' },
  samuel: { line: 'Judge and prophet; anointed David.', ref: '1 Samuel 16:13' },
  solomon: { line: 'Built the temple in Jerusalem.', ref: '1 Kings 1–11' },
  hezekiah: { line: 'Faithful king; reform and trust.', ref: '2 Kings 18–20' },
  joseph_3: { line: 'Husband of Mary (Matthew’s genealogy).', ref: 'Matthew 1:16' },
  mary: { line: 'Mother of Jesus the Messiah.', ref: 'Luke 1–2' },
  jesus_messiah: { line: 'God with us — Savior and King.', ref: 'Matthew 1:21' }
};

/** Spouse names shown like the poster (parentheses). */
export const POSTER_SPOUSE_LABEL = {
  adam: 'Eve',
  abram_abraham: 'Sarah',
  isaac: 'Rebekah',
  boaz: 'Ruth'
};
