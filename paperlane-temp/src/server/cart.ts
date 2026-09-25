/**
 * Cart service.
 *
 * A cart belongs either to a signed-in user or to a guest, identified by an
 * opaque HttpOnly cookie token. Both are real database rows, so a guest's basket
 * survives a browser restart and can be merged into their account the moment
 * they sign in — which is exactly the Instagram journey: browse, add, log in at
 * checkout, and never lose the basket.
 *
 * Stock is checked here for fast feedback, but the binding check happens inside
 * the checkout transaction. Between the two, time passes and other people buy
 * books; only the transactional check can be trusted.
 */

import 'server-only';
import { cookies } from 'next/headers';
import { db, withRetry } from './db';
import { calculateTotals, type OrderTotals } from './pricing';
import { getAvailabilityMap } from './inventory';
import { generateToken } from '@/lib/crypto';
import { badRequest, conflict, notFound } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { CART_STATUS, DEFAULT_MAX_PER_ORDER } from '@/lib/constants';

export const GUEST_CART_COOKIE = 'pl_cart';
const GUEST_CART_TTL_DAYS = 60;

export interface CartLine {
  id: string;
  bookId: string;
  quantity: number;
  addedUnitPricePaise: number;
  book: {
    id: string;
    title: string;
    slug: string;
    coverImageUrl: string;
    coverAlt: string | null;
    pricePaise: number;
    salePricePaise: number | null;
    format: string;
    status: string;
    authorName: string;
  };
  available: number;
  status: string;
  /** True when the price moved since the line was added. */
  priceChanged: boolean;
  currentUnitPricePaise: number;
  maxQuantity: number;
}

export interface CartView {
  cartId: string;
  isGuest: boolean;
  lines: CartLine[];
  totals: OrderTotals;
  /** Titles to cross-sell under the basket. */
  recommendations: Array<{ id: string; title: string; slug: string; coverImageUrl: string; authorName: string; pricePaise: number; salePricePaise: number | null }>;
}

/**
 * Read the current cart without creating one.
 * Safe to call from server components (no cookie writes).
 */
