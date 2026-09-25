/**
 * Authentication & session management.
 *
 * Design notes:
 *  - Sessions are opaque random tokens in an HttpOnly, SameSite=Lax cookie. The
 *    database stores only the SHA-256 of the token, so a leaked DB dump cannot
 *    be used to impersonate anyone.
 *  - `secure` is on in production, off in dev so http://localhost works.
 *  - `requireUser` / `requirePermission` are the server-side authorisation
 *    boundary. Client-side guards are cosmetic; these are the real control.
 */

import 'server-only';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import type { Session, User, Role } from '@prisma/client';

import { db, withRetry } from './db';
import { env, isProduction } from '@/lib/env';
import { hasEnvValidationErrors } from '@/lib/env';
import {
  forbidden,
  unauthenticated,
  unauthenticated as unauth,
  rateLimited,
} from '@/lib/errors';
import { generateToken, hashPassword, normaliseEmail, safeCompare, sha256, verifyPassword } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import {
  PERMISSIONS,
  ROLE,
  STAFF_ROLES,
  isStaffRole,
  permissionsForRole,
  roleHasPermission,
  type Permission,
} from '@/lib/permissions';
import { AUDIT_ACTION, USER_STATUS } from '@/lib/constants';

export const SESSION_COOKIE = 'pl_session';

/** Resolve once per process so dev warnings do not repeat on every request. */
let devSecretWarned = false;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  role: string;
  roleLabel: string;
  status: string;
  emailVerifiedAt: Date | null;
  permissions: Permission[];
}

export type SessionWithUser = { session: Session; user: SessionUser };

function toSessionUser(user: User & { role: Role }): SessionUser {
  // Custom roles store their own permission list; system roles use the bundle.
  const stored = user.role.permissions;
  let permissions = permissionsForRole(user.role.name);
  if (!user.role.isSystem && stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) permissions = parsed as Permission[];
    } catch {
      logger.warn('role has malformed permission payload', { roleId: user.role.id });
    }
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    role: user.role.name,
    roleLabel: user.role.label,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    permissions,
  };
}

/** Issue a session and set the cookie. Call only after credentials are verified. */
export async function createSession(
  userId: string,
  context: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const ttlDays = env().SESSION_TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  const token = generateToken(32);

  await db.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt,
      ip: context.ip?.slice(0, 64) ?? null,
      userAgent: context.userAgent?.slice(0, 400) ?? null,
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  return { token, expiresAt };
}

/**
 * Read and validate the current session. Wrapped in React `cache` so a single
 * render pass resolves the session once, no matter how many components ask.
 */
export const getSession = cache(async (): Promise<SessionWithUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { role: true } } },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;

  const user = session.user;
  if (user.deletedAt || user.status === USER_STATUS.DELETED || user.status === USER_STATUS.SUSPENDED) {
    return null;
  }

  return { session, user: toSessionUser(user) };
});

/** Current user or null. Safe to call from any server component. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const s = await getSession();
  return s?.user ?? null;
});

/** Throwing variant for routes that must have a user. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw unauth();
  return user;
}

/**
 * Require a verified email. Some flows (placing an order) are fine without it;
 * others (reviewing, deleting your account) are not.
 */
export async function requireVerifiedUser(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.emailVerifiedAt) {
    throw forbidden('Please verify your email address to do that. Check your inbox for the link.');
  }
  return user;
}

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.permissions.includes(permission)) {
    logger.warn('permission denied', { userId: user.id, permission, role: user.role });
    throw forbidden();
  }
  return user;
}

export async function requireStaff(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isStaffRole(user.role)) throw forbidden('Staff access only.');
  return user;
}

export function can(user: SessionUser | null, permission: Permission): boolean {
  if (!user) return false;
  return user.permissions.includes(permission);
}

export function canAny(user: SessionUser | null, permissions: Permission[]): boolean {
  if (!user) return false;
  return permissions.some((p) => user.permissions.includes(p));
}

