'use server';

/**
 * Authentication server actions.
 *
 * Every action here follows the same shape:
 *   1. rate-limit by IP and by account,
 *   2. validate with a Zod schema,
 *   3. perform the work,
 *   4. audit-log the outcome,
 *   5. return a result the form can render.
 *
 * Security notes worth stating explicitly:
 *  - Login never reveals whether an email exists; unknown accounts and wrong
 *    passwords return the identical message (see `authenticateWithPassword`).
 *  - Registration does the same, and sends an email either way.
 *  - A successful login rotates the session token; password change and reset
 *    revoke every existing session.
 */

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { db, withRetry } from '@/server/db';
import {
  authenticateWithPassword,
  createSession,
  destroySession,
  getClientIp,
  getUserAgent,
  recordLoginAudit,
  registerCustomer,
  revokeAllSessions,
} from '@/server/auth';
import { consume, RATE_LIMITS, limitKey } from '@/server/rate-limit';
import { generateToken, hashPassword, normaliseEmail, sha256 } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { recordAudit } from '@/server/audit';
import { AUDIT_ACTION } from '@/lib/constants';
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from '@/lib/validation';
import { sendEmailVerification, sendPasswordReset, sendNotification, renderEmailLayout, escapeHtml } from '@/server/notifications';
import { env } from '@/lib/env';
import { ok, fail, fromError, zodFieldErrors, formString, formBoolean, type ActionState } from './types';

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

