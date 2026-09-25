'use server';

/**
 * Cart server actions.
 *
 * Golden rule: the client sends *ids and quantities only*. Prices, discounts,
 * shipping and stock are always re-read and re-computed here. A tampered
 * request cannot buy a ₹999 book for ₹1, and a book that sold out two minutes
 * ago cannot be added by replaying an old request.
 *
 * Every mutation returns the freshly priced cart so the UI updates in one round
 * trip — on a phone, a second request just to update the total is a visible
 * stutter at the worst possible moment.
 */

import { revalidatePath } from 'next/cache';

import {
  addToCart,
  clearCart,
  getCartView,
  removeCartItem,
  setCartCoupon,
  updateCartItem,
} from '@/server/cart';
import { getCurrentUser } from '@/server/auth';
import { consume, RATE_LIMITS, limitKey } from '@/server/rate-limit';
import { validateCoupon } from '@/server/pricing';
import { trackEvent } from '@/server/analytics';
import { ANALYTICS_EVENT, DEFAULT_MAX_PER_ORDER } from '@/lib/constants';
import { formatPaise } from '@/lib/money';
import { addToCartSchema, updateCartItemSchema, applyCouponSchema, stockAlertSchema } from '@/lib/validation';
import { db } from '@/server/db';
import { getAvailability } from '@/server/inventory';
import { ok, fail, fromError, zodFieldErrors, formString, formNumber, type ActionState } from './types';
import { getAnalyticsContext, getClientIpForLimit } from '@/server/request-context';

export interface CartMutationResult {
  itemCount: number;
  subtotalPaise: number;
  /** Message suitable for a toast. */
  notice?: string;
  /** Set when the price moved since the customer last saw it. */
  priceChanged?: boolean;
}

// ---------------------------------------------------------------------------
// Add to basket
// ---------------------------------------------------------------------------

export async function addToCartAction(
  _prev: ActionState<CartMutationResult>,
  formData: FormData,
): Promise<ActionState<CartMutationResult>> {
  const ip = await getClientIpForLimit();

  try {
    const limit = await consume('CART_WRITE', limitKey('cart:ip', ip), RATE_LIMITS.CART_WRITE);
    if (!limit.allowed) {
      return fail('That is a lot of adding. Please wait a moment and try again.', {
        code: 'RATE_LIMITED',
        retryable: true,
      });
    }

    const parsed = addToCartSchema.safeParse({
      bookId: formString(formData, 'bookId'),
      quantity: formNumber(formData, 'quantity') ?? 1,
      expectedUnitPricePaise: formNumber(formData, 'expectedUnitPricePaise'),
    });

    if (!parsed.success) {
      return fail('We could not add that to your basket.', {
        fieldErrors: zodFieldErrors(parsed.error.issues),
      });
    }

    const result = await addToCart(parsed.data);
    const view = await getCartView();

    // Analytics: add_to_cart is the single most useful mid-funnel event.
    const context = await getAnalyticsContext();
    await trackEvent({
      name: ANALYTICS_EVENT.ADD_TO_CART,
      sessionId: context.sessionId,
      userId: context.userId,
      path: `/books/${parsed.data.bookId}`,
      referrer: context.referrer,
      device: context.device,
      props: {
        bookId: parsed.data.bookId,
        quantity: result.quantity,
        valuePaise: view?.totals.subtotalPaise ?? 0,
      },
    });

    revalidatePath('/cart');
    revalidatePath('/checkout');

    const priceChanged = view?.lines.some((line) => line.priceChanged) ?? false;

    return ok(
      {
        itemCount: view?.totals.itemCount ?? result.quantity,
        subtotalPaise: view?.totals.subtotalPaise ?? 0,
        notice: priceChanged ? 'Added — note that a price changed since you last looked.' : undefined,
        priceChanged,
      },
      'Added to your basket.',
    );
  } catch (err) {
    return fromError(err);
  }
}

/** Non-form variant used by quick-add buttons on cards. */
export async function quickAddAction(bookId: string, quantity = 1): Promise<ActionState<CartMutationResult>> {
  try {
    const result = await addToCart({ bookId, quantity });
    const view = await getCartView();

    revalidatePath('/cart');
    revalidatePath('/checkout');

    return ok(
      {
        itemCount: view?.totals.itemCount ?? quantity,
        subtotalPaise: view?.totals.subtotalPaise ?? 0,
      },
      `Added. ${result.quantity > 1 ? `${result.quantity} in your basket.` : '1 in your basket.'}`,
    );
  } catch (err) {
    return fromError(err);
  }
}

