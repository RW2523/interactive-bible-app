import React, { useEffect, useMemo, useRef } from 'react';
import { Search, SearchX, X } from 'lucide-react';
import EventArtIcon from './EventArtIcon.jsx';
import { EmptyState } from './ExploreUi.jsx';
import { eraLabel, eventMatchesTimelineFilter } from '../lib/timelineEra.js';

export const CATEGORY_COLORS = { travel: 'var(--x-cat-travel)', event: 'var(--x-cat-event)', people: 'var(--x-cat-people)' };

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'travel', label: 'Journeys' },
  { id: 'event', label: 'Events' },
  { id: 'people', label: 'People' }
];

function matchesQuery(e, q) {
  if (!q) return true;
  return [e.title, e.era, e.timelineDate, e.mapLocation, e.summary, ...(e.references || []), ...(e.mainPeople || [])]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

export default function EventList({ events, selectedId, onSelect, query, setQuery, category, setCategory, activeEra, onClearEra }) {
  const listRef = useRef(null);
  const q = query.trim().toLowerCase();

  const base = useMemo(() => events.filter((e) => matchesQuery(e, q) && eventMatchesTimelineFilter(e, activeEra)), [events, q, activeEra]);
  const filtered = useMemo(() => (category === 'all' ? base : base.filter((e) => e.category === category)), [base, category]);
  const counts = useMemo(() => {
    const c = { all: base.length, travel: 0, event: 0, people: 0 };
    for (const e of base) c[e.category] = (c[e.category] || 0) + 1;
    return c;
  }, [base]);

  // keep the selected row in view — only the list scrolls (vertical list on larger screens, carousel on phones)
  const firstRun = useRef(true);
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector(`[data-id="${selectedId}"]`);
    if (!list || !row) return;
    const first = firstRun.current;
    firstRun.current = false;
    const lr = list.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    // short moves glide; long jumps (or the first render) are instant so the list never crawls past dozens of rows
    const move = (delta, size) => ({ behavior: first || Math.abs(delta) > size * 1.5 ? 'auto' : 'smooth' });
    if (getComputedStyle(list).flexDirection === 'row') {
      if (rr.left < lr.left || rr.right > lr.right) {
        const d = rr.left - lr.left - 16;
        list.scrollBy({ left: d, ...move(d, lr.width) });
      }
    } else if (rr.top < lr.top) {
      const d = rr.top - lr.top - 8;
      list.scrollBy({ top: d, ...move(d, lr.height) });
    } else if (rr.bottom > lr.bottom) {
      const d = rr.bottom - lr.bottom + 8;
      list.scrollBy({ top: d, ...move(d, lr.height) });
    }
  }, [selectedId, filtered.length]);

  const filtersOn = Boolean(q) || category !== 'all' || (activeEra && activeEra !== 'All');

  return (
    <section className="bjm-list" aria-label="Bible events">
      <div className="bjm-list__head">
        <div className="bjm-list__title">
          <h2>Bible events</h2>
          <span className="bjm-list__count" aria-live="polite">{filtersOn ? `${filtered.length} of ${events.length}` : `${events.length} events`}</span>
        </div>
        <label className="x-search">
          <Search size={16} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search events, people, places"
            aria-label="Search Bible events"
          />
          {query ? (
            <button type="button" className="x-search__clear" onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>
          ) : null}
        </label>
        <div className="bjm-list__cats" role="group" aria-label="Show">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className="x-chip x-chip--sm"
              aria-pressed={category === c.id}
              onClick={() => setCategory(c.id)}
            >
              {c.id !== 'all' ? <span className="x-dot" style={{ background: CATEGORY_COLORS[c.id] }} aria-hidden /> : null}
              {c.label}
              <span className="x-chip__count">{counts[c.id] ?? 0}</span>
            </button>
          ))}
        </div>
        {activeEra && activeEra !== 'All' ? (
          <p className="bjm-list__era">
            Showing the <strong>{eraLabel(activeEra)}</strong> era
            <button type="button" className="link-button" onClick={onClearEra}>Show all eras</button>
          </p>
        ) : null}
      </div>

      <div className="bjm-list__rows" ref={listRef} role="list">
        {filtered.map((ev) => {
          const isSel = ev.id === selectedId;
          return (
            <div role="listitem" key={ev.id} className="bjm-list__item">
              <button
                type="button"
                data-id={ev.id}
                onClick={() => onSelect(ev.id)}
                className={`bjm-row${isSel ? ' is-selected' : ''}`}
                aria-current={isSel ? 'true' : undefined}
              >
                <EventArtIcon order={ev.order} mapIcon={ev.mapIcon} variant="list" />
                <span className="bjm-row__text">
                  <strong>{ev.title}</strong>
                  <small>
                    <span className="x-dot" style={{ background: CATEGORY_COLORS[ev.category] || 'var(--x-ink-3)' }} aria-hidden />
                    {ev.references?.[0]}
                    {ev.timelineDate ? <span aria-hidden> · </span> : null}
                    {ev.timelineDate}
                  </small>
                </span>
                <span className="bjm-row__num" aria-label={`Map pin ${ev.order}`}>{ev.order}</span>
              </button>
            </div>
          );
        })}
        {filtered.length === 0 ? (
          <EmptyState
            icon={<SearchX size={22} />}
            title="No events match"
            compact
            action={
              <button type="button" className="secondary btn-sm" onClick={() => { setQuery(''); setCategory('all'); onClearEra(); }}>
                Clear filters
              </button>
            }
          >
            Try another word, or show every kind of event.
          </EmptyState>
        ) : null}
      </div>
    </section>
  );
}
