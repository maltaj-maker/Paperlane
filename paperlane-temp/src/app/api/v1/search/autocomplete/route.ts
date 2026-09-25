import { NextResponse, type NextRequest } from 'next/server';

import { autocomplete } from '@/server/search';
import { consume, RATE_LIMITS, limitKey } from '@/server/rate-limit';
import { getAnalyticsContext, getClientIpForLimit } from '@/server/request-context';
import { trackEvent } from '@/server/analytics';
import { ANALYTICS_EVENT } from '@/lib/constants';
import { logger } from '@/lib/logger';

/**
 * GET /api/v1/search/autocomplete?q=…
 *
 * Public, unauthenticated, and therefore rate-limited per IP. Returns a small
 * mixed list — books, authors, genres and ISBN hits — because one input serving
 * every intent is what people expect on a phone.
 *
 * Search queries are recorded as analytics (they tell us what to stock) but the
 * query string is never associated with an account in a form we could use to
 * profile someone: we store the session id, not the user id.
 *
 * Responses are cacheable for a short window to absorb the burst of keystrokes
 * that comes from a popular Reel.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const started = Date.now();
  const query = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 120);

  if (query.length < 2) {
    return NextResponse.json(
      { suggestions: [], didYouMean: null, tookMs: 0 },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const ip = await getClientIpForLimit();
    const limit = await consume('AUTOCOMPLETE', limitKey('autocomplete:ip', ip), RATE_LIMITS.AUTOCOMPLETE);

    if (!limit.allowed) {
      // 429 rather than an error page: the client just stops showing suggestions.
      return NextResponse.json(
        { suggestions: [], didYouMean: null, tookMs: 0, error: 'rate_limited' },
        {
          status: 429,
          headers: { 'Retry-After': String(limit.retryAfterSeconds), 'Cache-Control': 'no-store' },
        },
      );
    }

    const result = await autocomplete(query, 8);

    // Fire-and-forget: never let analytics slow down or break the typeahead.
    const context = await getAnalyticsContext();
    void trackEvent({
      name: ANALYTICS_EVENT.SEARCH,
      sessionId: context.sessionId,
      path: '/api/v1/search/autocomplete',
      referrer: context.referrer,
      device: context.device,
      props: { query, resultCount: result.suggestions.length, phase: 'autocomplete' },
    });

    return NextResponse.json(
      {
        suggestions: result.suggestions,
        didYouMean: result.didYouMean,
        tookMs: result.tookMs,
      },
      {
        headers: {
          // Short shared cache: repeated keystrokes for the same prefix are
          // common during a traffic spike, and the result is not personalised.
          'Cache-Control': 'public, max-age=30, s-maxage=60',
        },
      },
    );
  } catch (err) {
    logger.error('autocomplete failed', { err, tookMs: Date.now() - started });
    // Degrade to "no suggestions" rather than a visible error — typing a search
    // should never be interrupted by a failed suggestion request.
    return NextResponse.json(
      { suggestions: [], didYouMean: null, tookMs: Date.now() - started },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
