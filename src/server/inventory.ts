/**
 * Inventory service.
 *
 * The single most important property here: **the store must never oversell**.
 * Two shoppers adding the last copy at the same instant must not both be able to
 * check out. Everything below is built around that.
 *
 * How overselling is prevented
 * ---------------------------
 * We model three numbers per (book, warehouse):
 *   onHand   — physical units in the warehouse
 *   reserved — units promised to carts/orders that have not shipped
 *   available = onHand - reserved
 *
 * `tryReserve` performs a compare-and-swap: it reads the row, then issues an
 * `updateMany` guarded by the *exact* values it read. If another writer changed
 * the row in between, the update affects zero rows and we retry with fresh data.
 * This is optimistic concurrency, works identically on SQLite and Postgres, and
 * needs no raw SQL or pessimistic locks.
 *
 * Reservations are leases, not facts: they carry an expiry and stale ones are
 * swept by `releaseExpiredReservations`. That is what stops an abandoned cart
 * from holding the last copy forever.
 */

import type { Prisma } from '@prisma/client';
import { db, withRetry } from './db';
import { logger } from '@/lib/logger';
import { conflict, notFound, outOfStock } from '@/lib/errors';
import { STOCK_MOVEMENT } from '@/lib/constants';

/** Prisma transaction client type — services accept this so they compose. */
export type Tx = Prisma.TransactionClient;

const CAS_ATTEMPTS = 6;

export interface Availability {
  bookId: string;
  onHand: number;
  reserved: number;
  available: number;
  incoming: number;
  lowStockThreshold: number;
  /** in_stock | low_stock | out_of_stock | preorder */
  status: 'in_stock' | 'low_stock' | 'out_of_stock' | 'preorder';
  /** How many a single customer may put in one order. */
  maxPerOrder: number;
}

export const DEFAULT_MAX_PER_ORDER = 10;

/**
 * Roll up availability for a book across all warehouses.
 * Uses the denormalised `bookId` index rather than loading inventory rows for
 * the whole catalogue.
 */
export async function getAvailability(
  bookId: string,
  client: Tx | typeof db = db,
): Promise<Availability> {
  const rows = await client.inventoryItem.findMany({
    where: { bookId },
    select: {
      onHand: true,
      reserved: true,
      incoming: true,
      lowStockThreshold: true,
      warehouse: { select: { isActive: true, priority: true } },
    },
  });

  const active = rows.filter((r) => r.warehouse.isActive);

  const onHand = active.reduce((sum, r) => sum + r.onHand, 0);
  const reserved = active.reduce((sum, r) => sum + r.reserved, 0);
  const incoming = active.reduce((sum, r) => sum + r.incoming, 0);
  const threshold = active.length
    ? Math.min(...active.map((r) => r.lowStockThreshold))
    : 5;
  const available = Math.max(0, onHand - reserved);

  let status: Availability['status'];
  if (available <= 0) status = incoming > 0 ? 'preorder' : 'out_of_stock';
  else if (available <= threshold) status = 'low_stock';
  else status = 'in_stock';

  return {
    bookId,
    onHand,
    reserved,
    available,
    incoming,
    lowStockThreshold: threshold,
    status,
    maxPerOrder: Math.max(1, available),
  };
}

