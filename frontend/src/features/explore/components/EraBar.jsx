import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ATLAS_ERAS } from '../lib/timelineEra.js';

/**
 * Era filter above the atlas: a small timeline rail. Picking an era dims the other pins and filters the event list;
 * picking it again (or "All") shows everything.
 */
export default function EraBar({ activeEra, setActiveEra, counts, focusPulse = 0 }) {
  const trackRef = useRef(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setOverflow({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return undefined;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', measure); };
  }, [measure]);

  // bring the active era into view (e.g. after "Show this era" on a map pin)
  useEffect(() => {
    const el = trackRef.current;
    const active = el?.querySelector('[aria-pressed="true"]');
    if (!el || !active) return;
    const er = el.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    if (ar.left < er.left || ar.right > er.right) {
      const d = ar.left - er.left - er.width / 2 + ar.width / 2;
      el.scrollBy({ left: d, behavior: Math.abs(d) > er.width ? 'auto' : 'smooth' });
    }
  }, [activeEra, focusPulse]);

  const scroll = (dir) => trackRef.current?.scrollBy({ left: dir * 220, behavior: 'smooth' });

  return (
    <nav className="bjm-eras" aria-label="Filter by era">
      <span className="bjm-eras__label" aria-hidden>Era</span>
      <button type="button" className={`bjm-eras__nav${overflow.left ? '' : ' is-hidden'}`} onClick={() => scroll(-1)} aria-label="Earlier eras" tabIndex={overflow.left ? 0 : -1}>
        <ChevronLeft size={16} />
      </button>
      <div className="bjm-eras__track" ref={trackRef}>
        <button type="button" className="bjm-era bjm-era--all" aria-pressed={!activeEra || activeEra === 'All'} onClick={() => setActiveEra('All')}>
          <span className="bjm-era__dot" aria-hidden />
          <span className="bjm-era__label">All</span>
          <span className="bjm-era__sub">{counts?.All ?? ''} events</span>
        </button>
        {ATLAS_ERAS.map((era) => (
          <button
            key={era.match}
            type="button"
            className="bjm-era"
            aria-pressed={activeEra === era.match}
            onClick={() => setActiveEra(activeEra === era.match ? 'All' : era.match)}
            title={`${era.label} · ${era.sub}${counts?.[era.match] != null ? ` · ${counts[era.match]} events` : ''}`}
          >
            <span className="bjm-era__dot" aria-hidden />
            <span className="bjm-era__label">{era.label}</span>
            <span className="bjm-era__sub">{era.sub}</span>
          </button>
        ))}
      </div>
      <button type="button" className={`bjm-eras__nav${overflow.right ? '' : ' is-hidden'}`} onClick={() => scroll(1)} aria-label="Later eras" tabIndex={overflow.right ? 0 : -1}>
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}
