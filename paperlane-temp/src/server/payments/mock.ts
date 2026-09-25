/**
 * Mock payment provider — LOCAL DEVELOPMENT AND TESTS ONLY.
 *
 * This adapter exists so the full checkout → payment → webhook → order pipeline
 * can be exercised without merchant credentials. It is real in the sense that it
 * drives the same verification code path as PhonePe; it is fake in that no money
 * moves.
 *
 * Three hard safety rails prevent it from being mistaken for a live provider:
 *  1. `assertPaymentConfigIsSafe()` in src/lib/env.ts throws at boot if
 *     PAYMENTS_PROVIDER=mock while NODE_ENV=production.
 *  2. `isLiveCapable` is false, so the checkout UI refuses to offer it outside
 *     development and the admin dashboard flags it.
 *  3. Orders paid through it are marked `isTestPayment` in their event trail.
 *
 * It requires a server-side confirmation step (see /api/v1/payments/mock/confirm),
 * so a client cannot simply assert success — the same discipline a real PSP's
 * signature check enforces.
 */

import { PaymentProviderError, normaliseState, type PaymentProvider } from './types';
import { env } from '@/lib/env';
import { generateToken } from '@/lib/crypto';

/** In-memory record of simulated payments. Process-local by design. */
const mockPayments = new Map<
  string,
  {
    merchantTransactionId: string;
    amountPaise: number;
    state: string;
    createdAt: number;
    method: string;
    methodDetail: string;
    failureReason?: string;
  }
>();

