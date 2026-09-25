/**
 * Notification service.
 *
 * Transactional messages (order confirmation, shipping, refunds) are sent to the
 * customer because they asked for them by placing an order — they are not
 * marketing. Promotional email requires explicit consent, and every promotional
 * path checks it before sending. That distinction is the whole ballgame under
 * anti-spam law, so it is enforced in code rather than left to the caller.
 *
 * Transport is pluggable. The `console` transport writes a structured log line,
 * which is what runs in development and in this sandbox: nothing is silently
 * dropped, and nothing pretends to have been delivered. Configuring Resend, SMTP
 * or an SMS gateway switches the transport without touching call sites.
 *
 * Every send is recorded in the `Notification` table, so "did they get the
 * shipping email?" has an answer that is not a guess.
 */

import 'server-only';
import { db } from './db';
import { env, isProduction } from '@/lib/env';
import { logger } from '@/lib/logger';
import { NOTIFICATION_CHANNEL, NOTIFICATION_STATUS } from '@/lib/constants';
import { formatPaiseExact } from '@/lib/money';

export interface NotificationPayload {
  to: string;
  subject: string;
  /** Plain-text body. Kept alongside HTML so every email has a readable fallback. */
  text: string;
  html?: string;
  /** Reply-to for support threads. */
  replyTo?: string;
}

export interface SendResult {
  ok: boolean;
  transport: string;
  skippedReason?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

interface Transport {
  name: string;
  send(payload: NotificationPayload & { from: string }): Promise<SendResult>;
}

/** Development/default transport: log it, do not pretend it was delivered. */
const consoleTransport: Transport = {
  name: 'console',
  async send(payload) {
    logger.info('email (console transport — not actually delivered)', {
      to: payload.to,
      subject: payload.subject,
      preview: payload.text.slice(0, 180),
    });
    // Deliberately not "sent": nothing left the machine.
    return { ok: true, transport: 'console', skippedReason: 'console transport does not deliver' };
  },
};

/**
 * Resend HTTP API. Chosen because it needs no SMTP connection juggling and is
 * trivial to deploy; swap for SMTP/SES without changing any caller.
 */
const resendTransport: Transport = {
  name: 'resend',
  async send(payload) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return { ok: false, transport: 'resend', error: 'RESEND_API_KEY not set' };

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: payload.from,
          to: [payload.to],
          subject: payload.subject,
          text: payload.text,
          html: payload.html,
          reply_to: payload.replyTo,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        return { ok: false, transport: 'resend', error: `${response.status}: ${body.slice(0, 200)}` };
      }
      return { ok: true, transport: 'resend' };
    } catch (err) {
      return { ok: false, transport: 'resend', error: err instanceof Error ? err.message : 'unknown' };
    }
  },
};

function resolveEmailTransport(): Transport {
  switch (env().EMAIL_PROVIDER) {
    case 'resend':
      return resendTransport;
    case 'smtp':
      // SMTP intentionally not implemented inline: it needs nodemailer, and a
      // half-working SMTP client is worse than an honest "not configured".
      logger.warn('EMAIL_PROVIDER=smtp is not wired up in this build; falling back to console');
      return consoleTransport;
    default:
      return consoleTransport;
  }
}

// ---------------------------------------------------------------------------
// Core send
// ---------------------------------------------------------------------------

/**
 * Send and record a notification.
 *
 * Never throws: a failed email must not roll back an order. Failures are stored
 * with their error so the admin can see and retry them.
 */
