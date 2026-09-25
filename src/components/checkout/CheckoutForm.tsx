'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';

import { placeOrderAction } from '@/app/actions/checkout';
import { IDLE } from '@/app/actions/types';
import { Alert } from '@/components/ui/Feedback';
import { Input, Select, Textarea } from '@/components/ui/Form';
import { Price } from '@/components/ui/Price';
import { cn } from '@/lib/cn';
import { formatPaise } from '@/lib/money';
import { formatCurrencyMinorUnits, type SupportedCurrency } from '@/lib/currency';

interface SavedAddress {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
}

interface PaymentOption {
  method: string;
  label: string;
  available: boolean;
  description: string;
}

/**
 * The checkout form.
 *
 * Three decisions worth stating:
 *
 *  1. **Guest first.** No "sign in to continue" wall. A signed-in customer gets
 *     their details pre-filled and a list of saved addresses; everybody else
 *     fills in a form. Forcing account creation here is the single most
 *     reliable way to lose a sale that was already won.
 *
 *  2. **One idempotency key per attempt.** Generated once when the form mounts
 *     and held in a ref. A double tap on a slow connection sends the same key
 *     twice and the database — not the UI — guarantees one order.
 *
 *  3. **Totals are the server's.** The summary shown here comes from the same
 *     `calculateTotals` the order will use. Changing the postcode or shipping
 *     method re-quotes rather than guessing.
 */
