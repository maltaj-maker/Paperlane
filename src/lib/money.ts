/**
 * Money handling.
 *
 * RULE: money is never a float in this codebase. Prices are integer minor units
 * ("paise"). Floats lose precision under repeated arithmetic and the failure mode
 * is a customer being charged ₹0.01 more than the invoice says — a real
 * compliance problem, not a rounding curiosity.
 *
 * All arithmetic here is integer-only, with explicit, documented rounding.
 */

export const CURRENCY = 'INR' as const;
export const MINOR_UNITS_PER_MAJOR = 100; // paise per rupee

/** A value in minor units (paise). Branded at the type level to resist mixups. */
export type Paise = number;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Guard used at every boundary where money enters the system. */
export function assertPaise(value: number, label = 'amount'): Paise {
  if (!Number.isFinite(value)) throw new MoneyError(`${label} is not finite`);
  if (!Number.isInteger(value)) throw new MoneyError(`${label} must be an integer (paise), got ${value}`);
  if (value < 0) throw new MoneyError(`${label} must not be negative, got ${value}`);
  if (Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new MoneyError(`${label} out of safe range`);
  return value;
}

/** ₹499.00 -> 49900 */
export function rupeesToPaise(rupees: number): Paise {
  if (!Number.isFinite(rupees)) throw new MoneyError('rupees must be finite');
  return Math.round(rupees * MINOR_UNITS_PER_MAJOR);
}

/** 49900 -> 499 */
export function paiseToRupees(paise: Paise): number {
  return paise / MINOR_UNITS_PER_MAJOR;
}

/**
 * Format for display. Uses Indian digit grouping (₹1,23,456.00) because that is
 * what customers here expect; `en-IN` handles lakh/crore grouping natively.
 */
export function formatPaise(
  paise: Paise,
  options: { withDecimals?: boolean; currencySymbol?: string; locale?: string } = {},
): string {
  const { withDecimals = false, currencySymbol = '₹', locale = 'en-IN' } = options;
  const safe = Number.isFinite(paise) ? paise : 0;
  const value = paiseToRupees(safe);
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: withDecimals ? 2 : 0,
    maximumFractionDigits: withDecimals ? 2 : 0,
  }).format(value);
  // Intl's currency formatting for INR yields "₹499.00"; we render the symbol
  // ourselves so we can drop decimals on grid tiles (₹499 reads cleaner than
  // ₹499.00 when you have six tiles across a phone screen).
  return `${safe < 0 ? '-' : ''}${currencySymbol}${formatted.replace('-', '')}`;
}

/** For invoices, where decimals are mandatory. */
export function formatPaiseExact(paise: Paise, locale = 'en-IN'): string {
  return formatPaise(paise, { withDecimals: true, locale });
}

/**
 * Apply a discount expressed in basis points (1 bp = 0.01%).
 * 1000 bp = 10%. Rounds half-away-from-zero to the paise.
 */
export function applyBasisPoints(amount: Paise, basisPoints: number): Paise {
  assertPaise(amount, 'amount');
  if (!Number.isFinite(basisPoints) || basisPoints < 0) {
    throw new MoneyError(`basisPoints must be a non-negative number, got ${basisPoints}`);
  }
  return Math.round((amount * basisPoints) / 10_000);
}

/** Convert a user-entered percentage (e.g. 12.5) to basis points. */
export function percentToBasisPoints(percent: number): number {
  return Math.round(percent * 100);
}

export function basisPointsToPercent(basisPoints: number): number {
  return basisPoints / 100;
}

/** Percentage saved, for "25% off" badges. Returns 0 when there is no discount. */
export function discountPercent(mrp: Paise, sale: Paise): number {
  if (mrp <= 0 || sale >= mrp) return 0;
  return Math.round(((mrp - sale) / mrp) * 100);
}

/**
 * Split a tax-inclusive amount into net + tax.
 *
 * Indian listed book prices are typically tax-inclusive (MRP includes GST), so
 * this is the common path: given a gross of 49900 at 5%, the tax component is
 * 49900 * 500 / (10000 + 500) = 2376.19 -> 2376, net = 47524.
 *
 * Rounding is applied to the tax and the net is derived by subtraction, so
 * net + tax === gross exactly. Never round both independently.
 */
export function splitInclusiveTax(
  grossPaise: Paise,
  rateBp: number,
): { netPaise: Paise; taxPaise: Paise } {
  assertPaise(grossPaise, 'grossPaise');
  if (rateBp === 0) return { netPaise: grossPaise, taxPaise: 0 };
  const taxPaise = Math.round((grossPaise * rateBp) / (10_000 + rateBp));
  return { netPaise: grossPaise - taxPaise, taxPaise };
}

/**
 * Add tax on top of a tax-exclusive amount.
 */
export function addExclusiveTax(
  netPaise: Paise,
  rateBp: number,
): { netPaise: Paise; taxPaise: Paise; grossPaise: Paise } {
  assertPaise(netPaise, 'netPaise');
  const taxPaise = applyBasisPoints(netPaise, rateBp);
  return { netPaise, taxPaise, grossPaise: netPaise + taxPaise };
}

/**
 * Round to the nearest whole rupee. Some stores use this to avoid paise on COD.
 * Kept separate and explicit rather than baked into totals.
 */
export function roundToWholeRupee(paise: Paise): Paise {
  return Math.round(paise / MINOR_UNITS_PER_MAJOR) * MINOR_UNITS_PER_MAJOR;
}

export function sumPaise(values: readonly Paise[]): Paise {
  let total = 0;
  for (const v of values) {
    assertPaise(v, 'summand');
    total += v;
  }
  if (!Number.isSafeInteger(total)) throw new MoneyError('sum overflowed safe integer range');
  return total;
}

/** Clamp a discount so it can never exceed the base or a configured cap. */
export function clampDiscount(requested: Paise, base: Paise, cap?: number | null): Paise {
  assertPaise(requested, 'requested discount');
  assertPaise(base, 'base');
  let result = Math.min(requested, base);
  if (typeof cap === 'number' && cap >= 0) result = Math.min(result, cap);
  return Math.max(0, result);
}

/** Provider-agnostic amount string (PhonePe & most Indian PSPs want rupees). */
export function paiseToProviderAmount(paise: Paise, currency: string = CURRENCY): string {
  return currency === 'INR' ? String(paise) : paiseToRupees(paise).toFixed(2);
}

/** Format a payment/presentment amount when its currency is not INR. */
export function formatMinorUnits(amountMinor: number, currency: string, locale = 'en-IN'): string {
  const digits = currency.toUpperCase() === 'JPY' ? 0 : 2;
  const code = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || !Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new MoneyError('Invalid currency amount');
  }
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountMinor / 10 ** digits);
}
