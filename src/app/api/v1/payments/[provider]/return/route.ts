import { NextResponse, type NextRequest } from 'next/server';

import { getProviderByKey } from '@/server/payments';
import { confirmPayment } from '@/server/orders';
import { getCurrentUser } from '@/server/auth';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';

/**
 * GET /api/v1/payments/{provider}/return?txn=…
 *
 * Where the customer's browser lands after the hosted payment page.
 *
 * The critical rule: **the query string is not evidence.** A redirect can be
 * forged by anyone, so nothing here is believed until we have asked the provider
 * directly, server to server, what actually happened. That query is what decides
 * whether the order is paid — not the presence of a `status=success` parameter.
 *
 * If the provider is unreachable, we send the customer to their order page in a
 * "payment pending" state and reconcile later via the webhook or the scheduled
 * status poll. We never guess in the customer's favour, and we never guess
 * against them either: an unpaid order is not silently cancelled.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { provider: providerKey } = await context.params;
  const merchantTransactionId = request.nextUrl.searchParams.get('txn');

  const base = env().APP_URL.replace(/\/$/, '');

  if (!merchantTransactionId) {
    return NextResponse.redirect(`${base}/payments/status?state=unknown`);
  }

  const provider = getProviderByKey(providerKey);
  if (!provider) {
    return NextResponse.redirect(`${base}/payments/status?state=unknown`);
  }

  // Where should we send them at the end? The order page when we can identify
  // it, otherwise a neutral status page.
  let orderId: string | null = null;

  try {
    const payment = await db_paymentLookup(merchantTransactionId);
    orderId = payment?.orderId ?? null;

    // Authorisation before we redirect someone to an order page: it is theirs if
    // they are signed in as the owner.
    if (orderId && payment?.userId) {
      const user = await getCurrentUser().catch(() => null);
      if (!user || user.id !== payment.userId) {
        // Fall through to the neutral page rather than confirming the order
        // exists — that would leak the existence of somebody else's order.
        return NextResponse.redirect(`${base}/payments/status?state=unknown`);
      }
    }

    const status = await provider.getPaymentStatus(merchantTransactionId);

    const result = await confirmPayment({
      merchantTransactionId,
      state: !status.state || status.state === 'initiated' ? 'pending' : status.state,
      amountPaise: status.amountPaise,
      providerPaymentId: status.providerPaymentId,
      providerTxnId: status.providerTxnId,
      method: status.method,
      methodDetail: status.methodDetail,
      failureCode: status.failureCode,
      failureReason: status.failureReason,
      rawPayload: status.raw,
      source: 'status_query',
    });

    const settled =
      result.status === 'confirmed' || result.status === 'already_confirmed';

    if (orderId) {
      return NextResponse.redirect(
        `${base}/orders/${orderId}?payment=${settled ? 'success' : result.status}`,
      );
    }

    // The order exists but belongs to nobody we can verify (a guest whose
    // cookie is gone, for instance). Send them to the status page with the
    // transaction so we can at least keep checking, but no order link.
    return NextResponse.redirect(
      `${base}/payments/status?state=${settled ? 'success' : 'pending'}&txn=${encodeURIComponent(merchantTransactionId)}`,
    );
  } catch (err) {
    logger.error('payment return verification failed', {
      providerKey,
      merchantTransactionId,
      err,
    });

    // We do not know the outcome. Say so plainly and keep the order intact.
    if (orderId) {
      return NextResponse.redirect(`${base}/orders/${orderId}?payment=unverified`);
    }

    return NextResponse.redirect(
      `${base}/payments/status?state=unverified&txn=${encodeURIComponent(merchantTransactionId)}`,
    );
  }
}

/**
 * Minimal lookup kept local to this route so the redirect target can be resolved
 * before any verification work happens.
 */
async function db_paymentLookup(merchantTransactionId: string) {
  const { db } = await import('@/server/db');

  return db.payment.findUnique({
    where: { merchantTransactionId },
    select: { orderId: true, order: { select: { userId: true } } },
  }).then((row) => (row ? { orderId: row.orderId, userId: row.order.userId } : null));
}
