import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { trackEvent, isAllowedClientEvent } from '@/server/analytics';
import { recordView } from '@/server/catalogue';
import { consume, RATE_LIMITS, limitKey } from '@/server/rate-limit';
import { getAnalyticsContext, getClientIpForLimit } from '@/server/request-context';
import { logger } from '@/lib/logger';

/**
 * POST /api/v1/analytics/event
 *
 * First-party event collection. This is what the admin dashboard actually
 * reports on, and it is deliberately not dependent on a third-party tag being
 * loaded — ad blockers block Google's endpoint, they do not block ours.
 *
 * Three guards, because an open write endpoint is an invitation:
 *   1. an allow-list of event names (`isAllowedClientEvent`) so nobody can
 *      poison the table with arbitrary rows,
 *   2. a strict size cap on the props payload,
 *   3. a per-IP rate limit.
 *
 * Revenue is *never* derived from these events. Money is read from `Order`.
 * An event that lies about a purchase therefore cannot inflate a report.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  name: z.string().min(1).max(60),
  params: z.record(z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const ip = await getClientIpForLimit();
    const limit = await consume('SEARCH', limitKey('analytics:ip', ip), {
      limit: 300,
      windowSeconds: 60,
    });

    if (!limit.allowed) {
      return NextResponse.json({ ok: true }, { status: 202 }); // silently drop
    }

    // Cap the body before parsing: a 10MB "event" is an attack, not a signal.
    const raw = await request.text();
    if (raw.length > 4_000) {
      return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
    }

    const parsed = bodySchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_event' }, { status: 400 });
    }

    if (!isAllowedClientEvent(parsed.data.name)) {
      // 202, not 403: a rejected event name should not teach a probe what the
      // allow-list contains.
      return NextResponse.json({ ok: true }, { status: 202 });
    }

    const context = await getAnalyticsContext();

    // A product view also updates the customer's recently-viewed rail. It is
    // recorded here — not during the cached page render — so it fires once per
    // actual visit rather than once per cache window.
    if (parsed.data.name === 'view_item' && typeof parsed.data.params?.bookId === 'string') {
      await recordView(parsed.data.params.bookId, {
        userId: context.userId,
        guestToken: context.userId ? null : context.sessionId,
      });
    }

    await trackEvent({
      name: parsed.data.name,
      sessionId: context.sessionId,
      userId: context.userId,
      // The client knows which page it is on; we accept it as a hint only and
      // keep it short so it cannot be used as a storage channel.
      path:
        typeof parsed.data.params?.path === 'string'
          ? parsed.data.params.path.slice(0, 500)
          : context.path,
      referrer: context.referrer,
      device: context.device,
      props: parsed.data.params,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Analytics must never surface an error to the customer.
    logger.debug('client analytics rejected', { err: String(err) });
    return NextResponse.json({ ok: true }, { status: 202 });
  }
}