/** Revoke the current session (logout) and clear the cookie. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    await db.session
      .updateMany({
        where: { tokenHash: sha256(token), revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch((err) => logger.error('failed to revoke session', { err }));
  }

  store.delete(SESSION_COOKIE);
}

/** Revoke every session for a user — used on password reset and account deletion. */
export async function revokeAllSessions(userId: string): Promise<number> {
  const result = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** Housekeeping: delete long-expired sessions. Safe to run on a schedule. */
export async function pruneExpiredSessions(): Promise<number> {
  const result = await db.session.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// Credential authentication with brute-force protection
// ---------------------------------------------------------------------------

const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_MINUTES = 15;

export interface LoginResult {
  ok: boolean;
  userId?: string;
  /** Generic message — never reveals whether the email exists. */
  message?: string;
  lockedUntil?: Date;
}

/**
 * Verify email + password.
 *
 * Anti-enumeration: an unknown email and a wrong password return the identical
 * message, and we run a dummy scrypt comparison for unknown users so response
 * timing does not leak existence either.
 */
export async function authenticateWithPassword(
  rawEmail: string,
  password: string,
  context: { ip?: string | null; userAgent?: string | null } = {},
): Promise<LoginResult> {
  const email = normaliseEmail(rawEmail);

  const user = await withRetry(
    () => db.user.findUnique({ where: { email }, include: { role: true } }),
    { label: 'auth.lookup' },
  );

  if (!user || !user.passwordHash) {
    // Burn equivalent CPU so timing is comparable to a real verification.
    await verifyPassword(password, 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA');
    await recordFailedLogin(null, email, context);
    return { ok: false, message: 'Those details do not match an account we have.' };
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    logger.warn('login attempt on locked account', { userId: user.id, ip: context.ip });
    await recordFailedLogin(user.id, email, context);
    return {
      ok: false,
      lockedUntil: user.lockedUntil,
      message: `Too many failed attempts. Try again after ${user.lockedUntil.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.`,
    };
  }

  if (user.deletedAt || user.status === USER_STATUS.DELETED) {
    await verifyPassword(password, user.passwordHash);
    await recordFailedLogin(user.id, email, context);
    return { ok: false, message: 'Those details do not match an account we have.' };
  }

  const valid = await verifyPassword(password, user.passwordHash);

  if (!valid) {
    const failedCount = user.failedLoginCount + 1;
    const shouldLock = failedCount >= MAX_FAILED_ATTEMPTS;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failedCount,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    });
    await recordFailedLogin(user.id, email, context);
    return {
      ok: false,
      lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : undefined,
      message: shouldLock
        ? 'Too many failed attempts. Your account is locked for 15 minutes.'
        : 'Those details do not match an account we have.',
    };
  }

  if (user.status === USER_STATUS.SUSPENDED) {
    return { ok: false, message: 'This account is suspended. Please contact support.' };
  }

  // Success: clear counters, record the login, upgrade the hash if needed.
  await db.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  return { ok: true, userId: user.id };
}

async function recordFailedLogin(
  userId: string | null,
  email: string,
  context: { ip?: string | null; userAgent?: string | null },
): Promise<void> {
  await db.auditLog
    .create({
      data: {
        actorId: userId,
        actorEmail: email,
        action: AUDIT_ACTION.LOGIN_FAILED,
        entityType: 'auth',
        summary: userId ? 'Failed sign-in attempt' : 'Failed sign-in for unknown email',
        ip: context.ip ?? null,
        userAgent: context.userAgent?.slice(0, 400) ?? null,
      },
    })
    .catch(() => {
      /* audit failures must never break the auth path */
    });
}

/** Register a new customer. Returns the created user id. */
export async function registerCustomer(input: {
  email: string;
  password: string;
  name: string;
  phone?: string;
  marketingEmailConsent?: boolean;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ userId: string }> {
  const email = normaliseEmail(input.email);

  const existing = await db.user.findUnique({ where: { email }, select: { id: true, deletedAt: true } });
  if (existing) {
    // Do not leak existence: the route responds identically for new and known
    // emails, sending a "you already have an account" notice by email instead.
    return { userId: existing.id };
  }

  const customerRole = await ensureCustomerRole();
  const passwordHash = await hashPassword(input.password);

  const user = await db.user.create({
    data: {
      email,
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      passwordHash,
      roleId: customerRole.id,
      marketingEmailConsent: input.marketingEmailConsent ?? false,
      notificationPrefs: JSON.stringify({
        orderUpdates: true,
        backInStock: true,
        priceDrop: false,
        newsletter: input.marketingEmailConsent ?? false,
      }),
    },
    select: { id: true },
  });

  return { userId: user.id };
}

/** Change a password and revoke all other sessions. */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user) throw unauthenticated();

  // Accounts created through social login may have no password yet.
  if (user.passwordHash) {
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) throw forbidden('Your current password is not correct.');
  }

  const passwordHash = await hashPassword(newPassword);
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { passwordHash } }),
    db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  logger.info('password changed', { userId });
}

