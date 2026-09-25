'use client';

import { useEffect } from 'react';

/**
 * Fires a product-view event once, after the page is interactive.
 *
 * Deliberately client-side and delayed: a server-side "view" would count
 * prefetches and bot traffic, and would block the page render. Scheduling the
 * work for idle time keeps it off the critical path, so it cannot cost us
 * Largest Contentful Paint — the metric that decides whether an Instagram
 * visitor stays long enough to read the description.
 */
export function ViewItemTracker({
  bookId,
  bookTitle,
  pricePaise,
  genreName,
}: {
  bookId: string;
  bookTitle: string;
  pricePaise: number;
  genreName?: string | null;
}) {
  useEffect(() => {
    let cancelled = false;

    const send = () => {
      if (cancelled) return;
      void fetch('/api/v1/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'view_item',
          params: { bookId, bookTitle, pricePaise, genreName, path: window.location.pathname },
        }),
        keepalive: true,
      }).catch(() => {});
    };

    // Safari has no requestIdleCallback; a short timeout is a fine substitute
    // because the goal is simply "not during the first paint".
    const hasIdle = typeof window.requestIdleCallback === 'function';

    if (hasIdle) {
      const id = window.requestIdleCallback!(send, { timeout: 2_000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(id);
      };
    }

    const timer = window.setTimeout(send, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bookId, bookTitle, pricePaise, genreName]);

  return null;
}
