import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { getCartView } from '@/server/cart';
import { getFreeShippingThreshold } from '@/server/shipping';
import { getCurrentUser } from '@/server/auth';
import { formatPaise } from '@/lib/money';
import { DEFAULT_FREE_SHIPPING_THRESHOLD_PAISE } from '@/lib/constants';
import { Button } from '@/components/ui/Button';
import { Alert, BookGridSkeleton, EmptyState } from '@/components/ui/Feedback';
import { Skeleton } from '@/components/ui/Feedback';
import { BookCard } from '@/components/books/BookCard';
import { CartLineItem } from '@/components/cart/CartLineItem';
import { CouponForm } from '@/components/cart/CouponForm';

/**
 * Basket page.
 *
 * The single rule here: everything on this page is what the server would charge.
 * Stock, price changes, the cap per order, the discount and the shipping line all
 * come from `getCartView` → `calculateTotals`. Nothing is echoed back from the
 * client, so a stale tab cannot show a price we will not honour.
 *
 * Stock problems are surfaced *here*, before checkout, not at payment — finding
 * out your book sold out after entering card details is the worst possible time.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your basket',
  description: 'Review the books in your basket before checkout.',
  robots: { index: false, follow: false },
};

export default async function CartPage() {
  const [view, user, thresholdOverride] = await Promise.all([
    getCartView().catch(() => null),
    getCurrentUser().catch(() => null),
    getFreeShippingThreshold().catch(() => DEFAULT_FREE_SHIPPING_THRESHOLD_PAISE),
  ]);

  const lines = view?.lines ?? [];
  const unavailable = lines.filter((line) => line.status === 'out_of_stock' || line.available <= 0);

  const freeShippingThreshold = view?.totals.freeShippingThresholdPaise ?? thresholdOverride;
  const amountToFreeShipping = view?.totals.amountToFreeShippingPaise ?? 0;

  if (lines.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        <EmptyState
          title="Your basket is empty"
          description="Nothing in here yet. Take a look at what has just arrived, or browse by genre — most people find something in under a minute."
          action={{ label: 'Browse new arrivals', href: '/books?sort=newest' }}
          secondaryAction={{ label: 'See bestsellers', href: '/books?sort=popularity' }}
        />
      </div>
    );
  }

  const recommendations = view?.recommendations ?? [];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Your basket
        </h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          {view?.totals.itemCount} {view?.totals.itemCount === 1 ? 'book' : 'books'}
          {view?.isGuest && ' · we will keep this for you'}
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_360px] lg:gap-12">
        {/* ---------------- Lines ---------------- */}
        <div>
          {unavailable.length > 0 && (
            <Alert tone="warning" title="Some books are unavailable" className="mb-4">
              {unavailable.length === 1
                ? `“${unavailable[0]!.book.title}” just sold out. Remove it to continue, or we can email you when it returns.`
                : `${unavailable.length} books in your basket are no longer available. Please remove them to continue.`}
            </Alert>
          )}

          <ul className="divide-y divide-line border-y border-line">
            {lines.map((line) => (
              <CartLineItem key={line.id} line={line} />
            ))}
          </ul>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
            <Link
              href="/books"
              className="text-sm font-medium text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
            >
              Continue shopping
            </Link>

            <CouponForm
              appliedCode={view?.totals.coupon?.code ?? null}
              appliedDescription={view?.totals.coupon?.description ?? null}
              discountPaise={view?.totals.discountPaise}
            />
          </div>

          {recommendations.length > 0 && (
            <Suspense fallback={<BookGridSkeleton count={4} className="mt-12" />}>
              <section className="mt-12" aria-labelledby="also-like-heading">
                <h2 id="also-like-heading" className="font-display text-lg font-semibold text-ink">
                  Often bought with these
                </h2>
                <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
                  {recommendations.slice(0, 4).map((item) => (
                    <li key={item.id}>
                      <BookCard book={item as never} showQuickAdd />
                    </li>
                  ))}
                </ul>
              </section>
            </Suspense>
          )}
        </div>

        {/* ---------------- Summary ---------------- */}
        <aside aria-labelledby="summary-heading" className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-xl border border-line bg-paper p-5">
            <h2 id="summary-heading" className="font-display text-lg font-semibold text-ink">
              Order summary
            </h2>

            {/* Free shipping progress: shows exactly what it is — the server's
                own threshold — and only when free shipping is actually offered. */}
            {freeShippingThreshold > 0 && amountToFreeShipping > 0 && (
              <div className="mt-4 rounded-lg bg-paper-soft p-3">
                <p className="text-xs leading-relaxed text-ink-soft">
                  Add <strong className="font-semibold">{formatPaise(amountToFreeShipping)}</strong> more for
                  free delivery.
                </p>
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper-sunken"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(
                    ((view!.totals.subtotalPaise - amountToFreeShipping) / freeShippingThreshold) * 100,
                  )}
                  aria-label="Progress towards free delivery"
                >
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out-soft"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(0, ((view!.totals.subtotalPaise - amountToFreeShipping) / freeShippingThreshold) * 100),
                      )}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {freeShippingThreshold > 0 && amountToFreeShipping === 0 && (
              <p className="mt-3 rounded-lg bg-success/8 p-3 text-xs font-medium text-success">
                Delivery is on us for this order.
              </p>
            )}

            <dl className="mt-4 space-y-2.5 text-sm">
              <Row label="Subtotal" value={formatPaise(view!.totals.subtotalPaise)} />

              {view!.totals.catalogueSavingsPaise > 0 && (
                <Row
                  label="Catalogue discounts"
                  value={`− ${formatPaise(view!.totals.catalogueSavingsPaise)}`}
                  tone="success"
                />
              )}

              {view!.totals.discountPaise > 0 && (
                <Row
                  label={view!.totals.coupon?.code ? `Coupon (${view!.totals.coupon.code})` : 'Discount'}
                  value={`− ${formatPaise(view!.totals.discountPaise)}`}
                  tone="success"
                />
              )}

              <Row
                label="Delivery"
                value={view!.totals.shippingPaise === 0 ? 'Free' : formatPaise(view!.totals.shippingPaise)}
              />

              <Row
                label="Tax"
                value={view!.totals.taxPaise === 0 ? 'Included' : formatPaise(view!.totals.taxPaise)}
                hint={view!.totals.taxPaise > 0 ? 'Shown separately per item' : 'Included in the prices shown'}
              />

              <div className="border-t border-line pt-3">
                <div className="flex items-baseline justify-between">
                  <dt className="font-display text-base font-semibold text-ink">Total</dt>
                  <dd className="font-display text-xl font-semibold tabular-nums text-ink">
                    {formatPaise(view!.totals.totalPaise)}
                  </dd>
                </div>
              </div>
            </dl>

            <Button
              href={unavailable.length > 0 ? '/cart' : '/checkout'}
              fullWidth
              size="lg"
              className="mt-5"
              aria-disabled={unavailable.length > 0}
            >
              {unavailable.length > 0 ? 'Available items only' : 'Checkout'}
            </Button>

            <p className="mt-3 text-center text-2xs leading-relaxed text-ink-faint">
              {user ? 'Signed in as ' + user.email : 'No account needed — guest checkout is fine.'}
            </p>

            <ul className="mt-4 space-y-2 border-t border-line pt-4">
              {[
                'Secure payment — card details never touch our servers',
                'Dispatched within 24 hours',
                'Free returns within the stated window',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-xs text-ink-muted">
                  <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: 'success';
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-muted">
        {label}
        {hint && <span className="block text-2xs text-ink-faint">{hint}</span>}
      </dt>
      <dd className={tone === 'success' ? 'tabular-nums text-success' : 'tabular-nums text-ink'}>{value}</dd>
    </div>
  );
}
