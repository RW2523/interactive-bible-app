import React, { useState } from 'react';
import {
  BookOpen, BookOpenText, CalendarDays, Check, ChevronDown, Compass, Globe, HelpCircle, ImagePlus, Landmark,
  Lightbulb, Loader2, MapPin, MessageCircle, PenLine, RefreshCw, Route, Sparkles, Tag, Users, Wand2, X
} from 'lucide-react';
import EventArtIcon from '../EventArtIcon.jsx';
import { ConfirmDialog, SectionTitle, initials } from '../ExploreUi.jsx';
import { eraLabel, timelineMatchFromEventEra } from '../../lib/timelineEra.js';

export const CATEGORY_LABELS = { travel: 'Journey', event: 'Event', people: 'People' };

/* ── Hero ───────────────────────────────────────────────────────────── */
function InfoHero({ selected, card, onReadRef, onStartSermon, onOpenTimeline }) {
  const [confirmRepaint, setConfirmRepaint] = useState(false);
  const ref = selected.references?.[0];
  const era = timelineMatchFromEventEra(selected.era);
  return (
    <header className="info-hero">
      {card.url ? (
        <figure className="info-art">
          <img src={card.url} alt={`Illustration: ${selected.title}`} loading="lazy" />
          <figcaption className="info-art__badge"><Sparkles size={12} aria-hidden /> AI illustration</figcaption>
          <button
            type="button"
            className="icon-button icon-button--glass info-art__repaint"
            onClick={() => setConfirmRepaint(true)}
            disabled={card.loading}
            aria-label="Paint a new illustration"
            title="Paint a new illustration"
          >
            {card.loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
          </button>
        </figure>
      ) : null}

      <div className="info-hero__row">
        {!card.url ? <EventArtIcon order={selected.order} mapIcon={selected.mapIcon} variant="hero" /> : null}
        <div className="info-hero__titles">
          <p className="x-eyebrow">
            {era ? eraLabel(era) : selected.era}
            <span aria-hidden> · </span>
            {CATEGORY_LABELS[selected.category] || 'Event'}
          </p>
          <h2 className="info-hero__title" id="info-title">{selected.title}</h2>
          <ul className="info-hero__meta">
            {selected.timelineDate ? <li><CalendarDays size={14} aria-hidden /> {selected.timelineDate}</li> : null}
            {selected.mapLocation ? <li><MapPin size={14} aria-hidden /> {selected.mapLocation}</li> : null}
          </ul>
        </div>
      </div>

      {selected.summary ? <p className="info-hero__lead">{selected.summary}</p> : null}

      <div className="info-hero__actions">
        {ref ? (
          <button type="button" className="primary" onClick={() => onReadRef(ref)}>
            <BookOpenText size={16} aria-hidden /> Read {ref}
          </button>
        ) : null}
        <button type="button" className="secondary" onClick={() => onStartSermon(selected)}>
          <PenLine size={16} aria-hidden /> Start a sermon
        </button>
      </div>
      <div className="info-hero__links">
        <button type="button" className="link-button" onClick={() => onOpenTimeline(selected.id)}>
          <CalendarDays size={15} aria-hidden /> See it on the timeline
        </button>
        {!card.url ? (
          <button
            type="button"
            className="link-button"
            onClick={() => card.illustrate()}
            disabled={card.loading}
            title="AI paints one scene for this event in about 15 seconds and saves it for everyone"
          >
            {card.loading ? <Loader2 size={15} className="spin" aria-hidden /> : <ImagePlus size={15} aria-hidden />}
            {card.loading ? 'Painting the scene…' : 'Illustrate with AI'}
          </button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmRepaint}
        icon={<ImagePlus size={20} />}
        title="Paint a new illustration?"
        description="AI paints a fresh scene in about 15 seconds. It replaces the current picture for everyone."
        confirmLabel="Paint new illustration"
        onCancel={() => setConfirmRepaint(false)}
        onConfirm={() => { setConfirmRepaint(false); card.illustrate({ force: true }); }}
      />
    </header>
  );
}

/* ── Quiz ───────────────────────────────────────────────────────────── */
function QuizQuestion({ item, index }) {
  const [picked, setPicked] = useState(null);
  const answered = picked != null;
  return (
    <li className="quiz__item">
      <p className="quiz__q"><span className="quiz__n">{index + 1}</span>{item.question}</p>
      <div className="quiz__options" role="group" aria-label={`Answers for question ${index + 1}`}>
        {item.options.map((opt, i) => {
          const correct = opt === item.answer;
          const state = !answered ? '' : correct ? ' is-correct' : picked === opt ? ' is-wrong' : ' is-dim';
          return (
            <button key={opt} type="button" className={`quiz__opt${state}`} onClick={() => setPicked(opt)} disabled={answered} aria-pressed={picked === opt}>
              <span className="quiz__letter" aria-hidden>{'ABCD'[i]}</span>
              <span className="quiz__text">{opt}</span>
              {answered && correct ? <Check size={16} className="quiz__mark" aria-label="Correct answer" /> : null}
              {answered && !correct && picked === opt ? <X size={16} className="quiz__mark" aria-label="Your answer" /> : null}
            </button>
          );
        })}
      </div>
      {answered ? (
        <p className={`quiz__feedback${picked === item.answer ? ' is-correct' : ' is-wrong'}`} role="status">
          {picked === item.answer ? 'Correct — well done!' : `Not quite. The answer is “${item.answer}”.`}
          <button type="button" className="link-button" onClick={() => setPicked(null)}>Try again</button>
        </p>
      ) : null}
    </li>
  );
}

/* ── AI teaching notes ──────────────────────────────────────────────── */
function AiTeachingNotes({ content, state, onGenerate }) {
  const [expanded, setExpanded] = useState(false);
  const has = Boolean(content?.teachingSummary);

  if (!has) {
    return (
      <section className="ai-card" aria-labelledby="ai-card-title">
        <span className="ai-card__icon" aria-hidden><Wand2 size={20} /></span>
        <div className="ai-card__body">
          <h3 id="ai-card-title">Teaching notes with AI</h3>
          <p>
            Get a fuller teaching summary, notes on the place, discussion questions and a short quiz.
            It takes about 20 seconds and is saved, so everyone can use it afterwards.
          </p>
          {state.error ? (
            <p className="x-inline-error" role="alert">{state.error}</p>
          ) : null}
          <button type="button" className="primary" onClick={onGenerate} disabled={state.loading}>
            {state.loading ? <Loader2 size={16} className="spin" aria-hidden /> : <Sparkles size={16} aria-hidden />}
            {state.loading ? 'Writing teaching notes…' : state.error ? 'Try again' : 'Enhance with AI'}
          </button>
          {state.loading ? (
            <div className="x-skeleton-lines" aria-hidden>
              <span /><span /><span />
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  const questions = content.discussionQuestions || [];
  const quiz = (content.quiz || []).filter((q) => Array.isArray(q.options) && q.options.length >= 2);
  const long = (content.teachingSummary || '').length > 420;
  return (
    <section className="ai-notes" aria-labelledby="ai-notes-title">
      <header className="ai-notes__head">
        <p className="x-eyebrow x-eyebrow--ai"><Sparkles size={13} aria-hidden /> Written with AI</p>
        <h3 id="ai-notes-title">Teaching notes</h3>
        <p className="ai-notes__note">Generated once from this event’s details and saved for everyone. Check it against Scripture before teaching.</p>
      </header>
      <div className={`ai-notes__summary x-prose${long && !expanded ? ' is-clamped' : ''}`}>
        <p>{content.teachingSummary}</p>
      </div>
      {long ? (
        <button type="button" className="link-button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? 'Show less' : 'Read more'} <ChevronDown size={15} className={expanded ? 'rot-180' : ''} aria-hidden />
        </button>
      ) : null}

      {questions.length ? (
        <div className="ai-notes__block">
          <h4><MessageCircle size={15} aria-hidden /> Discussion questions</h4>
          <ol className="ai-notes__questions">{questions.map((q, i) => <li key={i}>{q}</li>)}</ol>
        </div>
      ) : null}

      {quiz.length ? (
        <div className="ai-notes__block">
          <h4><HelpCircle size={15} aria-hidden /> Quick quiz</h4>
          <ol className="quiz">{quiz.map((item, i) => <QuizQuestion key={`${item.question}-${i}`} item={item} index={i} />)}</ol>
        </div>
      ) : null}
    </section>
  );
}

/* ── Info panel ─────────────────────────────────────────────────────── */
export default function InfoPanel({ selected, content, contentState, onGenerate, onReadRef, onStartSermon, onOpenTimeline, card }) {
  const pc = selected.placeContext || {};
  const journey = selected.journey;
  const tags = selected.eventTags || selected.tags || [];
  const roleTags = selected.roleTags || [];
  const refs = selected.references || [];
  const lessonExtra = content?.applicationLesson && content.applicationLesson !== selected.lesson ? content.applicationLesson : null;

  return (
    <article className="x-panel info-panel" aria-labelledby="info-title">
      <InfoHero selected={selected} card={card} onReadRef={onReadRef} onStartSermon={onStartSermon} onOpenTimeline={onOpenTimeline} />

      <section className="x-section">
        <SectionTitle icon={<BookOpen size={16} />}>The story</SectionTitle>
        {selected.details ? <p className="x-prose">{selected.details}</p> : null}
        {refs.length ? (
          <div className="x-chip-row" aria-label="Scripture references">
            {refs.map((r) => (
              <button key={r} type="button" className="x-chip x-chip--ref" onClick={() => onReadRef(r)} title={`Read ${r}`}>
                <BookOpen size={13} aria-hidden /> {r}
              </button>
            ))}
          </div>
        ) : null}
        {tags.length ? (
          <div className="x-chip-row x-chip-row--tags" aria-label="Themes">
            <Tag size={13} className="x-chip-row__icon" aria-hidden />
            {tags.map((t) => <span key={t} className="x-tag">{t}</span>)}
          </div>
        ) : null}
      </section>

      {selected.lesson || lessonExtra ? (
        <aside className="x-callout x-callout--gold" aria-label="Key lesson">
          <span className="x-callout__icon" aria-hidden><Lightbulb size={18} /></span>
          <div>
            <h3 className="x-callout__title">Key lesson</h3>
            {selected.lesson ? <p className="x-callout__lead">{selected.lesson}</p> : null}
            {lessonExtra ? <p className="x-callout__text">{lessonExtra}</p> : null}
          </div>
        </aside>
      ) : null}

      {pc.ancient || content?.mapExplanation ? (
        <section className="x-section">
          <SectionTitle icon={<Globe size={16} />}>The place</SectionTitle>
          {pc.ancient ? (
            <div className="place-grid">
              <div className="place-grid__cell">
                <span className="x-label">Then</span>
                <strong>{pc.ancient}</strong>
              </div>
              <div className="place-grid__cell">
                <span className="x-label">Today</span>
                <strong>{pc.modern}</strong>
              </div>
            </div>
          ) : null}
          {pc.construction ? <p className="x-note"><Landmark size={14} aria-hidden /> {pc.construction}</p> : null}
          {pc.significance ? <p className="x-note x-note--accent"><Compass size={14} aria-hidden /> {pc.significance}</p> : null}
          {content?.mapExplanation ? (
            <div className="x-ai-paragraph">
              <span className="x-label x-label--ai"><Sparkles size={12} aria-hidden /> AI notes</span>
              <p>{content.mapExplanation}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {journey ? (
        <section className="x-section">
          <SectionTitle icon={<Route size={16} />}>The journey</SectionTitle>
          <dl className="journey-dl">
            {journey.travelers?.length ? <div><dt>Who travelled</dt><dd>{journey.travelers.join(', ')}</dd></div> : null}
            {journey.from ? <div><dt>From</dt><dd>{journey.from}</dd></div> : null}
            {journey.to ? <div><dt>To</dt><dd>{journey.to}</dd></div> : null}
            {journey.via?.length ? <div className="is-wide"><dt>Along the way</dt><dd>{journey.via.join(' → ')}</dd></div> : null}
            {journey.mode ? <div className="is-wide"><dt>How they travelled</dt><dd>{journey.mode}</dd></div> : null}
            {journey.companions?.length ? <div className="is-wide"><dt>Companions</dt><dd>{journey.companions.join(', ')}</dd></div> : null}
            {journey.reason ? <div className="is-wide"><dt>Why</dt><dd>{journey.reason}</dd></div> : null}
            {journey.distance ? <div><dt>Distance</dt><dd className="journey-dl__strong">{journey.distance}</dd></div> : null}
          </dl>
        </section>
      ) : null}

      {roleTags.length || selected.mainPeople?.length ? (
        <section className="x-section">
          <SectionTitle icon={<Users size={16} />}>People and their roles</SectionTitle>
          {roleTags.length ? (
            <ul className="role-list">
              {roleTags.map((rt) => (
                <li key={rt.person} className="role-list__item">
                  <span className="x-avatar" aria-hidden>{initials(rt.person)}</span>
                  <div className="role-list__body">
                    <p className="role-list__name"><strong>{rt.person}</strong><span className="x-badge">{rt.role}</span></p>
                    {rt.relation ? <p className="role-list__relation">{rt.relation}</p> : null}
                    {rt.origin ? <p className="role-list__origin"><Globe size={12} aria-hidden /> {rt.origin}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="x-chip-row">
              {selected.mainPeople.map((name) => (
                <span key={name} className="x-person-chip"><span className="x-avatar x-avatar--xs" aria-hidden>{initials(name)}</span>{name}</span>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <AiTeachingNotes content={content} state={contentState} onGenerate={onGenerate} />
    </article>
  );
}
