'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';

import { addToCartAction } from '@/app/actions/cart';
import { IDLE } from '@/app/actions/types';
import { Alert } from '@/components/ui/Feedback';
import { QuantityStepper } from '@/components/ui/QuantityStepper';
import { cn } from '@/lib/cn';
import { trackClientEvent } from '@/components/analytics/AnalyticsScripts';

/**
 * Add to basket / buy now.
 *
 * The quantity is a real form field, so the server receives it and re-validates
 * it against stock and the per-order cap. The client-side `max` is a courtesy
 * that stops someone choosing 50 of a book we have two of — it is never the
 * control. `expectedUnitPricePaise` is sent along purely so the server can
 * detect that the price moved between page render and submission and tell the
 * customer, rather than silently charging a different amount.
 *
 * Buy now runs the same add-to-basket path and then continues to checkout, so
 * there is exactly one code path that can put an item in a basket.
 */
export function AddToCartForm({
  bookId,
  bookTitle,
  availability,
  sellingPricePaise,
  canBuy = true,
  isPreorder = false,
  className,
}: {
  bookId: string;
  bookTitle: string;
  availability: { status: string; available: number; maxPerOrder: number };
  sellingPricePaise: number;
  canBuy?: boolean;
  isPreorder?: boolean;
  className?: string;
}) {
  const [quantity, setQuantity] = useState(1);
  const [state, formAction] = useActionState(addToCartAction, IDLE);
  const [buyNowPending, setBuyNowPending] = useState(false);
  const router = useRouter();

  const max = Math.max(1, Math.min(availability.maxPerOrder || 10, availability.available || 10));

  // Funnel instrumentation: an add-to-basket that the server then rejects is a
  // very different signal from one that succeeds, so we only fire on success.
  useEffect(() => {
    if (state.ok && state.data) {
      trackClientEvent('add_to_cart', {
        bookId,
        quantity,
        valuePaise: sellingPricePaise * quantity,
        currency: 'INR',
        // Basket-level totals straight from the server, so the analytics value
        // matches what the customer was actually quoted.
        basketSubtotalPaise: state.data.subtotalPaise,
        basketItemCount: state.data.itemCount,
      });
      router.refresh();
    }
    // `state` is a new object per submission; keying off its identity is correct.
  }, [state, bookId, quantity, sellingPricePaise, router]);

  if (!canBuy) {
    return (
      <div className={cn('rounded-xl border border-line bg-paper-soft p-4', className)}>
        <p className="text-sm font-medium text-ink">Not available right now</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          We do not have a copy in stock and are not taking orders for this title yet. Ask us to
          notify you below and we will email the moment it is back.
        </p>
        <a
          href="#back-in-stock"
          className="mt-3 inline-flex min-h-[44px] items-center rounded-full border border-line bg-paper px-5 text-sm font-medium text-ink transition-colors hover:border-ink-faint"
        >
          Notify me when it arrives
        </a>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {!state.ok && state.error && (
        <Alert
          tone={state.code === 'PRICE_CHANGED' ? 'warning' : 'danger'}
          title={state.code === 'PRICE_CHANGED' ? 'The price changed' : undefined}
          live="polite"
        >
          {state.error}
        </Alert>
      )}

      {state.ok && state.message && (
        <Alert tone="success" live="polite" title="Added to your basket">
          {state.message}
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <QuantityStepper
          value={quantity}
          onChange={setQuantity}
          min={1}
          max={max}
          size="lg"
          label={`Quantity of ${bookTitle}`}
          maxReason={
            availability.available > 0 && max === availability.available
              ? `Only ${availability.available} left`
              : `Maximum ${max} per order`
          }
        />

        <form action={formAction} className="flex-1 min-w-[190px]">
          <input type="hidden" name="bookId" value={bookId} />
          <input type="hidden" name="quantity" value={quantity} />
          <input type="hidden" name="expectedUnitPricePaise" value={sellingPricePaise} />

          <AddButton isPreorder={isPreorder} />
        </form>
      </div>

      <form
        action={async (formData: FormData) => {
          setBuyNowPending(true);
          const result = await addToCartAction(IDLE, formData);
          if (result.ok) {
            trackClientEvent('begin_checkout', { bookId, source: 'buy_now' });
            router.push('/checkout');
          } else {
            setBuyNowPending(false);
            router.refresh();
          }
        }}
      >
        <input type="hidden" name="bookId" value={bookId} />
        <input type="hidden" name="quantity" value={quantity} />
        <input type="hidden" name="expectedUnitPricePaise" value={sellingPricePaise} />

        <button
          type="submit"
          disabled={buyNowPending}
          className="inline-flex min-h-[52px] w-full items-center justify-center rounded-full border border-ink bg-transparent px-8 text-base font-semibold text-ink transition-colors hover:bg-ink hover:text-paper disabled:opacity-60"
        >
          {buyNowPending ? 'Taking you to checkout…' : isPreorder ? 'Pre-order now' : 'Buy now'}
        </button>
      </form>

      <p className="text-xs leading-relaxed text-ink-muted">
        {isPreorder
          ? 'Pre-orders are charged when the book ships. You can cancel any time before dispatch.'
          : 'Secure checkout. Your card details never touch our servers.'}
      </p>
    </div>
  );
}

function AddButton({ isPreorder }: { isPreorder: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-brand-700 px-8 text-base font-semibold text-paper transition-colors hover:bg-brand-600 disabled:opacity-70"
    >
      {pending ? (
        <>
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
            <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Adding…
        </>
      ) : isPreorder ? (
        'Pre-order'
      ) : (
        'Add to basket'
      )}
    </button>
  );
}
