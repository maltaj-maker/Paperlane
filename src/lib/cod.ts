export function isKolkataCodAddress(address: { country?: string; state?: string; city?: string; postalCode?: string }): boolean {
  const country = (address.country ?? '').trim().toUpperCase();
  const state = (address.state ?? '').trim().toLowerCase();
  const city = (address.city ?? '').trim().toLowerCase();
  const postal = (address.postalCode ?? '').replace(/\D/g, '');
  return country === 'IN' && state === 'west bengal' && city === 'kolkata' && /^700\d{3}$/.test(postal);
}
