/**
 * Prisma client singleton.
 *
 * Next.js hot-reloads modules in development; without the global cache you burn
 * through database connections on every save. In production we also attach
 * slow-query logging, which is our first line of defence against an N+1 that
 * only shows up under real traffic.
 *
 * Transactions: use `db.$transaction([...])` for atomic multi-write operations.
 * Any flow that touches stock or money lives inside a transaction — see
 * src/server/inventory.ts and src/server/orders.ts.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Queries slower than this get logged as warnings. */
const SLOW_QUERY_MS = 400;

function createClient(): PrismaClient {
  const e = env();

  const client = new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
    errorFormat: e.NODE_ENV === 'production' ? 'minimal' : 'pretty',
  });

  // Prisma's generated types for $on are loose across versions; the handlers
  // below are intentionally narrow.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = client as any;

  if (e.LOG_LEVEL === 'debug' || e.NODE_ENV === 'development') {
    c.$on('query', (event: { duration: number; query: string }) => {
      if (event.duration >= SLOW_QUERY_MS) {
        logger.warn('slow query', {
          ms: event.duration,
          // Truncate: query text can contain customer values in dev logs.
          query: event.query.slice(0, 300),
        });
      }
    });
  }

  c.$on('error', (event: { message: string }) => {
    logger.error('prisma error', { message: event.message });
  });

  c.$on('warn', (event: { message: string }) => {
    logger.warn('prisma warning', { message: event.message });
  });

  return client;
}

export const db: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}

/**
 * Retry helper for transient SQLite/Postgres write contention.
 *
 * SQLite returns SQLITE_BUSY when a concurrent writer holds the lock. Under
 * load (or during the concurrency tests) a bounded retry converts that into a
 * correct result rather than a spurious 500. Postgres surfaces 40001
 * (serialization failure) in REPEATABLE READ, which we treat the same way.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  const { attempts = 5, baseDelayMs = 40, label = 'db operation' } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransient(err) || attempt === attempts) throw err;
      // Exponential backoff with jitter, to avoid two writers colliding forever.
      const delay = baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random());
      logger.warn(`retrying ${label}`, { attempt, delayMs: Math.round(delay) });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

function isTransient(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const message = String((err as { message?: string })?.message ?? '');
  return (
    code === 'P2034' || // write conflict / deadlock (Prisma)
    code === 'P1008' || // operation timeout
    code === 'P2024' || // pool timeout
    message.includes('SQLITE_BUSY') ||
    message.includes('database is locked') ||
    message.includes('40001')
  );
}

/** True when the database is reachable. Used by the health endpoint. */
export async function pingDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : 'unknown',
    };
  }
}
