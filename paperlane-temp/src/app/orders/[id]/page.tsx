import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { getOrderById, canCustomerCancel } from '@/server/orders';
import { getCurrentUser } from '@/server/auth';
import { buildTrackingUrl, carrierLabel } from '@/server/shipping';
import { env } from '@/lib/env';
import { formatPaise } from '@/lib/money';
import { formatDate, formatDateTime } from '@/lib/cn';
import {
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  FULFILLMENT_LABEL,
  ORDER_STATUS,
  PAYMENT_STATUS,
  FULFILLMENT_STATUS,
} from '@/lib/constants';
import { Alert, Badge } from '@/components/ui/Feedback';
import { Button } from '@/components/ui/Button';
import { OrderTimeline } from '@/components/orders/OrderTimeline';
import { RetryPaymentPanel } from '@/components/orders/RetryPaymentPanel';
import { OrderActions } from '@/components/orders/OrderActions';

/**
 * Order detail, confirmation and tracking — one page.
 *
 * After payment the customer lands here with `?payment=success`, and this is the
 * page they will come back to for tracking. Combining confirmation and tracking
 * avoids the classic broken pattern where an emailed "view your order" link
 * leads to a page that only worked immediately after checkout.
 *
 * Nothing on this page infers state. Every badge reads a real column, and the
 * tracking link is only rendered when a carrier and a number actually exist.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your order',
  robots: { index: false, follow: false },
};

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const user = await getCurrentUser().catch(() => null);

  // Staff can open any order; a customer can only open their own.
  const order = await getOrderById(id, { userId: user?.id ?? null, isStaff: false });

  if (!order) notFound();

  const paymentFlag = typeof query.payment === 'string' ? query.payment : null;
  const placed = query.placed === '1';

  const totalPaise = order.totalPaise;
  const paid = order.paymentStatus === PAYMENT_STATUS.PAID || order.paymentStatus === PAYMENT_STATUS.PARTIALLY_REFUNDED;

  const trackingUrl = buildTrackingUrl(order.carrier, order.trackingNumber);
  const cancel = canCustomerCancel(order);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      {/* ---------- Post-payment banners ---------- */}
      {paymentFlag === 'success' && (
        <Alert tone="success" title="Payment received — thank you" className="mb-6" live="polite">
          We have your order. A confirmation is on its way to {maskEmail(order.email)}, and we will email
          tracking as soon as it ships.
        </Alert>
      )}

      {paymentFlag === 'pending' && (
        <Alert tone="warning" title="We are still waiting on your bank" className="mb-6" live="polite">
          Your payment has not been confirmed yet. If money has left your account, it will settle shortly —
          we will email you the moment it does. You can safely retry below if nothing happens.
        </Alert>
      )}

      {paymentFlag === 'unverified' && (
        <Alert tone="warning" title="We could not check your payment just now" className="mb-6" live="polite">
          We could not reach the payment provider to confirm the outcome. Your order is safe — do not pay
          again yet. Refresh this page in a moment, or contact us and we will check for you.
        </Alert>
      )}

      {paymentFlag === 'failed' && (
        <Alert tone="danger" title="That payment did not go through" className="mb-6" live="assertive">
          Nothing has been charged. You can try again with a different method — the order is still here.
        </Alert>
      )}

      {paymentFlag === 'already_confirmed' && (
        <Alert tone="info" title="This order is already paid" className="mb-6">
          We have not taken a second payment.
        </Alert>
      )}

      {placed && !paymentFlag && (
        <Alert tone="success" title="Order placed" className="mb-6" live="polite">
          We have emailed your confirmation to {maskEmail(order.email)}.
        </Alert>
      )}

      {/* ---------- Header ---------- */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-ink-faint">Order</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {order.orderNumber}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">Placed {formatDateTime(order.placedAt)}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge tone={badgeToneForOrder(order.status)}>{ORDER_STATUS_LABEL[order.status] ?? order.status}</Badge>
          <Badge tone={paid ? 'success' : 'warning'}>
            {PAYMENT_STATUS_LABEL[order.paymentStatus] ?? order.paymentStatus}
          </Badge>
          <Badge tone="outline">
            {FULFILLMENT_LABEL[order.fulfillmentStatus] ?? order.fulfillmentStatus}
          </Badge>
        </div>
      </header>

      {/* ---------- Actions that depend on state ---------- */}
      {!paid && order.paymentStatus !== PAYMENT_STATUS.REFUNDED && (
        <RetryPaymentPanel
          orderId={order.id}
          orderNumber={order.orderNumber}
          amountPaise={totalPaise - order.amountPaidPaise}
          email={order.email}
        />
      )}

      {/* ---------- Tracking ---------- */}
      {order.trackingNumber && (
        <section className="mt-8 rounded-xl border border-line bg-paper p-5" aria-labelledby="tracking-heading">
          <h2 id="tracking-heading" className="font-display text-lg font-semibold text-ink">
            Tracking
          </h2>

          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-muted">Courier</dt>
              <dd className="mt-0.5 text-ink">{carrierLabel(order.carrier)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Tracking number</dt>
              <dd className="mt-0.5 font-mono text-ink">{order.trackingNumber}</dd>
            </div>
            {order.estimatedDelivery && (
              <div>
                <dt className="text-ink-muted">Estimated delivery</dt>
                <dd className="mt-0.5 text-ink">{formatDate(order.estimatedDelivery)}</dd>
              </div>
            )}
          </dl>

          {trackingUrl && (
            <Button href={trackingUrl} external variant="secondary" size="sm" className="mt-4">
              Track your parcel
            </Button>
          )}
        </section>
      )}

      {/* ---------- Timeline ---------- */}
      <section className="mt-8" aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" className="font-display text-lg font-semibold text-ink">
          Progress
        </h2>
        <OrderTimeline
          status={order.status}
          paymentStatus={order.paymentStatus}
          fulfillmentStatus={order.fulfillmentStatus}
          placedAt={order.placedAt}
          confirmedAt={order.confirmedAt}
          shippedAt={order.shipments[0]?.shippedAt ?? null}
          deliveredAt={order.deliveredAt}
          cancelledAt={order.cancelledAt}
        />
      </section>

      {/* ---------- Items ---------- */}
      <section className="mt-8" aria-labelledby="items-heading">
        <h2 id="items-heading" className="font-display text-lg font-semibold text-ink">
          What you ordered
        </h2>

        <ul className="mt-4 divide-y divide-line border-y border-line">
          {order.items.map((item) => (
            <li key={item.id} className="flex gap-4 py-4">
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm font-semibold text-ink">
                  {item.slugSnapshot ? (
                    <Link href={`/books/${item.slugSnapshot}`} className="transition-colors hover:text-accent">
                      {item.titleSnapshot}
                    </Link>
                  ) : (
                    item.titleSnapshot
                  )}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">{item.authorSnapshot}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {item.quantity} × {formatPaise(item.unitPricePaise)}
                  {item.status !== 'pending' && ` · ${item.status.replace(/_/g, ' ')}`}
                </p>
              </div>

              <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                {formatPaise(item.lineTotalPaise)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------- Totals + addresses ---------- */}
      <div className="mt-8 grid gap-8 sm:grid-cols-2">
        <section aria-labelledby="totals-heading">
          <h2 id="totals-heading" className="font-display text-lg font-semibold text-ink">
            Payment
          </h2>

          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Subtotal" value={formatPaise(order.subtotalPaise)} />
            {order.discountPaise > 0 && (
              <Row label="Discount" value={`− ${formatPaise(order.discountPaise)}`} tone="success" />
            )}
            <Row label="Delivery" value={order.shippingPaise === 0 ? 'Free' : formatPaise(order.shippingPaise)} />
            {order.taxPaise > 0 && <Row label="Tax" value={formatPaise(order.taxPaise)} />}
            <div className="flex justify-between border-t border-line pt-2">
              <dt className="font-semibold text-ink">Total</dt>
              <dd className="font-semibold tabular-nums text-ink">{formatPaise(order.totalPaise)}</dd>
            </div>
            {order.amountRefundedPaise > 0 && (
              <Row label="Refunded" value={formatPaise(order.amountRefundedPaise)} tone="success" />
            )}
          </dl>

          {order.invoiceNumber && (
            <p className="mt-3 text-xs text-ink-muted">
              Invoice <span className="font-mono">{order.invoiceNumber}</span>
              {' · '}
              <Link
                href={`/api/v1/orders/${order.id}/invoice`}
                className="underline decoration-line underline-offset-4 hover:text-ink"
              >
                Download receipt
              </Link>
            </p>
          )}
        </section>

        <section aria-labelledby="address-heading">
          <h2 id="address-heading" className="font-display text-lg font-semibold text-ink">
            Delivered to
          </h2>

          <address className="mt-3 text-sm not-italic leading-relaxed text-ink-soft">
            <span className="block font-medium text-ink">{order.customerName}</span>
            {formatAddress(order.shippingAddress)}
          </address>

          {order.shippingMethodLabel && (
            <p className="mt-3 text-xs text-ink-muted">{order.shippingMethodLabel}</p>
          )}
        </section>
      </div>

      {/* ---------- Customer actions ---------- */}
      <OrderActions
        orderId={order.id}
        orderNumber={order.orderNumber}
        canCancel={cancel.allowed}
        cancelReason={cancel.reason}
        canReturn={order.fulfillmentStatus === FULFILLMENT_STATUS.DELIVERED}
      />

      <p className="mt-10 text-sm text-ink-muted">
        Something wrong with this order?{' '}
        <Link href={`/contact?order=${order.orderNumber}`} className="underline decoration-line underline-offset-4 hover:text-ink">
          Contact us
        </Link>{' '}
        — quote {order.orderNumber} and we will pick it up straight away. Our address is{' '}
        {env().SUPPORT_EMAIL}.
      </p>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'success' }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={tone === 'success' ? 'tabular-nums text-success' : 'tabular-nums text-ink'}>{value}</dd>
    </div>
  );
}

function badgeToneForOrder(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (status === ORDER_STATUS.CANCELLED) return 'danger';
  if (status === ORDER_STATUS.CONFIRMED) return 'success';
  return 'warning';
}

/** Emails are masked in the UI; the full address is in the customer's inbox. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

function formatAddress(json: string) {
  try {
    const address = JSON.parse(json) as Record<string, string | null>;
    return (
      <>
        {[address.line1, address.line2].filter(Boolean).join(', ')}
        <br />
        {[address.city, address.state, address.postalCode].filter(Boolean).join(', ')}
        <br />
        {address.country}
        {address.phone ? (
          <>
            <br />
            {address.phone}
          </>
        ) : null}
      </>
    );
  } catch {
    return <span className="text-ink-muted">Address unavailable</span>;
  }
}
