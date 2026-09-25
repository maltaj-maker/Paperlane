'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const CONSENT_KEY = 'pl-consent-analytics';

/**
 * Cookie/analytics consent banner.
 *
 * Behaviour:
 *  - Renders nothing until mounted, so the server-rendered HTML and the first
 *    client render agree (no hydration mismatch, no flash).
 *  - Appears only when `ANALYTICS_REQUIRE_CONSENT` is on and no choice has been
 *    recorded. If the store runs first-party analytics only, no banner is needed
 *    and none is shown — asking for permission we do not require trains people
 *    to dismiss these without reading.
 *  - "Essential only" is as prominent as "Accept". Dark-pattern consent is both
 *    unlawful in several jurisdictions and corrosive of trust.
 */

export function ConsentBanner() {
  const [visible, setVisible] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [analyticsOn, setAnalyticsOn] = useState(true);

  const requireConsent = (process.env.NEXT_PUBLIC_ANALYTICS_REQUIRE_CONSENT ?? 'true') !== 'false';
  const provider = process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER ?? 'none';

  useEffect(() => {
    if (!requireConsent) return;
    // Only relevant when a third-party analytics provider is actually configured.
    if (provider === 'none' || provider === 'internal') return;
    if (window.localStorage.getItem(CONSENT_KEY)) return;

    // Let the page settle before interrupting — a banner that appears during
    // the first paint costs us the Largest Contentful Paint metric.
    const timer = setTimeout(() => setVisible(true), 800);
    return () => clearTimeout(timer);
  }, [requireConsent, provider]);

  const decide = (granted: boolean) => {
    window.localStorage.setItem(CONSENT_KEY, granted ? 'granted' : 'denied');

    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', {
        analytics_storage: granted ? 'granted' : 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      });
    }

    // Tell the analytics component so it can start (or stop) collecting without
    // forcing a page reload.
    window.dispatchEvent(new CustomEvent('pl:consent', { detail: { granted } }));
    setVisible(false);
    setManageOpen(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="consent-title"
      aria-describedby="consent-body"
      className="fixed inset-x-3 bottom-3 z-[90] mx-auto max-w-2xl animate-fade-up rounded-xl border border-line bg-paper p-4 shadow-book-lg sm:inset-x-6 sm:p-5"
    >
      <h2 id="consent-title" className="font-display text-base font-semibold text-ink">
        A quick word about cookies
      </h2>

      <p id="consent-body" className="mt-2 text-sm leading-relaxed text-ink-muted">
        We use strictly necessary cookies to keep your basket and sign you in — those cannot be turned
        off. With your permission we would also like to use analytics cookies to understand which books
        people are looking for and where they arrive from. We do not sell your data.{' '}
        <Link href="/legal/cookies" className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
          Cookie policy
        </Link>{' '}
        ·{' '}
        <Link href="/legal/privacy" className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
          Privacy policy
        </Link>
      </p>

      {manageOpen && (
        <div className="mt-3 rounded-lg border border-line bg-paper-soft p-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked
              disabled
              className="mt-0.5 h-4 w-4 rounded border-line accent-[rgb(var(--accent))]"
              aria-describedby="essential-desc"
            />
            <span className="text-sm">
              <span className="block font-medium text-ink">Strictly necessary</span>
              <span id="essential-desc" className="block text-xs text-ink-muted">
                Basket, session and security. Always on.
              </span>
            </span>
          </label>

          <label className="mt-3 flex items-start gap-3">
            <input
              type="checkbox"
              checked={analyticsOn}
              onChange={(event) => setAnalyticsOn(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-line accent-[rgb(var(--accent))]"
            />
            <span className="text-sm">
              <span className="block font-medium text-ink">Analytics</span>
              <span className="block text-xs text-ink-muted">
                Helps us see which pages and genres people use.
              </span>
            </span>
          </label>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => (manageOpen ? decide(analyticsOn) : decide(true))}
          className="rounded-full bg-brand-700 px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-brand-600"
        >
          {manageOpen ? 'Save my choice' : 'Accept analytics'}
        </button>

        <button
          type="button"
          onClick={() => decide(false)}
          className="rounded-full border border-line px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-paper-soft"
        >
          Essential only
        </button>

        {!manageOpen && (
          <button
            type="button"
            onClick={() => setManageOpen(true)}
            className="rounded-full px-3 py-2.5 text-sm font-medium text-ink-muted underline decoration-line underline-offset-4 transition-colors hover:text-ink"
          >
            Manage preferences
          </button>
        )}
      </div>
    </div>
  );
}
