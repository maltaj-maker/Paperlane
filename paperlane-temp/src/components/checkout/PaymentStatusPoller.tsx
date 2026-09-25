'use client';

import { useEffect, useState } from 'react';

/**
 * Re-checks a payment once, shortly after landing on the status page.
 *
 * Justification, not decoration: the customer is usually redirected the instant
 * the bank responds, while our confirmation waits for the provider webhook. A
 * refresh a few seconds later is often enough for the webhook to have landed, so
 * this converts a confusing "still pending" into a confirmed order without the
 * customer doing anything.
 *
 * It is deliberately bounded: **one** check, after a short delay, then it stops.
 * Anything more aggressive is a polling loop dressed up as a feature, and the
 * page is honest about the state in the meantime.
 */
export function PaymentStatusPoller({ merchantTransactionId }: { merchantTransactionId: string }) {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (checked || !merchantTransactionId) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetch('/api/v1/payments/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ merchantTransactionId }),
        // The answer decides whether we reload, so caching it would be wrong.
        cache: 'no-store',
      })
        .then(async (response) => {
          if (cancelled) return;
          const data = (await response.json().catch(() => null)) as { settle?: boolean } | null;
          // `settle` means the provider has now given a final answer; a reload
          // shows the customer the real outcome.
          if (data?.settle) window.location.reload();
        })
        .catch(() => {
          // Offline or blocked: keep the page as it is. The order page is still
          // the source of truth and will be correct next time it is opened.
        })
        .finally(() => {
          if (!cancelled) setChecked(true);
        });
    }, 4_000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [checked, merchantTransactionId]);

  return null;
}
