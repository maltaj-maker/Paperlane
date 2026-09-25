/**
 * Order service — the money path.
 *
 * Guarantees this module exists to provide:
 *
 *  1. **No duplicate orders.** Every checkout carries an idempotency key with a
 *     unique index. A double-tapped "Place order", a retried request, or a
 *     flaky network cannot create two orders or two charges.
 *  2. **No overselling.** Stock is reserved inside the same transaction that
 *     creates the order. If reservation fails, the whole order rolls back.
 *  3. **No order marked paid without verification.** Only `confirmPayment()`
 *     flips an order to paid, and it is only ever called after a *signed*
 *     webhook or a *server-to-server* status query — never from client input.
 *  4. **Auditable.** Every state change writes an OrderEvent, and the price/
 *     stock history lives in immutable snapshots and StockMovement rows.
 */

import type { Prisma } from '@prisma/client';
import { db, withRetry } from './db';
import { env } from '@/lib/env';
import { configuredInrFxRates, convertFromInrPaise, isSupportedCurrency, type SupportedCurrency } from '@/lib/currency';
import { logger } from '@/lib/logger';
import { AppError, conflict, notFound } from '@/lib/errors';
import { calculateTotals, type OrderTotals } from './pricing';
import {
  assertPurchasable,
  commitReservation,
  releaseReservation,
  reserveStock,
  restockOrderItem,
  type Tx,
} from './inventory';
import { generateReference, generateToken } from '@/lib/crypto';
import {
  FULFILLMENT_STATUS,
  ORDER_STATUS,
  PAYMENT_STATUS,
  STOCK_MOVEMENT,
} from '@/lib/constants';
import { sumPaise } from '@/lib/money';

export interface ShippingAddressInput {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
}

export interface CreateOrderInput {
  /** Client-generated, unique per checkout attempt. This is the anti-duplicate key. */
  idempotencyKey: string;
  cartId: string;
  userId?: string | null;
  email: string;
  phone: string;
  customerName: string;
  shippingAddress: ShippingAddressInput;
  billingAddress?: ShippingAddressInput;
  shippingMethodId?: string | null;
  couponCode?: string | null;
  giftCardCode?: string | null;
  notes?: string | null;
  paymentProvider: string;
  currency?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Analytics session id, for traffic-source attribution. */
  sessionId?: string | null;
  /** Guest checkout is a first-class flow; true suppresses account requirement. */
  isGuest?: boolean;
}

export interface CreatedOrder {
  orderId: string;
  orderNumber: string;
  totalPaise: number;
  amountDuePaise: number;
  currency: string;
  /** True when this call replayed an existing idempotency key. */
  replayed: boolean;
  paymentId: string | null;
  merchantTransactionId: string | null;
}

// ---------------------------------------------------------------------------
// Order number generation
// ---------------------------------------------------------------------------

/**
 * Human-readable order number: PL-2509-7K2M4Q.
 * Uses an unambiguous alphabet so a customer can read it over the phone.
 */
function buildOrderNumber(now = new Date()): string {
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const random = generateToken(6).replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase();
  return `PL-${yy}${mm}-${random}`;
}

// ---------------------------------------------------------------------------
// Create order
// ---------------------------------------------------------------------------

/**
 * Turn a cart into a pending order with reserved stock.
 *
 * The order starts in `pending`/`unpaid`. Payment confirmation is a separate,
 * provider-driven step. That separation is deliberate: an order row exists even
 * if the customer abandons the payment page, which gives support something to
 * look up and gives us an abandoned-checkout metric.
 */
