/**
 * Error taxonomy.
 *
 * Every user-visible failure is an AppError with a stable machine `code`, an
 * HTTP status, and a message that is safe to show a customer. Internal details
 * (stack traces, SQL, provider payloads) go to the logger, never to the client —
 * leaking them is how you hand an attacker a map.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'OUT_OF_STOCK'
  | 'PRICE_CHANGED'
  | 'CART_EMPTY'
  | 'COUPON_INVALID'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_DUPLICATE'
  | 'INVENTORY_CONFLICT'
  | 'IDEMPOTENCY_REPLAY'
  | 'UPSTREAM_ERROR'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  OUT_OF_STOCK: 409,
  PRICE_CHANGED: 409,
  CART_EMPTY: 400,
  COUPON_INVALID: 422,
  PAYMENT_FAILED: 402,
  PAYMENT_DUPLICATE: 409,
  INVENTORY_CONFLICT: 409,
  IDEMPOTENCY_REPLAY: 200,
  UPSTREAM_ERROR: 502,
  NOT_IMPLEMENTED: 501,
  INTERNAL_ERROR: 500,
};

export interface AppErrorOptions {
  /** Field-level details for form rendering. */
  details?: Record<string, string[] | undefined>;
  /** Extra context for logs (never serialised to the client). */
  context?: Record<string, unknown>;
  /** Wrap an upstream error for the log trail. */
  cause?: unknown;
  /** Override the default status when the code is reused for a nuance. */
  status?: number;
  /** Mark as retryable so the UI can offer a "try again" affordance. */
  retryable?: boolean;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, string[] | undefined>;
  readonly context?: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? STATUS_BY_CODE[code] ?? 500;
    this.details = options.details;
    this.context = options.context;
    this.retryable = options.retryable ?? false;
    if (options.cause !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).cause = options.cause;
    }
  }

  toJSON(): { error: { code: ErrorCode; message: string; details?: Record<string, string[]>; retryable: boolean } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details as Record<string, string[]> } : {}),
        retryable: this.retryable,
      },
    };
  }
}

// --- Ergonomic constructors. Keeps call sites readable. ---

export const badRequest = (message: string, options?: AppErrorOptions) =>
  new AppError('VALIDATION_ERROR', message, options);

export const unauthenticated = (message = 'Please sign in to continue.', options?: AppErrorOptions) =>
  new AppError('UNAUTHENTICATED', message, options);

export const forbidden = (message = 'You do not have permission to do that.', options?: AppErrorOptions) =>
  new AppError('FORBIDDEN', message, options);

export const notFound = (message = 'We could not find that page.', options?: AppErrorOptions) =>
  new AppError('NOT_FOUND', message, options);

export const conflict = (message: string, options?: AppErrorOptions) =>
  new AppError('CONFLICT', message, options);

export const rateLimited = (message = 'Too many requests. Please slow down and try again shortly.', options?: AppErrorOptions) =>
  new AppError('RATE_LIMITED', message, { retryable: true, ...options });

export const outOfStock = (message: string, details?: Record<string, string[]>) =>
  new AppError('OUT_OF_STOCK', message, { details, retryable: true });

export const paymentFailed = (message: string, options?: AppErrorOptions) =>
  new AppError('PAYMENT_FAILED', message, options);

export const internal = (message = 'Something went wrong on our side. We have been notified.', options?: AppErrorOptions) =>
  new AppError('INTERNAL_ERROR', message, options);

export const upstream = (message: string, options?: AppErrorOptions) =>
  new AppError('UPSTREAM_ERROR', message, { retryable: true, ...options });

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/** Normalise anything thrown into a client-safe shape. */
export function toPublicError(err: unknown): {
  status: number;
  body: ReturnType<AppError['toJSON']>;
} {
  if (isAppError(err)) {
    return { status: err.status, body: err.toJSON() };
  }
  // Unknown error: log-worthy, but say nothing specific to the client.
  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side. We have been notified.',
        retryable: true,
      },
    },
  };
}

/**
 * Map Prisma's known error shapes onto ours so the API can stay generic.
 * P2002 = unique constraint (usually an idempotency or duplicate-row conflict).
 * P2025 = record not found on update/delete.
 */
export function fromPrismaError(err: unknown, fallbackMessage = 'Database operation failed.'): AppError {
  const code = (err as { code?: string })?.code;
  const meta = (err as { meta?: { target?: string[] | string } })?.meta;
  const target = Array.isArray(meta?.target) ? meta.target.join(', ') : meta?.target;

  switch (code) {
    case 'P2002':
      return new AppError('CONFLICT', 'That record already exists.', {
        cause: err,
        context: { target },
      });
    case 'P2025':
      return notFound('That record no longer exists.', { cause: err });
    case 'P2003':
      return badRequest('Related record is missing.', { cause: err, context: { target } });
    default:
      return internal(fallbackMessage, { cause: err, context: { prismaCode: code } });
  }
}
