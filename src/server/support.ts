import { db } from './db';
import { logger } from '@/lib/logger';
import { generateReference, normaliseEmail } from '@/lib/crypto';
import { TICKET_STATUS } from '@/lib/constants';
import { sendSupportReply } from './notifications';
import { recordAudit } from './audit';
import { AUDIT_ACTION } from '@/lib/constants';

/**
 * Support tickets.
 *
 * A ticket is a conversation, not a form submission, so every ticket carries at
 * least one message and the ticket row itself only holds the routing metadata
 * (who, what order, which queue, how urgent).
 *
 * Three rules worth stating because they are easy to get wrong:
 *
 * 1. **Internal notes never reach the customer.** `isInternal` messages are
 *    filtered out of every customer-facing read path (`listCustomerMessages`),
 *    not merely hidden in the UI.
 * 2. **A customer reply reopens the queue.** Responding to a resolved ticket
 *    moves it to `pending_staff`; leaving it `resolved` loses the message in a
 *    folder nobody opens.
 * 3. **References are unguessable.** `PL-XXXXX` style codes are long enough that
 *    they cannot be enumerated, and the account page still checks ownership.
 */

export const TICKET_AUTHOR = {
  CUSTOMER: 'customer',
  STAFF: 'staff',
  SYSTEM: 'system',
} as const;

export type TicketAuthor = (typeof TICKET_AUTHOR)[keyof typeof TICKET_AUTHOR];

export const TICKET_PRIORITY = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
} as const;

export interface CreateTicketInput {
  email: string;
  name: string;
  subject: string;
  message: string;
  category?: string;
  orderId?: string | null;
  userId?: string | null;
  priority?: string;
  /** Free-form context shown to staff, e.g. the page the customer was on. */
  context?: Record<string, unknown>;
}

export interface TicketSummary {
  id: string;
  reference: string;
  subject: string;
  category: string;
  status: string;
  priority: string;
  createdAt: Date;
  updatedAt: Date;
  orderId: string | null;
  orderNumber: string | null;
  messageCount: number;
  lastMessageAt: Date | null;
}

/**
 * Open a ticket. Always creates the first customer message in the same
 * transaction, so there is no such thing as an empty ticket.
 */
export async function createSupportTicket(
  input: CreateTicketInput,
): Promise<{ id: string; reference: string }> {
  const reference = generateReference('PL-SUP');
  const email = normaliseEmail(input.email);

  const ticket = await db.$transaction(async (tx) => {
    // Attach the order when the caller did not, and the email matches one of
    // their orders — customers frequently forget to include the order number.
    let orderId = input.orderId ?? null;
    if (!orderId) {
      const candidate = await tx.order.findFirst({
        where: { email },
        orderBy: { placedAt: 'desc' },
        select: { id: true },
      });
      orderId = candidate?.id ?? null;
    }

    const created = await tx.supportTicket.create({
      data: {
        reference,
        userId: input.userId ?? null,
        orderId,
        email,
        name: input.name.trim().slice(0, 120),
        category: input.category ?? 'other',
        subject: input.subject.trim().slice(0, 200),
        priority: input.priority ?? TICKET_PRIORITY.NORMAL,
        status: TICKET_STATUS.OPEN,
        messages: {
          create: {
            authorId: input.userId ?? null,
            authorType: TICKET_AUTHOR.CUSTOMER,
            body: input.message.trim().slice(0, 5_000),
            isInternal: false,
          },
        },
      },
      select: { id: true, reference: true },
    });

    if (input.context && Object.keys(input.context).length > 0) {
      await tx.supportTicket.update({
        where: { id: created.id },
        data: {
          // Stored on the ticket as a system message so it is visible to staff
          // without widening the schema for something that is only context.
          messages: {
            create: {
              authorType: TICKET_AUTHOR.SYSTEM,
              body: `Context: ${JSON.stringify(input.context).slice(0, 1_000)}`,
              isInternal: true,
            },
          },
        },
      });
    }

    return created;
  });

  await recordAudit({
    actorId: input.userId ?? null,
    actorEmail: email,
    action: AUDIT_ACTION.SUPPORT_TICKET_CREATE,
    entityType: 'support_ticket',
    entityId: ticket.id,
    summary: `Support ticket ${ticket.reference} opened (${input.category ?? 'other'})`,
    after: { subject: input.subject, orderLinked: Boolean(input.orderId) },
  }).catch((err) => logger.warn('audit write failed for ticket', { err: String(err) }));

  // An acknowledgement in the customer's inbox ends the "did that send?" doubt.
  await sendSupportReply({
    userId: input.userId ?? null,
    ticketId: ticket.id,
    ticketReference: ticket.reference,
    email,
    customerName: input.name,
    body:
      `Thanks for getting in touch — we have your message and your reference is ${ticket.reference}.\n\n` +
      `A real person replies to every one of these, usually within one working day. ` +
      `You can reply directly to this email and it will land on the same conversation.`,
    fromStaff: false,
  }).catch((err) => logger.warn('ticket acknowledgement failed', { err: String(err) }));

  return ticket;
}

/**
 * Append a message. Staff replies notify the customer; customer replies move the
 * ticket back into the staff queue.
 */
