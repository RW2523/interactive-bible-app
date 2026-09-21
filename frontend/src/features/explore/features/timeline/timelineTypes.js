/**
 * @typedef {object} TimelineDate
 * @property {string} [label]
 * @property {string} [kind]
 * @property {number|null} [year]
 * @property {string|null} [era]
 * @property {number} sortYear
 * @property {boolean} [approximate]
 */

/**
 * @typedef {object} TimelineEvent
 * @property {string} id
 * @property {number} [order]
 * @property {TimelineDate} [date]
 * @property {string} dateLabel
 * @property {string} title
 * @property {string} [section]
 * @property {string} [scriptureTestament]
 * @property {string} eraGroup
 * @property {string} [referenceText]
 * @property {string[]} [references]
 * @property {string[]} [rawLines]
 * @property {{ importance: string; category: string; mapEventId: string|null; iconOrder: number|null }} [_computed]
 */

/**
 * @typedef {object} TimelineBundle
 * @property {string} schemaVersion
 * @property {{ eventCount?: number }} [metadata]
 * @property {{ name: string; eventCount?: number }[]} [eraGroups]
 * @property {TimelineEvent[]} events
 */

export {};
