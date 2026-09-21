import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Captions, Check, ChevronLeft, ChevronRight, Clapperboard, Download, Film, HelpCircle, Loader2, Maximize2,
  Minimize2, Pause, Play, RectangleHorizontal, RectangleVertical, RotateCcw, Sparkles, Wand2
} from 'lucide-react';
import EventArtIcon from '../EventArtIcon.jsx';
import { ConfirmDialog, Modal } from '../ExploreUi.jsx';
import { STORY_STEPS, storyProgressLabel, storyProgressPercent } from '../../lib/exploreJobs.js';
import { estimateVideoDuration, isVideoSupported, loadVideoLocally, makeStoryVideo, saveVideoLocally } from '../../utils/makeStoryVideo.js';

const FORMAT_CHOICES = [
  { id: 'landscape', title: 'Widescreen', ratio: '16 : 9', text: 'For a TV, projector, YouTube or a laptop.', icon: RectangleHorizontal },
  { id: 'portrait', title: 'Vertical', ratio: '9 : 16', text: 'For phones, Reels, Shorts and WhatsApp status.', icon: RectangleVertical }
];

function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ── Format picker (used for creating a story and for rendering a captioned video) ── */
function FormatModal({ open, title, description, confirmNote, onPick, onClose, readyFormats = {} }) {
  return (
    <Modal open={open} onClose={onClose} title={title} description={description} icon={<Film size={20} />} size="md">
      <div className="format-choices">
        {FORMAT_CHOICES.map((f) => {
          const Icon = f.icon;
          return (
            <button key={f.id} type="button" className={`format-choice format-choice--${f.id}`} onClick={() => onPick(f.id)}>
              <span className="format-choice__shape" aria-hidden><Icon size={30} strokeWidth={1.6} /></span>
              <span className="format-choice__title">{f.title} <small>{f.ratio}</small></span>
              <span className="format-choice__text">{f.text}</span>
              {readyFormats[f.id] ? <span className="format-choice__ready"><Check size={12} aria-hidden /> Ready</span> : null}
            </button>
          );
        })}
      </div>
      {confirmNote ? <p className="format-note">{confirmNote}</p> : null}
    </Modal>
  );
}

/* ── Create / generating / error states ─────────────────────────────── */
function StoryCreate({ selected, cardUrl, onCreate }) {
  const [picking, setPicking] = useState(false);
  return (
    <section className="story-create" aria-labelledby="story-create-title">
      <div className="story-create__stage">
        {cardUrl ? <img className="story-create__bg" src={cardUrl} alt="" aria-hidden /> : null}
        <div className="story-create__content">
          <span className="story-create__icon" aria-hidden><Clapperboard size={26} /></span>
          <p className="x-eyebrow x-eyebrow--on-dark"><Sparkles size={13} aria-hidden /> Story video</p>
          <h2 id="story-create-title">Watch “{selected.title}” come to life</h2>
          <p className="story-create__lead">
            AI writes a short script, paints four scenes and records a calm narration. It takes about a minute, and the
            story is saved so anyone can watch it later.
          </p>
          <button type="button" className="primary primary--gold" onClick={() => setPicking(true)}>
            <Wand2 size={17} aria-hidden /> Create story video
          </button>
        </div>
      </div>
      <ol className="story-create__how" aria-label="How it works">
        <li><span>1</span><div><strong>Script</strong><small>A short narrated retelling of the passage</small></div></li>
        <li><span>2</span><div><strong>Scenes</strong><small>Four painted illustrations</small></div></li>
        <li><span>3</span><div><strong>Narration</strong><small>A warm voice reads the story</small></div></li>
      </ol>
      {selected.videoIdea ? (
        <p className="story-create__idea"><Film size={15} aria-hidden /> <span><strong>What it will show:</strong> {selected.videoIdea}</span></p>
      ) : null}
      <FormatModal
        open={picking}
        title="Choose a shape for the video"
        description="The scenes are painted for this shape. You can make the other shape later."
        onClose={() => setPicking(false)}
        onPick={(fmt) => { setPicking(false); onCreate(fmt); }}
      />
    </section>
  );
}