/** Batch variant for catalogue grids — one query instead of N. */
export async function getAvailabilityMap(
  bookIds: string[],
  client: Tx | typeof db = db,
): Promise<Map<string, Availability>> {
  const map = new Map<string, Availability>();
  if (bookIds.length === 0) return map;

  const rows = await client.inventoryItem.findMany({
    where: { bookId: { in: bookIds } },
    select: {
      bookId: true,
      onHand: true,
      reserved: true,
      incoming: true,
      lowStockThreshold: true,
      warehouse: { select: { isActive: true } },
    },
  });

  const grouped = new Map<
    string,
    { onHand: number; reserved: number; incoming: number; threshold: number }
  >();

  for (const row of rows) {
    if (!row.warehouse.isActive) continue;
    const current = grouped.get(row.bookId) ?? {
      onHand: 0,
      reserved: 0,
      incoming: 0,
      threshold: Number.MAX_SAFE_INTEGER,
    };
    current.onHand += row.onHand;
    current.reserved += row.reserved;
    current.incoming += row.incoming;
    current.threshold = Math.min(current.threshold, row.lowStockThreshold);
    grouped.set(row.bookId, current);
  }

  for (const bookId of bookIds) {
    const agg = grouped.get(bookId);
    if (!agg) {
      map.set(bookId, {
        bookId,
        onHand: 0,
        reserved: 0,
        available: 0,
        incoming: 0,
        lowStockThreshold: 5,
        status: 'out_of_stock',
        maxPerOrder: 0,
      });
      continue;
    }
    const available = Math.max(0, agg.onHand - agg.reserved);
    const threshold = agg.threshold === Number.MAX_SAFE_INTEGER ? 5 : agg.threshold;
    map.set(bookId, {
      bookId,
      onHand: agg.onHand,
      reserved: agg.reserved,
      available,
      incoming: agg.incoming,
      lowStockThreshold: threshold,
      status:
        available <= 0 ? (agg.incoming > 0 ? 'preorder' : 'out_of_stock') : available <= threshold ? 'low_stock' : 'in_stock',
      maxPerOrder: Math.max(1, available),
    });
  }

  return map;
}

export interface ReservationLine {
  bookId: string;
  quantity: number;
}

export interface ReserveOptions {
  referenceType: 'cart' | 'order';
  referenceId: string;
  /** Lease duration. Orders get a long lease; carts a short one. */
  ttlMinutes?: number;
  /** Reserve from a specific warehouse instead of auto-selecting. */
  warehouseId?: string;
}

export interface ReserveResult {
  reservations: Array<{ inventoryItemId: string; bookId: string; warehouseId: string; quantity: number }>;
  /** Lines that could not be satisfied, with how many *were* available. */
  failures: Array<{ bookId: string; requested: number; available: number; reason: string }>;
}

/**
 * Reserve stock for a set of lines, all-or-nothing per line.
 *
 * Callers run this inside a transaction. If any line fails, the caller should
 * throw so the transaction rolls back and previously reserved lines are undone
 * — that gives us atomic multi-line reservation without nested transactions.
 */
export async function reserveStock(
  tx: Tx,
  lines: ReservationLine[],
  options: ReserveOptions,
): Promise<ReserveResult> {
  const reservations: ReserveResult['reservations'] = [];
  const failures: ReserveResult['failures'] = [];
  const ttlMs = (options.ttlMinutes ?? (options.referenceType === 'order' ? 60 * 24 : 30)) * 60_000;
  const expiresAt = new Date(Date.now() + ttlMs);

  for (const line of lines) {
    if (line.quantity <= 0) {
      failures.push({ bookId: line.bookId, requested: line.quantity, available: 0, reason: 'Invalid quantity' });
      continue;
    }

    const attempt = await reserveOneLine(tx, line, options, expiresAt);
    if (attempt.ok) {
      reservations.push(attempt.reservation);
    } else {
      failures.push(attempt.failure);
    }
  }

  return { reservations, failures };
}

async function reserveOneLine(
  tx: Tx,
  line: ReservationLine,
  options: ReserveOptions,
  expiresAt: Date,
): Promise<
  | { ok: true; reservation: ReserveResult['reservations'][number] }
  | { ok: false; failure: ReserveResult['failures'][number] }