export function CheckoutForm({
  email,
  savedAddresses,
  paymentOptions,
  shippingQuotes,
  totals,
  appliedCouponCode,
  isSignedIn,
  codAvailable,
  presentmentCurrencies,
}: {
  email: string | null;
  savedAddresses: SavedAddress[];
  paymentOptions: PaymentOption[];
  shippingQuotes: Array<{ methodId: string | null; label: string; description: string | null; ratePaise: number; isFree: boolean; minDays: number; maxDays: number }>;
  totals: {
    subtotalPaise: number;
    discountPaise: number;
    shippingPaise: number;
    taxPaise: number;
    totalPaise: number;
    itemCount: number;
    couponCode: string | null;
  };
  appliedCouponCode: string | null;
  isSignedIn: boolean;
  codAvailable: boolean;
  presentmentCurrencies: Array<{ code: SupportedCurrency; rate: number }>;
}) {
  const [state, formAction] = useActionState(placeOrderAction, IDLE);

  // Stable for the lifetime of the form: a retry after a network blip reuses
  // it deliberately, because it is the *same* checkout attempt.
  const idempotencyKey = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `k${Date.now()}${Math.random().toString(36).slice(2)}`,
  );

  const defaultAddress = savedAddresses.find((address) => address.isDefault) ?? savedAddresses[0] ?? null;

  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(defaultAddress?.id ?? null);
  const [shippingMethodId, setShippingMethodId] = useState<string | null>(shippingQuotes[0]?.methodId ?? null);
  const [paymentMethod, setPaymentMethod] = useState<string>(
    paymentOptions.find((option) => option.available)?.method ?? 'COD',
  );
  const [billingSame, setBillingSame] = useState(true);
  const [showSavedList, setShowSavedList] = useState(savedAddresses.length > 0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [addressAllowsCod, setAddressAllowsCod] = useState(false);
  const [presentmentCurrency, setPresentmentCurrency] = useState<SupportedCurrency>('INR');
  const [liveQuotes, setLiveQuotes] = useState(shippingQuotes);
  const [shippingLoading, setShippingLoading] = useState(false);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const refresh = () => {
      const value = (name: string) => String((form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '').trim();
      const country = value('shipping.country').toUpperCase();
      const state = value('shipping.state').toLowerCase();
      const city = value('shipping.city').toLowerCase();
      const postal = value('shipping.postalCode').replace(/\D/g, '');
      setAddressAllowsCod(country === 'IN' && state === 'west bengal' && city === 'kolkata' && /^700\d{3}$/.test(postal));
    };
    refresh();
    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);
    return () => {
      form.removeEventListener('input', refresh);
      form.removeEventListener('change', refresh);
    };
  }, [selectedAddressId]);

  useEffect(() => {
    if (paymentMethod === 'COD' && (!codAvailable || !addressAllowsCod)) {
      setPaymentMethod(paymentOptions.find((option) => option.available && option.method !== 'COD')?.method ?? 'CARD');
    }
  }, [addressAllowsCod, codAvailable, paymentMethod, paymentOptions]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const value = (name: string) => String((form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '').trim();
    let cancelled = false;
    let timer = 0;
    const refreshQuotes = async () => {
      const country = value('shipping.country').toUpperCase();
      const state = value('shipping.state');
      const postalCode = value('shipping.postalCode');
      if (!/^[A-Z]{2}$/.test(country) || postalCode.length < 2) return;
      setShippingLoading(true);
      try {
        const response = await fetch('/api/v1/shipping/quote', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ country, state, postalCode, subtotalPaise: totals.subtotalPaise, itemCount: totals.itemCount }),
        });
        const data = await response.json();
        if (!cancelled) {
          const quotes = Array.isArray(data.quotes) ? data.quotes : [];
          setLiveQuotes(quotes);
          if (quotes.length && !quotes.some((q: any) => q.methodId === shippingMethodId)) setShippingMethodId(quotes[0].methodId);
        }
      } catch { if (!cancelled) setLiveQuotes([]); }
      finally { if (!cancelled) setShippingLoading(false); }
    };
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(refreshQuotes, 300); };
    schedule();
    form.addEventListener('input', schedule);
    form.addEventListener('change', schedule);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      form.removeEventListener('input', schedule);
      form.removeEventListener('change', schedule);
    };
  }, [totals.subtotalPaise, totals.itemCount, selectedAddressId, shippingMethodId]);

  const effectivePaymentOptions = paymentOptions.map((option) =>
    option.method === 'COD'
      ? { ...option, available: option.available && codAvailable && addressAllowsCod, description: 'Pay in cash when your parcel arrives. Available only in eligible Kolkata postcodes.' }
      : option,
  );

  const selected = useMemo(
    () => savedAddresses.find((address) => address.id === selectedAddressId) ?? null,
    [savedAddresses, selectedAddressId],
  );

  const chosenQuote = liveQuotes.find((quote) => quote.methodId === shippingMethodId) ?? liveQuotes[0] ?? null;
  const fxRate = presentmentCurrencies.find((c) => c.code === presentmentCurrency)?.rate ?? 1;
  const toPresentment = (paise: number) => presentmentCurrency === 'INR' ? paise : Math.round((paise / 100) * fxRate * (presentmentCurrency === 'JPY' ? 1 : 100));
  const displayMoney = (paise: number) => formatCurrencyMinorUnits(toPresentment(paise), presentmentCurrency, 'en-US');

  // The server's shipping figure is authoritative; this is the same number,
  // read straight off the quote the customer selected.
  const shippingPaise = chosenQuote?.isFree ? 0 : (chosenQuote?.ratePaise ?? totals.shippingPaise);
  const totalPaise = totals.subtotalPaise - totals.discountPaise + shippingPaise + totals.taxPaise;

  return (
    <form ref={formRef} action={formAction} className="grid gap-10 lg:grid-cols-[1fr_380px] lg:gap-14" noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey.current} />
      <input type="hidden" name="currency" value={presentmentCurrency} />
      {appliedCouponCode && <input type="hidden" name="couponCode" value={appliedCouponCode} />}

      {/* Honeypot */}
      <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden opacity-0">
        <label htmlFor="checkout-website">Website</label>
        <input id="checkout-website" type="text" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="order-2 min-w-0 lg:order-1">
        {!state.ok && state.error && (
          <Alert tone="danger" title="We could not place your order" className="mb-6" live="assertive">
            {state.error}
          </Alert>
        )}

        {/* ---------------- Contact ---------------- */}
        <section aria-labelledby="contact-heading">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="contact-heading" className="font-display text-lg font-semibold text-ink">
              1. Your details
            </h2>

            {!isSignedIn && (
              <Link href="/login?next=/checkout" className="text-xs text-ink-muted underline decoration-line underline-offset-4 hover:text-ink">
                Sign in instead
              </Link>
            )}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Input
              label="Full name"
              name="customerName"
              id="customerName"
              required
              autoComplete="name"
              defaultValue={selected?.fullName ?? ''}
              error={!state.ok ? state.fieldErrors?.customerName : undefined}
            />

            <Input
              label="Mobile number"
              name="phone"
              id="phone"
              type="tel"
              required
              inputMode="tel"
              autoComplete="tel"
              hint="For delivery updates"
              defaultValue={selected?.phone ?? ''}
              error={!state.ok ? state.fieldErrors?.phone : undefined}
            />

            <Input
              label="Email"
              name="email"
              id="email"
              type="email"
              required
              inputMode="email"
              autoComplete="email"
              hint={isSignedIn ? undefined : 'Your receipt and tracking go here'}
              defaultValue={email ?? ''}
              wrapClassName="sm:col-span-2"
              error={!state.ok ? state.fieldErrors?.email : undefined}
            />
          </div>
        </section>

        {/* ---------------- Shipping address ---------------- */}
        <section aria-labelledby="shipping-heading" className="mt-10">
          <h2 id="shipping-heading" className="font-display text-lg font-semibold text-ink">
            2. Delivery address
          </h2>

          {savedAddresses.length > 0 && showSavedList && (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {savedAddresses.map((address) => (
                <li key={address.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAddressId(address.id);
                      setShowSavedList(false);
                    }}
                    className={cn(
                      'h-full w-full rounded-xl border p-4 text-left transition-colors',
                      selectedAddressId === address.id
                        ? 'border-ink bg-paper-soft'
                        : 'border-line bg-paper hover:border-ink-faint',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink">{address.label}</span>
                      {address.isDefault && (
                        <span className="rounded-full bg-paper-sunken px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                          Default
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-ink-muted">
                      {address.fullName}
                      <br />
                      {address.line1}
                      {address.line2 ? `, ${address.line2}` : ''}
                      <br />
                      {address.city}, {address.state} {address.postalCode}
                    </span>
                  </button>
                </li>
              ))}

              <li>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAddressId(null);
                    setShowSavedList(false);
                  }}
                  className="h-full w-full rounded-xl border border-dashed border-line p-4 text-left text-sm text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
                >
                  + Use a different address
                </button>
              </li>
            </ul>
          )}

          {(!showSavedList || savedAddresses.length === 0) && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Input
                label="Full name"
                name="shipping.fullName"
                id="shipping.fullName"
                required
                autoComplete="shipping name"
                defaultValue={selected?.fullName ?? ''}
                error={!state.ok ? state.fieldErrors?.['shippingAddress.fullName'] : undefined}
              />

              <Input
                label="Phone"
                name="shipping.phone"
                id="shipping.phone"
                type="tel"
                required
                inputMode="tel"
                autoComplete="shipping tel"
                defaultValue={selected?.phone ?? ''}
                error={!state.ok ? state.fieldErrors?.['shippingAddress.phone'] : undefined}
              />

              <Input
                label="Flat / house, building"
                name="shipping.line1"
                id="shipping.line1"
                required
                autoComplete="shipping address-line1"
                defaultValue={selected?.line1 ?? ''}
                wrapClassName="sm:col-span-2"
                error={!state.ok ? state.fieldErrors?.['shippingAddress.line1'] : undefined}
              />

              <Input
                label="Area, street, landmark"
                name="shipping.line2"
                id="shipping.line2"
                autoComplete="shipping address-line2"
                defaultValue={selected?.line2 ?? ''}
                wrapClassName="sm:col-span-2"
              />

              <Input
                label="City"
                name="shipping.city"
                id="shipping.city"
                required
                autoComplete="shipping address-level2"
                defaultValue={selected?.city ?? ''}
                error={!state.ok ? state.fieldErrors?.['shippingAddress.city'] : undefined}
              />

              <Input
                label="State"
                name="shipping.state"
                id="shipping.state"
                required
                autoComplete="shipping address-level1"
                defaultValue={selected?.state ?? ''}
                error={!state.ok ? state.fieldErrors?.['shippingAddress.state'] : undefined}
              />

              <Input
                label="PIN code"
                name="shipping.postalCode"
                id="shipping.postalCode"
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="shipping postal-code"
                hint="6 digits"
                defaultValue={selected?.postalCode ?? ''}
                error={!state.ok ? state.fieldErrors?.['shippingAddress.postalCode'] : undefined}
              />

              <Input
                label="Country"
                name="shipping.country"
                id="shipping.country"
                required
                defaultValue={selected?.country ?? 'IN'}
                error={!state.ok ? state.fieldErrors?.['shippingAddress.country'] : undefined}
              />
            </div>
          )}

          {selected && (
            // Keep the payload complete even when the fields are hidden behind
            // the saved-address cards.
            <>
              <input type="hidden" name="shipping.fullName" value={selected.fullName} />
              <input type="hidden" name="shipping.phone" value={selected.phone} />
              <input type="hidden" name="shipping.line1" value={selected.line1} />
              <input type="hidden" name="shipping.line2" value={selected.line2 ?? ''} />
              <input type="hidden" name="shipping.city" value={selected.city} />
              <input type="hidden" name="shipping.state" value={selected.state} />
              <input type="hidden" name="shipping.postalCode" value={selected.postalCode} />
              <input type="hidden" name="shipping.country" value={selected.country} />
            </>
          )}

          {isSignedIn && (
            <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-sm text-ink-soft">
              <input
                type="checkbox"
                name="shipping.isDefaultShipping"
                value="true"
                defaultChecked={savedAddresses.length === 0}
                className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]"
              />
              Save this address to my account
            </label>
          )}
        </section>

        {/* ---------------- Billing ---------------- */}
        <section aria-labelledby="billing-heading" className="mt-10">
          <h2 id="billing-heading" className="font-display text-lg font-semibold text-ink">
            3. Billing
          </h2>

          <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-sm text-ink-soft">
            <input
              type="checkbox"
              name="billingSameAsShipping"
              value="true"
              checked={billingSame}
              onChange={(event) => setBillingSame(event.target.checked)}
              className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]"
            />
            Billing address is the same as delivery
          </label>

          {!billingSame && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Input label="Full name" name="billing.fullName" id="billing.fullName" required />
              <Input label="Phone" name="billing.phone" id="billing.phone" type="tel" required inputMode="tel" />
              <Input label="Address" name="billing.line1" id="billing.line1" required wrapClassName="sm:col-span-2" />
              <Input label="City" name="billing.city" id="billing.city" required />
              <Input label="State" name="billing.state" id="billing.state" required />
              <Input label="PIN code" name="billing.postalCode" id="billing.postalCode" required inputMode="numeric" maxLength={6} />
              <Input label="Country" name="billing.country" id="billing.country" required defaultValue="IN" />
            </div>
          )}
        </section>

        {/* ---------------- Shipping method ---------------- */}
        <section aria-labelledby="method-heading" className="mt-10">
          <h2 id="method-heading" className="font-display text-lg font-semibold text-ink">
            4. Delivery speed
          </h2>

          <div className="mt-4 space-y-2.5">
            {liveQuotes.map((quote, index) => (
              <label
                key={quote.methodId ?? `quote-${index}`}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors',
                  shippingMethodId === quote.methodId ? 'border-ink bg-paper-soft' : 'border-line bg-paper hover:border-ink-faint',
                )}
              >
                <input
                  type="radio"
                  name="shippingMethodId"
                  value={quote.methodId ?? ''}
                  checked={shippingMethodId === quote.methodId}
                  onChange={() => setShippingMethodId(quote.methodId)}
                  className="mt-1 h-4 w-4 border-line accent-[rgb(var(--accent))]"
                />
                <span className="flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-sm font-medium text-ink">{quote.label}</span>
                    <span className="text-sm font-semibold tabular-nums text-ink">
                      {quote.isFree ? 'Free' : displayMoney(quote.ratePaise)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {quote.description ?? `${quote.minDays}–${quote.maxDays} working days`}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {shippingLoading && <p className="mt-2 text-xs text-ink-faint">Updating delivery options…</p>}
        </section>

        {/* ---------------- Currency ---------------- */}
        <section aria-labelledby="currency-heading" className="mt-10">
          <h2 id="currency-heading" className="font-display text-lg font-semibold text-ink">
            5. Currency
          </h2>
          <p className="mt-1 text-xs text-ink-muted">Choose the currency used on the payment page. INR is always available; other currencies require a configured FX rate.</p>
          <div className="mt-4 max-w-xs">
            <Select
              label="Pay in"
              name="currency_display"
              value={presentmentCurrency}
              onChange={(e) => setPresentmentCurrency(e.target.value as SupportedCurrency)}
              options={presentmentCurrencies.map((c) => ({ value: c.code, label: c.code }))}
            />
          </div>
        </section>

        {/* ---------------- Payment ---------------- */}
        <section aria-labelledby="payment-heading" className="mt-10">
          <h2 id="payment-heading" className="font-display text-lg font-semibold text-ink">
            6. Payment
          </h2>

          <div className="mt-4 space-y-2.5">
            {effectivePaymentOptions.map((option) => (
              <label
                key={option.method}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors',
                  paymentMethod === option.method ? 'border-ink bg-paper-soft' : 'border-line bg-paper hover:border-ink-faint',
                  !option.available && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value={option.method}
                  checked={paymentMethod === option.method}
                  disabled={!option.available}
                  onChange={() => setPaymentMethod(option.method)}
                  className="mt-1 h-4 w-4 border-line accent-[rgb(var(--accent))]"
                />
                <span className="flex-1">
                  <span className="block text-sm font-medium text-ink">{option.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {/* What we do with card data, said plainly. */}
          <p className="mt-3 text-2xs leading-relaxed text-ink-faint">
            Payments are processed by our payment provider. We never see or store your card number, CVV
            or UPI PIN — only a reference that says the payment succeeded.
          </p>
        </section>

        {/* ---------------- Notes + terms ---------------- */}
        <section className="mt-10">
          <Textarea
            label="Delivery notes"
            name="notes"
            id="notes"
            rows={3}
            maxLength={500}
            hint="Optional — gate code, landmark, or a safe place to leave the parcel"
          />

          <label className="mt-5 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              name="acceptTerms"
              value="true"
              required
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-[rgb(var(--accent))]"
            />
            <span className="text-xs leading-relaxed text-ink-soft">
              I have read and accept the{' '}
              <Link href="/legal/terms" className="underline decoration-line underline-offset-4">
                terms of sale
              </Link>{' '}
              and{' '}
              <Link href="/legal/privacy" className="underline decoration-line underline-offset-4">
                privacy policy
              </Link>
              .
            </span>
          </label>
        </section>
      </div>

      {/* ---------------- Summary ---------------- */}
      <aside className="order-1 lg:order-2 lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-xl border border-line bg-paper p-5">
          <h2 className="font-display text-lg font-semibold text-ink">Your order</h2>

          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">
                Subtotal ({totals.itemCount} {totals.itemCount === 1 ? 'book' : 'books'})
              </dt>
              <dd className="tabular-nums text-ink">{displayMoney(totals.subtotalPaise)}</dd>
            </div>

            {totals.discountPaise > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-muted">{appliedCouponCode ? `Discount (${appliedCouponCode})` : 'Discount'}</dt>
                <dd className="tabular-nums text-success">− {displayMoney(totals.discountPaise)}</dd>
              </div>
            )}

            <div className="flex justify-between">
              <dt className="text-ink-muted">Delivery</dt>
              <dd className="tabular-nums text-ink">
                {shippingPaise === 0 ? 'Free' : displayMoney(shippingPaise)}
              </dd>
            </div>

            <div className="flex justify-between">
              <dt className="text-ink-muted">Tax</dt>
              <dd className="tabular-nums text-ink">
                {totals.taxPaise === 0 ? 'Included' : displayMoney(totals.taxPaise)}
              </dd>
            </div>

            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <dt className="font-display text-base font-semibold text-ink">Total</dt>
              <dd className="font-display text-xl font-semibold tabular-nums text-ink">
                {displayMoney(totalPaise)}
              </dd>
            </div>
          </dl>

          <PlaceOrderButton paymentMethod={paymentMethod} codAvailable={codAvailable && addressAllowsCod} />

          {!state.ok && state.retryable && (
            <p className="mt-3 text-xs leading-relaxed text-ink-muted">
              Nothing has been charged. Submitting again is safe — we will not create a second order.
            </p>
          )}

          <p className="mt-3 text-center text-2xs text-ink-faint">
            Prices shown are what you will be charged.
          </p>
        </div>
      </aside>
    </form>
  );
}

function PlaceOrderButton({ paymentMethod, codAvailable }: { paymentMethod: string; codAvailable: boolean }) {
  const { pending } = useFormStatus();

  const label = pending
    ? 'Placing your order…'
    : paymentMethod === 'COD' && codAvailable
      ? 'Place order — pay on delivery'
      : 'Pay securely';

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="mt-5 flex min-h-[54px] w-full items-center justify-center gap-2 rounded-full bg-brand-700 px-6 text-base font-semibold text-paper transition-colors hover:bg-brand-600 disabled:opacity-70"
    >
      {pending && (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
          <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
      {label}
    </button>
  );
}

/** Small helper used by the page to keep the summary honest between renders. */
export function useCheckoutTotal(base: number, adjustment: number): number {
  const [total, setTotal] = useState(base + adjustment);
  useEffect(() => setTotal(base + adjustment), [base, adjustment]);
  return total;
}