export async function getCart(): Promise<{ cartId: string; isGuest: boolean } | null> {
  const store = await cookies();
  const guestToken = store.get(GUEST_CART_COOKIE)?.value;

  const { getCurrentUser } = await import('./auth');
  const user = await getCurrentUser().catch(() => null);

  if (user) {
    const cart = await db.cart.findFirst({
      where: { userId: user.id, status: CART_STATUS.ACTIVE },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (cart) return { cartId: cart.id, isGuest: false };
  }

  if (guestToken) {
    const cart = await db.cart.findUnique({
      where: { guestToken },
      select: { id: true, status: true },
    });
    if (cart && cart.status === CART_STATUS.ACTIVE) return { cartId: cart.id, isGuest: !user };
  }

  return null;
}

/**
 * Get or create the active cart. Writes a cookie, so it may only be called from
 * a Server Action or a Route Handler.
 */
export async function getOrCreateCart(): Promise<{ cartId: string; isGuest: boolean }> {
  const store = await cookies();
  const { getCurrentUser } = await import('./auth');
  const user = await getCurrentUser().catch(() => null);

  if (user) {
    const existing = await db.cart.findFirst({
      where: { userId: user.id, status: CART_STATUS.ACTIVE },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (existing) {
      // Promote any guest basket this visitor already built.
      const guestToken = store.get(GUEST_CART_COOKIE)?.value;
      if (guestToken) {
        await mergeGuestCartIntoUser(guestToken, user.id).catch((err) =>
          logger.warn('guest cart merge failed', { err }),
        );
      }
      return { cartId: existing.id, isGuest: false };
    }

    const guestToken = store.get(GUEST_CART_COOKIE)?.value;
    if (guestToken) {
      const merged = await mergeGuestCartIntoUser(guestToken, user.id).catch(() => null);
      if (merged) return { cartId: merged.cartId, isGuest: false };
    }

    const created = await db.cart.create({
      data: { userId: user.id, status: CART_STATUS.ACTIVE },
      select: { id: true },
    });
    return { cartId: created.id, isGuest: false };
  }

  const existingToken = store.get(GUEST_CART_COOKIE)?.value;
  if (existingToken) {
    const existing = await db.cart.findUnique({
      where: { guestToken: existingToken },
      select: { id: true, status: true },
    });
    if (existing && existing.status === CART_STATUS.ACTIVE) {
      return { cartId: existing.id, isGuest: true };
    }
  }

  const token = generateToken(24);
  const cart = await db.cart.create({
    data: {
      guestToken: token,
      status: CART_STATUS.ACTIVE,
      expiresAt: new Date(Date.now() + GUEST_CART_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });

  store.set(GUEST_CART_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: GUEST_CART_TTL_DAYS * 24 * 60 * 60,
  });

  return { cartId: cart.id, isGuest: true };
}

/**
 * Move every line from a guest cart into the user's cart, summing quantities
 * when the same book appears in both, then retire the guest cart.
 */
export async function mergeGuestCartIntoUser(
  guestToken: string,
  userId: string,
): Promise<{ cartId: string; mergedLines: number } | null> {
  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        const guestCart = await tx.cart.findUnique({
          where: { guestToken },
          include: { items: true },
        });

        if (!guestCart || guestCart.status !== CART_STATUS.ACTIVE) return null;
        if (guestCart.userId && guestCart.userId !== userId) return null;

        let userCart = await tx.cart.findFirst({
          where: { userId, status: CART_STATUS.ACTIVE },
        });

        if (guestCart.userId === userId && userCart?.id === guestCart.id) {
          return { cartId: guestCart.id, mergedLines: 0 };
        }

        if (!userCart) {
          // No user cart yet: simply re-parent the guest cart.
          await tx.cart.update({
            where: { id: guestCart.id },
            data: { userId, guestToken: null, couponCode: guestCart.couponCode },
          });
          return { cartId: guestCart.id, mergedLines: guestCart.items.length };
        }

        let mergedLines = 0;
        for (const item of guestCart.items) {
          const existing = await tx.cartItem.findUnique({
            where: { cartId_bookId: { cartId: userCart.id, bookId: item.bookId } },
            select: { id: true, quantity: true },
          });

          if (existing) {
            const combined = Math.min(DEFAULT_MAX_PER_ORDER, existing.quantity + item.quantity);
            await tx.cartItem.update({ where: { id: existing.id }, data: { quantity: combined } });
          } else {
            await tx.cartItem.create({
              data: {
                cartId: userCart.id,
                bookId: item.bookId,
                quantity: Math.min(DEFAULT_MAX_PER_ORDER, item.quantity),
                addedUnitPricePaise: item.addedUnitPricePaise,
              },
            });
          }
          mergedLines += 1;
        }

        if (!userCart.couponCode && guestCart.couponCode) {
          await tx.cart.update({
            where: { id: userCart.id },
            data: { couponCode: guestCart.couponCode },
          });
        }

        await tx.cart.update({
          where: { id: guestCart.id },
          data: { status: CART_STATUS.MERGED, guestToken: null, userId },
        });

        return { cartId: userCart.id, mergedLines };
      }),
    { label: 'mergeGuestCart' },
  );
}

export interface AddToCartInput {
  bookId: string;
  quantity?: number;
  /** Price the client displayed, used only to detect drift for a friendly notice. */
  expectedUnitPricePaise?: number;
}

export async function addToCart(input: AddToCartInput): Promise<{ cartId: string; quantity: number }> {
  const quantity = Math.max(1, Math.floor(input.quantity ?? 1));
  if (quantity > DEFAULT_MAX_PER_ORDER) {
    throw badRequest(`You can order up to ${DEFAULT_MAX_PER_ORDER} copies of one title.`);
  }

  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        const { cartId } = await getOrCreateCartTx(tx);

        const book = await tx.book.findFirst({
          where: { id: input.bookId, deletedAt: null },
          select: { id: true, status: true, pricePaise: true, salePricePaise: true, title: true },
        });
        if (!book) throw notFound('That book is no longer available.');
        if (book.status !== 'active') {
          throw conflict(`“${book.title}” is not currently available to order.`);
        }

        const existing = await tx.cartItem.findUnique({
          where: { cartId_bookId: { cartId, bookId: book.id } },
          select: { id: true, quantity: true },
        });

        const desired = Math.min(DEFAULT_MAX_PER_ORDER, (existing?.quantity ?? 0) + quantity);

        const availability = await getAvailabilityMap([book.id], tx);
        const available = availability.get(book.id)?.available ?? 0;

        if (available <= 0) {
          throw conflict(`“${book.title}” is out of stock right now. Add it to your wishlist and we will tell you when it is back.`);
        }
        if (desired > available) {
          throw conflict(
            available === 1
              ? `Only 1 copy of “${book.title}” is left.`
              : `Only ${available} copies of “${book.title}” are left.`,
          );
        }

        const unitPrice =
          book.salePricePaise !== null && book.salePricePaise > 0 && book.salePricePaise < book.pricePaise
            ? book.salePricePaise
            : book.pricePaise;

        if (existing) {
          await tx.cartItem.update({
            where: { id: existing.id },
            data: { quantity: desired },
          });
        } else {
          await tx.cartItem.create({
            data: {
              cartId,
              bookId: book.id,
              quantity: desired,
              addedUnitPricePaise: unitPrice,
            },
          });
        }

        await tx.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });

        return { cartId, quantity: desired };
      }),
    { label: 'addToCart' },
  );
}