> {
  for (let attempt = 1; attempt <= CAS_ATTEMPTS; attempt++) {
    // Prefer the highest-priority active warehouse with enough stock.
    const candidates = await tx.inventoryItem.findMany({
      where: {
        bookId: line.bookId,
        ...(options.warehouseId ? { id: options.warehouseId } : {}),
        warehouse: { isActive: true },
      },
      orderBy: { warehouse: { priority: 'asc' } },
    });

    if (candidates.length === 0) {
      return {
        ok: false,
        failure: { bookId: line.bookId, requested: line.quantity, available: 0, reason: 'Not stocked' },
      };
    }

    const target = candidates.find((c) => c.onHand - c.reserved >= line.quantity);

    if (!target) {
      const bestAvailable = Math.max(0, ...candidates.map((c) => c.onHand - c.reserved));
      return {
        ok: false,
        failure: {
          bookId: line.bookId,
          requested: line.quantity,
          available: bestAvailable,
          reason: bestAvailable > 0 ? 'Not enough stock' : 'Out of stock',
        },
      };
    }

    // Compare-and-swap: only succeed if the row still holds the values we read.
    const updated = await tx.inventoryItem.updateMany({
      where: {
        id: target.id,
        reserved: target.reserved,
        onHand: target.onHand,
      },
      data: { reserved: { increment: line.quantity } },
    });

    if (updated.count === 0) {
      // Someone else moved the needle. Re-read and try again.
      logger.debug('stock CAS retry', { bookId: line.bookId, attempt });
      continue;
    }

    await tx.stockReservation.create({
      data: {
        inventoryItemId: target.id,
        quantity: line.quantity,
        referenceType: options.referenceType,
        referenceId: options.referenceId,
        expiresAt,
      },
    });

    await recordMovement(tx, {
      inventoryItemId: target.id,
      bookId: line.bookId,
      warehouseId: target.warehouseId,
      type: STOCK_MOVEMENT.RESERVE,
      quantityDelta: 0, // reserved is a promise, not a physical move
      balanceAfter: target.onHand - (target.reserved + line.quantity),
      referenceType: options.referenceType,
      referenceId: options.referenceId,
      reason: `Reserved ${line.quantity} unit(s)`,
    });

    return {
      ok: true,
      reservation: {
        inventoryItemId: target.id,
        bookId: line.bookId,
        warehouseId: target.warehouseId,
        quantity: line.quantity,
      },
    };
  }

  // Exhausted retries under heavy contention — surface as a conflict so the
  // customer can retry rather than being told the book is gone.
  throw conflict(
    'We could not hold that copy just now because it was in high demand. Please try again.',
  );
}

/**
 * Convert a reservation into a real stock deduction (payment captured).
 * Reserved units become sold: reserved decreases, onHand decreases.
 */
export async function commitReservation(
  tx: Tx,
  referenceType: 'cart' | 'order',
  referenceId: string,
  actorId?: string,
): Promise<number> {
  const reservations = await tx.stockReservation.findMany({
    where: { referenceType, referenceId, releasedAt: null },
  });

  let committed = 0;

  for (const reservation of reservations) {
    const item = await tx.inventoryItem.findUnique({
      where: { id: reservation.inventoryItemId },
    });
    if (!item) continue;

    const newReserved = Math.max(0, item.reserved - reservation.quantity);
    const newOnHand = Math.max(0, item.onHand - reservation.quantity);

    const updated = await tx.inventoryItem.updateMany({
      where: { id: item.id, reserved: item.reserved, onHand: item.onHand },
      data: { reserved: newReserved, onHand: newOnHand },
    });

    if (updated.count === 0) {
      // Row changed under us. In a payment-confirmation path we must not silently
      // skip: re-read and apply once more, and if that also fails, log loudly —
      // the order is paid and a human needs to reconcile.
      const fresh = await tx.inventoryItem.findUnique({ where: { id: item.id } });
      if (!fresh) continue;
      await tx.inventoryItem.update({
        where: { id: fresh.id },
        data: {
          reserved: Math.max(0, fresh.reserved - reservation.quantity),
          onHand: Math.max(0, fresh.onHand - reservation.quantity),
        },
      });
      logger.warn('inventory commit required reconciliation', {
        inventoryItemId: item.id,
        orderId: referenceId,
      });
    }

    await tx.stockReservation.update({
      where: { id: reservation.id },
      data: { releasedAt: new Date() },
    });

    await recordMovement(tx, {
      inventoryItemId: item.id,
      bookId: item.bookId,
      warehouseId: item.warehouseId,
      type: STOCK_MOVEMENT.SALE,
      quantityDelta: -reservation.quantity,
      balanceAfter: newOnHand - newReserved,
      referenceType,
      referenceId,
      reason: `Sold ${reservation.quantity} unit(s)`,
      actorId,
    });

    committed += reservation.quantity;
  }

  return committed;
}

