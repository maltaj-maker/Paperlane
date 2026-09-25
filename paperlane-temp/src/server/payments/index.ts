/**
 * Payment provider registry.
 *
 * Selection is by configuration (`PAYMENTS_PROVIDER`), never by code branching
 * scattered through the app. Adding Razorpay or Stripe later means writing one
 * adapter and adding one line here.
 */

import { env, isProduction } from '@/lib/env';
import { logger } from '@/lib/logger';
import { AppError } from '@/lib/errors';
import { phonePeProvider } from './phonepe';
import { stripeProvider } from './stripe';
import { mockProvider } from './mock';
import type { PaymentProvider } from './types';
import { PaymentProviderError } from './types';

export * from './types';
export { phonePeProvider } from './phonepe';
export { stripeProvider } from './stripe';
export { mockProvider, simulatePaymentOutcome, getMockPayment } from './mock';

const REGISTRY: Record<string, PaymentProvider> = {
  mock: mockProvider,
  phonepe: phonePeProvider,
  stripe: stripeProvider,
};

/** All registered adapters, for the admin integrations screen. */
export function listProviders(): PaymentProvider[] {
  return Object.values(REGISTRY);
}

export function getProviderByKey(key: string): PaymentProvider | null {
  return REGISTRY[key] ?? null;
}

/**
 * The active provider.
 *
 * Refuses to fall back silently: if the configured provider is unusable we throw
 * rather than quietly downgrading to the mock, because a silent downgrade would
 * mark orders paid without money moving.
 */
export function getPaymentProvider(): PaymentProvider {
  const key = env().PAYMENTS_PROVIDER;
  const provider = REGISTRY[key];

  if (!provider) {
    throw new AppError('INTERNAL_ERROR', `Unknown payment provider "${key}".`, {
      context: { available: Object.keys(REGISTRY) },
    });
  }

  const config = provider.isConfigured();
  if (!config.ok) {
    logger.error('payment provider not configured', { provider: key, missing: config.missing });
    throw new AppError(
      'UPSTREAM_ERROR',
      'Online payment is temporarily unavailable. Please try again shortly or contact support.',
      { context: { provider: key, missing: config.missing }, retryable: true },
    );
  }

  if (isProduction() && !provider.isLiveCapable) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Refusing to take payments: the configured provider cannot process live payments.',
      { context: { provider: key } },
    );
  }

  return provider;
}

/** Which instruments the store can actually accept right now. */
export function getEnabledPaymentMethods(): Array<{
  method: string;
  label: string;
  available: boolean;
  provider: string;
  description: string;
}> {
  const e = env();
  const provider = e.PAYMENTS_PROVIDER;
  const adapter = REGISTRY[provider];
  const configured = adapter?.isConfigured().ok ?? false;
  const supported = new Set(adapter?.supportedMethods ?? []);

  const labels: Record<string, { label: string; description: string }> = {
    UPI: { label: 'UPI', description: 'Pay using a supported UPI app where available.' },
    CARD: { label: 'Credit / Debit Card', description: 'Pay securely by card through our hosted payment page.' },
    NETBANKING: { label: 'Net Banking', description: 'Pay directly from your bank account where supported.' },
    WALLET: { label: 'Wallet', description: 'Use a supported digital wallet where available.' },
  };

  const methods = [...supported].map((method) => ({
    method,
    label: labels[method]?.label ?? method,
    available: configured,
    provider,
    description: labels[method]?.description ?? 'Pay securely through our payment provider.',
  }));

  if (e.STORE_SUPPORT_COD) {
    methods.push({
      method: 'COD',
      label: 'Cash on Delivery',
      available: true,
      provider: 'cod',
      description: 'Pay in cash when your parcel arrives. Available only in eligible Kolkata postcodes.',
    });
  }

  return methods;
}

/** Human-readable health summary for the admin integrations panel. */
export function getPaymentHealth(): {
  provider: string;
  displayName: string;
  liveCapable: boolean;
  configured: boolean;
  missing: string[];
  mode: 'live' | 'sandbox' | 'test';
  warning: string | null;
} {
  const e = env();
  const adapter = REGISTRY[e.PAYMENTS_PROVIDER];
  const config = adapter?.isConfigured() ?? { ok: false, missing: ['unknown provider'] };

  let mode: 'live' | 'sandbox' | 'test' = 'test';
  if (e.PAYMENTS_PROVIDER === 'phonepe') {
    mode = e.PHONEPE_ENV === 'production' ? 'live' : 'sandbox';
  } else if (e.PAYMENTS_PROVIDER === 'stripe') {
    mode = e.NODE_ENV === 'production' ? 'live' : 'sandbox';
  }

  let warning: string | null = null;
  if (e.PAYMENTS_PROVIDER === 'mock') {
    warning = isProduction()
      ? 'CRITICAL: the test provider is selected in production. No payments will be collected.'
      : 'Test payment provider in use. No real money moves. Configure PhonePe before launch.';
  } else if (!config.ok) {
    warning = `Missing configuration: ${config.missing.join(', ')}`;
  } else if (e.PAYMENTS_PROVIDER === 'stripe' && !e.STRIPE_SECRET_KEY) {
    warning = 'Stripe is selected but STRIPE_SECRET_KEY is missing.';
  } else if (e.PHONEPE_ENV === 'sandbox' && isProduction()) {
    warning = 'PhonePe is running against the sandbox in production. Switch PHONEPE_ENV=production before launch.';
  }

  return {
    provider: e.PAYMENTS_PROVIDER,
    displayName: adapter?.displayName ?? e.PAYMENTS_PROVIDER,
    liveCapable: adapter?.isLiveCapable ?? false,
    configured: config.ok,
    missing: config.missing,
    mode,
    warning,
  };
}

export { PaymentProviderError };
export type { PaymentProvider };
