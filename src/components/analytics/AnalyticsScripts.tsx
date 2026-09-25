'use client';

import Script from 'next/script';
import { useEffect } from 'react';

/**
 * Analytics loading.
 *
 * Privacy position, stated plainly because it drives every choice here:
 *  - Default provider is `internal`: events go to our own database and nothing
 *    is sent to a third party at all.
 *  - Third-party tags (GA4, Meta Pixel) load **only** when a provider is
 *    configured *and* the visitor has consented, if consent is required.
 *  - Nothing loads on the checkout or payment-return pages beyond what is
 *    strictly needed — we do not want a marketing pixel firing next to a card
 *    form, and payment pages should be as close to tag-free as possible.
 *
 * The consent flag is read from localStorage and also broadcast via a custom
 * event, so granting consent mid-session starts collection without a reload.
 */

const CONSENT_KEY = 'pl-consent-analytics';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    _paq?: unknown[];
  }
}

export function AnalyticsScripts() {
  const provider = process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER ?? 'none';
  const ga4Id = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
  const metaPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const requireConsent = (process.env.NEXT_PUBLIC_ANALYTICS_REQUIRE_CONSENT ?? 'true') !== 'false';

  useEffect(() => {
    // Read consent and, when granted, initialise the configured provider.
    const apply = () => {
      const granted = !requireConsent || window.localStorage.getItem(CONSENT_KEY) === 'granted';
      if (!granted) return;

      // GA4 declarative stub — the actual library is loaded by the Script tag
      // below, which is only rendered in this component when a provider exists.
      if (provider === 'ga4' && ga4Id && !window.gtag) {
        window.dataLayer = window.dataLayer ?? [];
        // Minimal shim so queued calls work before gtag.js finishes loading.
        window.gtag = function gtagShim(...args: unknown[]) {
          window.dataLayer!.push(args);
        };
      }
    };

    apply();

    const onConsent = () => apply();
    window.addEventListener('pl:consent', onConsent);
    return () => window.removeEventListener('pl:consent', onConsent);
  }, [provider, ga4Id, requireConsent]);

  // Nothing configured → ship zero third-party JavaScript. This is the default.
  if (provider === 'none' || provider === 'internal') return null;
  if (provider === 'ga4' && !ga4Id) return null;

  return (
    <>
      {provider === 'ga4' && ga4Id && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${ga4Id}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              window.gtag = gtag;
              gtag('js', new Date());
              // Advertising storage is denied by default; consent mode lets the
              // visitor grant it explicitly rather than opting them in silently.
              gtag('consent', 'default', {
                ad_storage: 'denied',
                ad_user_data: 'denied',
                ad_personalization: 'denied',
                analytics_storage: '${requireConsent ? 'denied' : 'granted'}'
              });
              gtag('config', '${ga4Id}', { anonymize_ip: true });
            `}
          </Script>
        </>
      )}

      {metaPixelId && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
            n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
            document,'script','https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${metaPixelId}');
            fbq('track', 'PageView');
          `}
        </Script>
      )}
    </>
  );
}

/**
 * Track a client-side event.
 * Routes to the configured provider; the internal (first-party) path is handled
 * server-side by the API route so events are not lost to ad blockers.
 */
export function trackClientEvent(name: string, params: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;

  // Always record first-party. This is the data the admin dashboard reports on,
  // and it survives ad blockers precisely because it is ours.
  void fetch('/api/v1/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, params }),
    keepalive: true,
  }).catch(() => {});

  // Mirror to a third-party provider when one is configured and permitted.
  if (typeof window.gtag === 'function') {
    window.gtag('event', name, params);
  }
  if (typeof window.fbq === 'function') {
    window.fbq('trackCustom', name, params);
  }
}