// ---------------------------------------------------------------------------
// Update / remove
// ---------------------------------------------------------------------------

export async function updateCartItemAction(
  _prev: ActionState<CartMutationResult>,
  formData: FormData,
): Promise<ActionState<CartMutationResult>> {
  try {
    const parsed = updateCartItemSchema.safeParse({
      cartItemId: formString(formData, 'cartItemId'),
      quantity: formNumber(formData, 'quantity'),
    });

    if (!parsed.success) {
      return fail('We could not update that quantity.', {
        fieldErrors: zodFieldErrors(parsed.error.issues),
      });
    }

    // Quantity 0 is the conventional "remove" gesture from a stepper.
    if (parsed.data.quantity === 0) {
      await removeCartItem(parsed.data.cartItemId);
    } else {
      await updateCartItem(parsed.data.cartItemId, parsed.data.quantity);
    }

    const view = await getCartView();

    revalidatePath('/cart');
    revalidatePath('/checkout');

    return ok({
      itemCount: view?.totals.itemCount ?? 0,
      subtotalPaise: view?.totals.subtotalPaise ?? 0,
    });
  } catch (err) {
    return fromError(err);
  }
}

export async function removeCartItemAction(cartItemId: string): Promise<ActionState<CartMutationResult>> {
  try {
    await removeCartItem(cartItemId);
    const view = await getCartView();

    revalidatePath('/cart');
    revalidatePath('/checkout');

    return ok(
      { itemCount: view?.totals.itemCount ?? 0, subtotalPaise: view?.totals.subtotalPaise ?? 0 },
      'Removed from your basket.',
    );
  } catch (err) {
    return fromError(err);
  }
}

export async function clearCartAction(): Promise<ActionState<CartMutationResult>> {
  try {
    const view = await getCartView();
    if (view) await clearCart(view.cartId);

    // Revalidate the whole layout: the basket count appears in the header on
    // every page, for guests as well as signed-in customers.
    revalidatePath('/', 'layout');

    return ok({ itemCount: 0, subtotalPaise: 0 }, 'Your basket is empty.');
  } catch (err) {
    return fromError(err);
  }
}

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

export interface CouponResult {
  code: string;
  description: string;
  discountPaise: number;
}

export async function applyCouponAction(
  _prev: ActionState<CouponResult>,
  formData: FormData,
): Promise<ActionState<CouponResult>> {
  const ip = await getClientIpForLimit();

  try {
    const limit = await consume('CART_WRITE', limitKey('coupon:ip', ip), {
      limit: 20,
      windowSeconds: 600,
    });
    if (!limit.allowed) {
      return fail('Too many attempts. Please try again in a few minutes.', {
        code: 'RATE_LIMITED',
        retryable: true,
      });
    }

    const parsed = applyCouponSchema.safeParse({ code: formString(formData, 'code') });
    if (!parsed.success) {
      return fail('Please enter a coupon code.', { fieldErrors: zodFieldErrors(parsed.error.issues) });
    }

    const view = await getCartView();
    if (!view || view.lines.length === 0) {
      return fail('Add something to your basket before applying a coupon.', { code: 'CART_EMPTY' });
    }

    const user = await getCurrentUser();
    const context = await getAnalyticsContext();

    // Validation happens against real cart contents and, for per-customer
    // limits, against real redemption history — never against what the client
    // claims it has in the basket.
    const validation = await validateCoupon(
      parsed.data.code,
      {
        subtotalPaise: view.totals.subtotalPaise,
        lines: view.totals.lines.map((line) => ({
          bookId: line.bookId,
          quantity: line.quantity,
          unitPricePaise: line.unitPricePaise,
        })),
      },
      { userId: user?.id ?? null, email: user?.email ?? null },
    );

    if (!validation.valid) {
      await trackEvent({
        name: ANALYTICS_EVENT.COUPON_FAILED,
        sessionId: context.sessionId,
        userId: context.userId,
        props: { code: parsed.data.code.toUpperCase(), outcome: 'rejected' },
      });

      return fail(validation.message, { code: 'COUPON_INVALID' });
    }

    await setCartCoupon(view.cartId, parsed.data.code.toUpperCase());

    const updated = await getCartView();

    await trackEvent({
      name: ANALYTICS_EVENT.COUPON_APPLIED,
      sessionId: context.sessionId,
      userId: context.userId,
      props: {
        code: parsed.data.code.toUpperCase(),
        discountPaise: updated?.totals.discountPaise ?? 0,
      },
    });

    revalidatePath('/cart');
    revalidatePath('/checkout');

    return ok(
      {
        code: parsed.data.code.toUpperCase(),
        description: validation.coupon?.description ?? 'Discount applied',
        discountPaise: updated?.totals.discountPaise ?? 0,
      },
      `${parsed.data.code.toUpperCase()} applied — you save ${formatPaise(updated?.totals.discountPaise ?? 0)}.`,
    );
  } catch (err) {
    return fromError(err);
  }
}

