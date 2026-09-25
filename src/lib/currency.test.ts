import { describe, expect, it } from 'vitest';
import { convertFromInrPaise, formatCurrencyMinorUnits, parseInrFxRates } from './currency';

describe('currency helpers', () => {
  it('converts INR paise using an explicit rate', () => expect(convertFromInrPaise(10000, 'USD', 0.012)).toBe(120));
  it('handles zero-decimal JPY correctly', () => expect(convertFromInrPaise(10000, 'JPY', 1.7)).toBe(170));
  it('rejects malformed FX configuration', () => expect(() => parseInrFxRates('{bad')).toThrow());
  it('formats minor units according to currency', () => expect(formatCurrencyMinorUnits(1234, 'USD', 'en-US')).toContain('12.34'));
});
