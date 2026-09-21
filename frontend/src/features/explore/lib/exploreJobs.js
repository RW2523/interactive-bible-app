import { api } from '@/api/client';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll a background job until it finishes; returns the final job row. */
export async function waitForJob(jobId, { onProgress, isCancelled } = {}) {
  for (;;) {
    if (isCancelled?.()) throw new Error('cancelled');
    const job = await api(`/v1/jobs/${jobId}`);
    if (job.progress && onProgress) onProgress(job.progress);
    if (job.status === 'succeeded') return job;
    if (job.status === 'failed' || job.status === 'dead' || job.status === 'cancelled') {
      const reason = (job.last_error || '').split('\n')[0].replace(/^\w+Error: /, '');
      throw new Error(reason || 'The job failed');
    }
    await sleep(2000);
  }
}

/** Another reader already started this story: follow it through story/meta (job ids are private to the requester). */
export async function waitForSharedStory(eventId, imageFormat, { isCancelled } = {}) {
  for (;;) {
    if (isCancelled?.()) throw new Error('cancelled');
    const meta = await api(`/v1/explore/events/${eventId}/story/meta`);
    const fmt = meta.formats?.[imageFormat];
    if (!fmt?.generating) {
      if (fmt?.cached) return;
      throw new Error('Story generation did not finish. Please try again.');
    }
    await sleep(3000);
  }
}

export const STORY_STEPS = [
  { key: 'script', label: 'Script' },
  { key: 'images', label: 'Scenes' },
  { key: 'narration', label: 'Narration' },
  { key: 'saving', label: 'Saving' }
];

/** Friendly one-line status for a story generation progress row. */
export function storyProgressLabel(progress) {
  if (!progress) return 'Getting started…';
  if (progress.step === 'script') return 'Writing the story script…';
  if (progress.step === 'images') {
    if (progress.total) return `Painting scene ${Math.min((progress.done ?? 0) + 1, progress.total)} of ${progress.total}…`;
    return 'Painting the scenes…';
  }
  if (progress.step === 'narration') return 'Recording the narration…';
  if (progress.step === 'saving') return 'Saving the story…';
  if (progress.step === 'render') return progress.message || 'Rendering the video…';
  return progress.message || 'Working…';
}

/** 0–100 estimate of how far a story generation has got. */
export function storyProgressPercent(progress) {
  if (!progress) return 4;
  const { step, done = 0, total = 0 } = progress;
  if (step === 'script') return 12;
  if (step === 'images') return 20 + Math.round(55 * (total ? Math.min(done, total) / total : 0));
  if (step === 'narration') return 82;
  if (step === 'saving') return 95;
  return 8;
}

/** Friendly message for an API error from an AI action. */
export function aiErrorMessage(err, fallback) {
  if (err?.status === 503) return 'AI is not available right now. Check that the Gemini key is set, then try again.';
  if (err?.status === 429) return err.message || 'Too many AI requests just now. Please wait a minute and try again.';
  if (err?.status === 0) return err.message;
  return err?.message || fallback;
}
