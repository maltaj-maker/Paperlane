import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';
import { PaymentStatusPoller } from '@/components/checkout/PaymentStatusPoller';

/**
 * Payment status.
 *
 * Where customers land when the bank's answer is still in flight — the browser
 * came back from the gateway before the webhook did, or the redirect was
 * interrupted (a UPI app handover on Android is a genuinely unreliable moment:
 * the user leaves the browser entirely).
 *
 * The important behaviour: **never guess**. This page does not read a query
 * string and declare success. It shows what we know and offers a link to the
 * order, where the truth lives. If a payment reference was passed in, it
 * re-checks server-side once, because a webhook may have arrived in the seconds
 * since the customer was redirected.
 *
 * States are deliberately worded so nobody is told their money is safe when we
 * cannot prove it, and nobody is told it failed when it may still be settling.
 */

export const metadata: Metadata = {
  title: 'Payment status',
  description: 'Check the status of a payment.',
  robots: { index: false, follow: false },
};

const COPY: Record<
  string,
  { tone: 'info' | 'success' | 'warning' | 'danger'; title: string; body: string }
> = {
  pending: {
    tone: 'warning',
    title: 'Your bank has not answered yet',
    body:
      'If money left your account, the payment is on its way and your order will be confirmed automatically — usually within a few minutes. Nothing needs to be done, and you will only ever be charged once.',
  },
  success: {
    tone: 'success',
    title: 'Payment received',
    body: 'Your order is confirmed. We have emailed you the details and a receipt is on the order page.',
  },
  failed: {
    tone: 'danger',
    title: 'That payment did not go through',
    body:
      'No money has been taken. Your order is still saved, so you can try again with the same cart — a different method sometimes helps.',
  },
  cancelled: {
    tone: 'info',
    title: 'Payment cancelled',
    body: 'You closed the payment before it completed. Nothing was charged and your order is still waiting.',
  },
  not_found: {
    tone: 'warning',
    title: 'We could not match that payment',
    body:
      'The reference we received does not match anything on your account. If money left your account, send us the bank reference and we will trace it.',
  },
  unverified: {
    tone: 'warning',
    title: 'We are still confirming this with your bank',
    body:
      'Your payment may have gone through. We could not reach the bank just now, so rather than guess we will keep checking and email you either way. If money left your account, your order will be confirmed automatically.',
  },
  unknown: {
    tone: 'warning',
    title: 'We have not been able to confirm this payment yet',
    body:
      'This usually means the payment is still settling with the bank. We have logged it — if it succeeded you will get a confirmation email, and if it failed no money was taken.',
  },
};

export default async function PaymentStatusPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const state = typeof params.state === 'string' ? params.state : 'unknown';
  const orderId = typeof params.order === 'string' ? params.order : null;
  const txn = typeof params.txn === 'string' ? params.txn : null;

  const copy = COPY[state] ?? COPY.unknown!;
  const orderHref = orderId ? `/orders/${orderId}` : '/account/orders';

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-14 sm:py-20">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Payment
        </p>
        <h1 className="mt-3 font-display text-2xl font-semibold text-ink sm:text-3xl">
          {copy.title}
        </h1>
      </div>

      <Alert tone={copy.tone} className="mt-8" live={copy.tone === 'danger' ? 'assertive' : 'polite'}>
        {copy.body}
      </Alert>

      {txn && <PaymentStatusPoller merchantTransactionId={txn} />}

      <div className="mt-8 rounded-2xl border border-line bg-paper-soft p-5">
        <h2 className="font-display text-base font-semibold text-ink">What happens now</h2>
        <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-ink-soft">
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
            <span>
              We confirm an order only after your bank or UPI provider confirms the money. That check
              happens on our servers, not in your browser.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
            <span>
              If a payment is retried, our system matches it against the order so you cannot be charged
              twice for the same basket.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
            <span>
              Anything that looks duplicated or stuck is refunded to the original method, and we email you
              when that happens.
            </span>
          </li>
        </ul>
      </div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button href={orderHref} variant="primary">
          {orderId ? 'View your order' : 'Check your orders'}
        </Button>
        <Button href="/contact" variant="secondary">
          Ask us about this payment
        </Button>
      </div>

      <p className="mt-8 text-center text-xs leading-relaxed text-ink-faint">
        Still unsure in an hour? Email us with the approximate time and amount — the bank reference is the
        fastest way for us to trace it. See our{' '}
        <Link href="/legal/refund-policy" className="underline underline-offset-2 hover:text-ink">
          refund and cancellation policy
        </Link>
        .
      </p>
    </main>
  );
}
