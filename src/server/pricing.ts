/**
 * Pricing engine — the authoritative source of every number a customer pays.
 *
 * Hard rule: **the client never sends a price.** The browser sends book ids and
 * quantities; this module computes subtotal, discounts, tax, shipping and total
 * from the database. Every value the client thinks it knows is re-derived here
 * and returned for display.
 *
 * Tax model
 * ---------
 * Indian book prices are tax-inclusive (the printed MRP includes GST), so the
 * default path is *extractive*: the tax is carved out of the gross for the
 * invoice and the total is unchanged. Books whose `taxInclusive` flag is false
 * go through the additive path. Rates live in the `TaxRate` table — nothing is
 * hard-coded, and a rate change is a data change, not a deploy.
 */

import { db, withRetry } from './db';
import {
  applyBasisPoints,
  clampDiscount,
  discountPercent as computeDiscountPercent,
  formatPaise,
  sumPaise,
  type Paise,
} from '@/lib/money';
import { COUPON_TYPE } from '@/lib/constants';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

export interface PricedLine {
  bookId: string;
  quantity: number;
  title: string;
  slug: string;
  cover: string | null;
  format: string;
  /** Printed list price per unit. */
  mrpPaise: Paise;
  /** Selling price per unit before order-level discounts. */
  unitPricePaise: Paise;
  lineSubtotalPaise: Paise;
  lineDiscountPaise: Paise;
  lineTaxPaise: Paise;
  lineTotalPaise: Paise;
  taxRateBp: number;
  taxLabel: string;
  hsnCode: string | null;
  /** Set when the price moved since the item was added to the cart. */
  priceChangedFrom?: Paise;
  maxQuantity: number;
  available: number;
  status: string;
}

export interface AppliedCoupon {
  code: string;
  type: string;
  amountPaise: Paise;
  description: string | null;
}

export interface ShippingQuote {
  methodId: string | null;
  label: string;
  description: string | null;
  carrier: string | null;
  ratePaise: Paise;
  freeAbovePaise: Paise | null;
  isFree: boolean;
  minDays: number;
  maxDays: number;
  estimatedDeliveryFrom: Date;
  estimatedDeliveryTo: Date;
}

export interface OrderTotals {
  currency: string;
  lines: PricedLine[];
  itemCount: number;
  subtotalPaise: Paise;
  /** Sum of MRP × qty minus sum of selling price × qty — the "you saved" figure. */
  catalogueSavingsPaise: Paise;
  discountPaise: Paise;
  coupon: AppliedCoupon | null;
  giftCardPaise: Paise;
  taxPaise: Paise;
  taxBreakdown: Array<{ code: string; label: string; rateBp: number; taxablePaise: Paise; taxPaise: Paise; inclusive: boolean }>;
  shippingPaise: Paise;
  shipping: ShippingQuote | null;
  totalPaise: Paise;
  /** What the customer still owes after gifts cards are applied. */
  amountDuePaise: Paise;
  freeShippingThresholdPaise: Paise | null;
  amountToFreeShippingPaise: Paise;
  discountPercent: number;
}

export interface CouponEvaluationContext {
  userId?: string | null;
  email?: string | null;
  isFirstOrder?: boolean;
  now?: Date;
}

// ---------------------------------------------------------------------------
// Selling price resolution
// ---------------------------------------------------------------------------

/** The price a unit actually sells for: sale price when present and lower. */
export function sellingPricePaise(book: { pricePaise: number; salePricePaise: number | null }): Paise {
  if (book.salePricePaise !== null && book.salePricePaise > 0 && book.salePricePaise < book.pricePaise) {
    return book.salePricePaise;
  }
  return book.pricePaise;
}

/** Tax rate lookup — cached per request-ish lifetime, keyed by code+state. */
const taxCache = new Map<string, { rateBp: number; inclusive: boolean; label: string; hsnCode: string | null }>();

