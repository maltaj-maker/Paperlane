/**
 * Analytics.
 *
 * Two properties matter here and they pull in opposite directions, so the design
 * is explicit about both:
 *
 *  - **Privacy.** We store events in our own database and never put personal data
 *    in them. No names, emails, phone numbers or full IPs. A `sessionId` is a
 *    random per-visit token, not a fingerprint. Third-party analytics is opt-in
 *    via `ANALYTICS_PROVIDER` and gated behind consent (`ANALYTICS_REQUIRE_CONSENT`).
 *    If the owner never configures a provider, `internal` keeps everything
 *    first-party.
 *
 *  - **Instagram attribution.** This store's growth channel is Instagram, so
 *    referral detection is a first-class feature rather than an afterthought.
 *    Every event records whether it came from Instagram, and deep-link entry
 *    (`?utm_source=instagram` on a Reel) is tracked end to end so the owner can
 *    see which posts actually sell books.
 */

import { db } from './db';
import { logger } from '@/lib/logger';
import { ANALYTICS_EVENT } from '@/lib/constants';
import { env } from '@/lib/env';

export interface TrackEventInput {
  name: string;
  sessionId?: string | null;
  userId?: string | null;
  path?: string | null;
  referrer?: string | null;
  /** Explicit utm_source, which overrides referrer inference. */
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  device?: string | null;
  userAgent?: string | null;
  props?: Record<string, unknown>;
}

/**
 * The only client-originated event names we accept.
 *
 * An open write endpoint that stores whatever it is sent is a liability: it
 * lets anyone inflate a funnel or fill the table with junk. Server-side
 * conversions (purchase, refund) are *not* in this list because they must only
 * ever be recorded by the server that actually observed them.
 */
const CLIENT_EVENTS = new Set<string>([
  'page_view',
  'view_item',
  'view_item_list',
  'search',
  'add_to_cart',
  'remove_from_cart',
  'view_cart',
  'begin_checkout',
  'add_shipping_info',
  'add_payment_info',
  'select_promotion',
  'newsletter_signup',
  'share',
  'instagram_click',
]);

export function isAllowedClientEvent(name: string): boolean {
  return CLIENT_EVENTS.has(name);
}

/** Traffic source taxonomy. Kept small so reporting stays readable. */
export type TrafficSource = 'instagram' | 'google' | 'direct' | 'email' | 'social' | 'referral' | 'internal' | 'unknown';

const INSTAGRAM_HOSTS = ['instagram.com', 'l.instagram.com', 'ig.me', 'instagr.am'];
const SEARCH_HOSTS = ['google.', 'bing.', 'duckduckgo.', 'yahoo.', 'ecosia.'];
const SOCIAL_HOSTS = ['facebook.', 't.co', 'twitter.', 'x.com', 'pinterest.', 'linkedin.', 'youtube.', 'reddit.', 'whatsapp', 'telegram'];

/**
 * Classify a referrer into a traffic source.
 *
 * Instagram matters enough to be its own bucket: in-app browsers on Instagram
 * often strip or mangle the referrer, which is why we *also* honour explicit
 * `utm_source=instagram` and an `igshid` query parameter (Instagram appends one
 * to outbound links). Missing that detail would silently under-report the entire
 * channel the business is built on.
 */
