import 'server-only';

import { db } from './db';
// Rate maths lives in pricing.ts and is imported, never reimplemented — the
// quote a customer sees on a product page must come from the same function that
// charges them at checkout.
import { addBusinessDays, quoteShipping } from './pricing';
import { getSetting } from './content';
import { logger } from '@/lib/logger';
import { DEFAULT_FREE_SHIPPING_THRESHOLD_PAISE } from '@/lib/constants';
import { isKolkataCodAddress } from '@/lib/cod';

/**
 * Shipping: delivery estimates for shoppers, tracking links for orders.
 *
 * Rate *calculation* lives in `pricing.ts` (`quoteShipping`) because it is part
 * of the money maths and must never be duplicated. This module is about the
 * things around it: what to tell someone before they have entered an address,
 * which carriers exist, and how to build a tracking URL that actually resolves.
 *
 * Everything here is configuration-driven, so a shop can change couriers or
 * thresholds without a code change.
 */

export interface DeliveryEstimate {
  /** e.g. "Arrives 3–5 October" — safe to render directly. */
  label: string;
  from: Date;
  to: Date;
  isFree: boolean;
  /** Null when the estimate is generic (no address entered yet). */
  ratePaise: number | null;
  methodLabel: string;
  codAvailable: boolean;
}

/** Carriers we can produce a working tracking URL for. */
export const CARRIERS: Record<string, { label: string; trackingUrl: (tracking: string) => string }> = {
  delhivery: {
    label: 'Delhivery',
    trackingUrl: (t) => `https://www.delhivery.com/track/package/${encodeURIComponent(t)}`,
  },
  bluedart: {
    label: 'Blue Dart',
    trackingUrl: (t) => `https://www.bluedart.com/tracking?trackfor=${encodeURIComponent(t)}`,
  },
  dtdc: {
    label: 'DTDC',
    trackingUrl: (t) => `https://www.dtdc.in/tracking/tracking_results.asp?strCnno=${encodeURIComponent(t)}`,
  },
  indiapost: {
    label: 'India Post',
    trackingUrl: (t) => `https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx`,
  },
  shiprocket: {
    label: 'Shiprocket',
    trackingUrl: (t) => `https://shiprocket.co/tracking/${encodeURIComponent(t)}`,
  },
  ekart: {
    label: 'Ekart',
    trackingUrl: (t) => `https://ekartlogistics.com/shipmenttrack/${encodeURIComponent(t)}`,
  },
  other: {
    label: 'Courier',
    trackingUrl: () => '',
  },
};

/**
 * A generic estimate for the product page, before we know where the customer is.
 *
 * Deliberately conservative and vague ("3–6 working days") rather than a
 * false-precision date for an address we have not been given. Once someone
 * enters a postcode at checkout we can quote a real window via `estimateFor`.
 */
export async function getDefaultEstimate(now = new Date()): Promise<DeliveryEstimate> {
  const minDays = Number((await getSetting('shipping.default_min_days', null)) ?? 3);
  const maxDays = Number((await getSetting('shipping.default_max_days', null)) ?? 6);

  const from = addBusinessDays(now, Number.isFinite(minDays) ? minDays : 3);
  const to = addBusinessDays(now, Number.isFinite(maxDays) ? maxDays : 6);

  const freeThreshold = Number(
    (await getSetting('shipping.free_threshold_paise', null)) ?? DEFAULT_FREE_SHIPPING_THRESHOLD_PAISE,
  );

  return {
    label: `${minDays}–${maxDays} working days`,
    from,
    to,
    isFree: false,
    ratePaise: null,
    methodLabel: 'Standard delivery',
    codAvailable: await isCodAvailable(),
  };
}

/**
 * A concrete estimate for a known destination.
 * Uses the same zone configuration as checkout, so what we promise on the
 * product page is what the customer is actually charged.
 */
