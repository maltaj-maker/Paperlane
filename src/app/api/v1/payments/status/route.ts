import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { db } from '@/server/db';
import { getCurrentUser } from '@/server/auth';
import { getSessionId } from '@/server/request-context';
import { getProviderByKey, getPaymentProvider } from '@/server/payments';
import { confirmPayment } from '@/server/orders';
import { consume, RATE_LIMITS, limitKey } from '@/server/rate-limit';
import { logger } from '@/lib/logger';

/**
 * POST /api/v1/payments/status
 *
 * "Has my payment landed yet?" — asked by the status page a few seconds after the
 * customer returns from the bank, so that a pending page can quietly become a
 * confirmed order.
 *
 * Three things keep this from being a liability:
 *
 *  - **It authorises.** The caller must be the order's owner, or the browser
 *    that placed the order (same session id). Otherwise we answer `{ settle:false }`
 *    and nothing else — not even whether the transaction exists.
 *  - **It asks the provider, then goes through `confirmPayment()`.** This route
 *    never writes payment state itself; it is one more *source* of a verified
 *    signal, so the "only a verified provider response marks an order paid" rule
 *    still holds.
 *  - **It is rate limited per session.** A status poll is not free — each call
 *    costs an upstream request — and this endpoint must not become a free way to
 *    hammer the provider.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  merchantTransactionId: z.string().trim().min(6).max(64),
});

type Response_ = { settle: boolean; state: string };

function answer(payload: Response_, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: { 'cache-control': 'no-store', ...(init?.headers ?? {}) },
  });
}

export async function POST(request: NextRequest) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const sessionId = await getSessionId();
  const limit = await consume(
    'PAYMENT_INITIATE',
    limitKey('payment-status', sessionId ?? 'anonymous'),
    RATE_LIMITS.PAYMENT_INITIATE,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { settle: false, state: 'pending' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds), 'cache-control': 'no-store' } },
    );
  }

  const user = await getCurrentUser().catch(() => null);

  const payment = await db.payment.findUnique({
    where: { merchantTransactionId: parsed.merchantTransactionId },
    select: {
      id: true,
      orderId: true,
      provider: true,
      status: true,
      order: { select: { userId: true, sessionId: true } },
    },
  });

  // Unknown transaction, or one we cannot tie to this caller: indistinguishable
  // answers on purpose.
  const owns =
    payment &&
    ((user && payment.order.userId === user.id) ||
      (!payment.order.userId && sessionId && payment.order.sessionId === sessionId));

  if (!payment || !owns) {
    return answer({ settle: false, state: 'unknown' });
  }

  const provider = getProviderByKey(payment.provider) ?? getPaymentProvider();
  if (!provider.isConfigured()) {
    return answer({ settle: false, state: 'unverified' });
  }

  try {
    const status = await provider.getPaymentStatus(parsed.merchantTransactionId);

    const raw = status.state ?? 'pending';
    const state =
      raw === 'captured' || raw === 'authorized'
        ? 'success'
        : raw === 'failed' || raw === 'cancelled' || raw === 'expired'
          ? 'failed'
          : 'pending';

    // Confirmation goes through the single authority on payment state.
    const result = await confirmPayment({
      merchantTransactionId: parsed.merchantTransactionId,
      state: raw === 'initiated' ? 'pending' : (raw as 'captured' | 'authorized' | 'failed' | 'cancelled' | 'expired' | 'pending'),
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

    const settled = result.status === 'confirmed' || result.status === 'already_confirmed';

    logger.info('payment status polled', {
      merchantTransactionId: parsed.merchantTransactionId,
      state,
      result: result.status,
    });

    return answer({ settle: settled || state === 'failed', state });
  } catch (err) {
    // Reach the provider's failure as *our* uncertainty, never as the customer's.
    logger.warn('payment status poll failed', {
      merchantTransactionId: parsed.merchantTransactionId,
      err: err instanceof Error ? err.message : String(err),
    });

    return answer({ settle: false, state: 'unverified' });
  }
}
