'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';

import { applyCouponAction, removeCouponAction } from '@/app/actions/cart';
import { IDLE } from '@/app/actions/types';
import { Alert } from '@/components/ui/Feedback';
import { formatPaise } from '@/lib/money';

/**
 * Coupon entry.
 *
 * Opens behind a link rather than sitting permanently in the layout: a visible
 * "Have a code?" box on every visit invites people to leave the page and hunt
 * for one, which costs more orders than the codes bring in.
 *
 * Applied codes are always shown with a way to remove them, so a code that
 * reduces the total by nothing cannot sit there invisibly.
 */
export function CouponForm({
  appliedCode,
  appliedDescription,
  discountPaise,
}: {
  appliedCode?: string | null;
  appliedDescription?: string | null;
  discountPaise?: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(applyCouponAction, IDLE);
  const router = useRouter();

  if (appliedCode) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-lg border border-success/30 bg-success/5 p-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <span className="font-mono">{appliedCode}</span>
            <span className="rounded-full bg-success/15 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-success">
              Applied
            </span>
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {appliedDescription ?? 'Discount applied'}
            {discountPaise ? ` — you save ${formatPaise(discountPaise)}` : ''}
          </p>
        </div>

        <button
          type="button"
          onClick={async () => {
            await removeCouponAction();
            router.refresh();
          }}
          className="shrink-0 text-xs font-medium text-ink-muted underline decoration-line underline-offset-4 hover:text-ink"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm font-medium text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
        >
          Have a coupon code?
        </button>
      ) : (
        <form action={formAction}>
          {!state.ok && state.error && (
            <Alert tone="danger" className="mb-2" live="polite">
              {state.error}
            </Alert>
          )}

          {state.ok && state.message && (
            <Alert tone="success" className="mb-2" live="polite">
              {state.message}
            </Alert>
          )}

          <div className="flex gap-2">
            <label htmlFor="coupon-code" className="sr-only">
              Coupon code
            </label>
            <input
              id="coupon-code"
              name="code"
              type="text"
              required
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="Enter code"
              className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-line bg-paper px-3.5 text-sm uppercase tracking-wide text-ink placeholder:normal-case placeholder:tracking-normal placeholder:text-ink-faint focus:border-ink focus:outline-none"
            />
            <ApplyButton />
          </div>
        </form>
      )}
    </div>
  );
}

function ApplyButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[44px] shrink-0 rounded-lg bg-ink px-5 text-sm font-semibold text-paper transition-colors hover:bg-brand-600 disabled:opacity-60"
    >
      {pending ? 'Checking…' : 'Apply'}
    </button>
  );
}
