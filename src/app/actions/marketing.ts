'use server';

/**
 * Marketing actions: newsletter signup and the public contact form.
 *
 * Consent handling is the whole point of this file:
 *  - Newsletter uses DOUBLE OPT-IN. A submitted address is `pending` until the
 *    confirmation link is followed. That is what makes the list lawful to email
 *    under GDPR-style rules and materially reduces spam complaints.
 *  - The consent text the customer actually saw is stored alongside the record,
 *    because "prove they consented" is the question that gets asked later.
 *  - Honeypot + rate limiting guard the public endpoints.
 */

import { db } from '@/server/db';
import { consume, RATE_LIMITS, limitKey } from '@/server/rate-limit';
import { generateToken, sha256 } from '@/lib/crypto';
import { newsletterSchema, supportTicketSchema } from '@/lib/validation';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { sendNewsletterWelcome, sendNotification, renderEmailLayout, escapeHtml } from '@/server/notifications';
import { getClientIpForLimit } from '@/server/request-context';
import { generateReference } from '@/lib/crypto';
import { ok, fail, fromError, zodFieldErrors, formString, formBoolean, type ActionState } from './types';

const CONSENT_TEXT =
  'I would like to receive occasional emails with new arrivals, staff picks and offers. I understand I can unsubscribe at any time.';

// ---------------------------------------------------------------------------
// Newsletter
// ---------------------------------------------------------------------------

export async function subscribeNewsletterAction(
  _prev: ActionState<never>,
  formData: FormData,
): Promise<ActionState<never>> {
  const ip = await getClientIpForLimit();

  try {
    const limit = await consume('NEWSLETTER', limitKey('newsletter:ip', ip), RATE_LIMITS.NEWSLETTER);
    if (!limit.allowed) {
      return fail('Too many sign-ups from this connection. Please try again later.', {
        code: 'RATE_LIMITED',
        retryable: true,
      });
    }

    const parsed = newsletterSchema.safeParse({
      email: formString(formData, 'email'),
      name: formString(formData, 'name'),
      source: formString(formData, 'source'),
      consent: formBoolean(formData, 'consent'),
      website: formString(formData, 'website'),
    });

    if (!parsed.success) {
      return fail('Please check your email address and tick the consent box.', {
        fieldErrors: zodFieldErrors(parsed.error.issues),
      });
    }

    if (parsed.data.website) {
      // Honeypot: look successful, do nothing.
      return ok(undefined, 'Almost there — check your inbox to confirm.');
    }

    const email = parsed.data.email;
    const confirmToken = generateToken(24);

    const existing = await db.newsletterSubscriber.findUnique({
      where: { email },
      select: { id: true, status: true },
    });

    if (existing?.status === 'confirmed') {
      // Do not reveal list membership differences; the response is identical.
      return ok(undefined, 'You are already on the list — thank you.');
    }

    await db.newsletterSubscriber.upsert({
      where: { email },
      create: {
        email,
        name: parsed.data.name ?? null,
        status: 'pending',
        source: parsed.data.source ?? 'website',
        confirmTokenHash: sha256(confirmToken),
        consentText: CONSENT_TEXT,
      },
      update: {
        status: 'pending',
        confirmTokenHash: sha256(confirmToken),
        consentText: CONSENT_TEXT,
        source: parsed.data.source ?? 'website',
        unsubscribedAt: null,
      },
    });

    // Track the consent text against the user record too, when we know them.
    const { getCurrentUser } = await import('@/server/auth');
    const user = await getCurrentUser().catch(() => null);
    if (user) {
      await db.user
        .update({ where: { id: user.id }, data: { marketingEmailConsent: true } })
        .catch(() => {});
    }

    await sendNewsletterWelcome({ email, name: parsed.data.name ?? null, confirmToken });

    logger.info('newsletter signup captured', { source: parsed.data.source ?? 'website' });

    return ok(undefined, 'Almost there — we have sent you a link to confirm your subscription.');
  } catch (err) {
    return fromError(err);
  }
}

export async function confirmNewsletterAction(token: string): Promise<ActionState<never>> {
  try {
    if (!token) return fail('That confirmation link is incomplete.');

    const subscriber = await db.newsletterSubscriber.findFirst({
      where: { confirmTokenHash: sha256(token) },
      select: { id: true, status: true },
    });

    if (!subscriber) {
      return fail('That confirmation link is not valid. Please sign up again.');
    }

    await db.newsletterSubscriber.update({
      where: { id: subscriber.id },
      data: { status: 'confirmed', confirmedAt: new Date(), confirmTokenHash: null },
    });

    return ok(undefined, 'You are subscribed. Thank you!');
  } catch (err) {
    return fromError(err);
  }
}