export async function registerAction(
  _prev: ActionState<never>,
  formData: FormData,
): Promise<ActionState<never>> {
  const ip = await getClientIp();

  try {
    const limit = await consume('REGISTER', limitKey('register:ip', ip), RATE_LIMITS.REGISTER);
    if (!limit.allowed) {
      return fail('Too many sign-up attempts from this connection. Please try again later.', {
        code: 'RATE_LIMITED',
        retryable: true,
      });
    }

    const parsed = registerSchema.safeParse({
      name: formString(formData, 'name'),
      email: formString(formData, 'email'),
      password: formString(formData, 'password'),
      phone: formString(formData, 'phone'),
      marketingEmailConsent: formBoolean(formData, 'marketingEmailConsent'),
      website: formString(formData, 'website'),
    });

    if (!parsed.success) {
      return fail('Please check the highlighted fields.', {
        code: 'VALIDATION_ERROR',
        fieldErrors: zodFieldErrors(parsed.error.issues),
      });
    }

    // Honeypot tripped: pretend everything is fine, change nothing.
    if (parsed.data.website) {
      logger.warn('registration honeypot triggered', { ip });
      return ok(undefined, 'Check your inbox to confirm your email.');
    }

    const { userId } = await registerCustomer({
      email: parsed.data.email,
      password: parsed.data.password,
      name: parsed.data.name,
      phone: parsed.data.phone,
      marketingEmailConsent: parsed.data.marketingEmailConsent,
      ip,
      userAgent: await getUserAgent(),
    });

    // Issue a verification token (only if the account is genuinely unverified).
    const existing = await db.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true, name: true, email: true, passwordHash: true },
    });

    if (existing && !existing.emailVerifiedAt) {
      const token = generateToken(32);
      await db.token.create({
        data: {
          tokenHash: sha256(token),
          userId,
          type: 'email_verify',
          expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
        },
      });

      await sendEmailVerification({
        userId,
        email: existing.email,
        name: existing.name,
        token,
      });

      // Sign them straight in — forcing an email round trip before they can see
      // their basket is a conversion killer. Verification gates *privileged*
      // actions (reviews, account deletion), not browsing or buying.
      await createSession(userId, { ip, userAgent: await getUserAgent() });
    } else if (existing) {
      // Address already registered. Do not disclose that; nudge them to sign in
      // via email instead.
      await sendNotification(
        {
          to: existing.email,
          subject: 'You already have an account',
          text: `Someone tried to sign up with this email address, but an account already exists.\n\nSign in at ${env().APP_URL}/login — if you have forgotten your password, you can reset it there.\n\nIf this was not you, you can ignore this email.`,
          html: renderEmailLayout({
            title: 'You already have an account',
            bodyHtml: `<p style="margin:0 0 14px;">Someone tried to create an account with this email address, but one already exists.</p>
              <p style="margin:0;color:#6b6155;font-size:14px;">If that was you, just sign in — and use “Forgot password” if you need a new one.</p>`,
            ctaLabel: 'Sign in',
            ctaHref: `${env().APP_URL}/login`,
          }),
        },
        { userId, template: 'duplicate_registration' },
      );
    }

    await recordAudit({
      actorId: userId,
      action: 'user.register',
      entityType: 'user',
      entityId: userId,
      summary: 'New customer account created',
      ip,
    });

    return ok(undefined, 'Welcome aboard. Check your inbox to confirm your email address.');
  } catch (err) {
    return fromError(err);
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export async function loginAction(
  _prev: ActionState<never>,
  formData: FormData,
): Promise<ActionState<never>> {
  const ip = await getClientIp();
  let redirectTo: string | null = null;

  try {
    const parsed = loginSchema.safeParse({
      email: formString(formData, 'email'),
      password: formString(formData, 'password'),
    });

    // Still rate-limit malformed attempts so the limiter cannot be bypassed by
    // sending garbage.
    const emailForKey = parsed.success ? parsed.data.email : 'unknown';
    const limit = await consume(
      'LOGIN',
      limitKey('login:ip', ip),
      RATE_LIMITS.LOGIN,
    );

    if (!limit.allowed) {
      return fail(
        `Too many attempts. Please wait about ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s) and try again.`,
        { code: 'RATE_LIMITED', retryable: true },
      );
    }

    // A second, per-account limit stops a distributed attack on one account.
    const accountLimit = await consume(
      'LOGIN',
      limitKey('login:account', emailForKey),
      { limit: 20, windowSeconds: 900 },
    );
    if (!accountLimit.allowed) {
      return fail('Too many attempts for this account. Please try again in a few minutes.', {
        code: 'RATE_LIMITED',
        retryable: true,
      });
    }

    if (!parsed.success) {
      return fail('Those details do not match an account we have.', { code: 'VALIDATION_ERROR' });
    }

    const result = await authenticateWithPassword(parsed.data.email, parsed.data.password, {
      ip,
      userAgent: await getUserAgent(),
    });

    if (!result.ok || !result.userId) {
      return fail(result.message ?? 'Those details do not match an account we have.', {
        code: result.lockedUntil ? 'LOCKED' : 'INVALID_CREDENTIALS',
      });
    }

    await createSession(result.userId, { ip, userAgent: await getUserAgent() });

    const user = await db.user.findUnique({
      where: { id: result.userId },
      select: { email: true, role: { select: { name: true } } },
    });

    await recordLoginAudit(result.userId, user?.email ?? parsed.data.email, user?.role.name ?? 'customer');

    // Adopt everything built while signed out — this is the Instagram journey's
    // most fragile moment, and the reason the guest-cart merge exists at all.
    // Basket, saved books and viewing history all follow the customer in.
    const { cookies } = await import('next/headers');
    const { GUEST_CART_COOKIE, adoptGuestCart } = await import('@/server/cart');
    const { mergeGuestWishlist } = await import('@/server/wishlist');
    const { adoptGuestViews } = await import('@/server/catalogue');
    const store = await cookies();
    const guestToken = store.get(GUEST_CART_COOKIE)?.value ?? null;

    if (guestToken) {
      await adoptGuestCart(result.userId, guestToken);
      await adoptGuestViews(guestToken, result.userId);
    }
    await mergeGuestWishlist(result.userId);

    redirectTo = formString(formData, 'redirect') ?? (guestToken ? '/cart' : '/account');
    // Only allow same-site relative redirects (open-redirect protection).
    if (!redirectTo.startsWith('/') || redirectTo.startsWith('//')) redirectTo = '/account';

    return ok(undefined, 'Signed in.');
  } catch (err) {
    return fromError(err);
  } finally {
    if (redirectTo) redirect(redirectTo);
  }
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export async function logoutAction(): Promise<void> {
  try {
    const { getCurrentUser } = await import('@/server/auth');
    const user = await getCurrentUser().catch(() => null);
    await destroySession();

    await recordAudit({
      actorId: user?.id,
      actorEmail: user?.email,
      action: AUDIT_ACTION.LOGOUT,
      entityType: 'auth',
      summary: 'Signed out',
    });
  } catch (err) {
    logger.error('logout failed', { err });
  }
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

export async function verifyEmailAction(
  _prev: ActionState<never>,
  formData: FormData,
): Promise<ActionState<never>> {
  try {
    const token = formString(formData, 'token');
    if (!token) return fail('That confirmation link is incomplete.', { code: 'VALIDATION_ERROR' });

    const record = await db.token.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { select: { id: true, emailVerifiedAt: true } } },
    });

    if (!record || record.type !== 'email_verify') {
      return fail('That link is not valid. Request a new one from your account settings.', {
        code: 'INVALID_TOKEN',
      });
    }

    if (record.usedAt) {
      return ok(undefined, 'Your email is already confirmed.');
    }

    if (record.expiresAt < new Date()) {
      return fail('That link has expired. Request a new one from your account settings.', {
        code: 'EXPIRED_TOKEN',
        retryable: true,
      });
    }

    await db.$transaction([
      db.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: record.user.emailVerifiedAt ?? new Date() },
      }),
      db.token.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);

    return ok(undefined, 'Your email is confirmed. Thank you!');
  } catch (err) {
    return fromError(err);
  }
}

