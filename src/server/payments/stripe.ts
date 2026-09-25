/** Stripe Checkout adapter.
 *
 * Stripe is deliberately an adapter, not a dependency of the checkout domain.
 * The store can switch providers through PAYMENTS_PROVIDER without changing order
 * or checkout code. We use Stripe-hosted Checkout so card data never reaches us.
 */
import { env } from '@/lib/env';
import { safeCompare } from '@/lib/crypto';
import { createHmac } from 'node:crypto';
import { PaymentProviderError, normaliseState, type PaymentProvider } from './types';

const API = 'https://api.stripe.com/v1';
const TIMEOUT_MS = 20_000;

function configured() {
  const e = env();
  const missing: string[] = [];
  if (!e.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
  if (!e.STRIPE_WEBHOOK_SECRET) missing.push('STRIPE_WEBHOOK_SECRET');
  return { ok: missing.length === 0, missing };
}

async function stripeFetch(path: string, init: RequestInit = {}) {
  const e = env();
  if (!e.STRIPE_SECRET_KEY) throw new PaymentProviderError('Stripe is not configured.', 'NOT_CONFIGURED', false);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${e.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(init.headers ?? {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new PaymentProviderError(
        body?.error?.message ?? 'Stripe could not process the request.',
        body?.error?.code ?? 'STRIPE_ERROR',
        response.status >= 500 || response.status === 429,
        body,
      );
    }
    return body as Record<string, any>;
  } catch (err) {
    if (err instanceof PaymentProviderError) throw err;
    throw new PaymentProviderError('Could not reach Stripe.', 'UPSTREAM_UNREACHABLE', true, err);
  } finally {
    clearTimeout(timer);
  }
}

function formEncode(entries: Record<string, string | number | undefined | null>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) if (value !== undefined && value !== null) body.set(key, String(value));
  return body.toString();
}

async function findSession(merchantTransactionId: string) {
  const query = encodeURIComponent(`metadata['merchantTransactionId']:'${merchantTransactionId}'`);
  const result = await stripeFetch(`/checkout/sessions/search?query=${query}&limit=1`, { method: 'GET', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  return result.data?.[0] ?? null;
}

export const stripeProvider: PaymentProvider = {
  key: 'stripe',
  displayName: 'Stripe',
  supportedMethods: ['CARD'],
  isLiveCapable: true,

  isConfigured() {
    return configured();
  },

  async createPayment(input) {
    if (!/^[a-z]{3}$/i.test(input.currency)) throw new PaymentProviderError('Unsupported payment currency.', 'UNSUPPORTED_CURRENCY', false);

    const config = configured();
    if (!config.ok) throw new PaymentProviderError('Online payments are not configured yet.', 'NOT_CONFIGURED', false);

    const e = env();
    const params: Record<string, string | number | undefined> = {
      mode: 'payment',
      success_url: `${input.redirectUrl}&provider_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${input.redirectUrl}&cancelled=1`,
      customer_email: input.customer.email,
      client_reference_id: input.merchantTransactionId,
      'metadata[merchantTransactionId]': input.merchantTransactionId,
      'metadata[orderNumber]': input.orderNumber,
      'metadata[store]': e.APP_NAME,
      'payment_method_types[0]': 'card',
      'line_items[0][price_data][currency]': input.currency.toLowerCase(),
      'line_items[0][price_data][product_data][name]': input.description.slice(0, 500),
      'line_items[0][price_data][unit_amount]': input.amountPaise,
      'line_items[0][quantity]': 1,
    };

    // Keep the whole order as one Checkout line. The order service remains the
    // source of truth for the detailed basket and amount verification.
    const session = await stripeFetch('/checkout/sessions', {
      method: 'POST',
      headers: { 'Idempotency-Key': input.merchantTransactionId },
      body: formEncode(params),
    });

    return {
      merchantTransactionId: input.merchantTransactionId,
      providerOrderId: session.id ?? null,
      redirectUrl: session.url ?? null,
      upiIntentUrl: null,
      state: 'pending',
      raw: { id: session.id, status: session.status, payment_status: session.payment_status },
    };
  },

  async getPaymentStatus(merchantTransactionId) {
    const session = await findSession(merchantTransactionId);
    if (!session) return { merchantTransactionId, state: 'pending', failureCode: 'NOT_FOUND', failureReason: 'Stripe Checkout session not found.', raw: null };
    const state = session.payment_status === 'paid' ? 'captured' : session.status === 'expired' ? 'expired' : 'pending';
    return {
      merchantTransactionId,
      state,
      providerPaymentId: session.payment_intent ?? null,
      providerTxnId: session.payment_intent ?? null,
      method: session.payment_method_types?.[0] ?? null,
      amountPaise: session.amount_total ?? null,
      raw: { id: session.id, status: session.status, payment_status: session.payment_status },
    };
  },

  async verifyWebhook({ rawBody, headers }) {
    const secret = env().STRIPE_WEBHOOK_SECRET;
    const signature = headers['stripe-signature'] ?? headers['Stripe-Signature'];
    if (!secret || !signature) return { verified: false, reason: 'missing_signature', raw: null };

    const parts = Object.fromEntries(signature.split(',').map((p) => p.split('=').map((v) => v.trim()) as [string, string]));
    const timestamp = Number(parts.t);
    const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300 || !parts.v1 || !safeCompare(expected, parts.v1)) {
      return { verified: false, reason: 'invalid_signature', raw: null };
    }

    let event: any;
    try { event = JSON.parse(rawBody); } catch { return { verified: false, reason: 'malformed_body', raw: null }; }
    const session = event.data?.object ?? {};
    const merchantTransactionId = session.metadata?.merchantTransactionId ?? session.client_reference_id;
    if (!merchantTransactionId) return { verified: false, reason: 'missing_merchant_transaction_id', raw: event.type };

    let state = normaliseState(event.type);
    if (event.type === 'checkout.session.completed' && session.payment_status === 'paid') state = 'captured';
    if (event.type === 'checkout.session.expired') state = 'expired';
    if (event.type === 'payment_intent.payment_failed') state = 'failed';

    return {
      verified: true,
      eventId: event.id,
      eventType: event.type,
      merchantTransactionId,
      providerPaymentId: session.payment_intent ?? session.id ?? null,
      state,
      amountPaise: session.amount_total ?? session.amount_received ?? null,
      method: session.payment_method_types?.[0] ?? null,
      failureReason: session.last_payment_error?.message ?? null,
      raw: event,
    };
  },

  async refund(input) {
    let paymentIntent = input.providerPaymentId;
    if (!paymentIntent) paymentIntent = (await findSession(input.merchantTransactionId))?.payment_intent ?? null;
    if (!paymentIntent) return { refundReference: input.refundReference, state: 'failed', failureReason: 'Stripe payment intent not found.', raw: null };
    const refund = await stripeFetch('/refunds', {
      method: 'POST',
      headers: { 'Idempotency-Key': input.refundReference },
      body: formEncode({ payment_intent: paymentIntent, amount: input.amountPaise, reason: 'requested_by_customer' }),
    });
    return { refundReference: input.refundReference, state: refund.status === 'succeeded' ? 'completed' : 'processing', providerRefundId: refund.id ?? null, raw: refund };
  },
};
