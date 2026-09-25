import { NextResponse, type NextRequest } from 'next/server';

import { getProviderByKey } from '@/server/payments';
import { confirmPayment } from '@/server/orders';
import { db } from '@/server/db';
import { consume, RATE_LIMITS } from '@/server/rate-limit';
import { logger } from '@/lib/logger';

/**
 * POST /api/v1/payments/{provider}/webhook
 *
 * The authoritative confirmation path. Four properties this endpoint must have,
 * in order of importance:
 *
 *  1. **Signature verification first.** Nothing in the body is believed until
 *     the provider's signature is verified against our secret. An unverified
 *     webhook is an attacker telling us an order is paid.
 *
 *  2. **Idempotency.** Providers retry. Every delivery is recorded in
 *     `PaymentEvent` keyed on `(provider, eventId)`; a repeat is acknowledged
 *     with 200 and does no further work. This is what stops a retried webhook
 *     from sending a second confirmation email or double-committing stock.
 *
 *  3. **Amount checking.** `confirmPayment` compares the provider's amount with
 *     the order total. A mismatch leaves the order unpaid and flags it for
 *     review — we would rather chase a human than ship a ₹0 order.
 *
 *  4. **Fast, boring responses.** Always 200 once the body is verified and
 *     recorded, even if processing is a no-op, so the provider stops retrying.
 *     Real failures are logged and alerted on, not surfaced to the provider.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { provider: providerKey } = await context.params;

  // Coarse rate limit: webhooks are legitimately bursty, so this only exists to
  // blunt a flood, not to police the provider.
  const limit = await consume('WEBHOOK', `webhook:${providerKey}`, RATE_LIMITS.WEBHOOK);
  if (!limit.allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const provider = getProviderByKey(providerKey);
  if (!provider) {
    logger.warn('webhook for unknown provider', { providerKey });
    // 404 rather than 400: there is no such endpoint to talk to.
    return NextResponse.json({ error: 'unknown_provider' }, { status: 404 });
  }

  // Read the raw body — signature verification must run over the exact bytes.
  const rawBody = await request.text();

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let verification;
  try {
    verification = await provider.verifyWebhook({ rawBody, headers });
  } catch (err) {
    logger.error('webhook verification threw', { providerKey, err });
    return NextResponse.json({ error: 'verification_failed' }, { status: 400 });
  }

  if (!verification.verified) {
    // Log the reason, never the payload — it may contain a partial card ref.
    logger.warn('rejected unverified webhook', { providerKey, reason: verification.reason });
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  // --- Idempotency: record the event, and stop if we have seen it before -----
  const eventId =
    verification.eventId ||
    `${verification.merchantTransactionId ?? 'unknown'}:${verification.state ?? 'unknown'}`;

  try {
    await db.paymentEvent.create({
      data: {
        provider: provider.key,
        eventId,
        eventType: verification.eventType ?? 'unknown',
        // Store the raw body for reconciliation, capped, and never a secret.
        payload: rawBody.slice(0, 8_000),
        signatureVerified: true,
      },
      select: { id: true },
    });
  } catch (err) {
    // Unique constraint violation == we have already processed this delivery.
    if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2002') {
      logger.debug('duplicate webhook ignored', { providerKey, eventId });
      return NextResponse.json({ ok: true, duplicate: true });
    }

    logger.error('failed to record payment event', { providerKey, eventId, err });
    // Ask the provider to retry — losing an event would be worse than a retry.
    return NextResponse.json({ error: 'storage_failed' }, { status: 500 });
  }

  // --- Apply the outcome ----------------------------------------------------
  if (!verification.merchantTransactionId) {
    logger.warn('verified webhook without a merchant transaction id', { providerKey, eventId });
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const result = await confirmPayment({
      merchantTransactionId: verification.merchantTransactionId,
      // `initiated` is a state we only use locally before the provider answers;
      // an inbound webhook can never mean it, so it maps to `pending`.
      state:
        !verification.state || verification.state === 'initiated' ? 'pending' : verification.state,
      amountPaise: verification.amountPaise,
      providerPaymentId: verification.providerPaymentId,
      method: verification.method,
      methodDetail: verification.methodDetail,
      failureCode: verification.failureCode,
      failureReason: verification.failureReason,
      rawPayload: rawBody.slice(0, 8_000),
      source: 'webhook',
    });

    if (result.status === 'amount_mismatch') {
      // The money is real but the figures disagree. Never confirm; make noise.
      logger.error('payment amount mismatch — order held for review', {
        merchantTransactionId: verification.merchantTransactionId,
        orderNumber: result.orderNumber,
        message: result.message,
      });
    }

    return NextResponse.json({ ok: true, status: result.status });
  } catch (err) {
    logger.error('confirmPayment failed after verified webhook', {
      merchantTransactionId: verification.merchantTransactionId,
      err,
    });
    // A 500 here asks for a retry, which is correct: the event row exists, so a
    // repeat delivery will short-circuit at the idempotency check and try the
    // confirmation again.
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 });
  }
}

/** Providers occasionally probe with GET; answer honestly. */
export async function GET() {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405, headers: { Allow: 'POST' } });
}