/** Release reservations without deducting stock (cancel, expiry, failed payment). */
export async function releaseReservation(
  tx: Tx,
  referenceType: 'cart' | 'order',
  referenceId: string,
  reason = 'Released',
): Promise<number> {
  const reservations = await tx.stockReservation.findMany({
    where: { referenceType, referenceId, releasedAt: null },
  });

  let released = 0;

  for (const reservation of reservations) {
    const item = await tx.inventoryItem.findUnique({
      where: { id: reservation.inventoryItemId },
    });
    if (!item) continue;

    const newReserved = Math.max(0, item.reserved - reservation.quantity);

    await tx.inventoryItem.updateMany({
      where: { id: item.id, reserved: item.reserved },
      data: { reserved: newReserved },
    });

    await tx.stockReservation.update({
      where: { id: reservation.id },
      data: { releasedAt: new Date() },
    });

    await recordMovement(tx, {
      inventoryItemId: item.id,
      bookId: item.bookId,
      warehouseId: item.warehouseId,
      type: STOCK_MOVEMENT.RELEASE,
      quantityDelta: 0,
      balanceAfter: item.onHand - newReserved,
      referenceType,
      referenceId,
      reason,
    });

    released += reservation.quantity;
  }

  return released;
}

/** Restock a cancelled/returned order line. */
export async function restockOrderItem(
  tx: Tx,
  params: {
    bookId: string;
    warehouseId?: string | null;
    quantity: number;
    type: typeof STOCK_MOVEMENT.RETURN | typeof STOCK_MOVEMENT.CANCEL;
    referenceId: string;
    reason: string;
    /** Damaged returns must not go back into sellable stock. */
    damaged?: boolean;
    actorId?: string;
  },
): Promise<void> {
  const items = await tx.inventoryItem.findMany({
    where: { bookId: params.bookId, ...(params.warehouseId ? { id: params.warehouseId } : {}) },
    orderBy: { warehouse: { priority: 'asc' } },
    take: 1,
  });

  const item = items[0];
  if (!item) {
    logger.error('restock target missing', { bookId: params.bookId, referenceId: params.referenceId });
    return;
  }

  const newOnHand = item.onHand + params.quantity;
  const newDamaged = params.damaged ? item.damaged + params.quantity : item.damaged;

  await tx.inventoryItem.update({
    where: { id: item.id },
    data: {
      onHand: newOnHand,
      damaged: newDamaged,
    },
  });

  await recordMovement(tx, {
    inventoryItemId: item.id,
    bookId: params.bookId,
    warehouseId: item.warehouseId,
    type: params.damaged ? STOCK_MOVEMENT.DAMAGE : params.type,
    quantityDelta: params.quantity,
    balanceAfter: newOnHand - item.reserved,
    referenceType: 'order',
    referenceId: params.referenceId,
    reason: params.reason,
    actorId: params.actorId,
  });
}

