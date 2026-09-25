'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { retryPaymentAction } from '@/app/actions/checkout';
import { IDLE } from '@/app/actions/types';
import { Alert } from '@/components/ui/Feedback';
import { formatPaise } from '@/lib/money';

/**
 * Retry payment for an order that is not settled.
 *
 * This exists because payments fail for boring reasons — a bank timeout, a
 * closed tab, a flaky connection on a train — and the order should survive all
 * of them. The stock is already held and the order number already exists, so
 * the customer is not starting over.
 *
 * The panel is only rendered when the order is genuinely unpaid; the action
 * re-checks that on the server regardless.
 */
export function RetryPaymentPanel({
  orderId,
  orderNumber,
  amountPaise,
  email,
}: {
  orderId: string;
  orderNumber: string;
  amountPaise: number;
  email: string;
}) {
  const [state, formAction] = useActionState(retryPaymentAction, IDLE);
  const [open, setOpen] = useState(false);

  if (amountPaise <= 0) return null;

  if (!open) {
    return (
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-warning/40 bg-warning/5 p-4">
        <p className="text-sm text-ink-soft">
          This order is not paid yet — {formatPaise(amountPaise)} outstanding.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-[44px] rounded-full bg-brand-700 px-5 text-sm font-semibold text-paper transition-colors hover:bg-brand-600"
        >
          Complete payment
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-6 rounded-xl border border-line bg-paper p-5">
      <h2 className="font-display text-lg font-semibold text-ink">Complete your payment</h2>
      <p className="mt-1 text-sm text-ink-muted">
        {formatPaise(amountPaise)} for order {orderNumber}. You will be taken to our payment provider.
      </p>

      {!state.ok && state.error && (
        <Alert tone="danger" className="mt-4" live="assertive">
          {state.error}
        </Alert>
      )}

      <input type="hidden" name="orderId" value={orderId} />
      {/* Guests prove ownership of the order with the email it was placed with. */}
      <input type="hidden" name="email" value={email} />

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-ink">How would you like to pay?</legend>

        <div className="mt-2.5 space-y-2">
          {[
            { value: 'UPI', label: 'UPI', hint: 'PhonePe, Google Pay, Paytm, BHIM' },
            { value: 'CARD', label: 'Credit or debit card', hint: 'Visa, Mastercard, RuPay, Amex' },
            { value: 'NETBANKING', label: 'Net banking', hint: 'Pay from your bank account' },
            { value: 'WALLET', label: 'Wallet', hint: 'PhonePe and other supported wallets' },
          ].map((option, index) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 transition-colors hover:border-ink-faint"
            >
              <input
                type="radio"
                name="paymentMethod"
                value={option.value}
                defaultChecked={index === 0}
                className="mt-1 h-4 w-4 border-line accent-[rgb(var(--accent))]"
              />
              <span>
                <span className="block text-sm font-medium text-ink">{option.label}</span>
                <span className="block text-xs text-ink-muted">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <PayButton />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-[44px] rounded-full px-5 text-sm font-medium text-ink-muted hover:text-ink"
        >
          Not now
        </button>
      </div>
    </form>
  );
}

function PayButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[48px] rounded-full bg-brand-700 px-6 text-sm font-semibold text-paper transition-colors hover:bg-brand-600 disabled:opacity-60"
    >
      {pending ? 'Opening payment…' : 'Pay securely'}
    </button>
  );
}
