/**
 * Rate limiting.
 *
 * Backed by a table rather than process memory, because the app runs multiple
 * instances in production and an in-memory counter would let an attacker get N×
 * the limit by spreading requests. The upsert is a single atomic statement so
 * concurrent requests cannot both read the old count.
 *
 * Fixed-window is a deliberate trade-off: it is cheap, exact enough for abuse
 * control, and — importantly — every increment is one round trip. Sliding-window
 * accuracy is not worth two extra queries on the login path.
 */

import { db } from './db';
import { logger } from '@/lib/logger';

export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/** Named rules, tuned per endpoint sensitivity. */
export const RATE_LIMITS = {
  // Auth: tight, because credential stuffing is the realistic attack.
  LOGIN: { limit: 10, windowSeconds: 300 },
  REGISTER: { limit: 5, windowSeconds: 3600 },
  PASSWORD_RESET: { limit: 5, windowSeconds: 3600 },
  EMAIL_VERIFY_RESEND: { limit: 3, windowSeconds: 3600 },

  // Customer-facing reads and writes.
  SEARCH: { limit: 120, windowSeconds: 60 },
  SHIPPING_QUOTE: { limit: 60, windowSeconds: 60 },
  AUTOCOMPLETE: { limit: 240, windowSeconds: 60 },
  CART_WRITE: { limit: 90, windowSeconds: 60 },
  CHECKOUT_CREATE: { limit: 12, windowSeconds: 600 },
  PAYMENT_INITIATE: { limit: 20, windowSeconds: 600 },
  REVIEW_CREATE: { limit: 6, windowSeconds: 3600 },
  REVIEW_VOTE: { limit: 60, windowSeconds: 3600 },
  SUPPORT_CREATE: { limit: 5, windowSeconds: 3600 },
  NEWSLETTER: { limit: 5, windowSeconds: 3600 },
  CONTACT: { limit: 5, windowSeconds: 3600 },

  // Admin.
  ADMIN_WRITE: { limit: 300, windowSeconds: 60 },
  ADMIN_IMPORT: { limit: 10, windowSeconds: 3600 },

  // Inbound webhooks — generous, since providers batch and retry. Signature
  // verification, not rate limiting, is the real control here.
  WEBHOOK: { limit: 600, windowSeconds: 60 },

  // Generic fallback for anything unclassified.
  DEFAULT: { limit: 300, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix ms when the window resets. */
  resetAt: number;
  retryAfterSeconds: number;
}

/**
 * Consume one unit for `key` under `rule`.
 *
 * `key` should combine the limiter name with a stable identity, e.g.
 * `login:ip:203.0.113.4` or `login:user:abc123`. Compose with `limitKey()`.
 */
export async function consume(
  name: RateLimitName,
  key: string,
  rule: RateLimitRule = RATE_LIMITS[name],
): Promise<RateLimitResult> {
  const bucketId = `${name}:${key}`.slice(0, 250);
  const now = Date.now();
  const windowEnd = now + rule.windowSeconds * 1000;

  try {
    // Single-statement atomic upsert. Reset the counter when the previous
    // window has elapsed, otherwise increment in place.
    const rows = await db.$queryRawUnsafe<Array<{ count: number; windowEnd: Date | number | string }>>(
      `INSERT INTO "RateLimitBucket" ("id", "count", "windowEnd")
       VALUES (?, 1, ?)
       ON CONFLICT("id") DO UPDATE SET
         "count" = CASE WHEN "RateLimitBucket"."windowEnd" <= ? THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
         "windowEnd" = CASE WHEN "RateLimitBucket"."windowEnd" <= ? THEN ? ELSE "RateLimitBucket"."windowEnd" END
       RETURNING "count", "windowEnd"`,
      bucketId,
      new Date(windowEnd).toISOString(),
      new Date(now).toISOString(),
      new Date(now).toISOString(),
      new Date(windowEnd).toISOString(),
    );

    const row = rows[0];
    const count = Number(row?.count ?? 1);
    const resetAtRaw = row?.windowEnd;
    const resetAt =
      resetAtRaw instanceof Date
        ? resetAtRaw.getTime()
        : typeof resetAtRaw === 'number'
          ? resetAtRaw
          : Date.parse(String(resetAtRaw ?? windowEnd)) || windowEnd;

    const remaining = Math.max(0, rule.limit - count);
    return {
      allowed: count <= rule.limit,
      limit: rule.limit,
      remaining,
      resetAt,
      retryAfterSeconds: Math.max(0, Math.ceil((resetAt - now) / 1000)),
    };
  } catch (err) {
    // FAIL OPEN, deliberately, but loudly. If the limiter table is unavailable
    // we would rather serve customers than 500 the whole site. Auth endpoints
    // additionally have per-account lockout as an independent control.
    logger.error('rate limiter unavailable — failing open', { name, err });
    return {
      allowed: true,
      limit: rule.limit,
      remaining: rule.limit,
      resetAt: windowEnd,
      retryAfterSeconds: 0,
    };
  }
}

/** Build a consistent key. */
export function limitKey(scope: string, identity: string | null | undefined): string {
  return `${scope}:${identity || 'anonymous'}`;
}

/**
 * Check several scopes at once (e.g. per-IP *and* per-account). All must pass.
 * Returns the most restrictive failure so the client gets an accurate Retry-After.
 */
export async function consumeAll(
  checks: Array<{ name: RateLimitName; key: string; rule?: RateLimitRule }>,
): Promise<RateLimitResult> {
  const results: RateLimitResult[] = [];
  for (const check of checks) {
    results.push(await consume(check.name, check.key, check.rule));
  }
  const blocked = results.filter((r) => !r.allowed);
  if (blocked.length === 0) return results[0]!;
  return blocked.sort((a, b) => b.retryAfterSeconds - a.retryAfterSeconds)[0]!;
}

/** Housekeeping for a cron/scheduled job. */
export async function pruneRateLimitBuckets(): Promise<number> {
  const result = await db.rateLimitBucket.deleteMany({
    where: { windowEnd: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  return result.count;
}