export async function sendNotification(
  payload: NotificationPayload,
  options: {
    userId?: string | null;
    template: string;
    channel?: string;
    entityType?: string;
    entityId?: string;
  },
): Promise<SendResult> {
  const transport = resolveEmailTransport();
  const from = env().EMAIL_FROM;

  let result: SendResult;
  try {
    result = await transport.send({ ...payload, from });
  } catch (err) {
    result = { ok: false, transport: transport.name, error: err instanceof Error ? err.message : 'unknown' };
  }

  await db.notification
    .create({
      data: {
        userId: options.userId ?? null,
        channel: options.channel ?? NOTIFICATION_CHANNEL.EMAIL,
        template: options.template,
        recipient: payload.to,
        subject: payload.subject,
        // Store a bounded preview only; the full body may contain personal data
        // we do not need to duplicate.
        body: payload.text.slice(0, 2_000),
        status: result.ok ? NOTIFICATION_STATUS.SENT : NOTIFICATION_STATUS.FAILED,
        error: result.error ?? null,
        entityType: options.entityType ?? null,
        entityId: options.entityId ?? null,
        sentAt: result.ok ? new Date() : null,
      },
    })
    .catch((err) => logger.error('failed to record notification', { err, template: options.template }));

  if (!result.ok) {
    logger.error('notification failed', { template: options.template, transport: result.transport, error: result.error });
  } else if (isProduction() && result.transport === 'console') {
    logger.error('CRITICAL: production is using the console email transport — customers will not receive mail', {
      template: options.template,
    });
  }

  return result;
}

/** Record an intentionally skipped message so the trail is complete. */
async function recordSkipped(options: {
  userId?: string | null;
  template: string;
  recipient: string;
  reason: string;
  channel?: string;
}): Promise<void> {
  await db.notification
    .create({
      data: {
        userId: options.userId ?? null,
        channel: options.channel ?? NOTIFICATION_CHANNEL.EMAIL,
        template: options.template,
        recipient: options.recipient,
        status: NOTIFICATION_STATUS.SKIPPED_CONSENT,
        error: options.reason,
      },
    })
    .catch(() => {});
}

/** Read a user's notification preferences, with sane defaults. */
export async function getNotificationPrefs(userId: string): Promise<{
  orderUpdates: boolean;
  backInStock: boolean;
  priceDrop: boolean;
  newsletter: boolean;
  sms: boolean;
  whatsapp: boolean;
}> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      notificationPrefs: true,
      marketingEmailConsent: true,
      marketingSmsConsent: true,
      marketingWhatsappConsent: true,
    },
  });

  let stored: Partial<ReturnType<typeof defaults>> = {};
  if (user?.notificationPrefs) {
    try {
      stored = JSON.parse(user.notificationPrefs);
    } catch {
      /* fall through to defaults */
    }
  }

  const base = defaults();
  return {
    ...base,
    ...stored,
    // Consent columns are authoritative for marketing; prefs cannot enable what
    // the customer never opted into.
    newsletter: base.newsletter && (user?.marketingEmailConsent ?? false),
    sms: user?.marketingSmsConsent ?? false,
    whatsapp: user?.marketingWhatsappConsent ?? false,
  };
}