export async function resolveTaxRate(
  taxCategory: string,
  destination: { country?: string; state?: string } = {},
): Promise<{ rateBp: number; inclusive: boolean; label: string; hsnCode: string | null }> {
  const country = destination.country ?? 'IN';
  const state = destination.state ?? '';
  const cacheKey = `${taxCategory}|${country}|${state}`;

  const cached = taxCache.get(cacheKey);
  if (cached) return cached;

  // Prefer a state-specific rate, then a country-wide one.
  const rates = await db.taxRate.findMany({
    where: { code: taxCategory, country, isActive: true },
  });

  const match =
    rates.find((r) => r.state === state) ??
    rates.find((r) => r.state === null || r.state === '') ??
    rates[0];

  const resolved = match
    ? { rateBp: match.rateBp, inclusive: match.isInclusive, label: match.label, hsnCode: match.hsnCode }
    : { rateBp: 0, inclusive: true, label: 'No tax configured', hsnCode: null };

  if (!match) {
    logger.warn('no tax rate configured for category', { taxCategory, country, state });
  }

  taxCache.set(cacheKey, resolved);
  return resolved;
}

export function invalidateTaxCache(): void {
  taxCache.clear();
}

// ---------------------------------------------------------------------------
// Shipping
// ---------------------------------------------------------------------------

export async function quoteShipping(options: {
  country: string;
  state: string;
  postalCode: string;
  subtotalPaise: Paise;
  itemCount: number;
  methodCode?: string | null;
  now?: Date;
}): Promise<ShippingQuote[]> {
  const zones = await db.shippingZone.findMany({
    where: { isActive: true },
    include: { methods: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
    orderBy: { priority: 'asc' },
  });

  const country = options.country.trim().toUpperCase();
  const state = options.state.trim().toUpperCase();
  const postalCode = options.postalCode.trim();

  // ISO 3166-1 alpha-2 is what the checkout and carrier configuration use.
  // Postal formats vary wildly worldwide, so only impose a structural check;
  // India gets its stricter six-digit check below.
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new AppError('VALIDATION_ERROR', 'Please enter a valid two-letter country code.');
  }
  if (country === 'IN' && !/^\d{6}$/.test(postalCode.replace(/\s/g, ''))) {
    throw new AppError('VALIDATION_ERROR', 'Please enter a valid 6-digit Indian PIN code.');
  }
  if (country !== 'IN' && !/^[A-Z0-9][A-Z0-9 .-]{1,11}$/i.test(postalCode)) {
    throw new AppError('VALIDATION_ERROR', 'Please enter a valid postal or ZIP code.');
  }

  const zone =
    zones.find((z) => {
      const countries = parseJsonArray(z.countries).map((c) => c.toUpperCase());
      // A `*` country entry is the explicit catch-all international zone.
      // It is used only after higher-priority country-specific zones have had
      // a chance to match.
      if (!countries.includes('*') && !countries.includes(country)) return false;
      if (!z.states) return true;
      const states = parseJsonArray(z.states).map((s) => s.toUpperCase());
      return states.includes(state);
    }) ?? null;

  if (!zone || zone.methods.length === 0) {
    // Never invent a shipping service or price. A missing zone is an operational
    // configuration problem, not a reason to silently offer a made-up delivery
    // promise to a customer.
    logger.warn('no shipping zone matched', { country, state, postalCode });
    throw new AppError('VALIDATION_ERROR', 'We do not currently ship to this destination.');
  }

  const now = options.now ?? new Date();

  return zone.methods.map((method) => {
    const qualifiesFree =
      method.freeAbovePaise !== null && options.subtotalPaise >= method.freeAbovePaise;
    const isFree = method.ratePaise === 0 || qualifiesFree;
    return {
      methodId: method.id,
      label: method.label,
      description: method.description,
      carrier: method.carrier,
      ratePaise: isFree ? 0 : method.ratePaise,
      freeAbovePaise: method.freeAbovePaise,
      isFree,
      minDays: method.minDays,
      maxDays: method.maxDays,
      estimatedDeliveryFrom: addBusinessDays(now, method.minDays),
      estimatedDeliveryTo: addBusinessDays(now, method.maxDays),
    };
  });
}

