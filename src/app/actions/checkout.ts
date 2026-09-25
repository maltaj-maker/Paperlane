'use server';

/**
 * Checkout.
 *
 * The whole flow in one place, in the order it actually happens:
 *
 *   1. validate the submission (`checkoutSchema` is the trust boundary),
 *   2. `createOrder` — one transaction that re-prices the basket from the
 *      database, reserves stock optimistically, applies the coupon with its
 *      counters, and is idempotent on the client's key,
 *   3. attach a Payment row and ask the provider for a payment,
 *   4. send the customer to the provider, or confirm a COD order immediately.
 *
 * Two things this file deliberately does *not* do:
 *  - It never trusts a price, a total or a stock figure from the browser. The
 *    only client values used are ids, quantities and the customer's own details.
 *  - It never marks an order paid. Only `confirmPayment()` may do that, and only
 *    from a verified webhook or a server-to-server status query.
 *
 * If a provider fails we keep the order (stock held, payment pending) and offer
 * a retry, rather than discarding a real order because a redirect did not open.
 */

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { db } from '@/server/db';
import { createOrder, buildMerchantTransactionId } from '@/server/orders';
import { sendOrderConfirmation } from '@/server/notifications';
import { getCartView } from '@/server/cart';
import { getCurrentUser } from '@/server/auth';
import { consume, RATE_LIMITS, limitKey } from '@/server/rate-limit';
import { getPaymentProvider, getEnabledPaymentMethods, PaymentProviderError } from '@/server/payments';
import type { PaymentMethod } from '@/server/payments/types';
import { getAddressesForUser } from '@/server/customers';
import { checkoutSchema } from '@/lib/validation';
import { env } from '@/lib/env';
import { isSupportedCurrency, type SupportedCurrency } from '@/lib/currency';
import { logger } from '@/lib/logger';
import { recordAudit } from '@/server/audit';
import { AUDIT_ACTION, ANALYTICS_EVENT } from '@/lib/constants';
import { trackEvent } from '@/server/analytics';
import {
  ok,
  fail,
  fromError,
  zodFieldErrors,
  formString,
  formBoolean,
  type ActionState,
} from './types';
import { getAnalyticsContext, getClientIpForLimit, getUserAgentSafe } from '@/server/request-context';

export interface PlaceOrderResult {
  orderId: string;
  orderNumber: string;
  /** Where the browser should go next. */
  redirectTo: string;
  requiresPayment: boolean;
}

