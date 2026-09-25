'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { requestStockAlertAction } from '@/app/actions/cart';
import { IDLE } from '@/app/actions/types';
import { Alert } from '@/components/ui/Feedback';

/**
 * Back-in-stock / price-drop alert.
 *
 * Shown instead of an add-to-basket button when a title cannot be bought. This
 * is the honest alternative to a disabled button that collects nothing: the
 * customer gets to register real intent, and we get a reason to email them —
 * which is exactly the kind of message people are glad to receive.
 *
 * One email, then we stop. It is a transactional notification, not a list.
 */
export function BackInStockForm({ bookId, bookTitle }: { bookId: string; bookTitle: string }) {
  const [state, formAction] = useActionState(requestStockAlertAction, IDLE);

  return (
    <div id="back-in-stock" className="rounded-xl border border-line bg-paper-soft p-4">
      <h3 className="font-display text-base font-semibold text-ink">Tell me when it is back</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        We will send one email when “{bookTitle}” is available again — nothing else, ever.
      </p>

      {state.ok && state.message ? (
        <Alert tone="success" className="mt-3" live="polite">
          {state.message}
        </Alert>
      ) : (
        <form action={formAction} className="mt-3">
          <input type="hidden" name="bookId" value={bookId} />
          <input type="hidden" name="kind" value="back_in_stock" />

          {!state.ok && state.error && (
            <Alert tone="danger" className="mb-2" live="polite">
              {state.error}
            </Alert>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor={`alert-email-${bookId}`} className="sr-only">
              Email address
            </label>
            <input
              id={`alert-email-${bookId}`}
              name="email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              className="min-h-[46px] flex-1 rounded-lg border border-line bg-paper px-3.5 text-sm text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none"
            />
            <NotifyButton />
          </div>
        </form>
      )}
    </div>
  );
}

function NotifyButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[46px] shrink-0 rounded-lg bg-brand-700 px-5 text-sm font-semibold text-paper transition-colors hover:bg-brand-600 disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Notify me'}
    </button>
  );
}
