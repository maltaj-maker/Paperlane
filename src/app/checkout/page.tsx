import type { Metadata } from 'next';
import Link from 'next/link';

import { getCartView } from '@/server/cart';
import { getCurrentUser } from '@/server/auth';
import { quoteShipping } from '@/server/pricing';
import { getEnabledPaymentMethods } from '@/server/payments';
import { getCheckoutAddresses } from '@/app/actions/checkout';
import { isCodAvailable } from '@/server/shipping';
import { formatPaise } from '@/lib/money';
import { configuredInrFxRates, SUPPORTED_CURRENCIES, type SupportedCurrency } from '@/lib/currency';
import { env } from '@/lib/env';
import { EmptyState } from '@/components/ui/Feedback';
import { CheckoutForm } from '@/components/checkout/CheckoutForm';

/**
 * Checkout.
 *
 * Server-rendered, `noindex`, and deliberately thin on decoration: on this page
 * every pixel that is not the form is a distraction at the exact moment the
 * customer has decided to pay.
 *
 * The shipping quotes and totals come from `calculateTotals`, so the number in
 * the summary is the number the order will be created with. If the basket has
 * problems (sold out, cap exceeded) we send the customer back to fix them rather
 * than accepting an order we cannot fulfil.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  const [view, user, codAvailable, addresses] = await Promise.all([
    getCartView({ destination: { country: 'IN', state: '', postalCode: '' } }).catch(() => null),
    getCurrentUser().catch(() => null),
    isCodAvailable(),
    getCheckoutAddresses().catch(() => []),
  ]);

  if (!view || view.lines.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        <EmptyState
          title="There is nothing to check out"
          description="Your basket is empty. Find something worth your evening and come back."
          action={{ label: 'Browse the shop', href: '/books' }}
          secondaryAction={{ label: 'See new arrivals', href: '/books?sort=newest' }}
        />
      </div>
    );
  }

  const blocked = view.lines.filter((line) => line.status === 'out_of_stock' || line.available <= 0);

  if (blocked.length > 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        <EmptyState
          title="Something in your basket is unavailable"
          description={
            blocked.length === 1
              ? `“${blocked[0]!.book.title}” sold out while you were shopping. Remove it from your basket and checkout will open again.`
              : `${blocked.length} books in your basket are no longer available. Remove them and checkout will open again.`
          }
          action={{ label: 'Back to your basket', href: '/cart' }}
        />
      </div>
    );
  }

  const shippingQuotes = await quoteShipping({
    country: 'IN',
    state: '',
    postalCode: '',
    subtotalPaise: view.totals.subtotalPaise,
    itemCount: view.totals.itemCount,
  }).catch(() => []);

  const paymentMethods = getEnabledPaymentMethods();
  const configuredRates = configuredInrFxRates(env().CURRENCY_RATES_JSON);
  const presentmentCurrencies = SUPPORTED_CURRENCIES.filter((code) => code === 'INR' || configuredRates[code]).map((code) => ({ code: code as SupportedCurrency, rate: configuredRates[code] ?? 1 }));

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-8">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-muted">
          <Link href="/cart" className="transition-colors hover:text-ink">
            Basket
          </Link>
          <span className="mx-2 text-ink-faint">/</span>
          <span className="text-ink">Checkout</span>
        </nav>

        <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Checkout
        </h1>

        {!user && (
          <p className="mt-2 text-sm text-ink-muted">
            No account needed. We will email your receipt and tracking link.{' '}
            <Link href="/login?next=/checkout" className="underline decoration-line underline-offset-4 hover:text-ink">
              Signing in
            </Link>{' '}
            just saves you typing.
          </p>
        )}
      </header>

      <CheckoutForm
        email={user?.email ?? null}
        isSignedIn={Boolean(user)}
        codAvailable={codAvailable}
        savedAddresses={addresses.map((address) => ({
          id: address.id,
          label: address.label,
          fullName: address.fullName,
          phone: address.phone,
          line1: address.line1,
          line2: address.line2,
          city: address.city,
          state: address.state,
          postalCode: address.postalCode,
          country: address.country,
          isDefault: address.isDefault,
        }))}
        paymentOptions={paymentMethods.map((method) => ({
          method: method.method,
          label: method.label,
          available: method.available,
          description: method.description,
        }))}
        shippingQuotes={shippingQuotes.map((quote) => ({
          methodId: quote.methodId,
          label: quote.label,
          description: quote.description,
          ratePaise: quote.ratePaise,
          isFree: quote.isFree,
          minDays: quote.minDays,
          maxDays: quote.maxDays,
        }))}
        totals={{
          subtotalPaise: view.totals.subtotalPaise,
          discountPaise: view.totals.discountPaise,
          shippingPaise: view.totals.shippingPaise,
          taxPaise: view.totals.taxPaise,
          totalPaise: view.totals.totalPaise,
          itemCount: view.totals.itemCount,
          couponCode: view.totals.coupon?.code ?? null,
        }}
        appliedCouponCode={view.totals.coupon?.code ?? null}
        presentmentCurrencies={presentmentCurrencies}
      />

      <p className="mt-10 text-center text-2xs text-ink-faint">
        Total {formatPaise(view.totals.totalPaise)} · {view.totals.itemCount}{' '}
        {view.totals.itemCount === 1 ? 'book' : 'books'}
      </p>
    </div>
  );
}
