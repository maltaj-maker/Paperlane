/**
 * PhonePe Payment Gateway adapter (PG v2).
 *
 * Implements the real integration — no stubs, no fake success paths:
 *   • OAuth token acquisition (client credentials), cached until expiry
 *   • X-VERIFY checksum signing for /pg/v1/pay, /pg/v1/status, /pg/v1/refund
 *   • Hosted checkout redirect + raw UPI intent (for in-app deep links)
 *   • Server-to-server status polling (the authoritative confirmation path)
 *   • Webhook signature verification with constant-time comparison
 *
 * With no merchant credentials configured, `isConfigured()` returns false and
 * checkout refuses to route to this provider rather than pretending to charge
 * anyone. See src/server/payments/index.ts for adapter selection.
 *
 * Docs: https://developer.phonepe.com/v1/reference/pay-api
 */

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { sha256Hex, safeCompare, hmacSha256Base64 } from '@/lib/crypto';
import {
  PaymentProviderError,
  type CreatePaymentInput,
  type CreatePaymentResult,
  type PaymentProvider,
  type PaymentStatusResult,
  type RefundInput,
  type RefundResult,
  type WebhookVerificationResult,
  normaliseState,
} from './types';

const SANDBOX_BASE = 'https://api-preprod.phonepe.com/apis/pg-sandbox';
const PRODUCTION_BASE = 'https://api.phonepe.com/apis/hermes';

const REQUEST_TIMEOUT_MS = 20_000;

function baseUrl(): string {
  return env().PHONEPE_ENV === 'production' ? PRODUCTION_BASE : SANDBOX_BASE;
}

/** PhonePe expects amounts in paise. */
const PAY_ENDPOINT = '/pg/v1/pay';
const STATUS_PATH = '/pg/v1/status';
const REFUND_ENDPOINT = '/pg/v1/refund';
const TOKEN_PATH = '/v1/oauth/token';

// ---------------------------------------------------------------------------
// Checksum helpers — the part that must be exactly right
// ---------------------------------------------------------------------------

/**
 * X-VERIFY = sha256(payload + endpoint + saltKey) + "###" + saltIndex
 * where `payload` is the base64 request body for writes, or the URL path for reads.
 */
export function buildChecksum(payloadOrPath: string, endpoint: string, saltKey: string, saltIndex: number | string): string {
  const digest = sha256Hex(`${payloadOrPath}${endpoint}${saltKey}`);
  return `${digest}###${saltIndex}`;
}

/**
 * Verify a callback checksum from PhonePe.
 * PhonePe sends X-VERIFY = sha256(base64ResponseBody + saltKey) + "###" + saltIndex
 */
export function verifyCallbackChecksum(
  base64Body: string,
  receivedHeader: string,
  saltKey: string,
  saltIndex: number | string,
): boolean {
  if (!receivedHeader) return false;
  const expected = `${sha256Hex(`${base64Body}${saltKey}`)}###${saltIndex}`;
  return safeCompare(expected, receivedHeader.trim());
}