export async function createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
  // --- Idempotency fast path ---
  const existing = await db.order.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: {
      id: true,
      orderNumber: true,
      totalPaise: true,
      currency: true,
      paymentStatus: true,
      payments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, merchantTransactionId: true },
      },
    },
  });

  if (existing) {
    logger.info('order creation replayed (idempotency key)', {
      orderNumber: existing.orderNumber,
    });
    return {
      orderId: existing.id,
      orderNumber: existing.orderNumber,
      totalPaise: existing.totalPaise,
      amountDuePaise: existing.totalPaise,
      currency: existing.currency,
      replayed: true,
      paymentId: existing.payments[0]?.id ?? null,
      merchantTransactionId: existing.payments[0]?.merchantTransactionId ?? null,
    };
  }

  return withRetry(
    () =>
      db.$transaction(
        async (tx) => {
          // 1. Load and validate the cart.
          const cart = await tx.cart.findUnique({
            where: { id: input.cartId },
            include: {
              items: {
                include: {
                  book: {
                    select: {
                      id: true,
                      title: true,
                      slug: true,
                      coverImageUrl: true,
                      format: true,
                      isbn13: true,
                      pricePaise: true,
                      salePricePaise: true,
                      taxCategory: true,
                      status: true,
                      deletedAt: true,
                      author: { select: { name: true } },
                    },
                  },
                },
              },
            },
          });

          if (!cart) throw notFound('Your basket could not be found. Please add your books again.');
          if (cart.items.length === 0) {
            throw new AppError('CART_EMPTY', 'Your basket is empty.');
          }

          // A signed-in customer may only check out their own cart.
          if (cart.userId && input.userId && cart.userId !== input.userId) {
            throw notFound('Your basket could not be found.');
          }

          const lines = cart.items.map((item) => ({
            bookId: item.bookId,
            quantity: item.quantity,
          }));

          // 2. Re-price server-side. The client's numbers are ignored entirely.
          const destination = {
            country: (input.shippingAddress.country ?? 'IN').toUpperCase(),
            state: input.shippingAddress.state,
            postalCode: input.shippingAddress.postalCode,
          };

          const totals = await calculateTotals({
            lines: lines.map((l) => ({ bookId: l.bookId, quantity: l.quantity })),
            destination,
            shippingMethodId: input.shippingMethodId,
            couponCode: input.couponCode ?? cart.couponCode,
            userId: input.userId ?? null,
            email: input.email,
          });

          const requestedCurrency = (input.currency ?? 'INR').toUpperCase();
          if (!isSupportedCurrency(requestedCurrency)) throw new AppError('VALIDATION_ERROR', 'Unsupported checkout currency.');
          const rates = configuredInrFxRates(env().CURRENCY_RATES_JSON);
          const fxRate = requestedCurrency === 'INR' ? 1 : rates[requestedCurrency as SupportedCurrency];
          if (!fxRate) throw new AppError('UPSTREAM_ERROR', 'The selected currency is temporarily unavailable.', { retryable: true });
          const present = (amount: number) => requestedCurrency === 'INR' ? amount : convertFromInrPaise(amount, requestedCurrency as SupportedCurrency, fxRate);

          // 3. Verify every line is genuinely purchasable right now.
          await assertPurchasable(lines, tx);

          // 4. Reserve stock atomically. Any failure rolls back the transaction.
          const reservation = await reserveStock(tx, lines, {
            referenceType: 'order',
            // Placeholder id: the reservation is re-keyed to the order id below.
            referenceId: `pending:${input.idempotencyKey}`,
            ttlMinutes: 60, // long enough for a UPI flow; swept if abandoned
          });

          if (reservation.failures.length > 0) {
            const details: Record<string, string[]> = {};
            for (const failure of reservation.failures) {
              const line = cart.items.find((i) => i.bookId === failure.bookId);
              details[failure.bookId] = [
                failure.available > 0
                  ? `Only ${failure.available} left of “${line?.book.title ?? 'this title'}”.`
                  : `“${line?.book.title ?? 'This title'}” just sold out.`,
              ];
            }
            throw new AppError(
              'OUT_OF_STOCK',
              'Some books in your basket are no longer available. Please review your basket.',
              { details, retryable: true },
            );
          }

          // 5. Create the order.
          const orderNumber = buildOrderNumber();
          const now = new Date();

          const order = await tx.order.create({
            data: {
              orderNumber,
              userId: input.userId ?? null,
              email: input.email.toLowerCase().trim(),
              phone: input.phone.trim(),
              customerName: input.customerName.trim(),
              status: ORDER_STATUS.PENDING,
              paymentStatus: PAYMENT_STATUS.PENDING,
              fulfillmentStatus: FULFILLMENT_STATUS.UNFULFILLED,
              currency: requestedCurrency,
              subtotalPaise: present(totals.subtotalPaise),
              discountPaise: present(totals.discountPaise),
              taxPaise: present(totals.taxPaise),
              shippingPaise: present(totals.shippingPaise),
              totalPaise: present(totals.totalPaise),
              couponCode: totals.coupon?.code ?? null,
              giftCardCode: input.giftCardCode ?? null,
              giftCardPaise: present(totals.giftCardPaise),
              shippingAddress: JSON.stringify(input.shippingAddress),
              billingAddress: JSON.stringify(input.billingAddress ?? input.shippingAddress),
              shippingMethodId: totals.shipping?.methodId ?? null,
              shippingMethodLabel: totals.shipping?.label ?? null,
              estimatedDelivery: totals.shipping?.estimatedDeliveryTo ?? null,
              notes: input.notes ?? null,
              ipAddress: input.ipAddress ?? null,
              userAgent: input.userAgent?.slice(0, 400) ?? null,
              sessionId: input.sessionId ?? null,
              idempotencyKey: input.idempotencyKey,
              placedAt: now,
            },
            select: { id: true, orderNumber: true, totalPaise: true, currency: true },
          });

          // 6. Re-key reservations to the real order id so they can be released
          //    or committed by order.
          await tx.stockReservation.updateMany({
            where: { referenceType: 'order', referenceId: `pending:${input.idempotencyKey}` },
            data: { referenceId: order.id },
          });

          // 7. Immutable line snapshots.
          const warehouseByBook = new Map(
            reservation.reservations.map((r) => [r.bookId, r.warehouseId]),
          );

          for (const line of totals.lines) {
            const cartItem = cart.items.find((i) => i.bookId === line.bookId);
            if (!cartItem) continue;

            await tx.orderItem.create({
              data: {
                orderId: order.id,
                bookId: line.bookId,
                titleSnapshot: line.title,
                authorSnapshot: cartItem.book.author.name,
                slugSnapshot: line.slug,
                isbnSnapshot: cartItem.book.isbn13,
                coverSnapshot: line.cover,
                formatSnapshot: line.format,
                hsnCode: line.hsnCode,
                quantity: line.quantity,
                unitPricePaise: present(line.unitPricePaise),
                mrpPaise: present(line.mrpPaise),
                discountPaise: present(line.lineDiscountPaise),
                taxPaise: present(line.lineTaxPaise),
                taxRateBp: line.taxRateBp,
                lineTotalPaise: present(line.lineTotalPaise),
                warehouseId: warehouseByBook.get(line.bookId) ?? null,
              },
            });
          }

          // 8. Coupon redemption is counted here, inside the transaction, so a
          //    usage limit cannot be exceeded by concurrent checkouts.
          if (totals.coupon) {
            const coupon = await tx.coupon.findUnique({
              where: { code: totals.coupon.code },
              select: { id: true, usageLimit: true, usedCount: true },
            });

            if (coupon) {
              if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
                throw new AppError('COUPON_INVALID', 'That coupon has just been fully redeemed.');
              }

              // Compare-and-swap on usedCount to make the cap exact.
              const updated = await tx.coupon.updateMany({
                where: { id: coupon.id, usedCount: coupon.usedCount },
                data: { usedCount: { increment: 1 } },
              });
              if (updated.count === 0) {
                throw conflict('That coupon is being redeemed right now. Please try again.');
              }

              await tx.couponRedemption.create({
                data: {
                  couponId: coupon.id,
                  userId: input.userId ?? null,
                  orderId: order.id,
                  email: input.email.toLowerCase().trim(),
                  amountPaise: present(totals.discountPaise),
                },
              });
            }
          }

          // 9. Mark the cart as converted and detach it, so a repeat visit
          //    starts a fresh basket.
          await tx.cart.update({
            where: { id: cart.id },
            data: { status: 'converted', userId: cart.userId ?? input.userId ?? null },
          });

          await tx.orderEvent.create({
            data: {
              orderId: order.id,
              type: 'created',
              message: `Order placed for ${totals.itemCount} ${totals.itemCount === 1 ? 'item' : 'items'}.`,
              actorType: input.userId ? 'customer' : 'guest',
              metadata: JSON.stringify({ itemCount: totals.itemCount, totalPaise: present(totals.totalPaise), currency: requestedCurrency }),
            },
          });

          return {
            orderId: order.id,
            orderNumber: order.orderNumber,
            totalPaise: order.totalPaise,
            amountDuePaise: present(totals.amountDuePaise),
            currency: order.currency,
            replayed: false,
            paymentId: null,
            merchantTransactionId: null,
          };
        },
        { timeout: 20_000, maxWait: 10_000 },
      ),
    { label: 'createOrder', attempts: 4 },
  );
}

