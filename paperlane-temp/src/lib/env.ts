/**
 * Environment configuration, validated at boot.
 *
 * Failing fast on a missing AUTH_SECRET is far better than discovering it when
 * the first customer tries to log in. Access is centralised here so there is
 * exactly one place that reads `process.env` for configuration.
 */

import { z } from 'zod';

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['true', '1', 'yes', 'on'].includes(v.toLowerCase())));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === '' ? undefined : v));

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  APP_NAME: z.string().default('Paperlane Books'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET must be at least 32 characters. Generate with: openssl rand -base64 48'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),

  PAYMENTS_PROVIDER: z.enum(['mock', 'stripe', 'phonepe']).default('mock'),
  PAYMENT_CURRENCY: z.string().length(3).default('INR'),
  // Optional refreshed INR->presentment-currency rates, e.g. {"USD":0.0119,"GBP":0.0088}.
  CURRENCY_RATES_JSON: optionalString,
  PAYMENT_ALLOW_LIVE: booleanish.default(false),

  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,

  PHONEPE_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  PHONEPE_MERCHANT_ID: optionalString,
  PHONEPE_SALT_KEY: optionalString,
  PHONEPE_SALT_INDEX: z.coerce.number().int().min(1).max(2).default(1),
  PHONEPE_CLIENT_ID: optionalString,
  PHONEPE_CLIENT_SECRET: optionalString,
  PHONEPE_CLIENT_VERSION: z.coerce.number().int().default(1),
  PHONEPE_WEBHOOK_URL: optionalString,

  EMAIL_PROVIDER: z.enum(['console', 'resend', 'smtp']).default('console'),
  EMAIL_FROM: z.string().default('Paperlane Books <hello@paperlane.test>'),
  RESEND_API_KEY: optionalString,
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,

  SMS_PROVIDER: z.enum(['console', 'msg91', 'twilio']).default('console'),
  SMS_SENDER_ID: optionalString,

  ANALYTICS_PROVIDER: z.enum(['none', 'ga4', 'plausible', 'internal']).default('internal'),
  ANALYTICS_REQUIRE_CONSENT: booleanish.default(true),
  GA4_MEASUREMENT_ID: optionalString,
  META_PIXEL_ID: optionalString,

  SOCIAL_INSTAGRAM_URL: z.string().url().default('https://instagram.com/'),
  SOCIAL_INSTAGRAM_HANDLE: z.string().default('paperlane.books'),
  SOCIAL_X_URL: optionalString,
  SOCIAL_FACEBOOK_URL: optionalString,

  SUPPORT_EMAIL: z.string().email().default('support@paperlane.test'),
  SUPPORT_PHONE: optionalString,
  ERROR_MONITORING_DSN: optionalString,
  SENTRY_ENABLED: booleanish.default(false),

  STORE_SUPPORT_COD: booleanish.default(true),
  STORE_FREE_SHIPPING_THRESHOLD_PAISE: z.coerce.number().int().nonnegative().default(79_900),
  STORE_DEFAULT_TAX_CODE: z.string().default('books_print'),

  // Feature flags mirror the FeatureFlag table; DB rows win at runtime.
  FEATURE_REVIEWS: booleanish.default(true),
  FEATURE_WISHLIST: booleanish.default(true),
  FEATURE_NEWSLETTER: booleanish.default(true),
  FEATURE_SUPPORT_TICKETS: booleanish.default(true),
  FEATURE_BLOG: booleanish.default(true),
  FEATURE_LOYALTY: booleanish.default(false),
  FEATURE_REFERRALS: booleanish.default(false),
  FEATURE_CHATBOT: booleanish.default(false),
  FEATURE_GIFT_CARDS: booleanish.default(false),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;
let validationFailed = false;

function parseEnv(): ServerEnv {
  const result = serverSchema.safeParse(process.env);

  if (!result.success) {
    // In production a half-configured app is worse than a dead one: it will
    // silently take money with the wrong config. Fail loudly.
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    const message = `Invalid environment configuration:\n${issues}`;

    if (process.env.NODE_ENV === 'production') {
      throw new Error(message);
    }
    // Dev/test: log the problem but keep serving with defaults so a fresh clone
    // still boots. Anything security-sensitive is still blocked elsewhere.
    console.error(`\n⚠️  ${message}\n`);
    validationFailed = true;
    return serverSchema.parse({
      ...process.env,
      AUTH_SECRET: process.env.AUTH_SECRET || 'insecure-development-only-secret-value-32+',
    });
  }

  return result.data;
}

export function env(): ServerEnv {
  if (!cached) cached = parseEnv();
  return cached;
}

export function hasEnvValidationErrors(): boolean {
  env();
  return validationFailed;
}

export const isProduction = () => env().NODE_ENV === 'production';
export const isDevelopment = () => env().NODE_ENV === 'development';
export const isTest = () => env().NODE_ENV === 'test';

/**
 * Guard against the single most dangerous misconfiguration in this app:
 * running the mock payment provider in production, which would let orders be
 * marked paid without money moving.
 */
export function assertPaymentConfigIsSafe(): void {
  const e = env();
  if (e.NODE_ENV !== 'production') return;

  if (e.PAYMENTS_PROVIDER === 'mock') {
    throw new Error(
      'Refusing to start: PAYMENTS_PROVIDER=mock in production. The mock provider cannot take real payments. ' +
        'Set PAYMENTS_PROVIDER=stripe or phonepe and configure the selected provider.',
    );
  }

  if (e.PAYMENTS_PROVIDER === 'stripe') {
    const missing = ([
      ['STRIPE_SECRET_KEY', e.STRIPE_SECRET_KEY],
      ['STRIPE_WEBHOOK_SECRET', e.STRIPE_WEBHOOK_SECRET],
    ] as const).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) throw new Error(`Stripe is selected but these are missing: ${missing.join(', ')}`);
  }

  if (e.PAYMENTS_PROVIDER === 'phonepe') {
    const missing = (
      [
        ['PHONEPE_MERCHANT_ID', e.PHONEPE_MERCHANT_ID],
        ['PHONEPE_SALT_KEY', e.PHONEPE_SALT_KEY],
        ['PHONEPE_SALT_INDEX', e.PHONEPE_SALT_INDEX],
      ] as const
    )
      .filter(([, v]) => v === undefined || v === null || v === '')
      .map(([k]) => k);

    if (missing.length) {
      throw new Error(`PhonePe is selected but these are missing: ${missing.join(', ')}`);
    }
  }
}