function StoryGenerating({ progress, shared }) {
  const current = STORY_STEPS.findIndex((s) => s.key === (progress?.step || 'script'));
  const pct = storyProgressPercent(progress);
  return (
    <section className="story-progress" role="status" aria-live="polite">
      <div className="story-progress__head">
        <span className="story-progress__spinner" aria-hidden><Loader2 size={22} className="spin" /></span>
        <div>
          <h2>{shared ? 'This story is being created…' : 'Creating your story video…'}</h2>
          <p>{shared ? 'Someone else started it a moment ago. It will appear here when it is ready.' : storyProgressLabel(progress)}</p>
        </div>
      </div>
      <div className="x-progress" aria-hidden><span style={{ width: `${pct}%` }} /></div>
      <ol className="story-progress__steps">
        {STORY_STEPS.map((step, i) => {
          const state = i < current ? 'is-done' : i === current ? 'is-current' : '';
          const detail = step.key === 'images' && progress?.step === 'images' && progress.total ? ` ${Math.min(progress.done ?? 0, progress.total)}/${progress.total}` : '';
          return (
            <li key={step.key} className={state}>
              <span className="story-progress__dot" aria-hidden>{i < current ? <Check size={12} /> : i + 1}</span>
              {step.label}{detail}
            </li>
          );
        })}
      </ol>
      <p className="story-progress__note">Usually about a minute. You can keep exploring — it keeps working and saves the story for everyone.</p>
    </section>
  );
}

function StoryError({ message, onRetry, onDismiss }) {
  return (
    <section className="story-error" role="alert">
      <span className="x-empty__icon x-empty__icon--danger" aria-hidden><AlertCircle size={22} /></span>
      <h2>We couldn’t create this story</h2>
      <p>{message}</p>
      <div className="story-error__actions">
        <button type="button" className="primary" onClick={onRetry}><RotateCcw size={16} aria-hidden /> Try again</button>
        <button type="button" className="secondary" onClick={onDismiss}>Not now</button>
      </div>
    </section>
  );
}