// ---------------------------------------------------------------------------
// Payment confirmation — the only path to "paid"
// ---------------------------------------------------------------------------

export interface PaymentConfirmationInput {
  merchantTransactionId: string;
  /** Verified provider state. */
  state: 'captured' | 'authorized' | 'failed' | 'cancelled' | 'expired' | 'pending';
  providerPaymentId?: string | null;
  providerTxnId?: string | null;
  method?: string | null;
  methodDetail?: string | null;
  amountPaise?: number | null;
  failureCode?: string | null;
  failureReason?: string | null;
  /** Verified webhook or server-side query; recorded for the audit trail. */
  source: 'webhook' | 'status_query' | 'admin';
  rawPayload?: unknown;
}

export interface PaymentConfirmationResult {
  orderId: string;
  orderNumber: string;
  status: 'confirmed' | 'failed' | 'already_confirmed' | 'amount_mismatch';
  message: string;
}

/**
 * Apply a verified payment outcome.
 *
 * Idempotent by construction: the first thing it does is check whether the order
 * is already paid. Webhooks retry, and a status poll can race a webhook — both
 * must be safe.
 *
 * Amount verification: the provider-reported amount must match the order total.
 * A mismatch is treated as a hard failure and escalated, never silently accepted.
 */
export async function confirmPayment(
  input: PaymentConfirmationInput,
): Promise<PaymentConfirmationResult> {
  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({
          where: { merchantTransactionId: input.merchantTransactionId },
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                totalPaise: true,
                paymentStatus: true,
                status: true,
                amountPaidPaise: true,
                fulfillmentStatus: true,
                invoiceNumber: true,
              },
            },
          },
        });

        if (!payment) {
          // Could be a webhook for an order that was never created on our side
          // (or an outright forgery that happened to pass signature checks).
          throw notFound(`No payment matches ${input.merchantTransactionId}.`);
        }

        const order = payment.order;

        // --- Idempotency guard ---
        if (order.paymentStatus === PAYMENT_STATUS.PAID && input.state === 'captured') {
          logger.info('payment confirmation replayed', { orderNumber: order.orderNumber });
          return {
            orderId: order.id,
            orderNumber: order.orderNumber,
            status: 'already_confirmed' as const,
            message: 'Payment was already confirmed.',
          };
        }

        // Terminal failures on an already-cancelled order are no-ops.
        if (order.status === ORDER_STATUS.CANCELLED) {
          return {
            orderId: order.id,
            orderNumber: order.orderNumber,
            status: 'failed' as const,
            message: 'This order was cancelled.',
          };
        }

        // --- Failure paths ---
        if (input.state !== 'captured' && input.state !== 'authorized') {
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: input.state,
              providerPaymentId: input.providerPaymentId ?? payment.providerPaymentId,
              failureCode: input.failureCode ?? null,
              failureReason: input.failureReason ?? null,
              responsePayload: safeJson(input.rawPayload),
              updatedAt: new Date(),
            },
          });

          await tx.order.update({
            where: { id: order.id },
            data: { paymentStatus: PAYMENT_STATUS.FAILED },
          });

          await tx.orderEvent.create({
            data: {
              orderId: order.id,
              type: 'payment_failed',
              message:
                input.failureReason ??
                (input.state === 'cancelled'
                  ? 'Payment was cancelled before completion.'
                  : 'The payment did not go through.'),
              actorType: 'system',
              metadata: safeJson({ code: input.failureCode, state: input.state, source: input.source }),
            },
          });

          // Release the hold so the customer — or someone else — can buy the book.
          await releaseReservation(tx, 'order', order.id, 'Payment failed');

          logger.warn('payment failed', {
            orderNumber: order.orderNumber,
            state: input.state,
            code: input.failureCode,
          });

          return {
            orderId: order.id,
            orderNumber: order.orderNumber,
            status: 'failed' as const,
            message: input.failureReason ?? 'Your payment did not go through.',
          };
        }

        // --- Amount verification (never trust the client, and never trust a
        //     provider-reported figure without checking it against our total) ---
        const expectedPaise = order.totalPaise;
        if (typeof input.amountPaise === 'number' && input.amountPaise !== expectedPaise) {
          logger.error('payment amount mismatch — escalating', {
            orderNumber: order.orderNumber,
            expectedPaise,
            receivedPaise: input.amountPaise,
          });

          await tx.orderEvent.create({
            data: {
              orderId: order.id,
              type: 'payment_amount_mismatch',
              message: 'Payment amount did not match the order total. Held for manual review.',
              actorType: 'system',
              // Surfaced in the admin order list as a needs-attention flag.
              metadata: safeJson({ expectedPaise, receivedPaise: input.amountPaise, needsReview: true }),
            },
          });

          return {
            orderId: order.id,
            orderNumber: order.orderNumber,
            status: 'amount_mismatch' as const,
            message: 'The amount we received did not match your order. Our team will contact you.',
          };
        }

        // --- Success ---
        const now = new Date();

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'captured',
            method: input.method ?? payment.method,
            methodDetail: input.methodDetail ?? payment.methodDetail,
            providerPaymentId: input.providerPaymentId ?? payment.providerPaymentId,
            providerTxnId: input.providerTxnId ?? payment.providerTxnId,
            responsePayload: safeJson(input.rawPayload),
            verifiedAt: now,
            capturedAt: now,
            failureCode: null,
            failureReason: null,
          },
        });

        await tx.order.update({
          where: { id: order.id },
          data: {
            status: ORDER_STATUS.CONFIRMED,
            paymentStatus: PAYMENT_STATUS.PAID,
            amountPaidPaise: { increment: expectedPaise },
            confirmedAt: now,
            // Assigned once, on first confirmation, for tax invoicing.
            invoiceNumber: order.invoiceNumber ?? (await nextInvoiceNumber(tx)),
            // Move straight into the fulfilment queue so ops see it immediately.
            fulfillmentStatus:
              order.fulfillmentStatus === FULFILLMENT_STATUS.UNFULFILLED
                ? FULFILLMENT_STATUS.PROCESSING
                : order.fulfillmentStatus,
          },
        });

        // Paid stock becomes sold stock.
        await commitReservation(tx, 'order', order.id);

        // Denormalised sales counters power bestseller/trending lists.
        const items = await tx.orderItem.findMany({
          where: { orderId: order.id },
          select: { bookId: true, quantity: true },
        });
        for (const item of items) {
          if (!item.bookId) continue;
          await tx.book.update({
            where: { id: item.bookId },
            data: { salesCount: { increment: item.quantity } },
          });
        }

        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: 'payment_verified',
            message: `Payment of ₹${(expectedPaise / 100).toFixed(2)} verified via ${input.method ?? 'online payment'}.`,
            actorType: 'system',
            metadata: safeJson({
              source: input.source,
              method: input.method,
              providerPaymentId: input.providerPaymentId,
            }),
          },
        });

        logger.info('order paid', {
          orderNumber: order.orderNumber,
          amountPaise: expectedPaise,
          provider: payment.provider,
          source: input.source,
        });

        return {
          orderId: order.id,
          orderNumber: order.orderNumber,
          status: 'confirmed' as const,
          message: 'Payment confirmed.',
        };
      }, { timeout: 20_000 }),
    { label: 'confirmPayment', attempts: 4 },
  );
}

