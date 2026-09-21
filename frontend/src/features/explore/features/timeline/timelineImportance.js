const MAJOR_TITLE = [
  'creation',
  'fall of man',
  'flood',
  'noah',
  'babel',
  'abraham',
  'covenant',
  'isaac',
  'jacob',
  'israel',
  'joseph',
  'moses',
  'plague',
  'exodus',
  'red sea',
  'commandment',
  'golden calf',
  'spies',
  'jordan',
  'jericho',
  'judge',
  'ruth',
  'samuel',
  'saul',
  'goliath',
  'david',
  'solomon',
  'temple',
  'kingdom divide',
  'elijah',
  'carmel',
  'assyria',
  'jerusalem',
  'daniel',
  'esther',
  'exile',
  'return',
  'nehemiah',
  'john the baptist',
  'birth of jesus',
  'baptism',
  'sermon on the mount',
  'feeding',
  'transfiguration',
  'triumphal',
  'crucifixion',
  'resurrection',
  'ascension',
  'pentecost',
  'stephen',
  'paul',
  'damascus',
  'revelation'
];

/**
 * @param {string} eraGroup
 * @param {string} title
 */
function classifyCategory(eraGroup, title) {
  const e = (eraGroup || '').toLowerCase();
  const t = (title || '').toLowerCase();
  if (t.includes('revelation') || e.includes('revelation')) return 'revelation';
  if (e.includes('early church') || e.includes('apostolic')) return t.match(/paul|peter|john|letter|epistle/i) ? 'letter' : 'church';
  if (e.includes('jesus')) return 'jesus';
  if (e.includes('return') || e.includes('restoration')) return 'return';
  if (e.includes('exile')) return 'exile';
  if (e.includes('divided')) return e.includes('prophet') ? 'prophet' : 'king';
  if (e.includes('united kingdom')) return t.includes('david') || t.includes('solomon') || t.includes('goliath') ? 'king' : 'prophet';
  if (e.includes('judges')) return 'judge';
  if (e.includes('conquest')) return 'judge';
  if (e.includes('wilderness') || e.includes('law')) return t.includes('command') || t.includes('law') ? 'law' : 'exodus';
  if (e.includes('exodus') || e.includes('egypt')) return 'exodus';
  if (e.includes('patriarch')) return 'patriarch';
  if (e.includes('primeval')) return 'creation';
  return 'normal';
}

/**
 * @param {{ title?: string; order?: number; eraGroup?: string; id: string }} event
 * @param {string|null} mapEventId
 * @param {{ id: string; order?: number }[]} [mapEvents]
 */
export function enrichTimelineEvent(event, mapEventId, mapEvents = []) {
  const title = event.title || '';
  const tl = title.toLowerCase();
  let importance = 'normal';
  if (mapEventId) importance = 'major';
  else if (MAJOR_TITLE.some((w) => tl.includes(w))) importance = 'major';
  else if ((event.order ?? 999) <= 40) importance = 'medium';

  const category = classifyCategory(event.eraGroup || '', title);
  let iconOrder = null;
  if (mapEventId && mapEvents.length) {
    const me = mapEvents.find((m) => m.id === mapEventId);
    if (me && typeof me.order === 'number' && me.order >= 1 && me.order <= 50) iconOrder = me.order;
  }
  return {
    ...event,
    _computed: {
      importance,
      category,
      mapEventId,
      iconOrder
    }
  };
}

/**
 * @param {object} event
 * @returns {boolean}
 */
export function isMajorEvent(event) {
  return event?._computed?.importance === 'major';
}