/* ── Player ─────────────────────────────────────────────────────────── */
function StoryPlayer({ story, sceneIndex, setSceneIndex, playing, setPlaying, formats, onSwitchFormat, busy }) {
  const scenes = story.scenes || [];
  const audioRef = useRef(null);
  const stageRef = useRef(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(Number(story.durationSeconds) || 0);
  const [fullscreen, setFullscreen] = useState(false);
  const hasAudio = Boolean(story.audioUrl);
  const portrait = story.imageFormat === 'portrait';

  const rawDurations = useMemo(() => scenes.map((s) => Number(s.durationSec) || 7), [scenes]);
  const starts = useMemo(() => {
    const total = rawDurations.reduce((a, b) => a + b, 0) || 1;
    const scale = hasAudio && duration ? duration / total : 1;
    let acc = 0;
    return rawDurations.map((d) => { const s = acc; acc += d * scale; return s; });
  }, [rawDurations, hasAudio, duration]);

  // stop narration when the player goes away (tab switch, other event)
  useEffect(() => () => setPlaying(false), [setPlaying]);
  useEffect(() => { setTime(0); setDuration(Number(story.durationSeconds) || 0); }, [story]);

  // silent stories (or no narration): advance the scenes on a timer while playing
  useEffect(() => {
    if (!playing || hasAudio || !scenes.length) return undefined;
    const t = window.setTimeout(() => {
      if (sceneIndex >= scenes.length - 1) setPlaying(false);
      else setSceneIndex(sceneIndex + 1);
    }, rawDurations[sceneIndex] * 1000);
    return () => window.clearTimeout(t);
  }, [playing, hasAudio, sceneIndex, scenes.length, rawDurations, setSceneIndex, setPlaying]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!hasAudio || !audio) {
      if (!playing && sceneIndex >= scenes.length - 1) setSceneIndex(0);
      setPlaying(!playing);
      return;
    }
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      if (audio.ended) audio.currentTime = 0;
      try {
        await audio.play();
        setPlaying(true);
      } catch {
        setPlaying(false);
      }
    }
  };

  const goTo = (i) => {
    const next = Math.max(0, Math.min(scenes.length - 1, i));
    setSceneIndex(next);
    const audio = audioRef.current;
    if (hasAudio && audio) {
      const target = (starts[next] || 0) + 0.05;
      try {
        audio.currentTime = Number.isFinite(audio.duration) ? Math.min(audio.duration - 0.1, target) : target;
        setTime(target);
      } catch { /* metadata not loaded yet: the scene still changes */ }
    }
  };

  const onTimeUpdate = (e) => {
    const el = e.currentTarget;
    if (el.paused && el.currentTime === 0) return;
    setTime(el.currentTime);
    let idx = 0;
    for (let i = 0; i < starts.length; i++) if (el.currentTime >= starts[i] - 0.01) idx = i;
    if (idx !== sceneIndex) setSceneIndex(idx);
  };

  // in-page cinema view (browsers without element full screen): Escape closes it
  useEffect(() => {
    if (!fullscreen || document.fullscreenElement) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFullscreen(false); };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = async () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      setFullscreen(false);
      return;
    }
    if (fullscreen) {
      setFullscreen(false);
      return;
    }
    if (el.requestFullscreen) {
      try {
        await el.requestFullscreen();
        setFullscreen(true);
        return;
      } catch { /* fall back to the in-page cinema view */ }
    }
    setFullscreen(true);
  };

  const onStageKey = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(sceneIndex + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(sceneIndex - 1); }
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); togglePlay(); }
    if (e.key === 'Escape' && fullscreen && !document.fullscreenElement) setFullscreen(false);
  };

  const scene = scenes[sceneIndex];
  const progressPct = hasAudio && duration
    ? Math.min(100, (time / duration) * 100)
    : scenes.length ? ((sceneIndex + (playing ? 0.5 : 1)) / scenes.length) * 100 : 0;
  const bothFormats = formats?.landscape?.cached && formats?.portrait?.cached;

  return (
    <div className="story-player">
      <div
        ref={stageRef}
        className={`story-stage${portrait ? ' story-stage--portrait' : ''}${playing ? ' is-playing' : ''}${fullscreen ? ' is-fullscreen' : ''}${busy ? ' is-busy' : ''}`}
        tabIndex={0}
        onKeyDown={onStageKey}
        aria-label={`Story video: ${story.title}. Use the left and right arrow keys to change scenes and space to play or pause.`}
      >
        <div className="story-stage__frames">
          {scenes.map((s, i) => (
            <div key={`${s.title}-${i}`} className={`story-stage__frame${i === sceneIndex ? ' is-active' : ''}`} aria-hidden={i !== sceneIndex}>
              {s.imageUrl ? <img src={s.imageUrl} alt={i === sceneIndex ? s.title || story.title : ''} /> : <div className="story-stage__placeholder">Scene {i + 1}</div>}
            </div>
          ))}
        </div>
        <div className="story-stage__shade" aria-hidden />
        <div className="story-stage__caption" aria-live="polite">
          <span className="story-stage__badge">Scene {sceneIndex + 1} of {scenes.length}</span>
          <h3>{scene?.title || story.title}</h3>
          {scene?.narration ? <p>{scene.narration}</p> : null}
        </div>
        {!playing ? (
          <button type="button" className="story-stage__bigplay" onClick={togglePlay} aria-label={hasAudio ? 'Play with narration' : 'Play the scenes'}>
            <Play size={30} fill="currentColor" aria-hidden />
          </button>
        ) : null}
        {fullscreen ? (
          <div className="story-stage__nav">
            <button type="button" className="icon-button icon-button--glass" onClick={() => goTo(sceneIndex - 1)} disabled={sceneIndex === 0} aria-label="Previous scene"><ChevronLeft size={20} /></button>
            <button type="button" className="icon-button icon-button--glass" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
            <button type="button" className="icon-button icon-button--glass" onClick={() => goTo(sceneIndex + 1)} disabled={sceneIndex >= scenes.length - 1} aria-label="Next scene"><ChevronRight size={20} /></button>
          </div>
        ) : null}
        <button type="button" className="icon-button icon-button--glass story-stage__fs" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} title={fullscreen ? 'Exit full screen' : 'Full screen'}>
          {fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
        </button>
        <div className="story-stage__bar" aria-hidden><span style={{ width: `${progressPct}%` }} /></div>
        {busy ? <div className="story-stage__busy" role="status"><Loader2 size={18} className="spin" aria-hidden /> Updating story…</div> : null}
      </div>

      {hasAudio ? (
        <audio
          ref={audioRef}
          src={story.audioUrl}
          preload="metadata"
          onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setDuration(d); }}
          onTimeUpdate={onTimeUpdate}
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
          onEnded={() => { setPlaying(false); }}
        />
      ) : null}

      <div className="story-controls">
        <button type="button" className="story-controls__play" onClick={togglePlay} aria-label={playing ? 'Pause' : hasAudio ? 'Play with narration' : 'Play the scenes'}>
          {playing ? <Pause size={20} fill="currentColor" aria-hidden /> : <Play size={20} fill="currentColor" aria-hidden />}
        </button>
        <button type="button" className="icon-button" onClick={() => goTo(sceneIndex - 1)} disabled={sceneIndex === 0} aria-label="Previous scene" title="Previous scene">
          <ChevronLeft size={18} />
        </button>
        <button type="button" className="icon-button" onClick={() => goTo(sceneIndex + 1)} disabled={sceneIndex >= scenes.length - 1} aria-label="Next scene" title="Next scene">
          <ChevronRight size={18} />
        </button>
        <div className="story-controls__info">
          <strong>{scene?.title || story.title}</strong>
          <small>
            {hasAudio ? `${formatClock(time)} / ${formatClock(duration)}` : 'No narration · scenes only'}
          </small>
        </div>
        {bothFormats ? (
          <div className="x-segmented x-segmented--sm" role="group" aria-label="Video shape">
            <button type="button" aria-pressed={!portrait} onClick={() => portrait && onSwitchFormat('landscape')}>16:9</button>
            <button type="button" aria-pressed={portrait} onClick={() => !portrait && onSwitchFormat('portrait')}>9:16</button>
          </div>
        ) : null}
      </div>

      {scene?.narration ? <p className="story-narration-below">{scene.narration}</p> : null}

      <div className="story-thumbs" role="tablist" aria-label="Scenes">
        {scenes.map((s, i) => (
          <button
            key={`${s.title}-${i}`}
            type="button"
            role="tab"
            aria-selected={i === sceneIndex}
            className={`story-thumb${i === sceneIndex ? ' is-active' : ''}`}
            onClick={() => goTo(i)}
            title={s.title}
          >
            {s.imageUrl ? <img src={s.imageUrl} alt="" loading="lazy" /> : <span className="story-thumb__empty" />}
            <span className="story-thumb__num">{i + 1}</span>
            <span className="story-thumb__title">{s.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Sharing: captioned video (browser) and HD MP4 (server) ─────────── */
function StoryShare({ story, eventId, mp4, onExportMp4 }) {
  const supported = isVideoSupported();
  const [picking, setPicking] = useState(false);
  const [render, setRender] = useState({ status: 'idle', progress: 0, url: null, ext: 'webm', format: 'landscape' });
  const [saved, setSaved] = useState({});
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    setRender({ status: 'idle', progress: 0, url: null, ext: 'webm', format: 'landscape' });
    setSaved({});
    let cancelled = false;
    Promise.all(['landscape', 'reels'].map((fmt) => loadVideoLocally(eventId, fmt).then((rec) => [fmt, rec]))).then((rows) => {
      if (cancelled) return;
      const next = {};
      for (const [fmt, rec] of rows) if (rec) next[fmt] = rec;
      setSaved(next);
    });
    return () => { cancelled = true; };
  }, [eventId]);

  const make = useCallback(async (fmt) => {
    setRender({ status: 'making', progress: 0, url: null, ext: 'webm', format: fmt });
    requestAnimationFrame(() => document.getElementById('story-share-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    try {
      const blob = await makeStoryVideo(story, (p) => {
        if (alive.current) setRender((r) => ({ ...r, progress: Math.round(p * 100) }));
      }, fmt);
      await saveVideoLocally(eventId, blob, fmt);
      if (!alive.current) return;
      const url = URL.createObjectURL(blob);
      setRender({ status: 'ready', progress: 100, url, ext: blob._ext || 'webm', format: fmt });
      setSaved((s) => ({ ...s, [fmt]: { url, ext: blob._ext || 'webm', format: fmt } }));
    } catch (err) {
      console.error('[story video]', err);
      if (alive.current) setRender((r) => ({ ...r, status: 'error', message: err?.message }));
    }
  }, [story, eventId]);

  const download = (rec, fmt) => {
    const name = `${eventId}-${fmt === 'reels' ? 'vertical' : 'widescreen'}-captioned.${rec.ext || 'webm'}`;
    const a = Object.assign(document.createElement('a'), { href: rec.url, download: name, rel: 'noopener' });
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const seconds = estimateVideoDuration(story, 'landscape');
  const readyList = Object.entries(saved);

  return (
    <section className="x-card story-share" aria-labelledby="story-share-title">
      <h3 id="story-share-title" className="story-share__title"><Download size={16} aria-hidden /> Save or share this story</h3>

      <div className="story-share__option">
        <span className="story-share__icon" aria-hidden><Captions size={18} /></span>
        <div className="story-share__body">
          <strong>Captioned video</strong>
          <p>Made in this browser with a title card and captions on every scene. Takes about {seconds} seconds — keep this tab open.</p>
          {render.status === 'making' ? (
            <div className="story-share__progress" role="status" aria-live="polite">
              <span>{render.format === 'reels' ? 'Vertical' : 'Widescreen'} video · {render.progress}%</span>
              <div className="x-progress"><span style={{ width: `${render.progress}%` }} /></div>
            </div>
          ) : null}
          {render.status === 'error' ? <p className="x-inline-error" role="alert">The video could not be made in this browser{render.message ? ` (${render.message})` : ''}. Please try again.</p> : null}
          {readyList.length ? (
            <ul className="story-share__ready">
              {readyList.map(([fmt, rec]) => (
                <li key={fmt}>
                  <Check size={14} aria-hidden /> {fmt === 'reels' ? 'Vertical 9:16' : 'Widescreen 16:9'} ready
                  <button type="button" className="link-button" onClick={() => download(rec, fmt)}>Download</button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {supported ? (
          <button type="button" className="secondary btn-sm" onClick={() => setPicking(true)} disabled={render.status === 'making'}>
            {render.status === 'making' ? <Loader2 size={15} className="spin" aria-hidden /> : <Captions size={15} aria-hidden />}
            {render.status === 'making' ? 'Making…' : readyList.length ? 'Make again' : 'Make video'}
          </button>
        ) : (
          <span className="story-share__unsupported">Use Chrome or Edge</span>
        )}
      </div>

      <div className="story-share__option">
        <span className="story-share__icon" aria-hidden><Clapperboard size={18} /></span>
        <div className="story-share__body">
          <strong>HD MP4 with narration</strong>
          <p>A full-HD MP4 rendered on this computer — best for projecting in church or posting online. It downloads when ready.</p>
          {mp4?.status === 'working' ? <p className="story-share__status" role="status"><Loader2 size={14} className="spin" aria-hidden /> {mp4.label || 'Rendering the MP4…'}</p> : null}
        </div>
        <button type="button" className="secondary btn-sm" onClick={() => onExportMp4(story.imageFormat || 'landscape')} disabled={mp4?.status === 'working'}>
          {mp4?.status === 'working' ? <Loader2 size={15} className="spin" aria-hidden /> : <Download size={15} aria-hidden />}
          {mp4?.status === 'working' ? 'Rendering…' : 'Download MP4'}
        </button>
      </div>

      <FormatModal
        open={picking}
        title="Make a captioned video"
        description={`The video plays through once while it records (about ${seconds} seconds). Keep this tab open.`}
        readyFormats={{ landscape: Boolean(saved.landscape), portrait: Boolean(saved.reels) }}
        onClose={() => setPicking(false)}
        onPick={(fmt) => { setPicking(false); make(fmt === 'portrait' ? 'reels' : 'landscape'); }}
      />
    </section>
  );
}

function StoryQuestions({ quiz }) {
  const [open, setOpen] = useState({});
  if (!quiz?.length) return null;
  return (
    <section className="x-card story-quiz" aria-labelledby="story-quiz-title">
      <h3 id="story-quiz-title" className="story-share__title"><HelpCircle size={16} aria-hidden /> Questions for after the video</h3>
      <ol>
        {quiz.map((q, i) => (
          <li key={i}>
            <p>{q.question}</p>
            {open[i] ? <p className="story-quiz__answer"><Check size={14} aria-hidden /> {q.answer}</p> : (
              <button type="button" className="link-button" onClick={() => setOpen((o) => ({ ...o, [i]: true }))}>Show answer</button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ── Panel ──────────────────────────────────────────────────────────── */
export default function StoryPanel({
  selected, story, loading, progress, sharedGeneration, error, formats, cardUrl, sceneIndex, setSceneIndex, playing, setPlaying,
  mp4, onCreate, onRegenerate, onRetry, onDismissError, onExportMp4, onSwitchFormat
}) {
  const [confirmNew, setConfirmNew] = useState(false);

  if (error) {
    return (
      <div className="x-panel x-panel--wide story-panel">
        <StoryError message={error} onRetry={onRetry} onDismiss={onDismissError} />
      </div>
    );
  }

  if (!story) {
    return (
      <div className="x-panel x-panel--wide story-panel">
        {loading && (progress || sharedGeneration) ? (
          <StoryGenerating progress={progress} shared={sharedGeneration} />
        ) : loading ? (
          <div className="story-loading" role="status"><Loader2 size={20} className="spin" aria-hidden /> Loading the story…</div>
        ) : (
          <StoryCreate selected={selected} cardUrl={cardUrl} onCreate={onCreate} />
        )}
      </div>
    );
  }

  const fmt = story.imageFormat || 'landscape';
  return (
    <div className="x-panel x-panel--wide story-panel">
      <header className="story-head">
        <EventArtIcon order={selected.order} mapIcon={selected.mapIcon} variant="strip" />
        <div className="story-head__titles">
          <p className="x-eyebrow"><Film size={13} aria-hidden /> Story video</p>
          <h2>{story.title || selected.title}</h2>
          <p className="story-head__meta">
            {story.reference ? <span>{story.reference}</span> : null}
            <span><Sparkles size={12} aria-hidden /> Illustrated and narrated with AI</span>
            {story.generatedAt ? <span>Saved {formatDate(story.generatedAt)}</span> : null}
            {story.mode === 'partial' ? <span className="x-badge x-badge--warn">Some scenes have no picture</span> : null}
          </p>
        </div>
      </header>

      {loading && progress ? <StoryGenerating progress={progress} shared={false} /> : null}

      <StoryPlayer
        story={story}
        sceneIndex={Math.min(sceneIndex, (story.scenes?.length || 1) - 1)}
        setSceneIndex={setSceneIndex}
        playing={playing}
        setPlaying={setPlaying}
        formats={formats}
        onSwitchFormat={onSwitchFormat}
        busy={loading && !progress}
      />

      <div className="story-lower">
        <StoryShare story={story} eventId={selected.id} mp4={mp4} onExportMp4={onExportMp4} />
        <StoryQuestions quiz={story.quiz} />
        <section className="story-new">
          <div>
            <strong>Want a different telling?</strong>
            <p>Create a new version with a fresh script, scenes and narration. It replaces this one for everyone.</p>
          </div>
          <button type="button" className="secondary btn-sm" onClick={() => setConfirmNew(true)} disabled={loading}>
            <Wand2 size={15} aria-hidden /> New version
          </button>
        </section>
      </div>

      <ConfirmDialog
        open={confirmNew}
        icon={<Wand2 size={20} />}
        title="Create a new version?"
        description="AI writes a new script, paints new scenes and records new narration. It takes about a minute and replaces the saved story for everyone."
        confirmLabel="Create new version"
        onCancel={() => setConfirmNew(false)}
        onConfirm={() => { setConfirmNew(false); onRegenerate(fmt); }}
      />
    </div>
  );
}
