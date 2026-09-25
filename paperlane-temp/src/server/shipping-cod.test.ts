import { describe, expect, it } from 'vitest';
import { isKolkataCodAddress } from '@/lib/cod';

describe('Kolkata COD eligibility', () => {
  it('accepts Kolkata West Bengal 700xxx', () => expect(isKolkataCodAddress({ country: 'IN', state: 'West Bengal', city: 'Kolkata', postalCode: '700019' })).toBe(true));
  it('rejects another Kolkata-looking postcode', () => expect(isKolkataCodAddress({ country: 'IN', state: 'West Bengal', city: 'Kolkata', postalCode: '560001' })).toBe(false));
  it('rejects Kolkata in another country', () => expect(isKolkataCodAddress({ country: 'US', state: 'West Bengal', city: 'Kolkata', postalCode: '700019' })).toBe(false));
});