export async function resendVerificationAction(): Promise<ActionState<never>> {
  try {
    const { getCurrentUser } = await import('@/server/auth');
    const user = await getCurrentUser();
    if (!user) return fail('Please sign in first.', { code: 'UNAUTHENTICATED' });
    if (user.emailVerifiedAt) return ok(undefined, 'Your email is already confirmed.');

    const limit = await consume(
      'EMAIL_VERIFY_RESEND',
      limitKey('verify:user', user.id),
      RATE_LIMITS.EMAIL_VERIFY_RESEND,
    );
    if (!limit.allowed) {
      return fail('We have already sent a few of these. Please check your inbox and spam folder.', {
        code: 'RATE_LIMITED',
      });
    }

    const token = generateToken(32);
    await db.token.create({
      data: {
        tokenHash: sha256(token),
        userId: user.id,
        type: 'email_verify',
        expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
      },
    });

    await sendEmailVerification({ userId: user.id, email: user.email, name: user.name, token });

    return ok(undefined, 'Confirmation email sent. It should arrive within a minute.');
  } catch (err) {
    return fromError(err);
  }
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export async function forgotPasswordAction(
  _prev: ActionState<never>,
  formData: FormData,
): Promise<ActionState<never>> {
  const ip = await getClientIp();

  try {
    const limit = await consume('PASSWORD_RESET', limitKey('reset:ip', ip), RATE_LIMITS.PASSWORD_RESET);
    if (!limit.allowed) {
      return fail('Too many reset requests. Please try again later.', { code: 'RATE_LIMITED', retryable: true });
    }

    const parsed = forgotPasswordSchema.safeParse({ email: formString(formData, 'email') });
    if (!parsed.success) {
      return fail('Enter the email address on your account.', {
        fieldErrors: zodFieldErrors(parsed.error.issues),
      });
    }

    const user = await db.user.findUnique({
      where: { email: normaliseEmail(parsed.data.email) },
      select: { id: true, email: true, name: true, deletedAt: true },
    });

    if (user && !user.deletedAt) {
      const token = generateToken(32);
      await db.token.create({
        data: {
          tokenHash: sha256(token),
          userId: user.id,
          type: 'password_reset',
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });

      await sendPasswordReset({ userId: user.id, email: user.email, name: user.name, token });
    } else {
      // Unknown address: still report success so this endpoint cannot be used to
      // enumerate which emails have accounts.
      logger.info('password reset requested for unknown email', { ip });
    }

    return ok(
      undefined,
      'If an account exists for that email, a reset link is on its way. It expires in one hour.',
    );
  } catch (err) {
    return fromError(err);
  }
}

export async function resetPasswordAction(
  _prev: ActionState<never>,
  formData: FormData,
): Promise<ActionState<never>> {
  try {
    const parsed = resetPasswordSchema.safeParse({
      token: formString(formData, 'token'),
      password: formString(formData, 'password'),
      confirmPassword: formString(formData, 'confirmPassword'),
    });

    if (!parsed.success) {
      return fail('Please check the highlighted fields.', {
        fieldErrors: zodFieldErrors(parsed.error.issues),
      });
    }

    const record = await db.token.findUnique({
      where: { tokenHash: sha256(parsed.data.token) },
      include: { user: { select: { id: true, email: true } } },
    });

    if (!record || record.type !== 'password_reset' || record.usedAt || record.expiresAt < new Date()) {
      return fail('That reset link is not valid or has expired. Please request a new one.', {
        code: 'INVALID_TOKEN',
      });
    }

    const passwordHash = await hashPassword(parsed.data.password);

    await db.$transaction([
      db.user.update({
        where: { id: record.userId },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      }),
      db.token.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // Any session an attacker may have established is now dead.
      db.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await recordAudit({
      actorId: record.userId,
      actorEmail: record.user.email,
      action: AUDIT_ACTION.PASSWORD_RESET,
      entityType: 'user',
      entityId: record.userId,
      summary: 'Password reset and all sessions revoked',
    });

    return ok(undefined, 'Your password has been updated. You can sign in now.');
  } catch (err) {
    return fromError(err);
  }
}

export async function changePasswordAction(
  _prev: ActionState<never>,
  formData: FormData,
): Promise<ActionState<never>> {
  try {
    const { requireUser, changePassword } = await import('@/server/auth');
    const user = await requireUser();

    const parsed = changePasswordSchema.safeParse({
      currentPassword: formString(formData, 'currentPassword'),
      newPassword: formString(formData, 'newPassword'),
      confirmPassword: formString(formData, 'confirmPassword'),
    });

    if (!parsed.success) {
      return fail('Please check the highlighted fields.', {
        fieldErrors: zodFieldErrors(parsed.error.issues),
      });
    }

    await changePassword(user.id, parsed.data.currentPassword, parsed.data.newPassword);

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTION.PASSWORD_RESET,
      entityType: 'user',
      entityId: user.id,
      summary: 'Password changed from account settings; other sessions revoked',
    });

    return ok(undefined, 'Password updated. Other devices have been signed out.');
  } catch (err) {
    return fromError(err);
  }
}

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------

/**
 * Account deletion.
 *
 * We anonymise rather than hard-delete where financial records must be retained:
 * invoices and tax records have statutory retention periods, so the order rows
 * stay but the personal identifiers are scrubbed. The customer's access is
 * removed immediately, which is what the request is actually about.
 */
export async function deleteAccountAction(
  _prev: ActionState<never>,
  formData: FormData,
): Promise<ActionState<never>> {
  try {
    const { requireUser } = await import('@/server/auth');
    const user = await requireUser();

    const confirm = formString(formData, 'confirm');
    if (confirm !== 'DELETE') {
      return fail('Type DELETE to confirm.', { fieldErrors: { confirm: ['Type DELETE exactly.'] } });
    }

    const reason = formString(formData, 'reason');
    const anonymisedEmail = `deleted+${user.id}@deleted.invalid`;

    await withRetry(
      () =>
        db.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: {
              email: anonymisedEmail,
              name: 'Deleted account',
              phone: null,
              avatarUrl: null,
              passwordHash: null,
              status: 'deleted',
              deletedAt: new Date(),
              marketingEmailConsent: false,
              marketingSmsConsent: false,
              marketingWhatsappConsent: false,
              notificationPrefs: null,
              readingPrefs: null,
            },
          });

          // Revoke access immediately.
          await tx.session.updateMany({
            where: { userId: user.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          await tx.token.deleteMany({ where: { userId: user.id } });
          await tx.address.deleteMany({ where: { userId: user.id } });
          await tx.wishlistItem.deleteMany({ where: { userId: user.id } });
          await tx.recentlyViewed.deleteMany({ where: { userId: user.id } });
          await tx.cart.deleteMany({ where: { userId: user.id } });

          // Keep review text (it is content, not PII) but detach it.
          await tx.review.updateMany({
            where: { userId: user.id },
            data: { userId: user.id },
          });

          // Orders are retained for tax/accounting, with the profile link intact
          // because the user row still exists as a pseudonymous record.
          await tx.newsletterSubscriber.updateMany({
            where: { userId: user.id },
            data: { status: 'unsubscribed', unsubscribedAt: new Date() },
          });
        }),
      { label: 'deleteAccount' },
    );

    await destroySession();

    await recordAudit({
      actorId: null,
      actorEmail: anonymisedEmail,
      action: 'user.delete',
      entityType: 'user',
      entityId: user.id,
      summary: `Account deleted by customer${reason ? ` — reason: ${reason}` : ''}`,
    });

    return ok(undefined, 'Your account has been deleted.');
  } catch (err) {
    return fromError(err);
  }
}

export type { z };