/** Safe subset for the browser. Never expose secrets through this. */
export function publicEnv() {
  const e = env();
  return {
    APP_NAME: e.APP_NAME,
    APP_URL: e.APP_URL,
    ANALYTICS_PROVIDER: e.ANALYTICS_PROVIDER,
    ANALYTICS_REQUIRE_CONSENT: e.ANALYTICS_REQUIRE_CONSENT,
    GA4_MEASUREMENT_ID: e.ANALYTICS_PROVIDER === 'ga4' ? e.GA4_MEASUREMENT_ID : undefined,
    SOCIAL_INSTAGRAM_URL: e.SOCIAL_INSTAGRAM_URL,
    SOCIAL_INSTAGRAM_HANDLE: e.SOCIAL_INSTAGRAM_HANDLE,
    SOCIAL_X_URL: e.SOCIAL_X_URL,
    SOCIAL_FACEBOOK_URL: e.SOCIAL_FACEBOOK_URL,
    SUPPORT_EMAIL: e.SUPPORT_EMAIL,
    SUPPORT_PHONE: e.SUPPORT_PHONE,
    STORE_FREE_SHIPPING_THRESHOLD_PAISE: e.STORE_FREE_SHIPPING_THRESHOLD_PAISE,
    FEATURES: {
      reviews: e.FEATURE_REVIEWS,
      wishlist: e.FEATURE_WISHLIST,
      newsletter: e.FEATURE_NEWSLETTER,
      supportTickets: e.FEATURE_SUPPORT_TICKETS,
      blog: e.FEATURE_BLOG,
      loyalty: e.FEATURE_LOYALTY,
      referrals: e.FEATURE_REFERRALS,
      chatbot: e.FEATURE_CHATBOT,
      giftCards: e.FEATURE_GIFT_CARDS,
    },
  } as const;
}

export type PublicEnv = ReturnType<typeof publicEnv>;
