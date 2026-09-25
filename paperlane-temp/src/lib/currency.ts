/**
 * Currency / presentment helpers.
 *
 * Catalogue prices are stored in INR minor units today. This module keeps
 * conversion and formatting separate from the order/payment domain so the
 * store can add true multi-currency checkout without rewriting money maths.
 *
 * Rates are deliberately configuration-driven. We never silently invent a
 * live FX rate in application code. Production should provide refreshed rates
 * through the configured FX source and persist the rate used for an order.
 */

export const SUPPORTED_CURRENCIES = [
  'INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD', 'JPY', 'NZD', 'CHF', 'SAR',
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

const ZERO_DECIMAL_CURRENCIES = new Set<SupportedCurrency>(['JPY']);

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value.toUpperCase());
}

export function minorUnitDigits(currency: SupportedCurrency): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
}

/**
 * Convert INR paise to presentment minor units using an explicitly supplied
 * INR->currency rate. `rate` means major currency units received per ₹1.
 */
export function convertFromInrPaise(inrPaise: number, currency: SupportedCurrency, rate: number): number {
  if (!Number.isSafeInteger(inrPaise) || inrPaise < 0) throw new Error('Invalid INR amount');
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Invalid FX rate for ${currency}`);

  const inrRupees = inrPaise / 100;
  const majorAmount = inrRupees * rate;
  const multiplier = 10 ** minorUnitDigits(currency);
  return Math.round(majorAmount * multiplier);
}

export function formatCurrencyMinorUnits(amountMinor: number, currency: SupportedCurrency, locale = 'en-IN'): string {
  const digits = minorUnitDigits(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountMinor / 10 ** digits);
}

/** Parse a JSON object such as {"USD":0.0119,"EUR":0.0101}. */
export function parseInrFxRates(raw: string | undefined): Partial<Record<SupportedCurrency, number>> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Partial<Record<SupportedCurrency, number>> = { INR: 1 };
    for (const [key, value] of Object.entries(parsed)) {
      const code = key.toUpperCase();
      if (isSupportedCurrency(code) && typeof value === 'number' && Number.isFinite(value) && value > 0) {
        result[code] = value;
      }
    }
    return result;
  } catch {
    throw new Error('CURRENCY_RATES_JSON must be valid JSON');
  }
}

/** Server-side rate table. Missing currencies intentionally remain unavailable. */
export function configuredInrFxRates(raw: string | undefined): Partial<Record<SupportedCurrency, number>> {
  return parseInrFxRates(raw);
}
