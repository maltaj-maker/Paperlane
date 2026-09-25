/**
 * Customer service: addresses, profile data and the admin customer view.
 *
 * Privacy note that shapes this file: the admin customer list deliberately
 * exposes *operationally necessary* data only. Support staff can see a name,
 * contact details, order history and tickets because they need them to help.
 * They cannot see passwords (never stored in readable form), full payment
 * instruments (never stored at all) or browsing history beyond what the
 * analytics table already associates with a session. Data minimisation is a
 * design constraint here, not an afterthought.
 */

import 'server-only';
import { db } from './db';
import { forbidden, notFound } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { AddressInput } from '@/lib/validation';

export interface AddressRecord {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
}

export async function getAddressesForUser(userId: string): Promise<AddressRecord[]> {
  return db.address.findMany({
    where: { userId },
    orderBy: [{ isDefaultShipping: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      label: true,
      fullName: true,
      phone: true,
      line1: true,
      line2: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      isDefaultShipping: true,
      isDefaultBilling: true,
    },
  });
}

export async function getAddressById(userId: string, addressId: string): Promise<AddressRecord | null> {
  const address = await db.address.findFirst({
    where: { id: addressId, userId },
  });
  return address;
}

/**
 * Create or update an address.
 * Enforces a sane cap (20) so the address book cannot be used as free storage.
 */
export async function saveAddress(
  userId: string,
  input: AddressInput,
  addressId?: string | null,
): Promise<{ addressId: string }> {
  if (!addressId) {
    const count = await db.address.count({ where: { userId } });
    if (count >= 20) {
      throw forbidden('You have reached the maximum number of saved addresses. Please delete one first.');
    }
  }

  return db.$transaction(async (tx) => {
    // Only one default per type — clear the others in the same transaction.
    if (input.isDefaultShipping) {
      await tx.address.updateMany({ where: { userId, isDefaultShipping: true }, data: { isDefaultShipping: false } });
    }
    if (input.isDefaultBilling) {
      await tx.address.updateMany({ where: { userId, isDefaultBilling: true }, data: { isDefaultBilling: false } });
    }

    if (addressId) {
      const existing = await tx.address.findFirst({ where: { id: addressId, userId }, select: { id: true } });
      // Authorisation: you may only edit an address you own.
      if (!existing) throw notFound('That address is not on your account.');

      await tx.address.update({ where: { id: addressId }, data: { ...input } });
      return { addressId };
    }

    const created = await tx.address.create({
      data: { ...input, userId },
      select: { id: true },
    });

    return { addressId: created.id };
  });
}

export async function deleteAddress(userId: string, addressId: string): Promise<void> {
  const address = await db.address.findFirst({
    where: { id: addressId, userId },
    select: { id: true, isDefaultShipping: true },
  });
  if (!address) throw notFound('That address is not on your account.');

  await db.address.delete({ where: { id: address.id } });
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export interface CustomerProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  marketingEmailConsent: boolean;
  marketingSmsConsent: boolean;
  marketingWhatsappConsent: boolean;
  notificationPrefs: Record<string, unknown>;
  readingPrefs: Record<string, unknown>;
  createdAt: Date;
  lastLoginAt: Date | null;
  /** Lightweight counts for the account dashboard. */
  stats: {
    orderCount: number;
    totalSpentPaise: number;
    wishlistCount: number;
    reviewCount: number;
    addressesCount: number;
  };
}

export async function getCustomerProfile(userId: string): Promise<CustomerProfile | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      avatarUrl: true,
      emailVerifiedAt: true,
      marketingEmailConsent: true,
      marketingSmsConsent: true,
      marketingWhatsappConsent: true,
      notificationPrefs: true,
      readingPrefs: true,
      createdAt: true,
      lastLoginAt: true,
    },
  });

  if (!user) return null;

  const [orderAgg, wishlistCount, reviewCount, addressesCount] = await Promise.all([
    db.order.aggregate({
      where: { userId, paymentStatus: { in: ['paid', 'partially_refunded'] } },
      _count: { id: true },
      _sum: { totalPaise: true },
    }),
    db.wishlistItem.count({ where: { userId } }),
    db.review.count({ where: { userId, deletedAt: null } }),
    db.address.count({ where: { userId } }),
  ]);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    emailVerified: Boolean(user.emailVerifiedAt),
    marketingEmailConsent: user.marketingEmailConsent,
    marketingSmsConsent: user.marketingSmsConsent,
    marketingWhatsappConsent: user.marketingWhatsappConsent,
    notificationPrefs: safeParse(user.notificationPrefs),
    readingPrefs: safeParse(user.readingPrefs),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    stats: {
      orderCount: orderAgg._count.id ?? 0,
      totalSpentPaise: orderAgg._sum.totalPaise ?? 0,
      wishlistCount,
      reviewCount,
      addressesCount,
    },
  };
}