/** PhonePe's webhook auth header is SHA256(username:password). */
export function verifyWebhookAuthorization(
  received: string | undefined,
  username: string,
  password: string,
): boolean {
  if (!received) return false;
  const expected = sha256Hex(`${username}:${password}`);
  return safeCompare(expected, received.trim());
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new PaymentProviderError('PhonePe did not respond in time.', 'UPSTREAM_TIMEOUT', true);
    }
    throw new PaymentProviderError('Could not reach PhonePe.', 'UPSTREAM_UNREACHABLE', true, err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Obtain an OAuth access token.
 *
 * PhonePe's newer products require OAuth; older PG v2 integrations authenticate
 * purely with X-VERIFY checksums. We support both: if client credentials are
 * present we fetch a token, otherwise we sign every request with the salt key.
 * That means the store can go live on either contract without a code change.
 */
async function getAccessToken(): Promise<string | null> {
  const e = env();
  if (!e.PHONEPE_CLIENT_ID || !e.PHONEPE_CLIENT_SECRET) return null;

  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) {
    return tokenCache.token;
  }

  const body = new URLSearchParams({
    client_id: e.PHONEPE_CLIENT_ID,
    client_secret: e.PHONEPE_CLIENT_SECRET,
    client_version: String(e.PHONEPE_CLIENT_VERSION),
    grant_type: 'client_credentials',
  });

  const response = await fetchWithTimeout(`${baseUrl()}${TOKEN_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  });

  const text = await response.text();
  if (!response.ok) {
    logger.error('phonepe token request failed', { status: response.status });
    throw new PaymentProviderError('Could not authenticate with PhonePe.', 'AUTH_FAILED', false);
  }

  let parsed: { access_token?: string; expires_in?: number };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PaymentProviderError('PhonePe returned an unreadable token response.', 'BAD_RESPONSE', false);
  }

  if (!parsed.access_token) {
    throw new PaymentProviderError('PhonePe did not return an access token.', 'AUTH_FAILED', false);
  }

  tokenCache = {
    token: parsed.access_token,
    expiresAt: Date.now() + (parsed.expires_in ?? 3600) * 1000,
  };

  return tokenCache.token;
}

function authHeaders(): Record<string, string> {
  const e = env();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  // Legacy/checksum auth is always available and is what PG v2 documents.
  if (e.PHONEPE_MERCHANT_ID && e.PHONEPE_SALT_KEY) {
    headers['X-MERCHANT-ID'] = e.PHONEPE_MERCHANT_ID;
  }

  return headers;
}

/** Strip anything secret-shaped before a payload goes into the DB or logs. */
function redactProviderPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const clone = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  delete clone.token;
  delete clone.accessToken;
  delete clone.access_token;
  return clone;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const phonePeProvider: PaymentProvider = {
  key: 'phonepe',
  displayName: 'PhonePe',
  // UPI first; PhonePe's hosted checkout also surfaces cards, net banking and
  // wallets, which is why all four are advertised here.
  supportedMethods: ['UPI', 'CARD', 'NETBANKING', 'WALLET'],
  isLiveCapable: true,

  isConfigured() {
    const e = env();
    const missing: string[] = [];
    if (!e.PHONEPE_MERCHANT_ID) missing.push('PHONEPE_MERCHANT_ID');
    if (!e.PHONEPE_SALT_KEY) missing.push('PHONEPE_SALT_KEY');
    if (e.PHONEPE_SALT_INDEX === undefined) missing.push('PHONEPE_SALT_INDEX');
    return { ok: missing.length === 0, missing };
  },

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const e = env();
    const config = phonePeProvider.isConfigured();
    if (!config.ok) {
      throw new PaymentProviderError(
        `PhonePe is not configured (missing ${config.missing.join(', ')}).`,
        'NOT_CONFIGURED',
        false,
      );
    }

    /**
     * The request payload. We deliberately omit every optional customer field
     * we do not strictly need — data minimisation applies to payment payloads
     * just as much as to our own database.
     */
    const payload: Record<string, unknown> = {
      merchantId: e.PHONEPE_MERCHANT_ID,
      merchantTransactionId: input.merchantTransactionId,
      amount: input.amountPaise,
      redirectUrl: input.redirectUrl,
      redirectMode: 'REDIRECT',
      callbackUrl: input.callbackUrl,
      merchantOrderId: input.orderNumber,
      // Payment instrument hints. UPI is the default; the hosted page still
      // offers everything PhonePe supports if the hint is unavailable.
      paymentInstrument: input.preferredMethod === 'UPI' ? { type: 'UPI_INTENT' } : undefined,
      // PhonePe surfaces this as the human-readable narration on UPI apps.
      description: input.description.slice(0, 100),
    };

    // Remove undefined keys so the signature matches byte-for-byte.
    for (const key of Object.keys(payload)) {
      if (payload[key] === undefined) delete payload[key];
    }

    const base64Payload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const checksum = buildChecksum(base64Payload, PAY_ENDPOINT, e.PHONEPE_SALT_KEY!, e.PHONEPE_SALT_INDEX);

    const headers: Record<string, string> = {
      ...authHeaders(),
      'X-VERIFY': checksum,
    };

    const token = await getAccessToken().catch(() => null);
    if (token) headers.Authorization = `O-Bearer ${token}`;

    const response = await fetchWithTimeout(`${baseUrl()}${PAY_ENDPOINT}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ request: base64Payload }),
      cache: 'no-store',
    });

    const text = await response.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      logger.error('phonepe pay returned non-JSON', { status: response.status });
      throw new PaymentProviderError('PhonePe returned an unreadable response.', 'BAD_RESPONSE', true);
    }

    const success = parsed.success === true;
    const data = (parsed.data ?? {}) as Record<string, unknown>;
    const instrumentResponse = (data.instrumentResponse ?? {}) as Record<string, unknown>;
    const redirectInfo = (instrumentResponse.redirectInfo ?? {}) as Record<string, unknown>;

    const redirectUrl = typeof redirectInfo.url === 'string' ? redirectInfo.url : null;

    if (!success || (!redirectUrl && !data.merchantTransactionId)) {
      const code = typeof parsed.code === 'string' ? parsed.code : 'PAY_INIT_FAILED';
      logger.error('phonepe pay failed', { code, status: response.status, orderNumber: input.orderNumber });
      throw new PaymentProviderError(
        'PhonePe could not start this payment. Please try again.',
        code,
        // INVALID_TRANSACTION_ID and the like are not worth retrying blindly.
        code === 'INTERNAL_SERVER_ERROR' || code === 'TIMED_OUT',
        parsed,
      );
    }

    return {
      merchantTransactionId: input.merchantTransactionId,
      providerOrderId: typeof data.merchantTransactionId === 'string' ? data.merchantTransactionId : null,
      redirectUrl,
      upiIntentUrl: typeof instrumentResponse.intentUrl === 'string' ? instrumentResponse.intentUrl : null,
      state: 'pending',
      raw: redactProviderPayload(parsed),
    };
  },

  async getPaymentStatus(merchantTransactionId: string): Promise<PaymentStatusResult> {
    const e = env();
    const path = `${STATUS_PATH}/${e.PHONEPE_MERCHANT_ID}/${merchantTransactionId}`;
    const checksum = buildChecksum(path, '', e.PHONEPE_SALT_KEY!, e.PHONEPE_SALT_INDEX);

    const headers: Record<string, string> = {
      ...authHeaders(),
      'X-VERIFY': checksum,
    };
    const token = await getAccessToken().catch(() => null);
    if (token) headers.Authorization = `O-Bearer ${token}`;

    const response = await fetchWithTimeout(`${baseUrl()}${path}`, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });

    const text = await response.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new PaymentProviderError('PhonePe returned an unreadable status response.', 'BAD_RESPONSE', true);
    }

    const data = (parsed.data ?? {}) as Record<string, unknown>;
    const instrument = (data.paymentInstrument ?? {}) as Record<string, unknown>;
    const instrumentDetails = (instrument.instrumentDetails ?? {}) as Record<string, unknown>;

    const state = normaliseState(
      typeof data.state === 'string' ? data.state : typeof data.status === 'string' ? data.status : parsed.code as string,
    );

    return {
      merchantTransactionId,
      state,
      providerPaymentId: typeof data.transactionId === 'string' ? data.transactionId : null,
      providerTxnId: typeof data.transactionId === 'string' ? data.transactionId : null,
      method: typeof instrument.type === 'string' ? instrument.type : null,
      methodDetail: extractMethodDetail(instrumentDetails),
      amountPaise: typeof data.amount === 'number' ? data.amount : null,
      failureCode: typeof (data.errorCode ?? parsed.code) === 'string' ? String(data.errorCode ?? parsed.code) : null,
      failureReason: typeof data.errorMessage === 'string' ? data.errorMessage : null,
      raw: redactProviderPayload(parsed),
    };
  },

  async verifyWebhook({ rawBody, headers }): Promise<WebhookVerificationResult> {
    const e = env();
    const normalized = normaliseHeaders(headers);

    // Two independent checks: the callback checksum over the body, and (when
    // configured) the webhook's Authorization header. Either one alone would be
    // spoofable in some deployment topologies; requiring both is cheap.
    const receivedVerify = normalized['x-verify'] ?? '';
    const base64Body = Buffer.from(rawBody, 'utf8').toString('base64');
    const checksumOk = verifyCallbackChecksum(
      base64Body,
      receivedVerify,
      e.PHONEPE_SALT_KEY ?? '',
      e.PHONEPE_SALT_INDEX,
    );

    const authHeader = normalized.authorization;
    const authorizationOk = e.PHONEPE_CLIENT_ID && e.PHONEPE_CLIENT_SECRET
      ? verifyWebhookAuthorization(authHeader, e.PHONEPE_CLIENT_ID, e.PHONEPE_CLIENT_SECRET)
      : true; // Not configured → checksum is the sole control; still verified above.

    if (!checksumOk) {
      logger.warn('phonepe webhook checksum mismatch');
      return { verified: false, reason: 'checksum_mismatch', raw: null };
    }
    if (!authorizationOk) {
      logger.warn('phonepe webhook authorization mismatch');
      return { verified: false, reason: 'authorization_mismatch', raw: null };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return { verified: false, reason: 'malformed_body', raw: null };
    }

    const response = (parsed.response ?? parsed) as string | Record<string, unknown>;
    let body: Record<string, unknown>;

    if (typeof response === 'string') {
      try {
        body = JSON.parse(Buffer.from(response, 'base64').toString('utf8'));
      } catch {
        return { verified: false, reason: 'malformed_response_payload', raw: parsed };
      }
    } else {
      body = response;
    }

    const data = (body.data ?? {}) as Record<string, unknown>;
    const instrument = (data.paymentInstrument ?? {}) as Record<string, unknown>;
    const instrumentDetails = (instrument.instrumentDetails ?? {}) as Record<string, unknown>;

    const merchantTransactionId =
      typeof data.merchantTransactionId === 'string'
        ? data.merchantTransactionId
        : typeof body.merchantTransactionId === 'string'
          ? body.merchantTransactionId
          : undefined;

    if (!merchantTransactionId) {
      return { verified: false, reason: 'missing_merchant_transaction_id', raw: parsed };
    }

    const eventType = `${String(parsed.type ?? 'payment')}.${String(data.state ?? 'unknown')}`;
    // PhonePe does not always send an event id; derive a stable one from the
    // transaction + state so a replayed webhook is deduplicated by the unique
    // index on PaymentEvent instead of creating a second event row.
    const eventId =
      typeof parsed.eventId === 'string'
        ? parsed.eventId
        : `${merchantTransactionId}:${String(data.state ?? 'unknown')}`;

    return {
      verified: true,
      eventId,
      eventType,
      merchantTransactionId,
      providerPaymentId: typeof data.transactionId === 'string' ? data.transactionId : null,
      state: normaliseState(typeof data.state === 'string' ? data.state : undefined),
      amountPaise: typeof data.amount === 'number' ? data.amount : null,
      method: typeof instrument.type === 'string' ? instrument.type : null,
      methodDetail: extractMethodDetail(instrumentDetails),
      failureCode: typeof data.errorCode === 'string' ? data.errorCode : null,
      failureReason: typeof data.errorMessage === 'string' ? data.errorMessage : null,
      raw: redactProviderPayload(parsed),
    };
  },

  async refund(input: RefundInput): Promise<RefundResult> {
    const e = env();
    const config = phonePeProvider.isConfigured();
    if (!config.ok) {
      throw new PaymentProviderError('PhonePe is not configured.', 'NOT_CONFIGURED', false);
    }

    const payload = {
      merchantId: e.PHONEPE_MERCHANT_ID,
      merchantTransactionId: input.merchantTransactionId,
      // PhonePe expects a unique refund id per attempt.
      merchantRefundId: input.refundReference,
      // Original transaction reference; required by the refund API.
      originalTransactionId: input.providerPaymentId ?? input.merchantTransactionId,
      amount: input.amountPaise,
      callbackUrl: e.PHONEPE_WEBHOOK_URL,
    };

    const base64Payload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const checksum = buildChecksum(base64Payload, REFUND_ENDPOINT, e.PHONEPE_SALT_KEY!, e.PHONEPE_SALT_INDEX);

    const headers: Record<string, string> = { ...authHeaders(), 'X-VERIFY': checksum };
    const token = await getAccessToken().catch(() => null);
    if (token) headers.Authorization = `O-Bearer ${token}`;

    const response = await fetchWithTimeout(`${baseUrl()}${REFUND_ENDPOINT}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ request: base64Payload }),
      cache: 'no-store',
    });

    const text = await response.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new PaymentProviderError('PhonePe returned an unreadable refund response.', 'BAD_RESPONSE', true);
    }

    const success = parsed.success === true;
    const data = (parsed.data ?? {}) as Record<string, unknown>;
    const stateRaw = String(data.state ?? (success ? 'PENDING' : 'FAILED'));

    const state: RefundResult['state'] =
      stateRaw === 'COMPLETED' || stateRaw === 'SUCCESS'
        ? 'completed'
        : stateRaw === 'FAILED' || stateRaw === 'REJECTED'
          ? 'failed'
          : 'processing';

    return {
      refundReference: input.refundReference,
      state,
      providerRefundId: typeof data.refundId === 'string' ? data.refundId : null,
      failureReason: typeof data.errorMessage === 'string' ? data.errorMessage : null,
      raw: redactProviderPayload(parsed),
    };
  },

  async cancelPayment(merchantTransactionId: string): Promise<PaymentStatusResult> {
    // PhonePe's PG does not expose a hard cancel for UPI collect requests; a
    // pending UPI intent naturally expires. We surface the current state and let
    // the order-level cancel path release the stock reservation.
    return phonePeProvider.getPaymentStatus(merchantTransactionId);
  },
};

/**
 * Pull a masked instrument label out of whatever shape the provider sent.
 * We accept only fields that are already masked — if a provider ever hands us
 * something that looks like a full PAN we drop it on the floor.
 */
function extractMethodDetail(details: Record<string, unknown>): string | null {
  const candidates = [
    details.maskedCardNumber,
    details.cardNumber,
    details.maskedAccountNumber,
    details.vpa,
    details.upiTransactionId,
    details.bankTransactionId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate) continue;
    // Reject anything that is a full, unmasked PAN.
    const digits = candidate.replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && !candidate.includes('*') && !candidate.includes('X')) {
      return null;
    }
    return candidate.slice(0, 64);
  }
  return null;
}

function normaliseHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

export { PaymentProviderError };