export async function placeOrderAction(
  _prev: ActionState<PlaceOrderResult>,
  formData: FormData,
): Promise<ActionState<PlaceOrderResult>> {
  const ip = await getClientIpForLimit();
  let successRedirect: string | null = null;

  try {
    // --- Rate limit -------------------------------------------------------
    const limit = await consume('CHECKOUT_CREATE', limitKey('checkout:ip', ip), RATE_LIMITS.CHECKOUT_CREATE);
    if (!limit.allowed) {
      return fail('That is a lot of checkout attempts. Please wait a few minutes.', {
        code: 'RATE_LIMITED',
        retryable: true,
      });
    }

    // --- Validate ---------------------------------------------------------
    const parsed = checkoutSchema.safeParse({
      idempotencyKey: formString(formData, 'idempotencyKey'),
      email: formString(formData, 'email'),
      phone: formString(formData, 'phone'),
      customerName: formString(formData, 'customerName'),
      shippingAddress: readAddress(formData, 'shipping'),
      billingSameAsShipping: formBoolean(formData, 'billingSameAsShipping') ?? true,
      billingAddress: readAddress(formData, 'billing'),
      shippingMethodId: formString(formData, 'shippingMethodId') ?? null,
      paymentMethod: formString(formData, 'paymentMethod'),
      currency: formString(formData, 'currency') ?? 'INR',
      couponCode: formString(formData, 'couponCode') ?? null,
      giftCardCode: formString(formData, 'giftCardCode') ?? null,
      notes: formString(formData, 'notes') ?? null,
      acceptTerms: formBoolean(formData, 'acceptTerms'),
      website: formString(formData, 'website'),
    });

    if (!parsed.success) {
      return fail('Please check the highlighted fields and try again.', {
        code: 'VALIDATION_ERROR',
        fieldErrors: zodFieldErrors(parsed.error.issues),
      });
    }

    const input = parsed.data;
    if (!isSupportedCurrency(input.currency)) {
      return fail('That currency is not supported. Please choose another.', { code: 'VALIDATION_ERROR' });
    }
    const selectedCurrency = input.currency as SupportedCurrency;
    const configuredProvider = env().PAYMENTS_PROVIDER;
    if (configuredProvider === 'phonepe' && selectedCurrency !== 'INR') {
      return fail('This payment provider currently accepts INR only. Please choose INR.', { code: 'PAYMENT_METHOD_UNAVAILABLE' });
    }

    // Honeypot: a bot filling every field trips this. Fail quietly, with a
    // message that does not reveal the trap.
    if (input.website) {
      logger.warn('checkout honeypot triggered', { ip });
      return fail('We could not process that order. Please try again.', { code: 'BLOCKED' });
    }

    // --- Basket -----------------------------------------------------------
    // Read the real basket. If it is empty there is nothing to order, whatever
    // the client believes.
    const view = await getCartView();
    if (!view || view.lines.length === 0) {
      return fail('Your basket is empty.', { code: 'CART_EMPTY' });
    }

    const unavailable = view.lines.filter((line) => line.status === 'out_of_stock' || line.available <= 0);
    if (unavailable.length > 0) {
      return fail(
        unavailable.length === 1
          ? `“${unavailable[0]!.book.title}” sold out while you were shopping. Please remove it to continue.`
          : `${unavailable.length} books in your basket are no longer available. Please remove them to continue.`,
        { code: 'OUT_OF_STOCK' },
      );
    }

    // Payment availability is checked again on the server. COD is intentionally
    // restricted to Kolkata, even if a client attempts to submit it manually.
    const methods = getEnabledPaymentMethods();
    const requested = methods.find((method) => method.method === input.paymentMethod);
    if (!requested || !requested.available) {
      return fail('That payment method is not available right now. Please choose another.', {
        code: 'PAYMENT_METHOD_UNAVAILABLE',
      });
    }

    if (input.paymentMethod === 'COD') {
      if (selectedCurrency !== 'INR') {
        return fail('Cash on delivery is available only when paying in INR.', { code: 'PAYMENT_METHOD_UNAVAILABLE' });
      }
      const { isCodAvailable } = await import('@/server/shipping');
      const allowed = await isCodAvailable({
        country: input.shippingAddress.country,
        state: input.shippingAddress.state,
        city: input.shippingAddress.city,
        postalCode: input.shippingAddress.postalCode,
      });
      if (!allowed) {
        return fail('Cash on delivery is available only for eligible Kolkata postcodes. Please choose online payment.', {
          code: 'PAYMENT_METHOD_UNAVAILABLE',
        });
      }
    }

    // --- User + context ---------------------------------------------------
    const user = await getCurrentUser().catch(() => null);
    const context = await getAnalyticsContext();
    const provider = getPaymentProvider();

    // --- Create the order -------------------------------------------------
    const created = await createOrder({
      idempotencyKey: input.idempotencyKey,
      cartId: view.cartId,
      userId: user?.id ?? null,
      email: input.email,
      phone: input.phone,
      customerName: input.customerName,
      shippingAddress: input.shippingAddress,
      billingAddress: input.billingSameAsShipping ? undefined : input.billingAddress,
      shippingMethodId: input.shippingMethodId,
      couponCode: input.couponCode,
      giftCardCode: input.giftCardCode,
      notes: input.notes,
      paymentProvider: input.paymentMethod === 'COD' ? 'cod' : provider.key,
      currency: selectedCurrency,
      ipAddress: ip,
      userAgent: await getUserAgentSafe(),
      sessionId: context.sessionId,
      isGuest: !user,
    });

    await trackEvent({
      name: ANALYTICS_EVENT.BEGIN_CHECKOUT,
      sessionId: context.sessionId,
      userId: user?.id ?? null,
      path: '/checkout',
      referrer: context.referrer,
      device: context.device,
      props: {
        orderNumber: created.orderNumber,
        valuePaise: created.totalPaise,
        itemCount: view.totals.itemCount,
        paymentMethod: input.paymentMethod,
      },
    });

    // --- Cash on delivery: confirmed now ----------------------------------
    if (input.paymentMethod === 'COD') {
      if (selectedCurrency !== 'INR') {
        return fail('Cash on delivery is available only when paying in INR.', { code: 'PAYMENT_METHOD_UNAVAILABLE' });
      }
      await db.order.update({
        where: { id: created.orderId },
        data: {
          paymentStatus: 'cod_pending',
          status: 'confirmed',
          confirmedAt: new Date(),
          fulfillmentStatus: 'unfulfilled',
        },
      });

      await recordAudit({
        actorId: user?.id ?? null,
        actorEmail: input.email,
        action: AUDIT_ACTION.ORDER_CREATE,
        entityType: 'order',
        entityId: created.orderId,
        summary: `COD order placed (${created.orderNumber})`,
        after: { totalPaise: created.totalPaise, method: 'COD' },
        ip,
      });

      await sendConfirmationEmailSafely(created.orderId);

      successRedirect = `/orders/${created.orderId}?placed=1`;
      return ok({
        orderId: created.orderId,
        orderNumber: created.orderNumber,
        redirectTo: successRedirect,
        requiresPayment: false,
      });
    }

    // --- Online payment ---------------------------------------------------
    const merchantTransactionId = await buildMerchantTransactionId(created.orderId);

    const payment = await db.payment.create({
      data: {
        orderId: created.orderId,
        provider: provider.key,
        merchantTransactionId,
        amountPaise: created.amountDuePaise,
        currency: selectedCurrency,
        method: input.paymentMethod as PaymentMethod,
        status: 'initiated',
        idempotencyKey: `${input.idempotencyKey}:pay`,
      },
      select: { id: true },
    });

    const base = env().APP_URL.replace(/\/$/, '');

    try {
      const result = await provider.createPayment({
        orderNumber: created.orderNumber,
        merchantTransactionId,
        amountPaise: created.amountDuePaise,
        currency: selectedCurrency,
        customer: {
          id: user?.id ?? null,
          name: input.customerName,
          email: input.email,
          phone: input.phone,
        },
        // Both the browser return and the server-to-server callback point at
        // endpoints that verify with the provider before believing anything.
        redirectUrl: `${base}/api/v1/payments/${provider.key}/return?txn=${encodeURIComponent(merchantTransactionId)}`,
        callbackUrl: `${base}/api/v1/payments/${provider.key}/webhook`,
        description: `Order ${created.orderNumber}`,
        items: view.lines.map((line) => ({
          name: line.book.title,
          quantity: line.quantity,
          unitPricePaise: line.currentUnitPricePaise,
        })),
        preferredMethod: input.paymentMethod as PaymentMethod,
        metadata: { orderNumber: created.orderNumber, paymentId: payment.id },
      });

      await db.payment.update({
        where: { id: payment.id },
        data: {
          providerOrderId: result.providerOrderId,
          status: result.state === 'initiated' ? 'initiated' : 'pending',
          // Stored for reconciliation. The provider adapter has already removed
          // secrets; we still cap the size so a verbose payload cannot bloat a row.
          responsePayload: JSON.stringify(result.raw ?? {}).slice(0, 8_000),
        },
      });

      await recordAudit({
        actorId: user?.id ?? null,
        actorEmail: input.email,
        action: AUDIT_ACTION.ORDER_CREATE,
        entityType: 'order',
        entityId: created.orderId,
        summary: `Online order started (${created.orderNumber})`,
        after: { totalPaise: created.totalPaise, method: input.paymentMethod, provider: provider.key },
        ip,
      });

      if (!result.redirectUrl) {
        // The provider accepted the payment but gave us nowhere to send the
        // customer. The order stands; the customer gets a retry on the order page.
        return fail(
          'We could not open the payment page. Your order is saved — you can retry payment from your order.',
          { code: 'PAYMENT_INIT_FAILED', retryable: true },
        );
      }

      successRedirect = result.redirectUrl;
      return ok({
        orderId: created.orderId,
        orderNumber: created.orderNumber,
        redirectTo: successRedirect,
        requiresPayment: true,
      });
    } catch (err) {
      // Provider failure: keep the order, hold the stock, let the customer retry.
      // The adapter's message is written for a customer to read; the underlying
      // payload is logged, never shown.
      const message =
        err instanceof PaymentProviderError
          ? err.message
          : 'We could not reach the payment provider.';

      await db.payment.update({
        where: { id: payment.id },
        data: { status: 'failed', failureReason: String(err).slice(0, 500) },
      });

      logger.error('payment initiation failed', {
        orderNumber: created.orderNumber,
        provider: provider.key,
        err,
      });

      return fail(
        `${message} Your order ${created.orderNumber} is saved — retry payment from the order page, or choose cash on delivery.`,
        { code: 'PAYMENT_INIT_FAILED', retryable: true },
      );
    }
  } catch (err) {
    return fromError(err);
  } finally {
    // `redirect()` throws internally, so it must not run inside the try block —
    // a catch would swallow the navigation.
    if (successRedirect) redirect(successRedirect);
  }
}