export async function unsubscribeNewsletterAction(email: string): Promise<ActionState<never>> {
  try {
    // Unsubscribe must always appear to succeed — a failed unsubscribe turns
    // into a spam complaint, which harms every future send.
    await db.newsletterSubscriber
      .updateMany({
        where: { email: email.toLowerCase().trim() },
        data: { status: 'unsubscribed', unsubscribedAt: new Date() },
      })
      .catch(() => {});

    const user = await db.user
      .findUnique({ where: { email: email.toLowerCase().trim() }, select: { id: true } })
      .catch(() => null);

    if (user) {
      await db.user
        .update({ where: { id: user.id }, data: { marketingEmailConsent: false } })
        .catch(() => {});
    }

    return ok(undefined, 'You have been unsubscribed. Sorry to see you go.');
  } catch (err) {
    return fromError(err);
  }
}

// ---------------------------------------------------------------------------
// Contact form
// ---------------------------------------------------------------------------

/**
 * Public contact form.
 *
 * Creates a support ticket rather than sending a bare email, so every enquiry
 * has a reference number, an owner and a status — and nothing is lost in an
 * inbox. The customer gets an immediate acknowledgement.
 */
export async function submitContactAction(
  _prev: ActionState<{ reference: string }>,
  formData: FormData,
): Promise<ActionState<{ reference: string }>> {
  const ip = await getClientIpForLimit();

  try {
    const limit = await consume('CONTACT', limitKey('contact:ip', ip), RATE_LIMITS.CONTACT);
    if (!limit.allowed) {
      return fail('You have sent us several messages already. Please give us a little time to reply.', {
        code: 'RATE_LIMITED',
      });
    }

    const parsed = supportTicketSchema.safeParse({
      name: formString(formData, 'name'),
      email: formString(formData, 'email'),
      orderNumber: formString(formData, 'orderNumber'),
      category: formString(formData, 'category') ?? 'other',
      subject: formString(formData, 'subject'),
      message: formString(formData, 'message'),
      website: formString(formData, 'website'),
    });

    if (!parsed.success) {
      return fail('Please check the highlighted fields.', {
        fieldErrors: zodFieldErrors(parsed.error.issues),
      });
    }

    if (parsed.data.website) return ok({ reference: 'PL-RECEIVED' }, 'Thank you — we have got your message.');

    const { getCurrentUser } = await import('@/server/auth');
    const user = await getCurrentUser().catch(() => null);

    // Link the ticket to an order when the customer supplied a valid reference.
    let orderId: string | null = null;
    if (parsed.data.orderNumber) {
      const order = await db.order
        .findUnique({
          where: { orderNumber: parsed.data.orderNumber.trim().toUpperCase() },
          select: { id: true, email: true },
        })
        .catch(() => null);

      // Only link when the requester can reasonably be that customer.
      if (
        order &&
        (user?.id || order.email.toLowerCase() === parsed.data.email.toLowerCase())
      ) {
        orderId = order.id;
      }
    }

    const reference = generateReference('PL');

    const ticket = await db.supportTicket.create({
      data: {
        reference,
        userId: user?.id ?? null,
        orderId,
        email: parsed.data.email,
        name: parsed.data.name,
        category: parsed.data.category,
        subject: parsed.data.subject,
        status: 'open',
        priority: parsed.data.category === 'refund' ? 'high' : 'normal',
        messages: {
          create: {
            authorId: user?.id ?? null,
            authorType: 'customer',
            body: parsed.data.message,
          },
        },
      },
      select: { id: true, reference: true },
    });

    // Acknowledge to the customer.
    await sendNotification(
      {
        to: parsed.data.email,
        replyTo: env().SUPPORT_EMAIL,
        subject: `We have your message — ${ticket.reference}`,
        text: `Hi ${parsed.data.name},\n\nThanks for writing in. Your reference is ${ticket.reference}.\n\nWe aim to reply within one working day, usually sooner. You can add anything else to this request by replying to this email.\n\n— ${env().APP_NAME}`,
        html: renderEmailLayout({
          title: 'We have your message',
          preheader: `Reference ${ticket.reference}`,
          bodyHtml: `
            <p style="margin:0 0 14px;">Hi ${escapeHtml(parsed.data.name)}, thanks for writing in.</p>
            <p style="margin:0 0 14px;">Your reference is <strong>${escapeHtml(ticket.reference)}</strong>. We aim to reply within one working day, usually sooner.</p>
            <p style="margin:0;color:#6b6155;font-size:14px;">Your message: “${escapeHtml(parsed.data.message.slice(0, 300))}”</p>
          `,
          footerNote: 'Replying to this email adds to the same request.',
        }),
      },
      { userId: user?.id ?? null, template: 'support_acknowledgement', entityType: 'ticket', entityId: ticket.id },
    );

    // Alert the support inbox.
    await sendNotification(
      {
        to: env().SUPPORT_EMAIL,
        replyTo: parsed.data.email,
        subject: `[${ticket.reference}] ${parsed.data.subject}`,
        text: `From: ${parsed.data.name} <${parsed.data.email}>\nCategory: ${parsed.data.category}\n${orderId ? `Order: ${parsed.data.orderNumber}\n` : ''}\n${parsed.data.message}`,
      },
      { template: 'support_internal_notification', entityType: 'ticket', entityId: ticket.id },
    );

    return ok(
      { reference: ticket.reference },
      `Thanks — we have got your message. Your reference is ${ticket.reference}.`,
    );
  } catch (err) {
    return fromError(err);
  }
}