// ---------------------------------------------------------------------------
// Cancellation & refunds
// ---------------------------------------------------------------------------

export interface CancelOrderInput {
  orderId: string;
  reason: string;
  actorId?: string | null;
  actorType?: 'customer' | 'staff' | 'system';
  /** Restock the reserved/sold copies. */
  restock?: boolean;
  /** Refund any captured amount. Requires a staff actor with permission. */
  refund?: boolean;
}

export async function cancelOrder(input: CancelOrderInput): Promise<{
  orderNumber: string;
  refundAmountPaise: number;
  refunded: boolean;
}> {
  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: input.orderId },
          include: { items: true, payments: { orderBy: { createdAt: 'desc' } } },
        });

        if (!order) throw notFound('Order not found.');
        if (order.status === ORDER_STATUS.CANCELLED) {
          return {
            orderNumber: order.orderNumber,
            refundAmountPaise: 0,
            refunded: false,
          };
        }
        if (order.fulfillmentStatus === FULFILLMENT_STATUS.DELIVERED) {
          throw conflict(
            'This order has already been delivered. Please raise a return request instead of cancelling.',
          );
        }

        const wasPaid = order.paymentStatus === PAYMENT_STATUS.PAID;
        const refundAmount = wasPaid ? order.amountPaidPaise - order.amountRefundedPaise : 0;

        // Release any still-held reservation first.
        const held = await tx.stockReservation.count({
          where: { referenceType: 'order', referenceId: order.id, releasedAt: null },
        });
        if (held > 0) {
          await releaseReservation(tx, 'order', order.id, `Order cancelled: ${input.reason}`);
        }

        // If stock was already committed (paid), put it back on the shelf.
        if (wasPaid && input.restock !== false) {
          for (const item of order.items) {
            if (!item.bookId) continue;
            await restockOrderItem(tx, {
              bookId: item.bookId,
              warehouseId: item.warehouseId,
              quantity: item.quantity - item.cancelledQty,
              type: STOCK_MOVEMENT.CANCEL,
              referenceId: order.id,
              reason: `Order ${order.orderNumber} cancelled`,
              actorId: input.actorId ?? undefined,
            });
          }
        }

        await tx.orderItem.updateMany({
          where: { orderId: order.id },
          data: { status: 'cancelled' },
        });

        await tx.order.update({
          where: { id: order.id },
          data: {
            status: ORDER_STATUS.CANCELLED,
            fulfillmentStatus: FULFILLMENT_STATUS.CANCELLED,
            cancelledAt: new Date(),
            paymentStatus: wasPaid ? order.paymentStatus : PAYMENT_STATUS.UNPAID,
          },
        });

        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: 'cancelled',
            message: `Order cancelled: ${input.reason}`,
            actorId: input.actorId ?? null,
            actorType: input.actorType ?? 'system',
          },
        });

        return {
          orderNumber: order.orderNumber,
          refundAmountPaise: refundAmount,
          refunded: false,
        };
      }, { timeout: 20_000 }),
    { label: 'cancelOrder' },
  );
}

