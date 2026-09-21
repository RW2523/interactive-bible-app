import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { aiErrorMessage } from './exploreJobs.js';

/**
 * The AI illustration ("event card") for one atlas event: loads the saved image, and paints a new one on request.
 * Shared by the map card and the Info tab so both always show the same picture.
 */
export function useEventCard(eventId) {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const current = useRef(eventId);

  useEffect(() => {
    current.current = eventId;
    setUrl(null);
    setLoading(false);
    let cancelled = false;
    const t = window.setTimeout(() => {
      api(`/v1/explore/events/${eventId}/event-card`)
        .then((meta) => { if (!cancelled && meta?.imageUrl) setUrl(meta.imageUrl); })
        .catch(() => { /* no illustration yet */ });
    }, 150);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [eventId]);

  const illustrate = useCallback(async ({ force = false } = {}) => {
    const id = eventId;
    setLoading(true);
    try {
      const res = await api(`/v1/explore/events/${id}/event-card`, { method: 'POST', body: { force } });
      if (current.current !== id) return;
      if (res?.imageUrl) setUrl(res.imageUrl);
      toast.success('Illustration ready — saved for everyone');
    } catch (err) {
      if (current.current === id) toast.error(aiErrorMessage(err, 'Could not create the illustration. Please try again.'));
    } finally {
      if (current.current === id) setLoading(false);
    }
  }, [eventId]);

  return { url, loading, illustrate };
}