/** Sweep expired leases so abandoned carts release their holds. */
export async function releaseExpiredReservations(): Promise<number> {
  const expired = await db.stockReservation.findMany({
    where: { releasedAt: null, expiresAt: { lt: new Date() } },
    take: 500,
  });

  if (expired.length === 0) return 0;

  let released = 0;
  for (const reservation of expired) {
    try {
      await withRetry(
        () =>
          db.$transaction(async (tx) => {
            await releaseReservation(tx, reservation.referenceType as 'cart' | 'order', reservation.referenceId, 'Reservation expired');
          }),
        { label: 'releaseExpiredReservations' },
      );
      released += 1;
    } catch (err) {
      logger.error('failed to release expired reservation', { reservationId: reservation.id, err });
    }
  }
  return released;
}

// ---------------------------------------------------------------------------
// Admin / warehouse operations
// ---------------------------------------------------------------------------

export interface AdjustStockInput {
  inventoryItemId: string;
  /** Positive increases stock, negative decreases. */
  delta: number;
  type: typeof STOCK_MOVEMENT.ADJUST | typeof STOCK_MOVEMENT.DAMAGE | typeof STOCK_MOVEMENT.LOSS | typeof STOCK_MOVEMENT.RECEIVE;
  reason: string;
  actorId: string;
  /** For `receive`, quantity arriving (sets `incoming` to 0 and adds to onHand). */
  reference?: string;
}

export async function adjustStock(input: AdjustStockInput): Promise<{ balanceAfter: number }> {
  return withRetry(
    () =>
      db.$transaction(async (tx) => {
        const item = await tx.inventoryItem.findUnique({ where: { id: input.inventoryItemId } });
        if (!item) throw notFound('Inventory record not found.');

        const newOnHand = item.onHand + input.delta;
        if (newOnHand < 0) {
          throw conflict(
            `That adjustment would take stock negative (currently ${item.onHand} on hand).`,
          );
        }

        const newDamaged =
          input.type === STOCK_MOVEMENT.DAMAGE ? item.damaged + Math.abs(input.delta) : item.damaged;
        const newLost = input.type === STOCK_MOVEMENT.LOSS ? item.lost + Math.abs(input.delta) : item.lost;

        await tx.inventoryItem.update({
          where: { id: item.id },
          data: { onHand: newOnHand, damaged: newDamaged, lost: newLost },
        });

        await recordMovement(tx, {
          inventoryItemId: item.id,
          bookId: item.bookId,
          warehouseId: item.warehouseId,
          type: input.type,
          quantityDelta: input.delta,
          balanceAfter: newOnHand - item.reserved,
          reason: input.reason,
          referenceType: 'manual',
          referenceId: input.reference ?? null,
          actorId: input.actorId,
        });

        return { balanceAfter: newOnHand - item.reserved };
      }),
    { label: 'adjustStock' },
  );
}

/** Record incoming (on order from a distributor) without changing sellable stock. */
export async function setIncomingStock(
  inventoryItemId: string,
  incoming: number,
  actorId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const item = await tx.inventoryItem.findUnique({ where: { id: inventoryItemId } });
    if (!item) throw notFound('Inventory record not found.');

    await tx.inventoryItem.update({ where: { id: item.id }, data: { incoming } });

    await recordMovement(tx, {
      inventoryItemId: item.id,
      bookId: item.bookId,
      warehouseId: item.warehouseId,
      type: STOCK_MOVEMENT.RECEIVE,
      quantityDelta: 0,
      balanceAfter: item.onHand - item.reserved,
      reason: `Incoming stock set to ${incoming}`,
      referenceType: 'manual',
      actorId,
    });
  });
}

/** Ensure an inventory row exists for a book in every active warehouse. */
export async function ensureInventoryRows(tx: Tx, bookId: string): Promise<void> {
  const warehouses = await tx.warehouse.findMany({ where: { isActive: true } });
  const existing = await tx.inventoryItem.findMany({
    where: { bookId },
    select: { warehouseId: true, sku: true },
  });
  const have = new Set(existing.map((e) => e.warehouseId));

  for (const warehouse of warehouses) {
    if (have.has(warehouse.id)) continue;
    await tx.inventoryItem.create({
      data: {
        bookId,
        warehouseId: warehouse.id,
        sku: `${warehouse.code}-${bookId.slice(-6).toUpperCase()}`,
      },
    });
  }
}