export async function estimateFor(options: {
  country: string;
  state: string;
  postalCode: string;
  subtotalPaise: number;
  itemCount?: number;
  now?: Date;
}): Promise<DeliveryEstimate | null> {
  try {
    const quotes = await quoteShipping({
      country: options.country,
      state: options.state,
      postalCode: options.postalCode,
      subtotalPaise: options.subtotalPaise,
      itemCount: options.itemCount ?? 1,
      now: options.now,
    });

    const best = quotes[0];
    if (!best) return null;

    return {
      label: `Arrives ${formatWindow(best.estimatedDeliveryFrom, best.estimatedDeliveryTo)}`,
      from: best.estimatedDeliveryFrom,
      to: best.estimatedDeliveryTo,
      isFree: best.isFree,
      ratePaise: best.ratePaise,
      methodLabel: best.label,
      codAvailable: await isCodAvailable(),
    };
  } catch (err) {
    logger.warn('shipping estimate failed', { err: String(err), postalCode: options.postalCode });
    return null;
  }
}

/**
 * Zip/ETA windows are formatted here rather than in the component because the
 * phrasing ("3–5 Oct", "Oct 30 – Nov 2") depends on whether the range crosses a
 * month, and that logic belongs with the date maths.
 */
export function formatWindow(from: Date, to: Date): string {
  const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
  const day = new Intl.DateTimeFormat('en-IN', { day: 'numeric' });
  const dayMonth = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

  if (sameMonth) return `${day.format(from)}–${dayMonth.format(to)}`;
  return `${dayMonth.format(from)} – ${dayMonth.format(to)}`;
}

/** A tracking URL only when we can actually build a resolving one. */
export function buildTrackingUrl(carrier: string | null, trackingNumber: string | null): string | null {
  if (!carrier || !trackingNumber) return null;

  const entry = CARRIERS[carrier.toLowerCase()];
  if (!entry) {
    // Unknown carrier: give a search that at least gives the customer somewhere
    // to look, but never a fabricated deep link that 404s.
    return `https://www.google.com/search?q=${encodeURIComponent(`${carrier} tracking ${trackingNumber}`)}`;
  }

  const url = entry.trackingUrl(trackingNumber);
  return url || `https://www.google.com/search?q=${encodeURIComponent(`${carrier} tracking ${trackingNumber}`)}`;
}

export function carrierLabel(carrier: string | null): string {
  if (!carrier) return 'Courier';
  return CARRIERS[carrier.toLowerCase()]?.label ?? carrier;
}

/** Cash on delivery is a per-store flag, read from settings. */
export { isKolkataCodAddress } from '@/lib/cod';

export async function isCodAvailable(address?: { country?: string; state?: string; city?: string; postalCode?: string }): Promise<boolean> {
  const value = await getSetting('payments.cod_enabled', null);
  const enabled = value === null ? true : value === 'true' || value === '1';
  if (!enabled) return false;
  if (!address) return true;
  return isKolkataCodAddress(address);
}

/** Free-shipping threshold, for progress messaging in the cart. */
export async function getFreeShippingThreshold(): Promise<number> {
  const value = Number((await getSetting('shipping.free_threshold_paise', null)) ?? DEFAULT_FREE_SHIPPING_THRESHOLD_PAISE);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_FREE_SHIPPING_THRESHOLD_PAISE;
}

/** Return window, for the product page and the returns policy page. */
export async function getReturnWindowDays(): Promise<number> {
  const value = Number((await getSetting('shipping.return_window_days', null)) ?? 7);
  return Number.isFinite(value) && value >= 0 ? value : 7;
}

/**
 * Active shipping methods for the admin shipping screen.
 * Read-only here; writes go through the admin actions with validation.
 */
export async function listShippingZones() {
  return db.shippingZone.findMany({
    include: { methods: { orderBy: { sortOrder: 'asc' } } },
    orderBy: [{ priority: 'asc' }, { name: 'asc' }],
  });
}