export interface CreateRefundInput {
  orderId: string;
  amountPaise: number;
  reason: string;
  actorId: string;
  /** `full` refunds the remaining balance; `partial` uses amountPaise. */
  kind: 'full' | 'partial';
  notes?: string | null;
  restock?: boolean;
}

/**
 * Record a refund request.
 *
 * The actual provider call happens *after* the DB row is committed, so a refund
 * that reaches the provider always has a local record first. If the provider
 * call then fails, the row stays in `processing`/`failed` for an operator to
 * retry rather than vanishing.
 */
export async function createRefund(input: CreateRefundInput): Promise<{ refundId: string; amountPaise: number }> {
  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: input.orderId },
          include: {
            payments: { where: { status: 'captured' }, orderBy: { createdAt: 'desc' }, take: 1 },
            items: true,
          },
        });

        if (!order) throw notFound('Order not found.');

        const refundable = order.amountPaidPaise - order.amountRefundedPaise;
        if (refundable <= 0) {
          throw conflict('There is nothing left to refund on this order.');
        }

        const amount =
          input.kind === 'full' ? refundable : Math.min(Math.max(0, Math.floor(input.amountPaise)), refundable);

        if (amount <= 0) throw new AppError('VALIDATION_ERROR', 'Refund amount must be greater than zero.');

        const payment = order.payments[0] ?? null;

        const refund = await tx.refund.create({
          data: {
            orderId: order.id,
            paymentId: payment?.id ?? null,
            amountPaise: amount,
            reason: input.reason.slice(0, 500),
            status: 'requested',
            actorId: input.actorId,
            notes: input.notes ?? null,
          },
          select: { id: true },
        });

        await tx.order.update({
          where: { id: order.id },
          data: {
            amountRefundedPaise: { increment: amount },
            paymentStatus:
              order.amountRefundedPaise + amount >= order.amountPaidPaise
                ? PAYMENT_STATUS.REFUNDED
                : PAYMENT_STATUS.PARTIALLY_REFUNDED,
          },
        });

        if (input.restock) {
          for (const item of order.items) {
            if (!item.bookId) continue;
            const quantity = item.quantity - item.refundedQty;
            if (quantity <= 0) continue;
            await restockOrderItem(tx, {
              bookId: item.bookId,
              warehouseId: item.warehouseId,
              quantity,
              type: STOCK_MOVEMENT.RETURN,
              referenceId: order.id,
              reason: input.reason,
              actorId: input.actorId,
            });
            await tx.orderItem.update({
              where: { id: item.id },
              data: { refundedQty: item.refundedQty + quantity },
            });
          }
        }

        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: 'refund_initiated',
            message: `Refund of ₹${(amount / 100).toFixed(2)} initiated. ${input.reason}`,
            actorId: input.actorId,
            actorType: 'staff',
            metadata: safeJson({ refundId: refund.id, amountPaise: amount, kind: input.kind }),
          },
        });

        return { refundId: refund.id, amountPaise: amount };
      }, { timeout: 20_000 }),
    { label: 'createRefund' },
  );
}

