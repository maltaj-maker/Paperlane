import 'server-only';

/**
 * Per-request context: client IP, user agent, device class, referrer and a
 * stable session id.
 *
 * Pulled out of the auth module so non-auth code (analytics, rate limiting,
 * audit) can read it without importing the whole auth surface.
 *
 * The session id is a random cookie value, not a fingerprint. It exists so a
 * visit can be stitched together across pages for funnel reporting — nothing
 * about the device is inferred or stored beyond a coarse mobile/tablet/desktop
 * class, which is all the reporting actually needs.
 */

import { cookies, headers } from 'next/headers';
import { generateToken } from '@/lib/crypto';
import { classifyDevice } from './analytics';

export const SESSION_ID_COOKIE = 'pl_sid';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export async function getClientIpForLimit(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  // Left-most entry is the original client when behind a trusted proxy. The
  // platform sets this header; a spoofed value only weakens that attacker's own
  // rate limiting, which is an acceptable trade-off for not needing config.
  if (forwarded) return forwarded.split(',')[0]!.trim().slice(0, 64);
  return h.get('x-real-ip')?.slice(0, 64) ?? null;
}

export async function getUserAgentSafe(): Promise<string | null> {
  const h = await headers();
  return h.get('user-agent')?.slice(0, 400) ?? null;
}

export async function getReferrer(): Promise<string | null> {
  const h = await headers();
  return h.get('referer')?.slice(0, 500) ?? null;
}

/**
 * Read the analytics session id, creating one if needed.
 * Only callable where cookies may be written (route handlers / server actions),
 * which is exactly where analytics events are emitted from.
 */
export async function getOrCreateSessionId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(SESSION_ID_COOKIE)?.value;
  if (existing) return existing;

  const sessionId = generateToken(16);
  store.set(SESSION_ID_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });

  return sessionId;
}

/** Read-only variant for places that must not mutate cookies (server components). */
export async function getSessionId(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_ID_COOKIE)?.value ?? null;
}

export interface AnalyticsContext {
  sessionId: string | null;
  userId: string | null;
  referrer: string | null;
  /** Pathname the event was fired from, when the caller passes one through. */
  path: string | null;
  device: 'mobile' | 'tablet' | 'desktop' | 'unknown';
  userAgent: string | null;
  ip: string | null;
}

/** One call to gather everything an analytics event needs. */
export async function getAnalyticsContext(): Promise<AnalyticsContext> {
  const [sessionId, userAgent, referrer, ip, user] = await Promise.all([
    getSessionId(),
    getUserAgentSafe(),
    getReferrer(),
    getClientIpForLimit(),
    import('./auth')
      .then((m) => m.getCurrentUser())
      .catch(() => null),
  ]);

  return {
    sessionId,
    userId: user?.id ?? null,
    referrer,
    // Server-rendered callers do not know the referrer *path*; the client sends
    // it explicitly when it matters. Null is honest, not a guess.
    path: null,
    device: classifyDevice(userAgent),
    userAgent,
    ip,
  };
}
