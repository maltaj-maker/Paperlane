'use server';

/**
 * Account actions: profile, addresses, notification preferences, reading
 * preferences, avatar.
 *
 * Every one of these begins with the session — never with a user id from the
 * form. The `userId` handed to the server helpers is always the authenticated
 * one, so a crafted POST cannot edit somebody else's address book. That is the
 * whole security model of this file, and it is worth stating plainly because it
 * is the single easiest thing to get wrong in an account area.
 */

import { revalidatePath } from 'next/cache';

import { db } from '@/server/db';
import { getCurrentUser, revokeOtherSessions } from '@/server/auth';
import {
  saveAddress,
  deleteAddress,
  updateProfile,
  updateNotificationPrefs,
  updateReadingPrefs,
} from '@/server/customers';
import { addressSchema, updateProfileSchema } from '@/lib/validation';
import { recordAudit } from '@/server/audit';
import { AUDIT_ACTION } from '@/lib/constants';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { ok, fail, fromError, zodFieldErrors, formString, formBoolean, type ActionState } from './types';

/** Load the signed-in user or fail with a message the UI can show. */
async function requireSessionUser() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) throw new Error('Please sign in again — your session has expired.');
  return user;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function updateProfileAction(
  _prev: ActionState<never>,
  formData: FormData,
): Promise<ActionState<never>> {
  try {
    const user = await requireSessionUser();

    const parsed = updateProfileSchema.safeParse({
      name: formString(formData, 'name'),
      phone: formString(formData, 'phone'),
      avatarUrl: formString(formData, 'avatarUrl'),
    });

    if (!parsed.success) {
      return fail('Please check the highlighted fields.', {
        fieldErrors: zodFieldErrors(parsed.error.issues),
      });
    }

    await updateProfile(user.id, {
      name: parsed.data.name,
      phone: parsed.data.phone,
      avatarUrl: parsed.data.avatarUrl,
    });

    revalidatePath('/account');
    revalidatePath('/account/profile');

    return ok(undefined, 'Your details are saved.');
  } catch (err) {
    return fromError(err);
  }
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export async function saveAddressAction(
  _prev: ActionState<never>,
  formData: FormData,
): Promise<ActionState<never>> {
  try {
    const user = await requireSessionUser();
    const addressId = formString(formData, 'addressId') ?? null;

    const parsed = addressSchema.safeParse({
      label: formString(formData, 'label') ?? 'Home',
      fullName: formString(formData, 'fullName'),
      phone: formString(formData, 'phone'),
      line1: formString(formData, 'line1'),
      line2: formString(formData, 'line2'),
      city: formString(formData, 'city'),
      state: formString(formData, 'state'),
      postalCode: formString(formData, 'postalCode'),
      country: formString(formData, 'country') ?? 'IN',
      isDefaultShipping: formBoolean(formData, 'isDefaultShipping'),
      isDefaultBilling: formBoolean(formData, 'isDefaultBilling'),
    });

    if (!parsed.success) {
      return fail('Please check the highlighted fields.', {
        fieldErrors: zodFieldErrors(parsed.error.issues),
      });
    }

    const result = await saveAddress(user.id, parsed.data, addressId);

    revalidatePath('/account/addresses');
    revalidatePath('/checkout');

    return ok(undefined, addressId ? 'Address updated.' : 'Address saved.');
  } catch (err) {
    return fromError(err);
  }
}

export async function deleteAddressAction(
  _prev: ActionState<never>,
  formData: FormData,
): Promise<ActionState<never>> {
  try {
    const user = await requireSessionUser();
    const addressId = formString(formData, 'addressId');
    if (!addressId) return fail('We could not find that address.');

    // Ownership is enforced inside `deleteAddress` as well — two layers, because
    // an address book is the kind of data where a mistake is a privacy incident.
    await deleteAddress(user.id, addressId);

    revalidatePath('/account/addresses');

    return ok(undefined, 'Address removed.');
  } catch (err) {
    return fromError(err);
  }
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export async function updateNotificationPrefsAction(
  _prev: ActionState<never>,
  formData: FormData,
): Promise<ActionState<never>> {
  try {
    const user = await requireSessionUser();

    await updateNotificationPrefs(user.id, {
      orderUpdates: formBoolean(formData, 'orderUpdates'),
      backInStock: formBoolean(formData, 'backInStock'),
      priceDrop: formBoolean(formData, 'priceDrop'),
      newsletter: formBoolean(formData, 'newsletter'),
      marketingSmsConsent: formBoolean(formData, 'marketingSmsConsent'),
      marketingWhatsappConsent: formBoolean(formData, 'marketingWhatsappConsent'),
    });

    revalidatePath('/account/notifications');

    return ok(
      undefined,
      'Preferences saved. Order and delivery updates are always sent — they are part of buying something.',
    );
  } catch (err) {
    return fromError(err);
  }
}

const readingPrefsSchema = z.object({
  favouriteGenres: z.array(z.string().max(60)).max(20).default([]),
  preferredFormats: z.array(z.string().max(30)).max(10).default([]),
  preferredLanguages: z.array(z.string().max(30)).max(10).default([]),
});

export async function updateReadingPrefsAction(
  _prev: ActionState<never>,
  formData: FormData,
): Promise<ActionState<never>> {
  try {
    const user = await requireSessionUser();

    const parsed = readingPrefsSchema.safeParse({
      favouriteGenres: formData.getAll('favouriteGenres').map(String),
      preferredFormats: formData.getAll('preferredFormats').map(String),
      preferredLanguages: formData.getAll('preferredLanguages').map(String),
    });

    if (!parsed.success) return fail('Please check the highlighted fields.');

    await updateReadingPrefs(user.id, parsed.data);

    revalidatePath('/account/reading');
    revalidatePath('/');

    return ok(undefined, 'Saved — we will use this to shape your recommendations.');
  } catch (err) {
    return fromError(err);
  }
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

/**
 * Sign out everywhere else.
 *
 * Offered next to the password change because "I think someone else is in my
 * account" is a real, reasonably common situation, and the fix should be one
 * button rather than a support ticket.
 */
export async function signOutOtherSessionsAction(
  _prev: ActionState<never>,
): Promise<ActionState<never>> {
  try {
    const user = await requireSessionUser();
    const revoked = await revokeOtherSessions(user.id);

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTION.LOGOUT,
      entityType: 'user',
      entityId: user.id,
      summary: `Signed out ${revoked} other session(s)`,
    }).catch((err) => logger.warn('audit write failed', { err: String(err) }));

    return ok(
      undefined,
      revoked > 0
        ? `Signed out of ${revoked} other ${revoked === 1 ? 'device' : 'devices'}.`
        : 'No other devices were signed in.',
    );
  } catch (err) {
    return fromError(err);
  }
}

/** Avatar URL from a hosted image. Kept as a URL field on purpose. */
export const avatarUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === '' || /^https:\/\//i.test(value), {
    message: 'Use a full https:// image address.',
  });

export async function updateAvatarAction(
  _prev: ActionState<never>,
  formData: FormData,
): Promise<ActionState<never>> {
  try {
    const user = await requireSessionUser();
    const parsed = avatarUrlSchema.safeParse(formString(formData, 'avatarUrl') ?? '');

    if (!parsed.success) {
      return fail('That does not look like a valid image address.', {
        fieldErrors: { avatarUrl: parsed.error.issues.map((issue) => issue.message) },
      });
    }

    await db.user.update({
      where: { id: user.id },
      data: { avatarUrl: parsed.data === '' ? null : parsed.data },
    });

    revalidatePath('/account/profile');
    revalidatePath('/account');

    return ok(undefined, parsed.data === '' ? 'Photo removed.' : 'Photo updated.');
  } catch (err) {
    return fromError(err);
  }
}