/** Working days only — customers do not receive parcels on Sundays. */
export function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from.getTime());
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0) added += 1; // skip Sunday
  }
  return result;
}

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

export interface CouponValidation {
  valid: boolean;
  coupon: {
    id: string;
    code: string;
    type: string;
    description: string | null;
    valueBp: number | null;
    valuePaise: number | null;
    minOrderPaise: number;
    maxDiscountPaise: number | null;
    scope: string;
    appliesToBookIds: string[];
    appliesToGenreIds: string[];
  } | null;
  /** Customer-facing explanation when invalid. */
  message: string;
}

/**
 * Validate a coupon against a cart. Returns a structured result rather than
 * throwing, because "your code is invalid" is normal UX, not an exception.
 *
 * Eligibility (usage caps, per-customer caps, first-order-only) is enforced
 * here *and* re-checked inside the checkout transaction, where the counters are
 * incremented atomically. The second check is what makes the limit hold under
 * concurrent checkouts.
 */
export async function validateCoupon(
  code: string,
  context: { lines: Array<{ bookId: string; quantity: number; unitPricePaise: Paise; genreIds?: string[] }>; subtotalPaise: Paise },
  evalContext: CouponEvaluationContext = {},
): Promise<CouponValidation> {
  const normalised = code.trim().toUpperCase();
  const invalid = (message: string): CouponValidation => ({ valid: false, coupon: null, message });

  if (!normalised) return invalid('Enter a coupon code.');

  const coupon = await db.coupon.findUnique({ where: { code: normalised } });
  if (!coupon || !coupon.isActive) return invalid('That code is not valid.');

  const now = evalContext.now ?? new Date();
  if (coupon.startsAt && coupon.startsAt > now) return invalid('That code is not active yet.');
  if (coupon.endsAt && coupon.endsAt < now) return invalid('That code has expired.');

  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    return invalid('That code has reached its limit and is no longer available.');
  }

  if (coupon.minOrderPaise > 0 && context.subtotalPaise < coupon.minOrderPaise) {
    return invalid(
      `Add ${formatPaise(coupon.minOrderPaise - context.subtotalPaise)} more to use this code (minimum order ${formatPaise(coupon.minOrderPaise)}).`,
    );
  }

  if (coupon.firstOrderOnly && evalContext.userId) {
    const priorOrders = await db.order.count({
      where: { userId: evalContext.userId, paymentStatus: { in: ['paid', 'partially_refunded', 'refunded'] } },
    });
    if (priorOrders > 0) return invalid('This offer is for first orders only.');
  }

  if (coupon.perCustomerLimit !== null && evalContext.userId) {
    const used = await db.couponRedemption.count({
      where: { couponId: coupon.id, userId: evalContext.userId },
    });
    if (used >= coupon.perCustomerLimit) {
      return invalid('You have already used this code.');
    }
  }

  // Scope checks: if the coupon is restricted, at least one line must qualify.
  const appliesToBookIds = parseJsonArray(coupon.appliesToBookIds);
  const appliesToGenreIds = parseJsonArray(coupon.appliesToGenreIds);

  if (coupon.scope === 'books' && appliesToBookIds.length > 0) {
    const hasEligible = context.lines.some((l) => appliesToBookIds.includes(l.bookId));
    if (!hasEligible) return invalid('This code does not apply to anything in your basket.');
  }

  if (coupon.scope === 'genres' && appliesToGenreIds.length > 0) {
    const hasEligible = context.lines.some((l) =>
      (l.genreIds ?? []).some((g) => appliesToGenreIds.includes(g)),
    );
    if (!hasEligible) return invalid('This code does not apply to anything in your basket.');
  }

  return {
    valid: true,
    message: `Code ${coupon.code} applied.`,
    coupon: {
      id: coupon.id,
      code: coupon.code,
      type: coupon.type,
      description: coupon.description,
      valueBp: coupon.valueBp,
      valuePaise: coupon.valuePaise,
      minOrderPaise: coupon.minOrderPaise,
      maxDiscountPaise: coupon.maxDiscountPaise,
      scope: coupon.scope,
      appliesToBookIds,
      appliesToGenreIds,
    },
  };
}

