import 'server-only';

import { db } from './db';
import { getCurrentUser } from './auth';
import { logger } from '@/lib/logger';

/**
 * Wishlist storage.
 *
 * Deliberately not a `'use server'` module: every exported async function in one
 * of those becomes a callable endpoint, and `mergeGuestWishlist(userId)` taking a
 * caller-supplied user id would be an authorisation hole — anyone could push
 * items into somebody else's wishlist. Keeping the logic here, and calling it
 * from actions that derive the user id from the session, closes that off.
 *
 * Guests get a cookie-backed list so someone arriving from Instagram can save a
 * book without an account; it merges into the account on sign-in.
 */

const GUEST_WISHLIST_COOKIE = 'pl_wishlist';
const MAX_GUEST_ITEMS = 200;

export async function readGuestWishlist(): Promise<string[]> {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  const raw = store.get(GUEST_WISHLIST_COOKIE)?.value;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_GUEST_ITEMS) : [];
  } catch {
    return [];
  }
}

export async function writeGuestWishlist(ids: string[]): Promise<void> {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  store.set(
    GUEST_WISHLIST_COOKIE,
    Buffer.from(JSON.stringify(ids.slice(0, MAX_GUEST_ITEMS))).toString('base64url'),
    {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 180,
    },
  );
}

/**
 * Read the wishlist for the current viewer (account if signed in, else cookie).
 * Returns ids only — the caller hydrates cards, so no duplicate queries.
 */
export async function getWishlistBookIds(): Promise<string[]> {
  try {
    const user = await getCurrentUser();
    if (user) {
      const rows = await db.wishlistItem.findMany({
        where: { userId: user.id },
        select: { bookId: true },
      });
      return rows.map((row) => row.bookId);
    }
    return readGuestWishlist();
  } catch (err) {
    logger.debug('wishlist read failed', { err: String(err) });
    return [];
  }
}

/** Full wishlist with book ids and timestamps, newest first. */
export async function getWishlistItems(userId: string) {
  return db.wishlistItem.findMany({
    where: { userId },
    select: { id: true, bookId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Merge a guest wishlist into an account.
 * Called from the sign-in flow only, with the user id taken from the session.
 */
export async function mergeGuestWishlist(userId: string): Promise<number> {
  const ids = await readGuestWishlist();
  if (ids.length === 0) return 0;

  // Only merge books that still exist — a stale cookie must not create rows
  // pointing at deleted titles.
  const valid = await db.book.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true },
  });

  let merged = 0;
  for (const book of valid) {
    try {
      await db.wishlistItem.upsert({
        where: { userId_bookId: { userId, bookId: book.id } },
        create: { userId, bookId: book.id },
        update: {},
      });
      merged += 1;
    } catch {
      /* duplicate — nothing to do */
    }
  }

  await writeGuestWishlist([]);
  return merged;
}

/** A shareable, read-only view of somebody's wishlist (used for public sharing). */
export async function getSharedWishlist(token: string) {
  const share = await db.wishlistShare.findUnique({
    where: { token },
    select: { id: true, userId: true, expiresAt: true, viewCount: true, isRevoked: true, title: true },
  });

  if (!share || share.isRevoked) return null;
  if (share.expiresAt && share.expiresAt < new Date()) return null;

  const items = await db.wishlistItem.findMany({
    where: { userId: share.userId },
    select: { bookId: true },
    orderBy: { createdAt: 'desc' },
  });

  return { share, bookIds: items.map((i) => i.bookId) };
}
