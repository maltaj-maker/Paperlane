'use server';

/**
 * Wishlist action.
 *
 * Only the mutation lives here. Everything else — reading, merging, guest
 * cookies — lives in `src/server/wishlist.ts`, because a `'use server'` module
 * turns every exported async function into a callable HTTP endpoint, and
 * `mergeGuestWishlist(userId)` would have accepted a caller-supplied user id.
 * Authorisation must never depend on a value the client chose.
 *
 * The action itself takes the book id from the form (it is not a secret) and the
 * user id from the session (it is).
 */

import { revalidatePath } from 'next/cache';

import { db } from '@/server/db';
import { getCurrentUser } from '@/server/auth';
import { wishlistSchema } from '@/lib/validation';
import { trackEvent } from '@/server/analytics';
import { ANALYTICS_EVENT } from '@/lib/constants';
import { getAnalyticsContext } from '@/server/request-context';
import { readGuestWishlist, writeGuestWishlist } from '@/server/wishlist';
import { ok, fail, fromError, zodFieldErrors, formString, type ActionState } from './types';

export interface WishlistToggleResult {
  saved: boolean;
  count: number;
}

export async function toggleWishlistAction(
  _prev: ActionState<WishlistToggleResult>,
  formData: FormData,
): Promise<ActionState<WishlistToggleResult>> {
  try {
    const parsed = wishlistSchema.safeParse({ bookId: formString(formData, 'bookId') });
    if (!parsed.success) {
      return fail('We could not save that book.', { fieldErrors: zodFieldErrors(parsed.error.issues) });
    }

    const bookId = parsed.data.bookId;
    const user = await getCurrentUser();

    // --- Signed in: a real row, keyed to the session's user ---
    if (user) {
      // Confirm the book exists first, so the wishlist can never hold dangling ids.
      const book = await db.book.findFirst({
        where: { id: bookId, deletedAt: null },
        select: { id: true },
      });
      if (!book) return fail('We could not find that title.', { code: 'NOT_FOUND' });

      const existing = await db.wishlistItem.findUnique({
        where: { userId_bookId: { userId: user.id, bookId } },
        select: { id: true },
      });

      if (existing) {
        await db.wishlistItem.delete({ where: { id: existing.id } });
      } else {
        await db.wishlistItem.create({ data: { userId: user.id, bookId } });

        const context = await getAnalyticsContext();
        await trackEvent({
          name: ANALYTICS_EVENT.WISHLIST_ADD,
          sessionId: context.sessionId,
          userId: user.id,
          props: { bookId },
        });
      }

      const count = await db.wishlistItem.count({ where: { userId: user.id } });

      revalidatePath('/account/wishlist');
      revalidatePath('/books');

      return ok(
        { saved: !existing, count },
        existing ? 'Removed from your wishlist.' : 'Saved to your wishlist.',
      );
    }

    // --- Guest: cookie-backed, merged into the account on sign-in ---
    const current = await readGuestWishlist();
    const isSaved = current.includes(bookId);
    const next = isSaved ? current.filter((id) => id !== bookId) : [...current, bookId];

    await writeGuestWishlist(next);

    return ok(
      { saved: !isSaved, count: next.length },
      isSaved ? 'Removed from your wishlist.' : 'Saved. Sign in later and it will follow you.',
    );
  } catch (err) {
    return fromError(err);
  }
}