// ---------------------------------------------------------------------------
// Retry a failed payment
// ---------------------------------------------------------------------------

export async function retryPaymentAction(
  _prev: ActionState<PlaceOrderResult>,
  formData: FormData,
): Promise<ActionState<PlaceOrderResult>> {
  const ip = await getClientIpForLimit();
  let successRedirect: string | null = null;

  try {
    const limit = await consume('PAYMENT_INITIATE', limitKey('payment:ip', ip), RATE_LIMITS.PAYMENT_INITIATE);
    if (!limit.allowed) {
      return fail('Too many attempts. Please wait a moment.', { code: 'RATE_LIMITED', retryable: true });
    }

    const orderId = formString(formData, 'orderId');
    const paymentMethod = formString(formData, 'paymentMethod') ?? 'UPI';
    if (!orderId) return fail('We could not find that order.', { code: 'NOT_FOUND' });

    const user = await getCurrentUser().catch(() => null);
    const orderRow = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        userId: true,
        email: true,
        phone: true,
        customerName: true,
        paymentStatus: true,
        currency: true,
        totalPaise: true,
        amountPaidPaise: true,
      },
    });

    if (!orderRow) return fail('We could not find that order.', { code: 'NOT_FOUND' });

    // Authorisation: an order belongs to the account that placed it, or to the
    // guest who placed it and can prove it with the matching email. The order
    // number alone is never sufficient.
    const isOwner = Boolean(user && orderRow.userId === user.id);
    const isGuestOwner = !orderRow.userId && orderRow.email.toLowerCase() === (formString(formData, 'email') ?? '').toLowerCase();

    if (!isOwner && !isGuestOwner) {
      return fail('That order is not on your account.', { code: 'FORBIDDEN' });
    }

    if (orderRow.paymentStatus === 'paid' || orderRow.paymentStatus === 'partially_refunded') {
      // Never take a second payment for an order that is already settled.
      return fail('This order is already paid.', { code: 'ALREADY_PAID' });
    }

    // Amount outstanding, computed from the order row — never from the form.
    const outstandingPaise = Math.max(0, orderRow.totalPaise - orderRow.amountPaidPaise);
    if (outstandingPaise <= 0) {
      return fail('There is nothing left to pay on this order.', { code: 'ALREADY_PAID' });
    }

    const order = orderRow;

    const provider = getPaymentProvider();
    if (!provider.isConfigured().ok) {
      return fail('Online payment is not available right now. Please choose cash on delivery.', {
        code: 'PAYMENT_METHOD_UNAVAILABLE',
      });
    }
    const merchantTransactionId = await buildMerchantTransactionId(order.id);

    await db.payment.create({
      data: {
        orderId: order.id,
        provider: provider.key,
        merchantTransactionId,
        amountPaise: outstandingPaise,
        currency: order.currency,
        method: paymentMethod as PaymentMethod,
        status: 'initiated',
        idempotencyKey: `retry:${order.id}:${Date.now()}`,
      },
    });

    const base = env().APP_URL.replace(/\/$/, '');

    const result = await provider.createPayment({
      orderNumber: order.orderNumber,
      merchantTransactionId,
      amountPaise: outstandingPaise,
      currency: order.currency,
      customer: { name: order.customerName, email: order.email, phone: order.phone },
      redirectUrl: `${base}/api/v1/payments/${provider.key}/return?txn=${encodeURIComponent(merchantTransactionId)}`,
      callbackUrl: `${base}/api/v1/payments/${provider.key}/webhook`,
      description: `Order ${order.orderNumber} (retry)`,
      preferredMethod: paymentMethod as PaymentMethod,
    });

    if (!result.redirectUrl) {
      return fail('We could not open the payment page. Please try again in a moment.', {
        code: 'PAYMENT_INIT_FAILED',
        retryable: true,
      });
    }

    successRedirect = result.redirectUrl;
    return ok({
      orderId: order.id,
      orderNumber: order.orderNumber,
      redirectTo: successRedirect,
      requiresPayment: true,
    });
  } catch (err) {
    return fromError(err);
  } finally {
    if (successRedirect) redirect(successRedirect);
  }
}

