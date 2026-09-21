import React from 'react';
import { GitBranch, Sparkles, TreePine, Users } from 'lucide-react';
import { EmptyState, SectionTitle, initials } from '../ExploreUi.jsx';

function stepCaption(index, arr) {
  if (index === arr.length - 1) return 'Closest to this story';
  if (index === 0) return 'Earlier in the line';
  return `After ${arr[index - 1]}`;
}

/** Names get initials; descriptive steps ("Humanity affected by sin") get a small branch mark instead. */
function looksLikeName(text) {
  const words = String(text).split(/\s+/);
  return words.length <= 2 && /^[A-Z]/.test(text) && !/nation|tribes|humanity|promise|sons|line/i.test(text);
}

export default function FamilyPanel({ selected, content, lineageFocusLabels, onOpenLineageTree, treeSize }) {
  const thread = (selected.lineageConnection || []).slice(0, 10);
  const headline = thread.length > 1 ? `${thread[0]} to ${thread[thread.length - 1]}` : 'The family line';

  return (
    <article className="x-panel family-panel" aria-labelledby="family-title">
      <header className="x-panel-head">
        <p className="x-eyebrow"><GitBranch size={13} aria-hidden /> Family line</p>
        <h2 id="family-title">{headline}</h2>
        <p>How <em>{selected.title}</em> fits into the covenant family that leads to Jesus.</p>
      </header>

      {thread.length > 1 ? (
        <ol className="vine" aria-label="Family line for this event">
          {thread.map((name, index, arr) => (
            <li key={`${name}-${index}`} className={`vine__step${index === arr.length - 1 ? ' is-current' : ''}`}>
              <span className="vine__avatar" aria-hidden>{looksLikeName(name) ? initials(name) : <GitBranch size={15} />}</span>
              <span className="vine__text">
                <strong>{name}</strong>
                <small>{stepCaption(index, arr)}</small>
              </span>
            </li>
          ))}
        </ol>
      ) : thread.length === 1 ? (
        <p className="family-thread"><GitBranch size={16} aria-hidden /> <span><strong>Family thread:</strong> {thread[0]}</span></p>
      ) : (
        <EmptyState icon={<GitBranch size={22} />} title="No family line recorded for this event" compact>
          Open the family tree to browse the whole line from Adam to Jesus.
        </EmptyState>
      )}

      {content?.lineageExplanation ? (
        <aside className="x-callout x-callout--ai">
          <span className="x-callout__icon" aria-hidden><Sparkles size={17} /></span>
          <div>
            <h3 className="x-callout__title">Why this family matters here</h3>
            <p className="x-callout__text">{content.lineageExplanation}</p>
            <p className="x-callout__meta">Written with AI · saved for everyone</p>
          </div>
        </aside>
      ) : null}

      <section className="x-card tree-card" aria-labelledby="tree-card-title">
        <SectionTitle icon={<TreePine size={16} />}><span id="tree-card-title">On the family tree</span></SectionTitle>
        {lineageFocusLabels.length ? (
          <>
            <div className="x-chip-row">
              {lineageFocusLabels.slice(0, 8).map((name, i) => (
                <span key={`${name}-${i}`} className="x-person-chip"><span className="x-avatar x-avatar--xs" aria-hidden>{initials(name)}</span>{name}</span>
              ))}
              {lineageFocusLabels.length > 8 ? <span className="x-tag">+{lineageFocusLabels.length - 8} more</span> : null}
            </div>
            <p className="tree-card__hint">The tree highlights these people and follows their line toward Jesus.</p>
          </>
        ) : (
          <p className="tree-card__hint"><Users size={14} aria-hidden /> Explore the storybook tree, or the full map of {treeSize || 'all the'} people from Adam to Jesus.</p>
        )}
        <button type="button" className="primary tree-card__cta" onClick={onOpenLineageTree}>
          <TreePine size={16} aria-hidden /> Open the family tree
        </button>
      </section>
    </article>
  );
}