export const mockProvider: PaymentProvider = {
  key: 'mock',
  displayName: 'Test Payment (development only)',
  supportedMethods: ['UPI', 'CARD', 'NETBANKING', 'WALLET'],
  isLiveCapable: false,

  isConfigured() {
    if (env().NODE_ENV === 'production') {
      return { ok: false, missing: ['mock provider is disabled in production'] };
    }
    return { ok: true, missing: [] };
  },

  async createPayment(input) {
    const config = mockProvider.isConfigured();
    if (!config.ok) {
      throw new PaymentProviderError(
        'The test payment provider cannot be used in production. Configure PhonePe instead.',
        'NOT_CONFIGURED',
        false,
      );
    }

    mockPayments.set(input.merchantTransactionId, {
      merchantTransactionId: input.merchantTransactionId,
      amountPaise: input.amountPaise,
      state: 'PAYMENT_PENDING',
      createdAt: Date.now(),
      method: input.preferredMethod ?? 'UPI',
      methodDetail: input.preferredMethod === 'CARD' ? '•••• •••• •••• 4242' : 'test@mockbank',
    });

    // Everything created by the mock expires quickly, mirroring a real UPI intent.
    setTimeout(() => {
      const record = mockPayments.get(input.merchantTransactionId);
      if (record && record.state === 'PAYMENT_PENDING') {
        record.state = 'TIMED_OUT';
      }
    }, 15 * 60 * 1000).unref?.();

    return {
      merchantTransactionId: input.merchantTransactionId,
      providerOrderId: `MOCK-${input.merchantTransactionId}`,
      // A real provider sends the browser to a hosted page. We mirror that with
      // an internal route so the redirect flow is genuinely exercised.
      redirectUrl: `/checkout/test-pay/${encodeURIComponent(input.merchantTransactionId)}`,
      upiIntentUrl: null,
      state: 'pending',
      raw: { provider: 'mock', note: 'Simulated payment — no funds move.' },
    };
  },

  async getPaymentStatus(merchantTransactionId) {
    const record = mockPayments.get(merchantTransactionId);

    if (!record) {
      return {
        merchantTransactionId,
        state: 'expired',
        failureCode: 'NOT_FOUND',
        failureReason: 'No simulated payment with that reference.',
        raw: null,
      };
    }

    // Auto-expire after 15 minutes, like a real UPI collect request.
    if (record.state === 'PAYMENT_PENDING' && Date.now() - record.createdAt > 15 * 60 * 1000) {
      record.state = 'TIMED_OUT';
    }

    return {
      merchantTransactionId,
      state: normaliseState(record.state),
      providerPaymentId: `MOCKTXN-${generateToken(8)}`,
      providerTxnId: `MOCKTXN-${merchantTransactionId.slice(-8)}`,
      method: record.method,
      methodDetail: record.methodDetail,
      amountPaise: record.amountPaise,
      failureCode: record.state.includes('DECLINED') ? 'PAYMENT_DECLINED' : null,
      failureReason: record.failureReason ?? null,
      raw: { provider: 'mock', state: record.state },
    };
  },

  /**
   * Simulated webhook.
   *
   * The "signature" is a shared secret check against AUTH_SECRET, which means a
   * caller must already know a server-side secret to forge a confirmation — the
   * same property a real HMAC provides. This is what stops the mock provider
   * from being trivially abusable even in a shared staging environment.
   */
  async verifyWebhook({ rawBody, headers }) {
    const secret = headers['x-mock-signature'] ?? headers['X-Mock-Signature'];
    const expected = env().AUTH_SECRET;
    if (!secret || secret !== expected) {
      return { verified: false, reason: 'invalid_signature', raw: null };
    }

    let parsed: {
      merchantTransactionId?: string;
      state?: string;
      amountPaise?: number;
      method?: string;
      eventId?: string;
    };
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return { verified: false, reason: 'malformed_body', raw: null };
    }

    if (!parsed.merchantTransactionId) {
      return { verified: false, reason: 'missing_merchant_transaction_id', raw: parsed };
    }

    const record = mockPayments.get(parsed.merchantTransactionId);
    if (record && parsed.state) record.state = parsed.state;

    return {
      verified: true,
      eventId: parsed.eventId ?? `${parsed.merchantTransactionId}:${parsed.state ?? 'unknown'}`,
      eventType: `pay.${String(parsed.state ?? 'unknown').toLowerCase()}`,
      merchantTransactionId: parsed.merchantTransactionId,
      providerPaymentId: `MOCKTXN-${parsed.merchantTransactionId.slice(-8)}`,
      state: normaliseState(parsed.state),
      amountPaise: parsed.amountPaise ?? record?.amountPaise ?? null,
      method: parsed.method ?? record?.method ?? 'UPI',
      methodDetail: record?.methodDetail ?? 'test@mockbank',
      failureCode: null,
      failureReason: null,
      raw: parsed,
    };
  },

  async refund(input) {
    const record = mockPayments.get(input.merchantTransactionId);
    if (record) record.state = 'REFUNDED';

    return {
      refundReference: input.refundReference,
      state: 'completed',
      providerRefundId: `MOCKREF-${generateToken(6)}`,
      raw: { provider: 'mock', note: 'Simulated refund — no funds move.' },
    };
  },

  async cancelPayment(merchantTransactionId) {
    const record = mockPayments.get(merchantTransactionId);
    if (record && record.state === 'PAYMENT_PENDING') record.state = 'PAYMENT_CANCELLED';
    return mockProvider.getPaymentStatus(merchantTransactionId);
  },
};

/**
 * Test-only handle used by the confirm route and by integration tests.
 * Not exported through the provider registry on purpose.
 */
export function simulatePaymentOutcome(
  merchantTransactionId: string,
  outcome: 'success' | 'failure' | 'cancel',
  reason?: string,
): boolean {
  const record = mockPayments.get(merchantTransactionId);
  if (!record) return false;

  switch (outcome) {
    case 'success':
      record.state = 'PAYMENT_SUCCESS';
      break;
    case 'failure':
      record.state = 'PAYMENT_DECLINED';
      record.failureReason = reason ?? 'Simulated decline';
      break;
    case 'cancel':
      record.state = 'PAYMENT_CANCELLED';
      record.failureReason = reason ?? 'Cancelled by customer';
      break;
  }

  return true;
}

export function getMockPayment(merchantTransactionId: string) {
  return mockPayments.get(merchantTransactionId) ?? null;
}
