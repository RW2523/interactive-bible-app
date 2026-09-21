import { getMapEventIdForTimelineEvent } from './timelineToMapEventMap.js';

/**
 * Lineage modal uses Journey Map `selectedEventId` (bibleEvents id).
 * @param {string} timelineEventId
 * @param {string} [title]
 * @returns {{ mapEventId: string|null }}
 */
export function getLineageContextForTimeline(timelineEventId, title = '') {
  return { mapEventId: getMapEventIdForTimelineEvent(timelineEventId, title) };
}
