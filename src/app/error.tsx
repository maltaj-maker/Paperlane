'use client';

import { useEffect } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/Button';

/**
 * Route error boundary (500).
 *
 * What this page must never do is blame the customer or show them a stack trace.
 * It should say what happened in one sentence, offer a way forward, and give them
 * a reference they can quote if they contact us.
 *
 * `digest` is Next's hash of the server-side error; it is safe to display and it
 * is the only way to tie a customer's screenshot to a log line. The real error is
 * logged client-side too (console only — never sent to a third party from here,
 * because we cannot know whether the customer has consented to analytics).
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[route error]', error.digest ?? '', error.message);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-20 text-center sm:py-28">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-faint">
        Something went wrong
      </p>

      <h1 className="mt-4 font-display text-2xl font-semibold text-ink sm:text-3xl">
        This page would not load
      </h1>

      <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-muted">
        It is almost certainly temporary — most of these clear on a second attempt. Your cart and your
        orders are safe; nothing was lost or charged while this page failed.
      </p>

      {error.digest && (
        <p className="mt-5 rounded-full border border-line bg-paper-soft px-3.5 py-1.5 font-mono text-xs text-ink-muted">
          Reference {error.digest}
        </p>
      )}

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button onClick={reset} variant="primary">
          Try again
        </Button>
        <Button href="/" variant="secondary">
          Back to the shop
        </Button>
      </div>

      <p className="mt-10 text-sm text-ink-muted">
        Still stuck?{' '}
        <Link
          href={`/contact${error.digest ? `?ref=${encodeURIComponent(error.digest)}` : ''}`}
          className="font-medium text-ink underline underline-offset-4 hover:underline"
        >
          Send us the reference
        </Link>{' '}
        and we will look it up.
      </p>
    </main>
  );
}