/** Mark a refund's provider-side outcome. Idempotent. */
export async function settleRefund(
  refundId: string,
  result: { state: 'completed' | 'failed' | 'processing'; providerRefundId?: string | null; raw?: unknown },
): Promise<void> {
  const refund = await db.refund.findUnique({ where: { id: refundId } });
  if (!refund) throw notFound('Refund not found.');
  if (refund.status === 'completed' && result.state === 'completed') return; // replay

  await db.$transaction(async (tx) => {
    await tx.refund.update({
      where: { id: refundId },
      data: {
        status: result.state,
        providerRefundId: result.providerRefundId ?? refund.providerRefundId,
        providerResponse: safeJson(result.raw),
        completedAt: result.state === 'completed' ? new Date() : null,
      },
    });

    if (result.state === 'failed') {
      // Roll the reserved refund amount back so the order shows the true balance.
      await tx.order.update({
        where: { id: refund.orderId },
        data: { amountRefundedPaise: { decrement: refund.amountPaise } },
      });
    }

    await tx.orderEvent.create({
      data: {
        orderId: refund.orderId,
        type: `refund_${result.state}`,
        message:
          result.state === 'completed'
            ? `Refund of ₹${(refund.amountPaise / 100).toFixed(2)} completed.`
            : `Refund attempt ${result.state}.`,
        actorType: 'system',
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Fulfilment
// ---------------------------------------------------------------------------

export interface FulfilmentUpdateInput {
  orderId: string;
  status: (typeof FULFILLMENT_STATUS)[keyof typeof FULFILLMENT_STATUS];
  actorId: string;
  note?: string | null;
  tracking?: {
    carrier: string;
    trackingNumber: string;
    trackingUrl?: string | null;
    estimatedDelivery?: Date | null;
  } | null;
}

/**
 * Advance an order through fulfilment.
 *
 * Guard rails: cannot ship an unpaid order, cannot deliver an unshipped one, and
 * cannot silently move backwards. Each transition writes an OrderEvent and, when
 * shipping, a Shipment row.
 */
export async function updateFulfilment(input: FulfilmentUpdateInput): Promise<{ orderNumber: string; status: string }> {
  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: input.orderId },
          select: {
            id: true,
            orderNumber: true,
            paymentStatus: true,
            fulfillmentStatus: true,
            status: true,
          },
        });

        if (!order) throw notFound('Order not found.');
        if (order.status === ORDER_STATUS.CANCELLED) {
          throw conflict('This order was cancelled and cannot be advanced.');
        }

        const next = input.status;
        const requiresPaid: Array<(typeof FULFILLMENT_STATUS)[keyof typeof FULFILLMENT_STATUS]> = [
          FULFILLMENT_STATUS.PACKED,
          FULFILLMENT_STATUS.SHIPPED,
          FULFILLMENT_STATUS.DELIVERED,
        ];
        if (requiresPaid.includes(next) && order.paymentStatus !== PAYMENT_STATUS.PAID) {
          throw conflict('This order has not been paid yet, so it cannot be packed or shipped.');
        }

        if (next === FULFILLMENT_STATUS.SHIPPED && !input.tracking) {
          const existingShipment = await tx.shipment.findFirst({ where: { orderId: order.id } });
          if (!existingShipment) {
            throw new AppError(
              'VALIDATION_ERROR',
              'Add a carrier and tracking number before marking this order as shipped.',
            );
          }
        }

        if (next === FULFILLMENT_STATUS.DELIVERED && order.fulfillmentStatus !== FULFILLMENT_STATUS.SHIPPED) {
          throw conflict('An order must be shipped before it can be marked delivered.');
        }

        if (input.tracking) {
          const shippedAt = next === FULFILLMENT_STATUS.SHIPPED ? new Date() : null;
          await tx.shipment.create({
            data: {
              orderId: order.id,
              carrier: input.tracking.carrier,
              trackingNumber: input.tracking.trackingNumber,
              trackingUrl: input.tracking.trackingUrl ?? buildTrackingUrl(input.tracking.carrier, input.tracking.trackingNumber),
              status: next === FULFILLMENT_STATUS.DELIVERED ? 'delivered' : next === FULFILLMENT_STATUS.SHIPPED ? 'in_transit' : 'pending',
              shippedAt,
              deliveredAt: next === FULFILLMENT_STATUS.DELIVERED ? new Date() : null,
              estimatedDelivery: input.tracking.estimatedDelivery ?? null,
            },
          });
        } else if (next === FULFILLMENT_STATUS.DELIVERED) {
          await tx.shipment.updateMany({
            where: { orderId: order.id },
            data: { status: 'delivered', deliveredAt: new Date() },
          });
        } else if (next === FULFILLMENT_STATUS.SHIPPED) {
          await tx.shipment.updateMany({
            where: { orderId: order.id },
            data: { status: 'in_transit', shippedAt: new Date() },
          });
        }

        await tx.order.update({
          where: { id: order.id },
          data: {
            fulfillmentStatus: next,
            carrier: input.tracking?.carrier ?? undefined,
            trackingNumber: input.tracking?.trackingNumber ?? undefined,
            trackingUrl:
              input.tracking?.trackingUrl ??
              (input.tracking ? buildTrackingUrl(input.tracking.carrier, input.tracking.trackingNumber) : undefined),
            deliveredAt: next === FULFILLMENT_STATUS.DELIVERED ? new Date() : undefined,
            estimatedDelivery: input.tracking?.estimatedDelivery ?? undefined,
          },
        });

        await tx.orderItem.updateMany({
          where: { orderId: order.id },
          data: { status: next === FULFILLMENT_STATUS.DELIVERED ? 'delivered' : next },
        });

        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: next,
            message: input.note ?? defaultFulfilmentMessage(next, input.tracking?.carrier, input.tracking?.trackingNumber),
            actorId: input.actorId,
            actorType: 'staff',
            metadata: input.tracking ? safeJson(input.tracking) : null,
          },
        });

        return { orderNumber: order.orderNumber, status: next };
      }, { timeout: 20_000 }),
    { label: 'updateFulfilment' },
  );
}

