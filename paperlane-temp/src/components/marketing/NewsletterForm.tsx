'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { subscribeNewsletterAction } from '@/app/actions/marketing';
import { Alert } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Form';
import { cn } from '@/lib/cn';
import { IDLE } from '@/app/actions/types';

/**
 * Newsletter signup.
 *
 * Double opt-in: the address is stored as `pending` until the confirmation link
 * is followed. The consent text the customer saw is stored with the record.
 *
 * Includes a honeypot field and a required consent checkbox — both are
 * deliberate: an unchecked consent box is the difference between a lawful list
 * and a complaint.
 */
export function NewsletterForm({
  source = 'website',
  compact = false,
  className,
}: {
  source?: string;
  compact?: boolean;
  className?: string;
}) {
  const [state, formAction] = useActionState(subscribeNewsletterAction, IDLE);

  if (state.ok && state.message) {
    return (
      <Alert tone="success" title="Almost there" live="polite" className={className}>
        {state.message}
      </Alert>
    );
  }

  return (
    <form action={formAction} className={cn('w-full', className)} noValidate>
      <input type="hidden" name="source" value={source} />

      {/* Honeypot: hidden from humans, irresistible to bots. */}
      <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden opacity-0">
        <label htmlFor={`nl-website-${source}`}>Website</label>
        <input id={`nl-website-${source}`} type="text" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      {!state.ok && state.error && (
        <Alert tone="danger" className="mb-3" live="polite">
          {state.error}
        </Alert>
      )}

      <div className={cn(compact ? 'flex gap-2' : 'space-y-3')}>
        <Field label="Email address" htmlFor={`nl-email-${source}`} hideLabel={compact} className={compact ? 'flex-1' : undefined}>
          <input
            id={`nl-email-${source}`}
            name="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            aria-invalid={state.ok === false && state.fieldErrors?.email ? true : undefined}
            className="w-full rounded-xl border border-line bg-paper px-3.5 py-3 text-base text-ink placeholder:text-ink-faint transition-colors hover:border-ink-faint focus:border-ink focus:outline-none"
          />
        </Field>

        {compact && (
          <button
            type="submit"
            className="shrink-0 rounded-xl bg-brand-700 px-5 py-3 text-sm font-semibold text-paper transition-colors hover:bg-brand-600"
          >
            Join
          </button>
        )}
      </div>

      {!compact && (
        <>
          <label className="mt-3 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              name="consent"
              required
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-[rgb(var(--accent))]"
            />
            <span className="text-xs leading-relaxed text-ink-muted">
              Yes, email me occasionally about new arrivals, staff picks and offers. I can unsubscribe at
              any time.
            </span>
          </label>

          <SubmitButton />
        </>
      )}
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-3 w-full rounded-xl bg-brand-700 px-5 py-3 text-sm font-semibold text-paper transition-colors hover:bg-brand-600 disabled:opacity-60"
    >
      {pending ? 'Signing you up…' : 'Sign me up'}
    </button>
  );
}