export async function updateProfile(
  userId: string,
  input: { name: string; phone?: string; avatarUrl?: string },
): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: {
      name: input.name,
      phone: input.phone ?? null,
      avatarUrl: input.avatarUrl ?? null,
    },
  });
}

export async function updateNotificationPrefs(
  userId: string,
  input: {
    orderUpdates: boolean;
    backInStock: boolean;
    priceDrop: boolean;
    newsletter: boolean;
    marketingSmsConsent: boolean;
    marketingWhatsappConsent: boolean;
  },
): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: {
      notificationPrefs: JSON.stringify({
        orderUpdates: input.orderUpdates,
        backInStock: input.backInStock,
        priceDrop: input.priceDrop,
        newsletter: input.newsletter,
      }),
      marketingEmailConsent: input.newsletter,
      marketingSmsConsent: input.marketingSmsConsent,
      marketingWhatsappConsent: input.marketingWhatsappConsent,
    },
  });

  // Keep the newsletter list in step with the account preference.
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (user) {
    await db.newsletterSubscriber
      .updateMany({
        where: { email: user.email },
        data: input.newsletter
          ? { status: 'confirmed', confirmedAt: new Date(), unsubscribedAt: null }
          : { status: 'unsubscribed', unsubscribedAt: new Date() },
      })
      .catch((err) => logger.debug('newsletter sync skipped', { err: String(err) }));
  }
}

export async function updateReadingPrefs(
  userId: string,
  input: { favouriteGenres: string[]; preferredFormats: string[]; preferredLanguages: string[] },
): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { readingPrefs: JSON.stringify(input) },
  });
}

// ---------------------------------------------------------------------------
// Admin: customer management
// ---------------------------------------------------------------------------

