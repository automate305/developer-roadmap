import { NextResponse } from 'next/server';
import { optOutByToken } from '@/lib/unsubscribe';
import { toMessage } from '@/lib/errors';
import { checkRateLimit, clientKey } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * RFC 8058 one-click unsubscribe target.
 *
 * Mail clients POST here when the recipient uses their native unsubscribe
 * button. It acts immediately and needs no authentication beyond the token,
 * which is what the RFC requires. GET is deliberately not an opt-out: link
 * scanners follow links in inbound mail, so a GET only redirects to the
 * confirmation page.
 */
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('t') ?? '';

  // Unauthenticated and token-guessable by design, so it is throttled to stop
  // the token space being probed.
  const limit = checkRateLimit(clientKey(request, 'unsub'), { limit: 20, windowMs: 60_000 });
  if (!limit.allowed) {
    return new NextResponse('Too many requests. Please try again shortly.', {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfterSeconds) },
    });
  }

  try {
    const result = await optOutByToken(token);

    if (result.status === 'not_found') {
      // Deliberately vague: the token space should not be probeable.
      return new NextResponse('Unsubscribe request received.', { status: 200 });
    }

    return new NextResponse('You have been unsubscribed.', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (error) {
    console.error('[unsubscribe] one-click failed', toMessage(error));
    return new NextResponse('Could not process the request. Please try the link in the email.', {
      status: 500,
    });
  }
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('t') ?? '';
  const target = new URL(`/unsubscribe/${encodeURIComponent(token)}`, request.url);
  return NextResponse.redirect(target, 302);
}