/** Internal: cart creation inside a transaction (cannot touch cookies). */
async function getOrCreateCartTx(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]): Promise<{ cartId: string }> {
  const { getCurrentUser } = await import('./auth');
  const user = await getCurrentUser().catch(() => null);

  if (user) {
    const existing = await tx.cart.findFirst({
      where: { userId: user.id, status: CART_STATUS.ACTIVE },
      select: { id: true },
    });
    if (existing) return { cartId: existing.id };
    const created = await tx.cart.create({ data: { userId: user.id }, select: { id: true } });
    return { cartId: created.id };
  }

  const created = await tx.cart.create({
    data: {
      status: CART_STATUS.ACTIVE,
      expiresAt: new Date(Date.now() + GUEST_CART_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });
  // The cookie for this anonymous cart is written by getOrCreateCart() when the
  // action returns; the row is still usable within this transaction regardless.
  return { cartId: created.id };
}

export async function updateCartItem(
  cartItemId: string,
  quantity: number,
): Promise<{ quantity: number }> {
  const qty = Math.floor(quantity);

  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        const item = await tx.cartItem.findUnique({
          where: { id: cartItemId },
          include: { cart: { select: { id: true, userId: true, guestToken: true } }, book: { select: { title: true } } },
        });
        if (!item) throw notFound('That item is no longer in your basket.');

        await assertCartOwnership(item.cart.userId, item.cart.guestToken);

        if (qty <= 0) {
          await tx.cartItem.delete({ where: { id: cartItemId } });
          await tx.cart.update({ where: { id: item.cart.id }, data: { updatedAt: new Date() } });
          return { quantity: 0 };
        }

        if (qty > DEFAULT_MAX_PER_ORDER) {
          throw badRequest(`You can order up to ${DEFAULT_MAX_PER_ORDER} copies of one title.`);
        }

        const availability = await getAvailabilityMap([item.bookId], tx);
        const available = availability.get(item.bookId)?.available ?? 0;

        if (qty > available) {
          throw conflict(
            available <= 0
              ? `“${item.book.title}” is out of stock right now.`
              : `Only ${available} ${available === 1 ? 'copy' : 'copies'} of “${item.book.title}” left.`,
          );
        }

        await tx.cartItem.update({ where: { id: cartItemId }, data: { quantity: qty } });
        await tx.cart.update({ where: { id: item.cart.id }, data: { updatedAt: new Date() } });
        return { quantity: qty };
      }),
    { label: 'updateCartItem' },
  );
}

export async function removeCartItem(cartItemId: string): Promise<void> {
  const item = await db.cartItem.findUnique({
    where: { id: cartItemId },
    include: { cart: { select: { id: true, userId: true, guestToken: true } } },
  });
  if (!item) return;

  await assertCartOwnership(item.cart.userId, item.cart.guestToken);
  await db.$transaction([
    db.cartItem.delete({ where: { id: cartItemId } }),
    db.cart.update({ where: { id: item.cart.id }, data: { updatedAt: new Date() } }),
  ]);
}

export async function clearCart(cartId: string): Promise<void> {
  await db.$transaction([
    db.cartItem.deleteMany({ where: { cartId } }),
    db.cart.update({ where: { id: cartId }, data: { couponCode: null } }),
  ]);
}

export async function setCartCoupon(cartId: string, couponCode: string | null): Promise<void> {
  await db.cart.update({
    where: { id: cartId },
    data: { couponCode: couponCode ? couponCode.trim().toUpperCase() : null },
  });
}

/**
 * Authorisation for cart mutations.
 *
 * A guest may only touch the cart their own cookie points at; a signed-in user
 * may only touch their own. Without this, any cart item id would be mutable by
 * anyone who guessed it.
 */
async function assertCartOwnership(cartUserId: string | null, cartGuestToken: string | null): Promise<void> {
  const { getCurrentUser } = await import('./auth');
  const user = await getCurrentUser().catch(() => null);

  if (cartUserId) {
    if (!user || user.id !== cartUserId) {
      throw notFound('That item is no longer in your basket.');
    }
    return;
  }

  if (cartGuestToken) {
    const store = await cookies();
    const token = store.get(GUEST_CART_COOKIE)?.value;
    if (!token || token !== cartGuestToken) {
      throw notFound('That item is no longer in your basket.');
    }
    return;
  }

  throw notFound('That item is no longer in your basket.');
}