/**
 * Compute the discount a coupon yields for a cart.
 * Restricted coupons discount only the eligible portion of the basket — if a
 * 10% code applies to two of five books, the customer gets 10% of those two.
 */
export function computeCouponDiscount(
  coupon: NonNullable<CouponValidation['coupon']>,
  lines: Array<{ bookId: string; quantity: number; unitPricePaise: Paise; genreIds?: string[] }>,
  shippingPaise: Paise,
): { discountPaise: Paise; freeShipping: boolean } {
  if (coupon.type === COUPON_TYPE.FREE_SHIPPING) {
    return { discountPaise: 0, freeShipping: true };
  }

  const eligibleLines = lines.filter((line) => {
    if (coupon.scope === 'all') return true;
    if (coupon.scope === 'first_order') return true;
    if (coupon.scope === 'books') return coupon.appliesToBookIds.includes(line.bookId);
    if (coupon.scope === 'genres') {
      return (line.genreIds ?? []).some((g) => coupon.appliesToGenreIds.includes(g));
    }
    return true;
  });

  const eligibleBase = sumPaise(eligibleLines.map((l) => l.unitPricePaise * l.quantity));
  if (eligibleBase <= 0) return { discountPaise: 0, freeShipping: false };

  let discount: Paise;
  if (coupon.type === COUPON_TYPE.PERCENT) {
    discount = applyBasisPoints(eligibleBase, coupon.valueBp ?? 0);
  } else {
    discount = coupon.valuePaise ?? 0;
  }

  return {
    discountPaise: clampDiscount(discount, eligibleBase, coupon.maxDiscountPaise),
    freeShipping: false,
  };
}

// ---------------------------------------------------------------------------
// Order totals — the single entry point
// ---------------------------------------------------------------------------

export interface CalculateTotalsInput {
  lines: Array<{
    bookId: string;
    quantity: number;
    /** Optional: what the client believed the price was, to detect drift. */
    expectedUnitPricePaise?: Paise;
  }>;
  destination: { country: string; state: string; postalCode: string };
  shippingMethodId?: string | null;
  couponCode?: string | null;
  giftCardPaise?: Paise;
  userId?: string | null;
  email?: string | null;
  now?: Date;
}

/**
 * Compute everything the customer will pay.
 *
 * This runs on every cart view and again inside the checkout transaction. The
 * second run is the authoritative one; the first exists only so the cart page
 * can show live numbers.
 */