export async function removeCouponAction(): Promise<ActionState<never>> {
  try {
    const view = await getCartView();
    if (view) await setCartCoupon(view.cartId, null);
    revalidatePath('/cart');
    revalidatePath('/checkout');
    return ok(undefined, 'Coupon removed.');
  } catch (err) {
    return fromError(err);
  }
}

// ---------------------------------------------------------------------------
// Back-in-stock / price-drop alerts
// ---------------------------------------------------------------------------

/**
 * "Email me when it is back."
 *
 * We store the request and send *one* email when stock returns, then stop —
 * this is a transactional notification the customer asked for, not a marketing
 * list. That distinction is enforced by the notification layer, and by the fact
 * that the record is deleted after it fires.
 */
export async function requestStockAlertAction(
  _prev: ActionState<never>,
  formData: FormData,
): Promise<ActionState<never>> {
  const ip = await getClientIpForLimit();

  try {
    const limit = await consume('CONTACT', limitKey('stockalert:ip', ip), {
      limit: 10,
      windowSeconds: 3600,
    });
    if (!limit.allowed) {
      return fail('Too many requests. Please try again later.', { code: 'RATE_LIMITED', retryable: true });
    }

    const parsed = stockAlertSchema.safeParse({
      email: formString(formData, 'email'),
      bookId: formString(formData, 'bookId'),
      kind: formString(formData, 'kind') ?? 'back_in_stock',
    });

    if (!parsed.success) {
      return fail('Please check your email address.', {
        fieldErrors: zodFieldErrors(parsed.error.issues),
      });
    }

    const book = await db.book.findFirst({
      where: { id: parsed.data.bookId, deletedAt: null },
      select: { id: true, title: true },
    });

    if (!book) return fail('We could not find that title.', { code: 'NOT_FOUND' });

    const user = await getCurrentUser();

    // Upsert on the natural key so repeatedly tapping the button does not queue
    // a dozen identical emails.
    const existing = await db.stockAlert.findFirst({
      where: { bookId: book.id, email: parsed.data.email.toLowerCase(), status: 'pending' },
      select: { id: true },
    });

    if (!existing) {
      await db.stockAlert.create({
        data: {
          bookId: book.id,
          email: parsed.data.email.toLowerCase(),
          userId: user?.id ?? null,
          kind: parsed.data.kind,
          status: 'pending',
        },
      });
    }

    return ok(
      undefined,
      `We will email you the moment “${book.title}” is back — and only then.`,
    );
  } catch (err) {
    return fromError(err);
  }
}

// ---------------------------------------------------------------------------
// Quantity limits
// ---------------------------------------------------------------------------

/**
 * Server-side cap for a single line, exposed so the stepper can show an honest
 * maximum rather than letting someone type 99 and get rejected at checkout.
 */
export async function getMaxPerOrderAction(bookId: string): Promise<number> {
  try {
    // Availability is the single source of the per-order cap: the same number
    // the stepper shows and the same one checkout enforces.
    const availability = await getAvailability(bookId);
    return availability.maxPerOrder || DEFAULT_MAX_PER_ORDER;
  } catch {
    return DEFAULT_MAX_PER_ORDER;
  }
}