// ---------------------------------------------------------------------------
// Supporting reads
// ---------------------------------------------------------------------------

/**
 * Saved addresses for the signed-in customer, so checkout is two taps instead
 * of twelve fields on a phone keyboard.
 */
export async function getCheckoutAddresses() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return [];

  const addresses = await getAddressesForUser(user.id);

  return addresses.map((address) => ({
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
    isDefault: address.isDefaultShipping,
  }));
}

/**
 * Re-price the basket for the delivery options on the checkout page.
 * Called when the customer changes their postcode or shipping method, so the
 * total they see before paying is the total the server will charge.
 */
export async function refreshCheckoutTotalsAction(input: {
  postalCode?: string;
  state?: string;
  shippingMethodId?: string | null;
}) {
  try {
    const view = await getCartView({
      destination: input.postalCode
        ? { country: 'IN', state: input.state ?? '', postalCode: input.postalCode }
        : undefined,
    });

    if (!view) return ok(null);

    return ok({
      totals: view.totals,
      methods: view.totals.shipping ? [view.totals.shipping] : [],
    });
  } catch (err) {
    logger.warn('checkout total refresh failed', { err: String(err) });
    return fail('We could not update your total. Please try again.', { retryable: true });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Addresses are submitted flat (`shipping.fullName`) because a plain HTML form
 * cannot express nesting, and because dotted names survive a no-JS submit.
 */
function readAddress(formData: FormData, prefix: string) {
  const value = (field: string) => formString(formData, `${prefix}.${field}`);

  // A missing block is normal (billing-same-as-shipping); returning undefined
  // lets the schema decide what is required.
  if (!value('line1') && !value('fullName')) return undefined;

  return {
    label: value('label') ?? 'Home',
    fullName: value('fullName'),
    phone: value('phone'),
    line1: value('line1'),
    line2: value('line2') ?? null,
    city: value('city'),
    state: value('state'),
    postalCode: value('postalCode'),
    country: value('country') ?? 'IN',
    isDefaultShipping: formBoolean(formData, `${prefix}.isDefaultShipping`) ?? false,
    isDefaultBilling: formBoolean(formData, `${prefix}.isDefaultBilling`) ?? false,
  };
}

/**
 * Send the confirmation email without letting a mail failure break checkout.
 * The order exists and is paid; an email transport problem is our problem, not
 * the customer's, and it is logged as such.
 */
async function sendConfirmationEmailSafely(orderId: string): Promise<void> {
  try {
    const record = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        orderNumber: true,
        email: true,
        customerName: true,
        currency: true,
        totalPaise: true,
        shippingPaise: true,
        discountPaise: true,
        taxPaise: true,
        shippingMethodLabel: true,
        estimatedDelivery: true,
        items: {
          select: {
            titleSnapshot: true,
            authorSnapshot: true,
            quantity: true,
            lineTotalPaise: true,
          },
        },
      },
    });

    if (!record) return;

    // The email is the customer's record of the order, so it carries the exact
    // figures stored on the order — never a re-derived total.
    await sendOrderConfirmation({
      userId: record.userId,
      orderId: record.id,
      orderNumber: record.orderNumber,
      email: record.email,
      customerName: record.customerName,
      totalPaise: record.totalPaise,
      shippingPaise: record.shippingPaise,
      discountPaise: record.discountPaise,
      taxPaise: record.taxPaise,
      shippingMethod: record.shippingMethodLabel,
      estimatedDelivery: record.estimatedDelivery,
      items: record.items.map((item) => ({
        title: item.titleSnapshot,
        author: item.authorSnapshot,
        quantity: item.quantity,
        lineTotalPaise: item.lineTotalPaise,
      })),
    });
  } catch (err) {
    logger.error('order confirmation email failed', { orderId, err });
  }
}

/** Re-exported so the confirmation page can refresh an order after a redirect. */
export async function revalidateOrder(orderId: string): Promise<void> {
  revalidatePath(`/orders/${orderId}`);
}

