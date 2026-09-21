import React, { useEffect, useId, useState } from 'react';
import { BookOpen, ChevronDown, Globe, Users } from 'lucide-react';
import { getPersonPerspectiveEntry } from '../../lib/eventPersonPerspective.js';
import { EmptyState, initials } from '../ExploreUi.jsx';

const ROLE_HINTS = [
  ['god', 'Divine actor and covenant source'],
  ['jesus', 'Central figure of redemption'],
  ['moses', 'Deliverer and covenant leader'],
  ['abraham', 'Patriarch and promise bearer'],
  ['david', 'King and messianic ancestor'],
  ['joseph', 'Protector and providential leader'],
  ['mary', 'Mother of Jesus'],
  ['paul', 'Apostle and missionary'],
  ['pharaoh', 'Opposing ruler'],
  ['israel', 'People connected to the event']
];

function roleFor(name, event) {
  const l = name.toLowerCase();
  const hit = ROLE_HINTS.find(([k]) => l.includes(k));
  return hit ? hit[1] : `Part of ${event.title}`;
}

function PersonItem({ name, selected, open, onToggle, onReadRef }) {
  const bodyId = useId();
  const rt = (selected.roleTags || []).find((r) => r.person === name);
  const entry = open ? getPersonPerspectiveEntry(selected.id, name) : null;
  const ref = selected.references?.[0];
  const fallback = `Scripture doesn’t record a separate first-person account for ${name} in this scene. Read ${ref || 'the passage'} and notice what ${name} says and does.`;
  return (
    <li className={`person${open ? ' is-open' : ''}`}>
      <button type="button" className="person__toggle" onClick={onToggle} aria-expanded={open} aria-controls={bodyId}>
        <span className="x-avatar" aria-hidden>{initials(name)}</span>
        <span className="person__text">
          <strong>{name}</strong>
          <small>{rt?.role || roleFor(name, selected)}</small>
        </span>
        <ChevronDown size={18} className="person__chev" aria-hidden />
      </button>
      {open ? (
        <div className="person__body" id={bodyId}>
          {rt?.origin || rt?.relation ? (
            <p className="person__facts">
              {rt.origin ? <span><Globe size={13} aria-hidden /> {rt.origin}</span> : null}
              {rt.relation ? <span>{rt.relation}</span> : null}
            </p>
          ) : null}
          <p className="person__label">Their point of view</p>
          <blockquote className="person__perspective">{entry?.perspective ?? fallback}</blockquote>
          {ref ? (
            <button type="button" className="link-button" onClick={() => onReadRef(ref)}>
              <BookOpen size={15} aria-hidden /> Read {ref}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export default function PeoplePanel({ selected, onReadRef }) {
  const [openName, setOpenName] = useState(null);
  useEffect(() => { setOpenName(null); }, [selected.id]);
  const people = selected.mainPeople || [];

  return (
    <article className="x-panel people-panel" aria-labelledby="people-title">
      <header className="x-panel-head">
        <p className="x-eyebrow"><Users size={13} aria-hidden /> People</p>
        <h2 id="people-title">Who was there</h2>
        <p>Tap a person to see <em>{selected.title}</em> from their point of view.</p>
      </header>
      {people.length ? (
        <ul className="people-list">
          {people.map((name) => (
            <PersonItem
              key={name}
              name={name}
              selected={selected}
              open={openName === name}
              onToggle={() => setOpenName(openName === name ? null : name)}
              onReadRef={onReadRef}
            />
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Users size={22} />} title="No people listed for this event" compact>
          Read the passage to meet the people in this part of the story.
        </EmptyState>
      )}
    </article>
  );
}