export async function calculateTotals(input: CalculateTotalsInput): Promise<OrderTotals> {
  const currency = 'INR';

  if (input.lines.length === 0) {
    return emptyTotals(currency);
  }

  const bookIds = [...new Set(input.lines.map((l) => l.bookId))];

  const books = await db.book.findMany({
    where: { id: { in: bookIds }, deletedAt: null },
    select: {
      id: true,
      title: true,
      slug: true,
      coverImageUrl: true,
      format: true,
      pricePaise: true,
      salePricePaise: true,
      taxCategory: true,
      taxInclusive: true,
      status: true,
      genreId: true,
      genreLinks: { select: { genreId: true } },
    },
  });

  const bookMap = new Map(books.map((b) => [b.id, b]));

  const missing = bookIds.filter((id) => !bookMap.has(id));
  if (missing.length > 0) {
    throw new AppError('NOT_FOUND', 'One or more titles in your basket are no longer available.');
  }

  // Availability is fetched once for all lines.
  const { getAvailabilityMap, DEFAULT_MAX_PER_ORDER } = await import('./inventory');
  const availability = await getAvailabilityMap(bookIds);

  const pricedLines: PricedLine[] = [];
  const taxGroups = new Map<
    string,
    { code: string; label: string; rateBp: number; taxablePaise: Paise; taxPaise: Paise; inclusive: boolean }
  >();

  let subtotal = 0;
  let mrpTotal = 0;
  let itemCount = 0;

  for (const line of input.lines) {
    const book = bookMap.get(line.bookId)!;
    const quantity = Math.max(1, Math.floor(line.quantity));

    const tax = await resolveTaxRate(book.taxCategory, {
      country: input.destination.country,
      state: input.destination.state,
    });

    const unitPrice = sellingPricePaise(book);
    const lineGross = unitPrice * quantity;
    const lineMrp = book.pricePaise * quantity;

    // Carve tax out of the inclusive price so net + tax === gross exactly.
    let lineTax: number;
    if (book.taxInclusive) {
      lineTax = tax.rateBp > 0 ? Math.round((lineGross * tax.rateBp) / (10_000 + tax.rateBp)) : 0;
    } else {
      lineTax = applyBasisPoints(lineGross, tax.rateBp);
    }

    const avail = availability.get(book.id);

    const priced: PricedLine = {
      bookId: book.id,
      quantity,
      title: book.title,
      slug: book.slug,
      cover: book.coverImageUrl,
      format: book.format,
      mrpPaise: book.pricePaise,
      unitPricePaise: unitPrice,
      lineSubtotalPaise: lineGross,
      lineDiscountPaise: 0, // filled after order-level discount is allocated
      lineTaxPaise: lineTax,
      lineTotalPaise: lineGross,
      taxRateBp: tax.rateBp,
      taxLabel: tax.label,
      hsnCode: tax.hsnCode,
      maxQuantity: Math.min(DEFAULT_MAX_PER_ORDER, Math.max(1, avail?.available ?? 0)),
      available: avail?.available ?? 0,
      status: avail?.status ?? 'out_of_stock',
    };

    if (
      line.expectedUnitPricePaise !== undefined &&
      line.expectedUnitPricePaise !== unitPrice
    ) {
      priced.priceChangedFrom = line.expectedUnitPricePaise;
    }

    pricedLines.push(priced);
    subtotal += lineGross;
    mrpTotal += lineMrp;
    itemCount += quantity;

    const groupKey = `${tax.label}|${tax.rateBp}|${book.taxInclusive}`;
    const group = taxGroups.get(groupKey) ?? {
      code: book.taxCategory,
      label: tax.label,
      rateBp: tax.rateBp,
      taxablePaise: 0,
      taxPaise: 0,
      inclusive: book.taxInclusive,
    };
    group.taxablePaise += lineGross - lineTax;
    group.taxPaise += lineTax;
    taxGroups.set(groupKey, group);
  }

  // --- Coupon ---
  let appliedCoupon: AppliedCoupon | null = null;
  let discountPaise = 0;
  let couponFreeShipping = false;

  if (input.couponCode) {
    const validation = await validateCoupon(
      input.couponCode,
      {
        lines: pricedLines.map((l) => ({
          bookId: l.bookId,
          quantity: l.quantity,
          unitPricePaise: l.unitPricePaise,
          genreIds: (() => {
            const b = bookMap.get(l.bookId);
            return b ? [b.genreId, ...b.genreLinks.map((g) => g.genreId)].filter(Boolean) as string[] : [];
          })(),
        })),
        subtotalPaise: subtotal,
      },
      { userId: input.userId, email: input.email, now: input.now },
    );

    if (validation.valid && validation.coupon) {
      const { discountPaise: computed, freeShipping } = computeCouponDiscount(
        validation.coupon,
        pricedLines.map((l) => ({
          bookId: l.bookId,
          quantity: l.quantity,
          unitPricePaise: l.unitPricePaise,
          genreIds: (() => {
            const b = bookMap.get(l.bookId);
            return b ? [b.genreId, ...b.genreLinks.map((g) => g.genreId)].filter(Boolean) as string[] : [];
          })(),
        })),
        0,
      );
      discountPaise = computed;
      couponFreeShipping = freeShipping;
      appliedCoupon = {
        code: validation.coupon.code,
        type: validation.coupon.type,
        amountPaise: computed,
        description: validation.coupon.description,
      };
    }
  }

  // --- Shipping ---
  const quotes = await quoteShipping({
    country: input.destination.country,
    state: input.destination.state,
    postalCode: input.destination.postalCode,
    // Free-shipping thresholds are evaluated against the pre-discount subtotal,
    // which is the customer-friendly reading of "spend ₹799".
    subtotalPaise: subtotal,
    itemCount,
    methodCode: input.shippingMethodId,
    now: input.now,
  });

  const selectedQuote =
    (input.shippingMethodId ? quotes.find((q) => q.methodId === input.shippingMethodId) : undefined) ??
    quotes[0] ??
    null;

  let shippingPaise = selectedQuote?.ratePaise ?? 0;
  if (couponFreeShipping) {
    shippingPaise = 0;
    if (selectedQuote) selectedQuote.isFree = true;
  }

  // --- Allocate order-level discount across lines, proportionally ---
  if (discountPaise > 0 && subtotal > 0) {
    let allocated = 0;
    pricedLines.forEach((line, index) => {
      const share =
        index === pricedLines.length - 1
          ? discountPaise - allocated
          : Math.round((line.lineSubtotalPaise / subtotal) * discountPaise);
      line.lineDiscountPaise = Math.max(0, share);
      line.lineTotalPaise = Math.max(0, line.lineSubtotalPaise - line.lineDiscountPaise);
      allocated += share;
    });
  }

  const taxPaise = sumPaise([...taxGroups.values()].map((g) => g.taxPaise));
  const giftCardPaise = Math.min(input.giftCardPaise ?? 0, Math.max(0, subtotal - discountPaise + shippingPaise));

  // Books are tax-inclusive, so the payable total is subtotal - discount +
  // shipping (+ tax only for tax-exclusive lines).
  const taxExclusiveExtra = [...taxGroups.values()]
    .filter((g) => !g.inclusive)
    .reduce((sum, g) => sum + g.taxPaise, 0);

  const totalPaise = Math.max(0, subtotal - discountPaise + shippingPaise + taxExclusiveExtra);
  const amountDuePaise = Math.max(0, totalPaise - giftCardPaise);

  const threshold = 79_900;
  const catalogueSavings = Math.max(0, mrpTotal - subtotal);

  return {
    currency,
    lines: pricedLines,
    itemCount,
    subtotalPaise: subtotal,
    catalogueSavingsPaise: catalogueSavings,
    discountPaise,
    coupon: appliedCoupon,
    giftCardPaise,
    taxPaise,
    taxBreakdown: [...taxGroups.values()],
    shippingPaise,
    shipping: selectedQuote,
    totalPaise,
    amountDuePaise,
    freeShippingThresholdPaise: threshold,
    amountToFreeShippingPaise: Math.max(0, threshold - subtotal),
    discountPercent:
      subtotal > 0 ? Math.round(((discountPaise + catalogueSavings) / (subtotal + catalogueSavings)) * 100) : 0,
  };
}

/** Totals for an empty basket — avoids a DB round trip on a cold cart page. */
export function emptyTotals(currency = 'INR'): OrderTotals {
  return {
    currency,
    lines: [],
    itemCount: 0,
    subtotalPaise: 0,
    catalogueSavingsPaise: 0,
    discountPaise: 0,
    coupon: null,
    giftCardPaise: 0,
    taxPaise: 0,
    taxBreakdown: [],
    shippingPaise: 0,
    shipping: null,
    totalPaise: 0,
    amountDuePaise: 0,
    freeShippingThresholdPaise: 79_900,
    amountToFreeShippingPaise: 79_900,
    discountPercent: 0,
  };
}

/** Public helper so UI code does not reimplement the maths. */
export { computeDiscountPercent };

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
