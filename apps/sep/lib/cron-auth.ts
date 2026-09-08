import { NextResponse } from 'next/server';

/**
 * Cron routes mutate real state and send real email, so they are never open.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when the
 * project defines CRON_SECRET, and any external scheduler can send the same
 * header. With no secret configured the route refuses to run rather than
 * quietly exposing a send trigger.
 */
export function authorizeCron(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured, so scheduled runs are disabled.' },
      { status: 503 },
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!provided || !timingSafeEqual(provided, secret)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  return null;
}

/** Constant-time comparison, so a wrong secret leaks nothing through timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}
