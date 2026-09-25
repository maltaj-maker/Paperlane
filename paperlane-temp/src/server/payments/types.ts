/**
 * Payment provider contract.
 *
 * Every provider is an adapter behind this interface. The rest of the app
 * (checkout, webhooks, admin refunds) only ever sees these types, which is what
 * makes providers swappable by configuration rather than code.
 *
 * SECURITY CONTRACT — adapters must uphold all of these:
 *  1. NEVER accept a raw card number, CVV or full PAN through this interface.
 *     Card data is collected by the provider's own hosted/embedded UI. We only
 *     ever receive tokens and masked instrument labels.
 *  2. NEVER trust a client-reported payment status. Only a signed webhook or a
 *     server-to-server status query may mark an order paid.
 *  3. Every create call must carry a caller-supplied idempotency key so a retry
 *     cannot double-charge.
 *  4. Verify webhook signatures before parsing the body, and reject replays.
 */

/**
 * Instrument families we surface to customers. Kept as a local union rather than
 * importing the runtime constant so adapters stay free of value imports.
 */
export type PaymentMethod = 'UPI' | 'CARD' | 'NETBANKING' | 'WALLET' | 'COD';

/**
 * Thrown by adapters when the provider fails or is misconfigured.
 * `retryable` drives whether checkout offers a "Try again" affordance.
 */
export class PaymentProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly raw: unknown;

  constructor(message: string, code = 'PROVIDER_ERROR', retryable = true, raw: unknown = null) {
    super(message);
    this.name = 'PaymentProviderError';
    this.code = code;
    this.retryable = retryable;
    this.raw = raw;
  }
}

export interface CreatePaymentInput {
  /** Our order number, shown to the customer and used as the merchant ref. */
  orderNumber: string;
  /** Our unique merchant transaction id. Doubles as the idempotency key. */
  merchantTransactionId: string;
  amountPaise: number;
  currency: string;
  customer: {
    id?: string | null;
    name: string;
    email: string;
    phone: string;
  };
  /** Where the provider should send the browser back to. */
  redirectUrl: string;
  /** Server-to-server callback (belt) in addition to webhooks (braces). */
  callbackUrl: string;
  description: string;
  /** Line items, for providers that display a basket. No PII. */
  items?: Array<{ name: string; quantity: number; unitPricePaise: number }>;
  /** Preferred instrument. UPI is the default for this market. */
  preferredMethod?: PaymentMethod | null;
  metadata?: Record<string, string>;
}

export interface CreatePaymentResult {
  merchantTransactionId: string;
  providerOrderId: string | null;
  /** Where to send the customer to complete payment (hosted page / UPI intent). */
  redirectUrl: string | null;
  /** Some providers return a UPI deep link separately from a web page. */
  upiIntentUrl?: string | null;
  /** Raw status string from the provider, already normalised. */
  state: PaymentStateValue;
  /** Untouched provider payload, stored for reconciliation (secrets redacted). */
  raw: unknown;
}

export type PaymentStateValue =
  | 'initiated'
  | 'pending'
  | 'authorized'
  | 'captured'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface PaymentStatusResult {
  merchantTransactionId: string;
  state: PaymentStateValue;
  providerPaymentId?: string | null;
  providerTxnId?: string | null;
  method?: string | null;
  /** Masked, provider-supplied instrument label. Never a full PAN. */
  methodDetail?: string | null;
  amountPaise?: number | null;
  failureCode?: string | null;
  failureReason?: string | null;
  raw: unknown;
}

export interface RefundInput {
  merchantTransactionId: string;
  /** Our own refund reference — unique per attempt, used as the idempotency key. */
  refundReference: string;
  amountPaise: number;
  reason: string;
  /** Original provider payment id where the provider requires it. */
  providerPaymentId?: string | null;
}

export interface RefundResult {
  refundReference: string;
  state: 'processing' | 'completed' | 'failed';
  providerRefundId?: string | null;
  failureReason?: string | null;
  raw: unknown;
}

export interface WebhookVerificationResult {
  verified: boolean;
  reason?: string;
  eventId?: string;
  eventType?: string;
  merchantTransactionId?: string;
  providerPaymentId?: string | null;
  state?: PaymentStateValue;
  amountPaise?: number | null;
  method?: string | null;
  methodDetail?: string | null;
  failureCode?: string | null;
  failureReason?: string | null;
  raw: unknown;
}

export interface PaymentProvider {
  /** Stable adapter key, also stored on the Payment row. */
  readonly key: string;
  /** Shown in admin and on the checkout page. */
  readonly displayName: string;
  /** Instruments this provider can accept in this configuration. */
  readonly supportedMethods: PaymentMethod[];
  /** False for the mock provider, so the UI can refuse to offer it in production. */
  readonly isLiveCapable: boolean;

  isConfigured(): { ok: boolean; missing: string[] };

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;

  /** Server-to-server status query. This is what confirms a payment. */
  getPaymentStatus(merchantTransactionId: string): Promise<PaymentStatusResult>;

  /** Verify and normalise an inbound webhook/callback. */
  verifyWebhook(request: {
    rawBody: string;
    headers: Record<string, string>;
  }): Promise<WebhookVerificationResult>;

  /** Issue a refund. Providers without an API return `processing` for manual work. */
  refund(input: RefundInput): Promise<RefundResult>;

  /** Optional reconciliation hooks. */
  cancelPayment?(merchantTransactionId: string): Promise<PaymentStatusResult>;
}

/** Normalise provider-specific status strings into our vocabulary. */
export function normaliseState(raw: string | null | undefined): PaymentStateValue {
  const value = (raw ?? '').toUpperCase();
  if (!value) return 'pending';
  if (['PAYMENT_SUCCESS', 'SUCCESS', 'CAPTURED', 'COMPLETED', 'CHARGED'].includes(value)) return 'captured';
  if (['AUTHORIZED', 'AUTHORISED'].includes(value)) return 'authorized';
  if (['PENDING', 'PAYMENT_PENDING', 'INITIATED', 'PROCESSING'].includes(value)) return 'pending';
  if (['PAYMENT_DECLINED', 'DECLINED', 'FAILED', 'PAYMENT_ERROR', 'ERROR', 'ERROR_STATE'].includes(value)) return 'failed';
  if (['PAYMENT_CANCELLED', 'CANCELLED', 'USER_CANCELLED', 'ABORTED'].includes(value)) return 'cancelled';
  if (['TIMED_OUT', 'TIMEOUT', 'EXPIRED'].includes(value)) return 'expired';
  return 'pending';
}
