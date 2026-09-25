'use server';

/**
 * Customer-side order actions: cancelling an order and asking to return one.
 *
 * Authorisation rule for both: the order belongs to the signed-in user, or to a
 * guest who can supply the email address used at checkout. An order id alone is
 * never enough — otherwise a cuid leaked from a URL would let a stranger cancel
 * someone else's order.
 *
 * Neither action invents a refund. Cancelling hands the decision to
 * `cancelOrder()`, which releases stock, restocks paid copies and records the
 * refund amount; a return opens a support ticket for a human to triage, because
 * "damaged in transit" and "changed my mind" need different answers.
 */

import { revalidatePath } from 'next/cache';

import { db } from '@/server/db';
import { getCurrentUser } from '@/server/auth';
import { cancelOrder, canCustomerCancel } from '@/server/orders';
import { sendOrderCancellation } from '@/server/notifications';
import { createSupportTicket } from '@/server/support';
import { recordAudit } from '@/server/audit';
import { logger } from '@/lib/logger';
import { normaliseEmail } from '@/lib/crypto';
import {
  AUDIT_ACTION,
  ORDER_STATUS,
  PAYMENT_STATUS,
  TICKET_STATUS,
} from '@/lib/constants';
import { ok, fail, fromError, formString, type ActionState } from './types';

/** Who is looking at this order? Owner, guest owner, or nobody. */
async function authoriseOrder(orderId: string, suppliedEmail?: string | null) {
  const user = await getCurrentUser().catch(() => null);

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      userId: true,
      email: true,
      customerName: true,
      status: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      amountPaidPaise: true,
      amountRefundedPaise: true,
      totalPaise: true,
      deliveredAt: true,
    },
  });

  if (!order) return { ok: false as const, reason: 'not_found' as const };

  if (user && order.userId === user.id) return { ok: true as const, order, user };

  // Guest order: the email on the order is the only credential we hold, so an
  // exact match on the normalised address is required.
  if (!order.userId && suppliedEmail && normaliseEmail(suppliedEmail) === normaliseEmail(order.email)) {
    return { ok: true as const, order, user: null };
  }

  return { ok: false as const, reason: 'forbidden' as const };
}

export async function cancelOrderAction(
  _prev: ActionState<never>,
  formData: FormData,
): Promise<ActionState<never>> {
  try {
    const orderId = formString(formData, 'orderId');
    if (!orderId) return fail('We could not find that order.', { code: 'NOT_FOUND' });

    const auth = await authoriseOrder(orderId, formString(formData, 'email'));
    if (!auth.ok) {
      if (auth.reason === 'not_found') return fail('We could not find that order.', { code: 'NOT_FOUND' });
      return fail('That order is not on your account.', { code: 'FORBIDDEN' });
    }

    const { order, user } = auth;

    if (order.status === ORDER_STATUS.CANCELLED) {
      return ok(undefined, 'This order is already cancelled.');
    }

    const policy = canCustomerCancel(order);
    if (!policy.allowed) {
      return fail(policy.reason ?? 'This order can no longer be cancelled online.', {
        code: 'NOT_CANCELLABLE',
      });
    }

    const reason = (formString(formData, 'reason') ?? '').trim() || 'Cancelled by the customer';

    // Stock release and restocking happen inside `cancelOrder`'s transaction, so
    // an order can never be cancelled while still holding inventory.
    const result = await cancelOrder({
      orderId: order.id,
      reason,
      actorId: user?.id ?? null,
      actorType: 'customer',
      // A customer cancellation may only restock copies that were actually sold.
      restock: order.paymentStatus === PAYMENT_STATUS.PAID,
      refund: false,
    });

    await sendOrderCancellation({
      userId: order.userId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      email: order.email,
      customerName: order.customerName,
      reason,
      refundAmountPaise: result.refundAmountPaise,
    }).catch((err) => logger.warn('cancellation email failed', { orderId: order.id, err: String(err) }));

    await recordAudit({
      actorId: user?.id ?? null,
      actorEmail: user?.email ?? order.email,
      action: AUDIT_ACTION.ORDER_CANCEL,
      entityType: 'order',
      entityId: order.id,
      summary: `Order ${order.orderNumber} cancelled by customer`,
      after: { status: ORDER_STATUS.CANCELLED, reason, refundAmountPaise: result.refundAmountPaise },
    }).catch((err) => logger.warn('audit write failed for cancellation', { err: String(err) }));

    // Keep the shipping address and IDs on the confirmation page accurate.
    revalidatePath(`/orders/${order.id}`);

    return ok(
      undefined,
      result.refundAmountPaise > 0
        ? 'Cancelled. Your refund will be with you in 5–7 working days.'
        : 'Cancelled. Nothing was charged.',
    );
  } catch (err) {
    return fromError(err);
  }
}

export async function requestReturnAction(
  _prev: ActionState<never>,
  formData: FormData,
): Promise<ActionState<never>> {
  try {
    const orderId = formString(formData, 'orderId');
    if (!orderId) return fail('We could not find that order.', { code: 'NOT_FOUND' });

    const auth = await authoriseOrder(orderId, formString(formData, 'email'));
    if (!auth.ok) {
      if (auth.reason === 'not_found') return fail('We could not find that order.', { code: 'NOT_FOUND' });
      return fail('That order is not on your account.', { code: 'FORBIDDEN' });
    }

    const { order, user } = auth;

    if (order.status === ORDER_STATUS.CANCELLED) {
      return fail('This order was cancelled, so there is nothing to return.', { code: 'NOT_RETURNABLE' });
    }

    if (order.fulfillmentStatus !== 'delivered') {
      return fail(
        'Returns open once the parcel has been delivered. If it has not arrived, ask us where it is instead.',
        { code: 'NOT_DELIVERED' },
      );
    }

    const open = await db.supportTicket.findFirst({
      where: {
        orderId: order.id,
        category: 'refund',
        status: { notIn: [TICKET_STATUS.CLOSED, TICKET_STATUS.RESOLVED] },
      },
      select: { reference: true },
    });

    if (open) {
      return fail(
        `We already have a return request open for this order (${open.reference}). We will reply by email shortly.`,
        { code: 'DUPLICATE' },
      );
    }

    const reason = (formString(formData, 'reason') ?? '').trim();

    const ticket = await createSupportTicket({
      userId: user?.id ?? order.userId ?? null,
      orderId: order.id,
      email: order.email,
      name: order.customerName,
      category: 'refund',
      subject: `Return request for order ${order.orderNumber}`,
      message:
        reason.length >= 3
          ? reason
          : `Customer requested a return for order ${order.orderNumber}. No reason given.`,
      context: {
        source: 'order_page',
        orderNumber: order.orderNumber,
        deliveredAt: order.deliveredAt?.toISOString() ?? null,
        paidPaise: order.amountPaidPaise,
        refundedPaise: order.amountRefundedPaise,
      },
    });

    revalidatePath(`/orders/${order.id}`);

    return ok(
      undefined,
      `Return requested — your reference is ${ticket.reference}. We will email you the next steps within one working day.`,
    );
  } catch (err) {
    return fromError(err);
  }
}
