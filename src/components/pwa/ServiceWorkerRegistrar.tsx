'use client';

import { useEffect, useState } from 'react';

/**
 * Service worker registration + install prompt.
 *
 * Two deliberate constraints, both about not breaking trust:
 *
 *  1. The service worker **never caches** API responses, cart, checkout or
 *     payment pages. A stale price or a stale stock count shown from cache is
 *     worse than a spinner — it leads to a failed payment and a support ticket.
 *     Only static assets, images and public catalogue pages are cached.
 *  2. Registration is skipped entirely in development, where a stale worker
 *     causes the classic "why is my change not showing up" loop.
 *
 * The install prompt is deliberately quiet: a banner appears only on Android/
 * desktop Chromium after real engagement (the browser's own heuristic fires
 * `beforeinstallprompt`), never on first load.
 */
export function ServiceWorkerRegistrar() {
  const [installEvent, setInstallEvent] = useState<Event | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        // Pick up a new deployment without requiring a hard refresh twice.
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent('pl:update-available'));
            }
          });
        });
      } catch {
        // A failed registration must never surface to the customer.
      }
    };

    void register();
  }, []);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event);
      setDismissed(window.localStorage.getItem('pl-install-dismissed') === '1');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  if (!installEvent || dismissed) return null;

  const install = async () => {
    const prompt = installEvent as Event & { prompt?: () => Promise<void> };
    await prompt.prompt?.();
    setDismissed(true);
  };

  const dismiss = () => {
    window.localStorage.setItem('pl-install-dismissed', '1');
    setDismissed(true);
  };

  return (
    <div
      role="region"
      aria-label="Install app"
      className="pointer-events-auto fixed bottom-4 left-4 right-4 z-[75] mx-auto max-w-sm animate-fade-up rounded-xl border border-line bg-paper p-4 shadow-book-lg sm:left-auto sm:right-6"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-700 text-paper" aria-hidden="true">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
            <path d="M4 5.5A1.5 1.5 0 015.5 4H10a2 2 0 012 2v13a1.5 1.5 0 00-1.5-1.5H5.5A1.5 1.5 0 014 16V5.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M20 5.5A1.5 1.5 0 0018.5 4H14a2 2 0 00-2 2v13a1.5 1.5 0 011.5-1.5h5A1.5 1.5 0 0020 16V5.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">Add the bookshop to your home screen</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
            Opens faster and works with a shaky connection. No app store needed.
          </p>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={install}
              className="rounded-full bg-brand-700 px-4 py-2 text-xs font-semibold text-paper transition-colors hover:bg-brand-600"
            >
              Install
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-full px-3 py-2 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