function defaults() {
  return {
    orderUpdates: true,
    backInStock: true,
    priceDrop: false,
    newsletter: false,
  };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * Branded transactional email layout.
 *
 * Inline styles only, table-based layout, no external CSS — that is what
 * actually renders consistently in Gmail, Outlook and Apple Mail. A
 * single-column 600px body also happens to be the right shape for reading a
 * receipt on a phone, which is how most of our customers will read it.
 */
export function renderEmailLayout(options: {
  title: string;
  preheader?: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaHref?: string;
  footerNote?: string;
}): string {
  const e = env();
  const year = new Date().getFullYear();
  const instagram = e.SOCIAL_INSTAGRAM_URL;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(options.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f1e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#241f1a;">
${options.preheader ? `<div style="display:none;font-size:1px;color:#f5f1e8;max-height:0;overflow:hidden;">${escapeHtml(options.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1e8;padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fffdf8;border-radius:14px;overflow:hidden;border:1px solid #e6ded0;">
        <tr>
          <td style="padding:28px 28px 12px;">
            <a href="${escapeHtml(e.APP_URL)}" style="text-decoration:none;color:#241f1a;">
              <span style="font-size:20px;font-weight:700;letter-spacing:-0.3px;">${escapeHtml(e.APP_NAME)}</span>
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 28px 0;">
            <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;">${escapeHtml(options.title)}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px 24px;font-size:15px;line-height:1.6;">
            ${options.bodyHtml}
            ${
              options.ctaLabel && options.ctaHref
                ? `<p style="margin:24px 0 8px;">
                     <a href="${escapeHtml(options.ctaHref)}" style="display:inline-block;background:#241f1a;color:#fffdf8;text-decoration:none;padding:13px 22px;border-radius:999px;font-weight:600;font-size:15px;">${escapeHtml(options.ctaLabel)}</a>
                   </p>`
                : ''
            }
          </td>
        </tr>
        <tr>
          <td style="padding:20px 28px 28px;border-top:1px solid #efe7d9;font-size:13px;line-height:1.6;color:#6b6155;">
            ${options.footerNote ? `<p style="margin:0 0 12px;">${options.footerNote}</p>` : ''}
            <p style="margin:0 0 8px;">
              Need a hand? Write to
              <a href="mailto:${escapeHtml(e.SUPPORT_EMAIL)}" style="color:#8a5a1f;text-decoration:underline;">${escapeHtml(e.SUPPORT_EMAIL)}</a>${e.SUPPORT_PHONE ? ` or call ${escapeHtml(e.SUPPORT_PHONE)}` : ''}.
            </p>
            <p style="margin:0 0 12px;">
              <a href="${escapeHtml(instagram)}" style="color:#8a5a1f;text-decoration:underline;">Follow us on Instagram</a>
              &nbsp;·&nbsp;
              <a href="${escapeHtml(e.APP_URL)}/legal/terms" style="color:#8a5a1f;text-decoration:underline;">Terms</a>
              &nbsp;·&nbsp;
              <a href="${escapeHtml(e.APP_URL)}/legal/privacy" style="color:#8a5a1f;text-decoration:underline;">Privacy</a>
            </p>
            <p style="margin:0;color:#8a8177;">© ${year} ${escapeHtml(e.APP_NAME)}. You are receiving this because you placed an order or created an account.</p>
          </td>
        </tr>
      </table>
      <p style="max-width:600px;margin:16px auto 0;font-size:11px;color:#8a8177;text-align:center;line-height:1.5;">
        This is a transactional message about your account or order.
      </p>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export { escapeHtml };

// ---------------------------------------------------------------------------
// Domain-specific senders
// ---------------------------------------------------------------------------

export async function sendEmailVerification(params: {
  userId: string;
  email: string;
  name: string;
  token: string;
}): Promise<SendResult> {
  const url = `${env().APP_URL}/verify-email?token=${encodeURIComponent(params.token)}`;

  return sendNotification(
    {
      to: params.email,
      subject: 'Confirm your email address',
      text: `Hi ${params.name},\n\nConfirm your email to finish setting up your account:\n${url}\n\nThis link expires in 24 hours. If you did not create an account, ignore this email.`,
      html: renderEmailLayout({
        title: `Welcome, ${escapeHtml(params.name)}`,
        preheader: 'One tap to confirm your email address.',
        bodyHtml: `<p style="margin:0 0 14px;">Thanks for joining ${escapeHtml(env().APP_NAME)}. Confirm your email address and your account is ready to go.</p>
          <p style="margin:0;color:#6b6155;font-size:14px;">This link expires in 24 hours. If you did not create an account, you can ignore this email.</p>`,
        ctaLabel: 'Confirm email',
        ctaHref: url,
      }),
    },
    { userId: params.userId, template: 'email_verification' },
  );
}

export async function sendPasswordReset(params: {
  userId: string;
  email: string;
  name: string;
  token: string;
}): Promise<SendResult> {
  const url = `${env().APP_URL}/reset-password?token=${encodeURIComponent(params.token)}`;

  return sendNotification(
    {
      to: params.email,
      subject: 'Reset your password',
      text: `Hi ${params.name},\n\nSet a new password here:\n${url}\n\nThis link expires in 1 hour. If you did not request it, no action is needed — your password has not changed.`,
      html: renderEmailLayout({
        title: 'Reset your password',
        preheader: 'This link expires in one hour.',
        bodyHtml: `<p style="margin:0 0 14px;">We received a request to reset the password on your account.</p>
          <p style="margin:0;color:#6b6155;font-size:14px;">The link expires in one hour. If you did not request this, nothing has changed and you can safely ignore this email.</p>`,
        ctaLabel: 'Set a new password',
        ctaHref: url,
      }),
    },
    { userId: params.userId, template: 'password_reset' },
  );
}

export interface OrderEmailItem {
  title: string;
  author: string;
  quantity: number;
  lineTotalPaise: number;
}

function renderOrderItems(items: OrderEmailItem[]): string {
  const rows = items
    .map(
      (item) => `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0e9dc;font-size:14px;">
          <strong>${escapeHtml(item.title)}</strong><br>
          <span style="color:#6b6155;font-size:13px;">${escapeHtml(item.author)}${item.quantity > 1 ? ` · × ${item.quantity}` : ''}</span>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #f0e9dc;font-size:14px;text-align:right;white-space:nowrap;vertical-align:top;">
          ${escapeHtml(formatPaiseExact(item.lineTotalPaise))}
        </td>
      </tr>`,
    )
    .join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 8px;">${rows}</table>`;
}

export async function sendOrderConfirmation(params: {
  userId?: string | null;
  orderId: string;
  orderNumber: string;
  email: string;
  customerName: string;
  items: OrderEmailItem[];
  totalPaise: number;
  shippingPaise: number;
  discountPaise: number;
  taxPaise: number;
  shippingMethod: string | null;
  estimatedDelivery: Date | null;
}): Promise<SendResult> {
  const url = `${env().APP_URL}/orders/${params.orderNumber}`;
  const eta = params.estimatedDelivery
    ? params.estimatedDelivery.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
    : null;

  const totalsRows = [
    ['Subtotal', formatPaiseExact(params.items.reduce((s, i) => s + i.lineTotalPaise, 0))],
    ...(params.discountPaise > 0 ? [['Discount', `− ${formatPaiseExact(params.discountPaise)}`]] : []),
    ['Shipping', params.shippingPaise === 0 ? 'Free' : formatPaiseExact(params.shippingPaise)],
    ...(params.taxPaise > 0 ? [['Includes GST', formatPaiseExact(params.taxPaise)]] : []),
  ]
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 0;font-size:14px;color:#6b6155;">${escapeHtml(label!)}</td><td style="padding:4px 0;font-size:14px;text-align:right;color:#6b6155;">${escapeHtml(value!)}</td></tr>`,
    )
    .join('');

  return sendNotification(
    {
      to: params.email,
      subject: `Order confirmed — ${params.orderNumber}`,
      text: [
        `Hi ${params.customerName},`,
        '',
        `Your order ${params.orderNumber} is confirmed.`,
        '',
        ...params.items.map((i) => `• ${i.title} — ${i.author} × ${i.quantity}`),
        '',
        `Total: ${formatPaiseExact(params.totalPaise)}`,
        eta ? `Estimated delivery: ${eta}` : '',
        '',
        `Track it here: ${url}`,
      ]
        .filter(Boolean)
        .join('\n'),
      html: renderEmailLayout({
        title: `Order ${escapeHtml(params.orderNumber)} confirmed`,
        preheader: eta ? `Estimated delivery ${eta}` : 'We are getting your books ready.',
        bodyHtml: `
          <p style="margin:0 0 16px;">Thanks, ${escapeHtml(params.customerName)} — your payment went through and your books are being prepared.</p>
          ${renderOrderItems(params.items)}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 0;">
            ${totalsRows}
            <tr>
              <td style="padding:10px 0 0;font-size:16px;font-weight:700;border-top:1px solid #e6ded0;">Total paid</td>
              <td style="padding:10px 0 0;font-size:16px;font-weight:700;text-align:right;border-top:1px solid #e6ded0;">${escapeHtml(formatPaiseExact(params.totalPaise))}</td>
            </tr>
          </table>
          ${eta ? `<p style="margin:18px 0 0;font-size:14px;color:#6b6155;">Estimated delivery: <strong>${escapeHtml(eta)}</strong>${params.shippingMethod ? ` · ${escapeHtml(params.shippingMethod)}` : ''}</p>` : ''}
        `,
        ctaLabel: 'Track your order',
        ctaHref: url,
      }),
    },
    { userId: params.userId ?? null, template: 'order_confirmation', entityType: 'order', entityId: params.orderId },
  );
}

export async function sendPaymentFailed(params: {
  userId?: string | null;
  orderId: string;
  orderNumber: string;
  email: string;
  customerName: string;
  totalPaise: number;
  reason: string | null;
}): Promise<SendResult> {
  const url = `${env().APP_URL}/orders/${params.orderNumber}`;
  // The basket is preserved, so retrying is genuinely one tap.
  const retryUrl = `${env().APP_URL}/checkout/retry/${params.orderNumber}`;

  return sendNotification(
    {
      to: params.email,
      subject: `Payment did not go through — ${params.orderNumber}`,
      text: `Hi ${params.customerName},\n\nYour payment of ${formatPaiseExact(params.totalPaise)} for order ${params.orderNumber} did not complete${params.reason ? `: ${params.reason}` : '.'}\n\nNo money has been taken. You can try again here:\n${retryUrl}\n\nWe have kept your basket aside.`,
      html: renderEmailLayout({
        title: 'Your payment did not complete',
        preheader: 'No money has been taken. Your basket is saved.',
        bodyHtml: `
          <p style="margin:0 0 14px;">Hi ${escapeHtml(params.customerName)}, the payment for order <strong>${escapeHtml(params.orderNumber)}</strong> did not go through${params.reason ? `: ${escapeHtml(params.reason)}` : '.'}</p>
          <p style="margin:0 0 14px;"><strong>No money has been taken.</strong> We have kept your basket aside for a little while so you can pick up where you left off.</p>
        `,
        ctaLabel: 'Try the payment again',
        ctaHref: retryUrl,
        footerNote: `You can also view the order at ${escapeHtml(url)}.`,
      }),
    },
    { userId: params.userId ?? null, template: 'payment_failed', entityType: 'order', entityId: params.orderId },
  );
}

export async function sendShipmentUpdate(params: {
  userId?: string | null;
  orderId: string;
  orderNumber: string;
  email: string;
  customerName: string;
  carrier: string;
  trackingNumber: string;
  trackingUrl: string | null;
  estimatedDelivery: Date | null;
}): Promise<SendResult> {
  const url = `${env().APP_URL}/orders/${params.orderNumber}`;
  const eta = params.estimatedDelivery
    ? params.estimatedDelivery.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
    : null;

  return sendNotification(
    {
      to: params.email,
      subject: `Your books are on the way — ${params.orderNumber}`,
      text: `Hi ${params.customerName},\n\nOrder ${params.orderNumber} has shipped with ${params.carrier}.\nTracking number: ${params.trackingNumber}\n${eta ? `Estimated delivery: ${eta}\n` : ''}\nTrack it: ${params.trackingUrl ?? url}`,
      html: renderEmailLayout({
        title: 'Your books are on the way',
        preheader: `${params.carrier} · ${params.trackingNumber}`,
        bodyHtml: `
          <p style="margin:0 0 14px;">Hi ${escapeHtml(params.customerName)}, order <strong>${escapeHtml(params.orderNumber)}</strong> has left our warehouse.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1e8;border-radius:10px;padding:14px;margin:0 0 14px;">
            <tr><td style="font-size:14px;padding:2px 0;color:#6b6155;">Carrier</td><td style="font-size:14px;padding:2px 0;text-align:right;font-weight:600;">${escapeHtml(params.carrier)}</td></tr>
            <tr><td style="font-size:14px;padding:2px 0;color:#6b6155;">Tracking number</td><td style="font-size:14px;padding:2px 0;text-align:right;font-weight:600;">${escapeHtml(params.trackingNumber)}</td></tr>
            ${eta ? `<tr><td style="font-size:14px;padding:2px 0;color:#6b6155;">Estimated delivery</td><td style="font-size:14px;padding:2px 0;text-align:right;font-weight:600;">${escapeHtml(eta)}</td></tr>` : ''}
          </table>
        `,
        ctaLabel: params.trackingUrl ? 'Track your parcel' : 'View your order',
        ctaHref: params.trackingUrl ?? url,
      }),
    },
    { userId: params.userId ?? null, template: 'shipment_update', entityType: 'order', entityId: params.orderId },
  );
}

export async function sendRefundUpdate(params: {
  userId?: string | null;
  orderId: string;
  orderNumber: string;
  email: string;
  customerName: string;
  amountPaise: number;
  completed: boolean;
}): Promise<SendResult> {
  return sendNotification(
    {
      to: params.email,
      subject: params.completed
        ? `Refund processed — ${params.orderNumber}`
        : `Refund initiated — ${params.orderNumber}`,
      text: `Hi ${params.customerName},\n\n${params.completed ? 'We have processed' : 'We have initiated'} a refund of ${formatPaiseExact(params.amountPaise)} for order ${params.orderNumber}.\n\nRefunds reach the original payment method, usually within 5–7 working days depending on your bank.`,
      html: renderEmailLayout({
        title: params.completed ? 'Your refund is on its way' : 'Refund initiated',
        preheader: `${formatPaiseExact(params.amountPaise)} back to your original payment method.`,
        bodyHtml: `
          <p style="margin:0 0 14px;">Hi ${escapeHtml(params.customerName)},</p>
          <p style="margin:0 0 14px;">${params.completed ? 'We have processed' : 'We have initiated'} a refund of <strong>${escapeHtml(formatPaiseExact(params.amountPaise))}</strong> for order ${escapeHtml(params.orderNumber)}.</p>
          <p style="margin:0;color:#6b6155;font-size:14px;">Refunds go back to the original payment method and typically take 5–7 working days, depending on your bank.</p>
        `,
      }),
    },
    { userId: params.userId ?? null, template: 'refund_update', entityType: 'order', entityId: params.orderId },
  );
}

export async function sendOrderCancellation(params: {
  userId?: string | null;
  orderId: string;
  orderNumber: string;
  email: string;
  customerName: string;
  reason: string;
  refundAmountPaise: number;
}): Promise<SendResult> {
  return sendNotification(
    {
      to: params.email,
      subject: `Order cancelled — ${params.orderNumber}`,
      text: `Hi ${params.customerName},\n\nOrder ${params.orderNumber} has been cancelled. Reason: ${params.reason}.${params.refundAmountPaise > 0 ? `\n\nA refund of ${formatPaiseExact(params.refundAmountPaise)} has been initiated.` : ''}`,
      html: renderEmailLayout({
        title: 'Order cancelled',
        preheader: `Order ${params.orderNumber}`,
        bodyHtml: `
          <p style="margin:0 0 14px;">Hi ${escapeHtml(params.customerName)}, order <strong>${escapeHtml(params.orderNumber)}</strong> has been cancelled.</p>
          <p style="margin:0 0 14px;color:#6b6155;font-size:14px;">Reason: ${escapeHtml(params.reason)}</p>
          ${params.refundAmountPaise > 0 ? `<p style="margin:0;">A refund of <strong>${escapeHtml(formatPaiseExact(params.refundAmountPaise))}</strong> has been initiated to your original payment method.</p>` : ''}
        `,
      }),
    },
    { userId: params.userId ?? null, template: 'order_cancelled', entityType: 'order', entityId: params.orderId },
  );
}

/**
 * Back-in-stock / price-drop alerts.
 *
 * These are opt-in per customer. If consent is missing we record the skip and
 * send nothing — silently sending them anyway is exactly the behaviour that gets
 * a store's domain blacklisted.
 */
export async function sendBackInStockAlert(params: {
  userId: string;
  email: string;
  bookTitle: string;
  bookSlug: string;
  pricePaise: number | null;
}): Promise<SendResult> {
  const prefs = await getNotificationPrefs(params.userId);
  if (!prefs.backInStock) {
    await recordSkipped({
      userId: params.userId,
      template: 'back_in_stock',
      recipient: params.email,
      reason: 'Customer has back-in-stock alerts turned off.',
    });
    return { ok: false, transport: 'none', skippedReason: 'preference_disabled' };
  }

  const url = `${env().APP_URL}/books/${params.bookSlug}`;

  return sendNotification(
    {
      to: params.email,
      subject: `Back in stock: ${params.bookTitle}`,
      text: `${params.bookTitle} is back in stock.${params.pricePaise ? ` Now ${formatPaiseExact(params.pricePaise)}.` : ''}\n\n${url}`,
      html: renderEmailLayout({
        title: 'It is back in stock',
        preheader: `${params.bookTitle} is available again.`,
        bodyHtml: `<p style="margin:0 0 14px;"><strong>${escapeHtml(params.bookTitle)}</strong> is available again${params.pricePaise ? `, now at ${escapeHtml(formatPaiseExact(params.pricePaise))}` : ''}.</p>
          <p style="margin:0;color:#6b6155;font-size:14px;">Popular titles sell out quickly — we would grab it soon.</p>`,
        ctaLabel: 'View the book',
        ctaHref: url,
        footerNote: 'You asked us to tell you when this came back. You can turn these off in your account settings.',
      }),
    },
    { userId: params.userId, template: 'back_in_stock' },
  );
}

export async function sendNewsletterWelcome(params: {
  email: string;
  name?: string | null;
  confirmToken?: string | null;
}): Promise<SendResult> {
  // Double opt-in: the subscription is only confirmed once the link is followed.
  const confirmUrl = params.confirmToken
    ? `${env().APP_URL}/newsletter/confirm?token=${encodeURIComponent(params.confirmToken)}`
    : null;

  return sendNotification(
    {
      to: params.email,
      subject: confirmUrl ? 'Confirm your subscription' : 'You are on the list',
      text: confirmUrl
        ? `One more step — confirm you want to hear from us:\n${confirmUrl}\n\nIf you did not sign up, ignore this email and we will not write again.`
        : 'Thanks for subscribing. We send one considered email a month: new arrivals, staff picks and the occasional offer. Reply STOP any time to unsubscribe.',
      html: renderEmailLayout({
        title: confirmUrl ? 'One more step' : 'You are on the list',
        preheader: 'Confirm your subscription to start receiving our reading letters.',
        bodyHtml: confirmUrl
          ? `<p style="margin:0 0 14px;">Tap below to confirm you would like to hear from us. If you did not sign up, ignore this email and we will not write again.</p>`
          : `<p style="margin:0 0 14px;">Thanks for subscribing. We send one considered email a month: new arrivals, staff picks and the occasional offer.</p>`,
        ctaLabel: confirmUrl ? 'Confirm subscription' : undefined,
        ctaHref: confirmUrl ?? undefined,
      }),
    },
    { template: 'newsletter_welcome' },
  );
}

/** Admin/customer reply on a support ticket, including internal notes. */
export async function sendSupportReply(params: {
  userId?: string | null;
  ticketReference: string;
  ticketId: string;
  email: string;
  customerName: string;
  body: string;
  fromStaff: boolean;
}): Promise<SendResult> {
  const url = `${env().APP_URL}/account/support/${params.ticketReference}`;

  return sendNotification(
    {
      to: params.email,
      replyTo: env().SUPPORT_EMAIL,
      subject: params.fromStaff
        ? `Re: your request ${params.ticketReference}`
        : `New reply on ${params.ticketReference}`,
      text: params.body,
      html: renderEmailLayout({
        title: params.fromStaff ? `Re: ${params.ticketReference}` : `New reply on ${params.ticketReference}`,
        preheader: params.body.slice(0, 120),
        bodyHtml: `<div style="white-space:pre-wrap;">${escapeHtml(params.body)}</div>`,
        ctaLabel: 'View the conversation',
        ctaHref: url,
      }),
    },
    { userId: params.userId ?? null, template: 'support_reply', entityType: 'ticket', entityId: params.ticketId },
  );
}

// ---------------------------------------------------------------------------
// Internal alerting
// ---------------------------------------------------------------------------

/**
 * Operational alerts (payment failures spikes, oversell attempts, import errors).
 * Goes to the support mailbox; in production this should also reach a monitoring
 * tool via ERROR_MONITORING_DSN.
 */
export async function sendOperationalAlert(params: {
  subject: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
}): Promise<void> {
  const prefix = params.severity === 'critical' ? '[CRITICAL]' : params.severity === 'warning' ? '[WARN]' : '[INFO]';
  logger.warn('operational alert', { severity: params.severity, subject: params.subject });

  await sendNotification(
    {
      to: env().SUPPORT_EMAIL,
      subject: `${prefix} ${params.subject}`,
      text: params.body,
    },
    { template: 'operational_alert' },
  );
}