/** Full cart view with live pricing, for the cart page and drawer. */
export async function getCartView(options: { destination?: { country: string; state: string; postalCode: string } } = {}): Promise<CartView | null> {
  const ref = await getCart();
  if (!ref) return null;

  const cart = await db.cart.findUnique({
    where: { id: ref.cartId },
    include: {
      items: {
        orderBy: { createdAt: 'asc' },
        include: {
          book: {
            select: {
              id: true,
              title: true,
              slug: true,
              coverImageUrl: true,
              coverAlt: true,
              pricePaise: true,
              salePricePaise: true,
              format: true,
              status: true,
              author: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (!cart || cart.items.length === 0) return null;

  const availability = await getAvailabilityMap(cart.items.map((i) => i.bookId));

  const destination = options.destination ?? { country: 'IN', state: '', postalCode: '' };

  const totals = await calculateTotals({
    lines: cart.items.map((i) => ({
      bookId: i.bookId,
      quantity: i.quantity,
      expectedUnitPricePaise: i.addedUnitPricePaise,
    })),
    destination,
    couponCode: cart.couponCode,
    userId: cart.userId,
    email: null,
  });

  const totalsByBook = new Map(totals.lines.map((l) => [l.bookId, l]));

  const lines: CartLine[] = cart.items.map((item) => {
    const avail = availability.get(item.bookId);
    const priced = totalsByBook.get(item.bookId);
    const currentUnit =
      item.book.salePricePaise !== null &&
      item.book.salePricePaise > 0 &&
      item.book.salePricePaise < item.book.pricePaise
        ? item.book.salePricePaise
        : item.book.pricePaise;

    return {
      id: item.id,
      bookId: item.bookId,
      quantity: item.quantity,
      addedUnitPricePaise: item.addedUnitPricePaise,
      book: {
        id: item.book.id,
        title: item.book.title,
        slug: item.book.slug,
        coverImageUrl: item.book.coverImageUrl,
        coverAlt: item.book.coverAlt,
        pricePaise: item.book.pricePaise,
        salePricePaise: item.book.salePricePaise,
        format: item.book.format,
        status: item.book.status,
        authorName: item.book.author.name,
      },
      available: avail?.available ?? 0,
      status: avail?.status ?? 'out_of_stock',
      priceChanged: item.addedUnitPricePaise !== currentUnit,
      currentUnitPricePaise: currentUnit,
      maxQuantity: Math.min(DEFAULT_MAX_PER_ORDER, Math.max(1, avail?.available ?? 1)),
    };
  });

  return {
    cartId: cart.id,
    isGuest: !cart.userId,
    lines,
    totals,
    recommendations: await getCartCrossSell(cart.items.map((i) => i.bookId)),
  };
}

/** Lightweight counts for the header badge — avoids a full pricing pass. */
export async function getCartCount(): Promise<number> {
  const ref = await getCart();
  if (!ref) return 0;
  const result = await db.cartItem.aggregate({
    where: { cartId: ref.cartId },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}

/**
 * Cross-sell for the basket: what other people bought alongside these titles.
 * Starts as a simple genre/sales heuristic and is deliberately easy to swap for
 * a real recommender later.
 */
async function getCartCrossSell(
  bookIds: string[],
): Promise<CartView['recommendations']> {
  if (bookIds.length === 0) return [];

  const books = await db.book.findMany({
    where: { id: { in: bookIds } },
    select: { genreId: true },
  });
  const genreIds = [...new Set(books.map((b) => b.genreId).filter((g): g is string => !!g))];

  const results = await db.book.findMany({
    where: {
      status: 'active',
      deletedAt: null,
      id: { notIn: bookIds },
      ...(genreIds.length ? { genreId: { in: genreIds } } : {}),
    },
    orderBy: [{ salesCount: 'desc' }, { ratingAvg: 'desc' }],
    take: 6,
    select: {
      id: true,
      title: true,
      slug: true,
      coverImageUrl: true,
      pricePaise: true,
      salePricePaise: true,
      author: { select: { name: true } },
    },
  });

  return results.map((b) => ({
    id: b.id,
    title: b.title,
    slug: b.slug,
    coverImageUrl: b.coverImageUrl,
    authorName: b.author.name,
    pricePaise: b.pricePaise,
    salePricePaise: b.salePricePaise,
  }));
}

/** Mark carts stale after a period of inactivity, for abandoned-cart reporting. */
export async function markAbandonedCarts(olderThanHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const result = await db.cart.updateMany({
    where: {
      status: CART_STATUS.ACTIVE,
      updatedAt: { lt: cutoff },
      items: { some: {} },
    },
    data: { status: CART_STATUS.ABANDONED },
  });
  return result.count;
}

/** Merge any additional guest cart tokens into a user (called after sign-in). */
export async function adoptGuestCart(userId: string, guestToken: string | null): Promise<void> {
  if (!guestToken) return;
  await mergeGuestCartIntoUser(guestToken, userId).catch((err) =>
    logger.error('failed to adopt guest cart', { userId, err }),
  );
}

export { GUEST_CART_COOKIE as CART_COOKIE };