function defaultFulfilmentMessage(status: string, carrier?: string, trackingNumber?: string): string {
  switch (status) {
    case FULFILLMENT_STATUS.PROCESSING:
      return 'We are preparing your parcel.';
    case FULFILLMENT_STATUS.PACKED:
      return 'Your books are packed and waiting for the courier.';
    case FULFILLMENT_STATUS.SHIPPED:
      return `Shipped${carrier ? ` with ${carrier}` : ''}${trackingNumber ? ` (${trackingNumber})` : ''}.`;
    case FULFILLMENT_STATUS.DELIVERED:
      return 'Delivered. Enjoy your reading!';
    case FULFILLMENT_STATUS.RETURNED:
      return 'Parcel returned to sender.';
    default:
      return `Order status updated to ${status}.`;
  }
}

/** Carrier tracking URL templates. Extend as new carriers are onboarded. */
const CARRIER_TRACKING: Record<string, (n: string) => string> = {
  delhivery: (n) => `https://www.delhivery.com/track/package/${encodeURIComponent(n)}`,
  bluedart: (n) => `https://www.bluedart.com/tracking#${encodeURIComponent(n)}`,
  dtdc: (n) => `https://www.dtdc.in/tracking/tracking_results.asp?strCnno=${encodeURIComponent(n)}`,
  ekart: (n) => `https://ekartlogistics.com/track/${encodeURIComponent(n)}`,
  indiapost: (n) => `https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx`,
  shiprocket: (n) => `https://shiprocket.co/tracking/${encodeURIComponent(n)}`,
};

export function buildTrackingUrl(carrier: string, trackingNumber: string): string | null {
  const key = carrier.trim().toLowerCase().replace(/\s+/g, '');
  const builder = CARRIER_TRACKING[key];
  return builder ? builder(trackingNumber) : null;
}

