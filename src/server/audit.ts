/**
 * Audit trail.
 *
 * Every sensitive back-office action lands here: price changes, stock
 * adjustments, refunds, role changes, deletions, coupon edits, settings toggles.
 * This is not optional infrastructure — it is how the owner answers "who changed
 * the price of this book, and when?" without asking everyone on the team.
 *
 * Entries are append-only by convention: nothing in the codebase updates or
 * deletes an AuditLog row. `before`/`after` snapshots are stored as JSON strings
 * and are themselves redacted of secrets before writing.
 */

import { db } from './db';
import { logger } from '@/lib/logger';
import type { Prisma } from '@prisma/client';

export interface AuditInput {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Write an audit entry.
 *
 * Never throws. An audit failure must not break the operation the user asked
 * for, but it *is* logged at error level so it shows up in monitoring rather
 * than disappearing.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary.slice(0, 500),
        beforeJson: serialise(input.before),
        afterJson: serialise(input.after),
        ip: input.ip ?? null,
        userAgent: input.userAgent?.slice(0, 400) ?? null,
      },
    });
  } catch (err) {
    logger.error('AUDIT WRITE FAILED', { action: input.action, entityType: input.entityType, err });
  }
}

/** Fields never written to the audit trail, even if a caller passes them. */
const SENSITIVE_FIELDS = /(password|hash|token|secret|salt|cvv|card|pan|otp|authorization)/i;

function serialise(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    const sanitised = sanitise(value, 0);
    const json = JSON.stringify(sanitised);
    // Cap the snapshot; an audit row should be readable, not a data dump.
    return json.length > 8_000 ? `${json.slice(0, 8_000)}…` : json;
  } catch {
    return null;
  }
}

function sanitise(value: unknown, depth: number): unknown {
  if (depth > 4) return '[deep]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitise(v, depth + 1));
  if (value instanceof Date) return value.toISOString();

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_FIELDS.test(key) ? '[redacted]' : sanitise(val, depth + 1);
  }
  return out;
}

/** Compute a compact diff of changed fields, for price/stock/meta edits. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: Array<keyof T>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of fields) {
    const from = before[field];
    const to = after[field];
    if (to === undefined) continue;
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes[String(field)] = { from, to };
    }
  }
  return changes;
}

export interface AuditFilters {
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export async function listAuditLogs(filters: AuditFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));

  const where: Prisma.AuditLogWhereInput = {};
  if (filters.actorId) where.actorId = filters.actorId;
  if (filters.action) where.action = { contains: filters.action };
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.entityId) where.entityId = filters.entityId;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  const [items, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      include: { actor: { select: { name: true, email: true, role: { select: { label: true } } } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.auditLog.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

/** Timeline of changes to one entity, shown on its admin detail page. */
export async function getEntityHistory(entityType: string, entityId: string, limit = 50) {
  return db.auditLog.findMany({
    where: { entityType, entityId },
    include: { actor: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