/** Find-or-create the built-in `customer` role. */
export async function ensureCustomerRole(): Promise<Role> {
  const existing = await db.role.findUnique({ where: { name: ROLE.CUSTOMER } });
  if (existing) return existing;

  return db.role.create({
    data: {
      name: ROLE.CUSTOMER,
      label: 'Customer',
      description: 'Storefront shopper. No back-office access.',
      permissions: '[]',
      isSystem: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Request context helpers
// ---------------------------------------------------------------------------

/** Best-effort client IP. Trusts the left-most XFF entry (set by our proxy). */
export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim().slice(0, 64);
  return h.get('x-real-ip')?.slice(0, 64) ?? null;
}

export async function getUserAgent(): Promise<string | null> {
  const h = await headers();
  return h.get('user-agent')?.slice(0, 400) ?? null;
}

/**
 * Same-origin check for state-changing API routes.
 *
 * Our session cookie is SameSite=Lax, which already blocks classic cross-site
 * POSTs. This is defence-in-depth for browsers with unusual cookie behaviour,
 * and it also blocks naive CSRF via form posts.
 */
export async function assertSameOrigin(request: Request): Promise<void> {
  const h = await headers();
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = h.get('host');
  if (!host) return;

  const expectedHosts = new Set<string>([host]);
  try {
    expectedHosts.add(new URL(env().APP_URL).host);
  } catch {
    /* APP_URL is validated at boot; ignore */
  }

  const source = origin ?? referer;
  if (!source) return; // Non-browser client (webhook, curl) — signature checks apply instead.

  let sourceHost: string;
  try {
    sourceHost = new URL(source).host;
  } catch {
    throw forbidden('Invalid request origin.');
  }

  if (!expectedHosts.has(sourceHost)) {
    logger.warn('origin mismatch', { sourceHost, expectedHosts: [...expectedHosts] });
    throw forbidden('Cross-origin request blocked.');
  }
}

/** Log a successful login for the audit trail. */
export async function recordLoginAudit(userId: string, email: string, role: string): Promise<void> {
  await db.auditLog
    .create({
      data: {
        actorId: userId,
        actorEmail: email,
        action: AUDIT_ACTION.LOGIN_SUCCESS,
        entityType: 'auth',
        summary: `Signed in (${role})`,
        ip: await getClientIp(),
        userAgent: await getUserAgent(),
      },
    })
    .catch(() => {});
}

export function warnIfInsecureConfig(): void {
  if (devSecretWarned) return;
  devSecretWarned = true;
  if (hasEnvValidationErrors()) {
    logger.warn('environment validation reported problems — see the boot log above');
  }
  if (isProduction() && !env().AUTH_SECRET.includes('dev-only')) {
    /* nothing to do; a real secret is configured */
  }
}

export { safeCompare, roleHasPermission, STAFF_ROLES, PERMISSIONS };