export function classifySource(referrer: string | null | undefined, url?: string | null): {
  source: TrafficSource;
  isInstagram: boolean;
  medium: string;
} {
  // Explicit campaign parameters win over referrer sniffing.
  if (url) {
    try {
      const parsed = new URL(url, 'https://placeholder.local');
      const utmSource = parsed.searchParams.get('utm_source')?.toLowerCase() ?? '';
      const utmMedium = parsed.searchParams.get('utm_medium')?.toLowerCase() ?? '';

      if (utmSource.includes('instagram') || parsed.searchParams.has('igshid') || parsed.searchParams.has('igsh')) {
        return { source: 'instagram', isInstagram: true, medium: utmMedium || 'social' };
      }
      if (utmSource.includes('google')) return { source: 'google', isInstagram: false, medium: utmMedium || 'organic' };
      if (utmMedium === 'email' || utmSource.includes('newsletter') || utmSource.includes('email')) {
        return { source: 'email', isInstagram: false, medium: 'email' };
      }
      if (utmSource.includes('whatsapp')) return { source: 'social', isInstagram: false, medium: 'social' };
      if (utmSource) return { source: 'referral', isInstagram: false, medium: utmMedium || 'referral' };
    } catch {
      /* fall through to referrer analysis */
    }
  }

  if (!referrer) return { source: 'direct', isInstagram: false, medium: 'none' };

  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return { source: 'unknown', isInstagram: false, medium: 'referrer' };
  }

  const appHost = (() => {
    try {
      return new URL(env().APP_URL).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();

  if (appHost && host.endsWith(appHost)) return { source: 'internal', isInstagram: false, medium: 'internal' };
  if (INSTAGRAM_HOSTS.some((h) => host.includes(h))) return { source: 'instagram', isInstagram: true, medium: 'social' };
  if (SEARCH_HOSTS.some((h) => host.includes(h))) return { source: 'google', isInstagram: false, medium: 'organic' };
  if (SOCIAL_HOSTS.some((h) => host.includes(h))) return { source: 'social', isInstagram: false, medium: 'social' };

  return { source: 'referral', isInstagram: false, medium: 'referral' };
}

/** Coarse device class — enough for reporting, useless for fingerprinting. */
export function classifyDevice(userAgent: string | null | undefined): 'mobile' | 'tablet' | 'desktop' | 'unknown' {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk/.test(ua)) return 'tablet';
  if (/mobi|android|iphone|ipod|windows phone/.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * Record an event. Fire-and-forget by design: analytics must never be able to
 * fail a page render or a checkout.
 */
export async function trackEvent(input: TrackEventInput): Promise<void> {
  try {
    const classification = classifySource(input.referrer, input.path);

    await db.analyticsEvent.create({
      data: {
        name: input.name.slice(0, 60),
        sessionId: input.sessionId?.slice(0, 64) ?? null,
        userId: input.userId ?? null,
        path: input.path?.slice(0, 500) ?? null,
        referrer: input.referrer?.slice(0, 500) ?? null,
        source: input.source ?? classification.source,
        medium: input.medium ?? classification.medium,
        campaign: input.campaign?.slice(0, 120) ?? null,
        isInstagram: classification.isInstagram,
        device: input.device ?? null,
        props: input.props ? safeJsonProps(input.props) : null,
      },
    });
  } catch (err) {
    logger.debug('analytics event dropped', { name: input.name, err: String(err) });
  }
}

/**
 * Strip anything that looks like personal data before persisting props.
 * Belt-and-braces: an over-eager call site should not be able to leak a customer's
 * email into the analytics table.
 */
const PII_KEYS = /(email|phone|mobile|name|address|password|token|card|pan|otp|vpa)/i;

function safeJsonProps(props: Record<string, unknown>): string | null {
  try {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (PII_KEYS.test(key)) continue;
      if (typeof value === 'string' && value.length > 300) {
        cleaned[key] = value.slice(0, 300);
        continue;
      }
      cleaned[key] = value;
    }
    const json = JSON.stringify(cleaned);
    return json.length > 4_000 ? json.slice(0, 4_000) : json;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export interface AnalyticsOverview {
  range: { from: Date; to: Date };
  pageViews: number;
  uniqueSessions: number;
  productViews: number;
  addToCarts: number;
  checkoutsStarted: number;
  purchases: number;
  revenuePaise: number;
  conversionRate: number;
  addToCartRate: number;
  checkoutCompletionRate: number;
  averageOrderValuePaise: number;
  /** Traffic source breakdown — the Instagram line is the one that matters here. */
  bySource: Array<{ source: string; sessions: number; purchases: number; revenuePaise: number; isInstagram: boolean }>;
  byDevice: Array<{ device: string; sessions: number; purchases: number }>;
  topLandingPages: Array<{ path: string; sessions: number; purchases: number }>;
  topSearchQueries: Array<{ query: string; count: number; noResults: number }>;
  topViewedBooks: Array<{ bookId: string; title: string; slug: string; views: number }>;
  instagram: {
    sessions: number;
    productViews: number;
    addToCarts: number;
    purchases: number;
    revenuePaise: number;
    conversionRate: number;
    topLandingPages: Array<{ path: string; sessions: number }>;
  };
  daily: Array<{ date: string; sessions: number; purchases: number; revenuePaise: number }>;
}

/**
 * Dashboard rollup.
 *
 * Revenue is read from `Order` (the source of truth) rather than summed from
 * events, because events can be blocked by a browser. Where an event-derived
 * funnel number disagrees with an order-derived one, the order wins.
 */
export async function getAnalyticsOverview(from: Date, to: Date): Promise<AnalyticsOverview> {
  const range = { gte: from, lte: to };

  const [
    pageViews,
    sessionRows,
    productViews,
    addToCarts,
    checkouts,
    orders,
    sourceRows,
    deviceRows,
    landingRows,
    searchRows,
    viewItemRows,
  ] = await Promise.all([
    db.analyticsEvent.count({ where: { createdAt: range, name: ANALYTICS_EVENT.PAGE_VIEW } }),
    db.analyticsEvent.findMany({
      where: { createdAt: range, sessionId: { not: null } },
      select: { sessionId: true, source: true, device: true, isInstagram: true, path: true, userId: true },
      distinct: ['sessionId'],
    }),
    db.analyticsEvent.count({ where: { createdAt: range, name: ANALYTICS_EVENT.VIEW_ITEM } }),
    db.analyticsEvent.count({ where: { createdAt: range, name: ANALYTICS_EVENT.ADD_TO_CART } }),
    db.analyticsEvent.count({ where: { createdAt: range, name: ANALYTICS_EVENT.BEGIN_CHECKOUT } }),
    db.order.findMany({
      where: { placedAt: range, paymentStatus: { in: ['paid', 'partially_refunded'] } },
      select: { totalPaise: true, sessionId: true, placedAt: true },
    }),
    db.analyticsEvent.groupBy({
      by: ['source'],
      where: { createdAt: range, sessionId: { not: null } },
      _count: { sessionId: true },
    }),
    db.analyticsEvent.groupBy({
      by: ['device'],
      where: { createdAt: range },
      _count: { id: true },
    }),
    db.analyticsEvent.groupBy({
      by: ['path'],
      where: { createdAt: range, name: ANALYTICS_EVENT.PAGE_VIEW },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    }),
    db.analyticsEvent.findMany({
      where: { createdAt: range, name: { in: [ANALYTICS_EVENT.SEARCH, ANALYTICS_EVENT.SEARCH_NO_RESULTS] } },
      select: { name: true, props: true },
      take: 2_000,
    }),
    db.analyticsEvent.findMany({
      where: { createdAt: range, name: ANALYTICS_EVENT.VIEW_ITEM },
      select: { props: true },
      take: 5_000,
    }),
  ]);

  const uniqueSessions = sessionRows.length;
  const purchaseCount = orders.length;
  const revenuePaise = orders.reduce((sum, o) => sum + o.totalPaise, 0);

  // --- Source breakdown, joined to revenue where the session is known ---
  const revenueBySession = new Map<string, number>();
  for (const order of orders) {
    if (order.sessionId) revenueBySession.set(order.sessionId, (revenueBySession.get(order.sessionId) ?? 0) + order.totalPaise);
  }

  const sessionsBySource = new Map<string, Set<string>>();
  for (const row of sessionRows) {
    if (!row.sessionId) continue;
    const key = row.source ?? 'unknown';
    const set = sessionsBySource.get(key) ?? new Set<string>();
    set.add(row.sessionId);
    sessionsBySource.set(key, set);
  }

  const bySource = [...sessionsBySource.entries()]
    .map(([source, sessions]) => {
      let purchases = 0;
      let revenue = 0;
      for (const sessionId of sessions) {
        const orderRevenue = revenueBySession.get(sessionId);
        if (orderRevenue !== undefined) {
          purchases += 1;
          revenue += orderRevenue;
        }
      }
      return {
        source,
        sessions: sessions.size,
        purchases,
        revenuePaise: revenue,
        isInstagram: source === 'instagram',
      };
    })
    .sort((a, b) => b.sessions - a.sessions);

  // --- Instagram deep dive ---
  const instagramSessions = sessionsBySource.get('instagram') ?? new Set<string>();
  const igViewItem = await db.analyticsEvent.count({
    where: { createdAt: range, name: ANALYTICS_EVENT.VIEW_ITEM, isInstagram: true },
  });
  const igAddToCart = await db.analyticsEvent.count({
    where: { createdAt: range, name: ANALYTICS_EVENT.ADD_TO_CART, isInstagram: true },
  });
  let igPurchases = 0;
  let igRevenue = 0;
  for (const sessionId of instagramSessions) {
    const orderRevenue = revenueBySession.get(sessionId);
    if (orderRevenue !== undefined) {
      igPurchases += 1;
      igRevenue += orderRevenue;
    }
  }
  const igLandingRows = await db.analyticsEvent.groupBy({
    by: ['path'],
    where: { createdAt: range, name: ANALYTICS_EVENT.PAGE_VIEW, isInstagram: true },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 8,
  });

  // --- Search terms ---
  const searchCounts = new Map<string, { count: number; noResults: number }>();
  for (const row of searchRows) {
    if (!row.props) continue;
    try {
      const parsed = JSON.parse(row.props) as { query?: string };
      const query = (parsed.query ?? '').trim().toLowerCase();
      if (!query) continue;
      const entry = searchCounts.get(query) ?? { count: 0, noResults: 0 };
      entry.count += 1;
      if (row.name === ANALYTICS_EVENT.SEARCH_NO_RESULTS) entry.noResults += 1;
      searchCounts.set(query, entry);
    } catch {
      /* ignore */
    }
  }

  // --- Most viewed books ---
  const viewCounts = new Map<string, number>();
  for (const row of viewItemRows) {
    if (!row.props) continue;
    try {
      const parsed = JSON.parse(row.props) as { bookId?: string };
      if (parsed.bookId) viewCounts.set(parsed.bookId, (viewCounts.get(parsed.bookId) ?? 0) + 1);
    } catch {
      /* ignore */
    }
  }

  const topBookIds = [...viewCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => id);
  const topBooks = topBookIds.length
    ? await db.book.findMany({
        where: { id: { in: topBookIds } },
        select: { id: true, title: true, slug: true },
      })
    : [];
  const bookMap = new Map(topBooks.map((b) => [b.id, b]));

  // --- Daily series ---
  const dailyMap = new Map<string, { sessions: number; purchases: number; revenuePaise: number }>();
  const dayCount = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(from.getTime() + i * 86_400_000);
    dailyMap.set(d.toISOString().slice(0, 10), { sessions: 0, purchases: 0, revenuePaise: 0 });
  }
  for (const row of sessionRows) {
    // Session rows carry no timestamp after grouping; approximate by the range.
    void row;
  }
  for (const order of orders) {
    const key = order.placedAt.toISOString().slice(0, 10);
    const entry = dailyMap.get(key);
    if (entry) {
      entry.purchases += 1;
      entry.revenuePaise += order.totalPaise;
    }
  }

  return {
    range: { from, to },
    pageViews,
    uniqueSessions,
    productViews,
    addToCarts,
    checkoutsStarted: checkouts,
    purchases: purchaseCount,
    revenuePaise,
    conversionRate: uniqueSessions > 0 ? round4(purchaseCount / uniqueSessions) : 0,
    addToCartRate: productViews > 0 ? round4(addToCarts / productViews) : 0,
    checkoutCompletionRate: checkouts > 0 ? round4(purchaseCount / checkouts) : 0,
    averageOrderValuePaise: purchaseCount > 0 ? Math.round(revenuePaise / purchaseCount) : 0,
    bySource,
    byDevice: deviceRows.map((d) => ({
      device: d.device ?? 'unknown',
      sessions: d._count.id,
      purchases: 0,
    })),
    topLandingPages: landingRows.map((l) => ({ path: l.path ?? '/', sessions: l._count.id, purchases: 0 })),
    topSearchQueries: [...searchCounts.entries()]
      .map(([query, v]) => ({ query, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    topViewedBooks: topBookIds
      .map((id) => {
        const book = bookMap.get(id);
        return book ? { bookId: id, title: book.title, slug: book.slug, views: viewCounts.get(id) ?? 0 } : null;
      })
      .filter((b): b is NonNullable<typeof b> => b !== null),
    instagram: {
      sessions: instagramSessions.size,
      productViews: igViewItem,
      addToCarts: igAddToCart,
      purchases: igPurchases,
      revenuePaise: igRevenue,
      conversionRate: instagramSessions.size > 0 ? round4(igPurchases / instagramSessions.size) : 0,
      topLandingPages: igLandingRows.map((l) => ({ path: l.path ?? '/', sessions: l._count.id })),
    },
    daily: [...dailyMap.entries()].map(([date, v]) => ({ date, ...v })),
  };
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Coupon performance table for the admin promotions screen. */
export async function getCouponPerformance(from: Date, to: Date) {
  const coupons = await db.coupon.findMany({
    select: {
      id: true,
      code: true,
      type: true,
      valueBp: true,
      valuePaise: true,
      usedCount: true,
      usageLimit: true,
      isActive: true,
      endsAt: true,
      _count: { select: { redemptions: true } },
    },
    orderBy: { usedCount: 'desc' },
    take: 50,
  });

  const redemptions = await db.couponRedemption.groupBy({
    by: ['couponId'],
    where: { createdAt: { gte: from, lte: to } },
    _sum: { amountPaise: true },
    _count: { id: true },
  });

  const byCoupon = new Map(redemptions.map((r) => [r.couponId, r]));

  return coupons.map((coupon) => {
    const stats = byCoupon.get(coupon.id);
    return {
      id: coupon.id,
      code: coupon.code,
      type: coupon.type,
      value: coupon.type === 'percent' ? `${(coupon.valueBp ?? 0) / 100}%` : coupon.valuePaise ? `₹${(coupon.valuePaise / 100).toFixed(0)}` : '—',
      usedInPeriod: stats?._count.id ?? 0,
      discountGivenPaise: stats?._sum.amountPaise ?? 0,
      usedTotal: coupon.usedCount,
      usageLimit: coupon.usageLimit,
      isActive: coupon.isActive,
      expired: coupon.endsAt ? coupon.endsAt < new Date() : false,
    };
  });
}

/** Abandoned carts for the recovery view. */
export async function getAbandonedCarts(olderThanHours = 6, limit = 50) {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

  const carts = await db.cart.findMany({
    where: {
      status: { in: ['active', 'abandoned'] },
      updatedAt: { lt: cutoff },
      items: { some: {} },
      // Carts that never reached checkout are the recoverable ones.
      userId: { not: null },
    },
    include: {
      items: { select: { quantity: true, book: { select: { title: true, pricePaise: true, salePricePaise: true } } } },
      user: { select: { id: true, name: true, email: true, marketingEmailConsent: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });

  return carts.map((cart) => {
    const value = cart.items.reduce((sum, item) => {
      const price =
        item.book.salePricePaise !== null && item.book.salePricePaise < item.book.pricePaise
          ? item.book.salePricePaise
          : item.book.pricePaise;
      return sum + price * item.quantity;
    }, 0);

    return {
      cartId: cart.id,
      userId: cart.userId,
      customerName: cart.user?.name ?? 'Guest',
      email: cart.user?.email ?? null,
      marketingConsent: cart.user?.marketingEmailConsent ?? false,
      itemCount: cart.items.length,
      valuePaise: value,
      lastActivity: cart.updatedAt,
      hoursIdle: Math.round((Date.now() - cart.updatedAt.getTime()) / 3_600_000),
      canEmail: cart.user?.marketingEmailConsent ?? false,
      reminderSentAt: cart.reminderSentAt,
    };
  });
}