export async function addTicketMessage(input: {
  ticketId: string;
  body: string;
  authorId?: string | null;
  authorType: TicketAuthor;
  isInternal?: boolean;
}): Promise<void> {
  const body = input.body.trim();
  if (!body) throw new Error('Message body is required.');

  const ticket = await db.supportTicket.findUnique({
    where: { id: input.ticketId },
    select: { id: true, reference: true, email: true, name: true, userId: true, status: true },
  });
  if (!ticket) throw new Error('Ticket not found.');

  await db.$transaction(async (tx) => {
    await tx.supportMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: input.authorId ?? null,
        authorType: input.authorType,
        body: body.slice(0, 5_000),
        isInternal: input.isInternal ?? false,
      },
    });

    await tx.supportTicket.update({
      where: { id: ticket.id },
      data: {
        status:
          input.authorType === TICKET_AUTHOR.STAFF
            ? TICKET_STATUS.PENDING_CUSTOMER
            : TICKET_STATUS.PENDING_STAFF,
        resolvedAt: null,
      },
    });
  });

  if (input.authorType === TICKET_AUTHOR.STAFF && !input.isInternal) {
    await sendSupportReply({
      userId: ticket.userId,
      ticketId: ticket.id,
      ticketReference: ticket.reference,
      email: ticket.email,
      customerName: ticket.name,
      body,
      fromStaff: true,
    }).catch((err) => logger.warn('support reply notification failed', { err: String(err) }));
  }
}

/**
 * Customer-facing conversation. Internal notes are removed in SQL rather than in
 * the component, so a future UI cannot leak them by accident.
 */
export async function listCustomerMessages(ticketId: string) {
  return db.supportMessage.findMany({
    where: { ticketId, isInternal: false },
    orderBy: { createdAt: 'asc' },
    select: { id: true, authorType: true, body: true, createdAt: true },
  });
}

export async function getTicketForCustomer(referenceOrId: string, userId: string) {
  const ticket = await db.supportTicket.findFirst({
    where: { OR: [{ reference: referenceOrId }, { id: referenceOrId }], userId },
    include: {
      order: { select: { id: true, orderNumber: true, status: true } },
      messages: {
        where: { isInternal: false },
        orderBy: { createdAt: 'asc' },
        select: { id: true, authorType: true, body: true, createdAt: true },
      },
    },
  });
  return ticket;
}

export async function listTicketsForUser(userId: string): Promise<TicketSummary[]> {
  const tickets = await db.supportTicket.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    include: {
      order: { select: { orderNumber: true } },
      _count: { select: { messages: { where: { isInternal: false } } } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
    },
  });

  return tickets.map((ticket) => ({
    id: ticket.id,
    reference: ticket.reference,
    subject: ticket.subject,
    category: ticket.category,
    status: ticket.status,
    priority: ticket.priority,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    orderId: ticket.orderId,
    orderNumber: ticket.order?.orderNumber ?? null,
    messageCount: ticket._count.messages,
    lastMessageAt: ticket.messages[0]?.createdAt ?? null,
  }));
}

/** Staff queue, filterable and searchable. */
export async function listTickets(filters: {
  status?: string;
  category?: string;
  assignedToId?: string | null;
  unassigned?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));

  const where = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.unassigned ? { assignedToId: null } : {}),
    ...(filters.assignedToId ? { assignedToId: filters.assignedToId } : {}),
    ...(filters.search
      ? {
          OR: [
            { reference: { contains: filters.search } },
            { subject: { contains: filters.search } },
            { email: { contains: filters.search } },
            { name: { contains: filters.search } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.supportTicket.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        order: { select: { orderNumber: true } },
        _count: { select: { messages: true } },
      },
    }),
    db.supportTicket.count({ where }),
  ]);

  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Full thread for staff — includes internal notes. */
export async function getTicketForStaff(id: string) {
  return db.supportTicket.findUnique({
    where: { id },
    include: {
      order: { select: { id: true, orderNumber: true, totalPaise: true, status: true } },
      user: { select: { id: true, name: true, email: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true, email: true } } },
      },
    },
  });
}

export async function assignTicket(ticketId: string, staffId: string | null): Promise<void> {
  await db.supportTicket.update({
    where: { id: ticketId },
    data: { assignedToId: staffId, status: TICKET_STATUS.PENDING_STAFF },
  });
}

export async function setTicketStatus(
  ticketId: string,
  status: string,
  actorId?: string | null,
): Promise<void> {
  await db.supportTicket.update({
    where: { id: ticketId },
    data: {
      status,
      resolvedAt: status === TICKET_STATUS.RESOLVED || status === TICKET_STATUS.CLOSED ? new Date() : null,
    },
  });

  await recordAudit({
    actorId: actorId ?? null,
    action: AUDIT_ACTION.SUPPORT_TICKET_STATUS,
    entityType: 'support_ticket',
    entityId: ticketId,
    summary: `Ticket moved to ${status}`,
    after: { status },
  }).catch(() => {});
}

/** Counts for the admin dashboard badge. */
export async function getSupportStats() {
  const [open, pendingStaff, pendingCustomer, unassigned, urgent] = await Promise.all([
    db.supportTicket.count({ where: { status: TICKET_STATUS.OPEN } }),
    db.supportTicket.count({ where: { status: TICKET_STATUS.PENDING_STAFF } }),
    db.supportTicket.count({ where: { status: TICKET_STATUS.PENDING_CUSTOMER } }),
    db.supportTicket.count({ where: { assignedToId: null, status: { notIn: [TICKET_STATUS.CLOSED] } } }),
    db.supportTicket.count({ where: { priority: TICKET_PRIORITY.URGENT, status: { not: TICKET_STATUS.CLOSED } } }),
  ]);

  return { open, pendingStaff, pendingCustomer, unassigned, urgent, needsAttention: pendingStaff + open };
}
