import { NextResponse } from 'next/server';
import { z } from 'zod';
import { consume, RATE_LIMITS, limitKey } from '@/server/rate-limit';
import { getClientIpForLimit } from '@/server/request-context';
import { quoteShipping } from '@/server/pricing';

const schema = z.object({
  country: z.string().length(2),
  state: z.string().max(80).default(''),
  postalCode: z.string().min(2).max(16),
  subtotalPaise: z.number().int().min(0),
  itemCount: z.number().int().min(1).max(100),
});

export async function POST(request: Request) {
  try {
    const ip = await getClientIpForLimit();
    const limit = await consume('SHIPPING_QUOTE', limitKey('shipping:ip', ip), RATE_LIMITS.SHIPPING_QUOTE);
    if (!limit.allowed) return NextResponse.json({ error: 'Too many quote requests. Please wait a moment.' }, { status: 429 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid shipping details.' }, { status: 400 });
    const quotes = await quoteShipping(parsed.data);
    return NextResponse.json({ quotes });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'We do not currently ship to this destination.' }, { status: 422 });
  }
}