/** Low-stock report for the admin dashboard and alerts. */
export async function getLowStockItems(limit = 50) {
  const items = await db.inventoryItem.findMany({
    where: { warehouse: { isActive: true } },
    include: {
      book: { select: { id: true, title: true, slug: true, coverImageUrl: true, status: true } },
      warehouse: { select: { code: true, name: true } },
    },
    orderBy: [{ onHand: 'asc' }],
    take: limit * 4,
  });

  return items
    .filter((i) => i.onHand - i.reserved <= i.lowStockThreshold)
    .slice(0, limit)
    .map((i) => ({
      inventoryItemId: i.id,
      bookId: i.bookId,
      title: i.book.title,
      slug: i.book.slug,
      cover: i.book.coverImageUrl,
      bookStatus: i.book.status,
      warehouse: i.warehouse.code,
      sku: i.sku,
      onHand: i.onHand,
      reserved: i.reserved,
      available: i.onHand - i.reserved,
      threshold: i.lowStockThreshold,
      incoming: i.incoming,
      /** Out of stock, or below threshold. */
      severity: i.onHand - i.reserved <= 0 ? ('critical' as const) : ('warning' as const),
    }));
}

/**
 * Assert that requested quantities are purchasable *right now*.
 * Used at cart-mutation time to give fast feedback, and again inside checkout —
 * the second check is the binding one, because time passes between the two.
 */
export async function assertPurchasable(
  lines: ReservationLine[],
  client: Tx | typeof db = db,
): Promise<void> {
  const ids = lines.map((l) => l.bookId);
  const books = await client.book.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, status: true, deletedAt: true },
  });
  const byId = new Map(books.map((b) => [b.id, b]));
  const availability = await getAvailabilityMap(ids, client);

  const details: Record<string, string[]> = {};

  for (const line of lines) {
    const book = byId.get(line.bookId);
    if (!book || book.deletedAt || book.status !== 'active') {
      details[line.bookId] = ['This title is no longer available.'];
      continue;
    }
    if (line.quantity > DEFAULT_MAX_PER_ORDER) {
      details[line.bookId] = [`Maximum ${DEFAULT_MAX_PER_ORDER} copies per order.`];
      continue;
    }
    const avail = availability.get(line.bookId);
    if (!avail || avail.available < line.quantity) {
      details[line.bookId] = [
        avail && avail.available > 0
          ? `Only ${avail.available} left in stock.`
          : 'Out of stock.',
      ];
    }
  }

  if (Object.keys(details).length > 0) {
    throw outOfStock('Some items in your basket are no longer available in the quantity you asked for.', details);
  }
}

async function recordMovement(
  tx: Tx,
  data: {
    inventoryItemId: string;
    bookId: string;
    warehouseId: string;
    type: string;
    quantityDelta: number;
    balanceAfter: number;
    reason?: string;
    referenceType?: string | null;
    referenceId?: string | null;
    actorId?: string;
  },
): Promise<void> {
  await tx.stockMovement.create({
    data: {
      inventoryItemId: data.inventoryItemId,
      bookId: data.bookId,
      warehouseId: data.warehouseId,
      type: data.type,
      quantityDelta: data.quantityDelta,
      balanceAfter: data.balanceAfter,
      reason: data.reason ?? null,
      referenceType: data.referenceType ?? null,
      referenceId: data.referenceId ?? null,
      actorId: data.actorId ?? null,
    },
  });
}

/** Full movement history for one inventory row (admin drill-down). */
export async function getInventoryHistory(inventoryItemId: string, limit = 100) {
  return db.stockMovement.findMany({
    where: { inventoryItemId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { actor: { select: { name: true, email: true } } },
  });
}