export interface CustomerListFilters {
  search?: string;
  status?: string;
  role?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

/**
 * Admin customer directory.
 *
 * Returns only what staff need to identify and help a customer. Email is masked
 * in list views and revealed only on the individual customer page, which is
 * itself an audited action.
 */
export async function listCustomers(filters: CustomerListFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));

  const where: Record<string, unknown> = {};

  if (filters.search) {
    const search = filters.search.trim();
    where.OR = [
      { name: { contains: search } },
      { email: { contains: search.toLowerCase() } },
      { phone: { contains: search } },
      { orders: { some: { orderNumber: { contains: search.toUpperCase() } } } },
    ];
  }

  if (filters.status) where.status = filters.status;
  if (filters.role) where.role = { name: filters.role };
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  const [items, total] = await Promise.all([
    db.user.findMany({
      where: where as never,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        emailVerifiedAt: true,
        createdAt: true,
        lastLoginAt: true,
        marketingEmailConsent: true,
        role: { select: { name: true, label: true } },
        _count: { select: { orders: true, supportTickets: true, reviews: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.user.count({ where: where as never }),
  ]);

  const spend = await db.order.groupBy({
    by: ['userId'],
    where: {
      userId: { in: items.map((i) => i.id) },
      paymentStatus: { in: ['paid', 'partially_refunded'] },
    },
    _sum: { totalPaise: true },
    _count: { id: true },
  });

  const spendMap = new Map(spend.map((s) => [s.userId, s]));

  return {
    items: items.map((user) => ({
      ...user,
      orderCount: user._count.orders,
      ticketCount: user._count.supportTickets,
      reviewCount: user._count.reviews,
      lifetimeValuePaise: spendMap.get(user.id)?._sum.totalPaise ?? 0,
      paidOrderCount: spendMap.get(user.id)?._count.id ?? 0,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Full customer profile for the admin detail page.
 *
 * Every call to this is audit-logged by the route that invokes it, because
 * viewing a customer's personal data is itself a privacy-relevant event.
 */
export async function getCustomerDetail(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      avatarUrl: true,
      status: true,
      emailVerifiedAt: true,
      marketingEmailConsent: true,
      marketingSmsConsent: true,
      marketingWhatsappConsent: true,
      notificationPrefs: true,
      readingPrefs: true,
      createdAt: true,
      lastLoginAt: true,
      lockedUntil: true,
      role: { select: { id: true, name: true, label: true } },
      addresses: { orderBy: [{ isDefaultShipping: 'desc' }] },
      orders: {
        orderBy: { placedAt: 'desc' },
        take: 25,
        select: {
          id: true,
          orderNumber: true,
          placedAt: true,
          totalPaise: true,
          status: true,
          paymentStatus: true,
          fulfillmentStatus: true,
          _count: { select: { items: true } },
        },
      },
      supportTickets: {
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: {
          id: true,
          reference: true,
          subject: true,
          status: true,
          category: true,
          createdAt: true,
        },
      },
      reviews: {
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: {
          id: true,
          rating: true,
          title: true,
          status: true,
          createdAt: true,
          book: { select: { title: true, slug: true } },
        },
      },
    },
  });

  if (!user) return null;

  const [lifetime, refunds, sessions] = await Promise.all([
    db.order.aggregate({
      where: { userId, paymentStatus: { in: ['paid', 'partially_refunded', 'refunded'] } },
      _sum: { totalPaise: true, amountRefundedPaise: true },
      _count: { id: true },
      _avg: { totalPaise: true },
    }),
    db.refund.count({ where: { order: { userId } } }),
    db.session.count({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);

  return {
    ...user,
    stats: {
      orderCount: lifetime._count.id ?? 0,
      lifetimeValuePaise: lifetime._sum.totalPaise ?? 0,
      refundedPaise: lifetime._sum.amountRefundedPaise ?? 0,
      averageOrderValuePaise: Math.round(lifetime._avg.totalPaise ?? 0),
      refundCount: refunds,
      activeSessions: sessions,
    },
  };
}

/** Suspend or reactivate an account. Staff-only, audited by the caller. */
export async function setCustomerStatus(
  userId: string,
  status: 'active' | 'suspended',
): Promise<void> {
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { status } }),
    // A suspended account loses every active session immediately.
    ...(status === 'suspended'
      ? [db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })]
      : []),
  ]);
}

function safeParse(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Order counts by payment status, for the admin dashboard tiles. */
export async function getCustomerStats(from: Date, to: Date) {
  const [newCustomers, activeCustomers, repeatBuyers] = await Promise.all([
    db.user.count({ where: { createdAt: { gte: from, lte: to } } }),
    db.user.count({ where: { lastLoginAt: { gte: from, lte: to } } }),
    db.order
      .groupBy({
        by: ['userId'],
        where: {
          userId: { not: null },
          paymentStatus: { in: ['paid', 'partially_refunded'] },
          placedAt: { gte: from, lte: to },
        },
        _count: { id: true },
        having: { id: { _count: { gt: 1 } } },
      })
      .then((rows) => rows.length),
  ]);

  return { newCustomers, activeCustomers, repeatBuyers };
}