export function listCarriers(): Array<{ code: string; label: string }> {
  return [
    { code: 'delhivery', label: 'Delhivery' },
    { code: 'bluedart', label: 'Blue Dart' },
    { code: 'dtdc', label: 'DTDC' },
    { code: 'ekart', label: 'Ekart' },
    { code: 'indiapost', label: 'India Post' },
    { code: 'shiprocket', label: 'Shiprocket' },
    { code: 'other', label: 'Other / manual' },
  ];
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const orderInclude = {
  items: { orderBy: { id: 'asc' } },
  payments: { orderBy: { createdAt: 'desc' }, take: 5 },
  refunds: { orderBy: { createdAt: 'desc' } },
  shipments: { orderBy: { createdAt: 'desc' } },
  events: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.OrderInclude;

export type OrderWithDetail = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/**
 * Fetch an order for a customer.
 * Authorisation: an order is reachable by order number alone *only* if the
 * caller is signed in as its owner, or is staff. Guests must supply the email
 * used at checkout (checked by the caller) — see the route handler.
 */
export async function getOrderForViewer(
  orderNumber: string,
  viewer: { userId?: string | null; email?: string | null; isStaff?: boolean },
): Promise<OrderWithDetail | null> {
  const order = await db.order.findUnique({
    where: { orderNumber },
    include: orderInclude,
  });

  if (!order) return null;
  if (viewer.isStaff) return order;
  if (viewer.userId && order.userId === viewer.userId) return order;
  if (viewer.email && order.email.toLowerCase() === viewer.email.toLowerCase()) return order;

  // Do not distinguish "not found" from "not yours" — that would let someone
  // enumerate valid order numbers.
  return null;
}

/**
 * Fetch an order by its internal id, for the order/tracking pages.
 *
 * Authorisation is identical to `getOrderForViewer`: the owner, or staff. A
 * guest reaches their order through the order *number* plus the email they used
 * (see the lookup page) — never by guessing an id.
 */
export async function getOrderById(
  orderId: string,
  viewer: { userId?: string | null; email?: string | null; isStaff?: boolean },
): Promise<OrderWithDetail | null> {
  const order = await db.order.findUnique({ where: { id: orderId }, include: orderInclude });
  if (!order) return null;

  if (viewer.isStaff) return order;
  if (viewer.userId && order.userId === viewer.userId) return order;
  if (viewer.email && order.email.toLowerCase() === viewer.email.toLowerCase()) return order;

  return null;
}

export interface OrderListFilters {
  status?: string;
  paymentStatus?: string;
  fulfillmentStatus?: string;
  search?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export async function listOrders(filters: OrderListFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));

  const where: Prisma.OrderWhereInput = {};

  if (filters.status) where.status = filters.status;
  if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
  if (filters.fulfillmentStatus) where.fulfillmentStatus = filters.fulfillmentStatus;

  if (filters.from || filters.to) {
    where.placedAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  if (filters.search) {
    const search = filters.search.trim();
    where.OR = [
      { orderNumber: { contains: search } },
      { email: { contains: search.toLowerCase() } },
      { customerName: { contains: search } },
      { phone: { contains: search } },
      { trackingNumber: { contains: search } },
      { items: { some: { titleSnapshot: { contains: search } } } },
    ];
  }

  const [items, total] = await Promise.all([
    db.order.findMany({
      where,
      include: {
        items: { select: { id: true, titleSnapshot: true, quantity: true, lineTotalPaise: true } },
        _count: { select: { items: true } },
      },
      orderBy: { placedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.order.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/** Orders for a signed-in customer's account area. */
export async function listCustomerOrders(userId: string, page = 1, pageSize = 10) {
  const [items, total] = await Promise.all([
    db.order.findMany({
      where: { userId },
      include: {
        items: {
          select: {
            id: true,
            titleSnapshot: true,
            authorSnapshot: true,
            slugSnapshot: true,
            coverSnapshot: true,
            quantity: true,
            lineTotalPaise: true,
            bookId: true,
          },
        },
        shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
        reviews: { select: { id: true, bookId: true } },
      },
      orderBy: { placedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.order.count({ where: { userId } }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

/**
 * Can this order still be cancelled by the customer?
 * Policy: any time before it ships. Once packed we ask them to contact support,
 * because the parcel may already be with the courier.
 */
export function canCustomerCancel(order: { status: string; fulfillmentStatus: string }): {
  allowed: boolean;
  reason?: string;
} {
  if (order.status === ORDER_STATUS.CANCELLED) {
    return { allowed: false, reason: 'This order is already cancelled.' };
  }
  if (order.fulfillmentStatus === FULFILLMENT_STATUS.SHIPPED || order.fulfillmentStatus === FULFILLMENT_STATUS.DELIVERED) {
    return { allowed: false, reason: 'This order has already shipped. Please request a return instead.' };
  }
  return { allowed: true };
}

/**
 * Generate an invoice number. Sequential per year for accounting sanity.
 *
 * Accepts a transaction client so it can be called inside the payment
 * confirmation transaction without a nested connection.
 */
export async function nextInvoiceNumber(client: Tx | typeof db = db): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const last = await client.order.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: 'desc' },
    select: { invoiceNumber: true },
  });

  const lastSeq = last?.invoiceNumber ? Number.parseInt(last.invoiceNumber.slice(prefix.length), 10) : 0;
  const next = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}

/** Statistics used by the admin dashboard. */
export async function getOrderStats(from: Date, to: Date) {
  const [totals, byStatus, refundTotals] = await Promise.all([
    db.order.aggregate({
      where: { placedAt: { gte: from, lte: to }, paymentStatus: { in: ['paid', 'partially_refunded', 'refunded'] } },
      _sum: { totalPaise: true, amountPaidPaise: true, amountRefundedPaise: true },
      _count: { id: true },
      _avg: { totalPaise: true },
    }),
    db.order.groupBy({
      by: ['fulfillmentStatus'],
      where: { placedAt: { gte: from, lte: to } },
      _count: { id: true },
    }),
    db.refund.aggregate({
      where: { createdAt: { gte: from, lte: to }, status: 'completed' },
      _sum: { amountPaise: true },
      _count: { id: true },
    }),
  ]);

  const gross = totals._sum.totalPaise ?? 0;
  const refunded = refundTotals._sum.amountPaise ?? 0;
  const orderCount = totals._count.id ?? 0;

  return {
    orderCount,
    grossRevenuePaise: gross,
    netRevenuePaise: gross - refunded,
    refundedPaise: refunded,
    refundCount: refundTotals._count.id ?? 0,
    averageOrderValuePaise: orderCount > 0 ? Math.round(gross / orderCount) : 0,
    byFulfillment: Object.fromEntries(byStatus.map((s) => [s.fulfillmentStatus, s._count.id])),
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function safeJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    const serialised = JSON.stringify(value);
    // Guard against an oversized provider payload blowing up a column.
    return serialised.length > 60_000 ? serialised.slice(0, 60_000) : serialised;
  } catch {
    return null;
  }
}

/** Unique merchant transaction id sent to the provider. */
export function buildMerchantTransactionId(orderNumber: string): string {
  const compact = orderNumber.replace(/[^A-Za-z0-9]/g, '');
  return `PL${compact}${generateToken(4).replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()}`;
}

export { sumPaise };
