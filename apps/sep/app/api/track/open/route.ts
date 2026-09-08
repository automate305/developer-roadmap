import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { EmailStatus } from '@/lib/generated/prisma';
import { TRANSPARENT_GIF } from '@/lib/tracking';
import { checkRateLimit, clientKey } from '@/lib/rate-limit';

export const runtime = 'nodejs';
// The pixel must never be served from a cache, or repeat opens go unrecorded.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PIXEL_HEADERS = {
  'Content-Type': 'image/gif',
  'Content-Length': String(TRANSPARENT_GIF.byteLength),
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
} as const;

function pixel() {
  // Always 200 with a valid GIF: a broken image in the recipient's client would
  // advertise that the message is tracked.
  return new NextResponse(new Uint8Array(TRANSPARENT_GIF), { status: 200, headers: PIXEL_HEADERS });
}

export async function GET(request: Request) {
  const trackingId = new URL(request.url).searchParams.get('t');
  if (!trackingId) return pixel();

  // Throttling here protects the database, never the image: a rate-limited
  // request still gets a valid pixel, because a broken image in the recipient's
  // client would advertise that the message is tracked.
  const limit = checkRateLimit(clientKey(request, 'track'), { limit: 300, windowMs: 60_000 });
  if (!limit.allowed) return pixel();

  try {
    const log = await prisma.emailLog.findUnique({
      where: { trackingId },
      select: { id: true, openedAt: true, status: true },
    });

    if (log) {
      await prisma.emailLog.update({
        where: { id: log.id },
        data: {
          // First open stamps openedAt; later opens only bump the counter.
          openedAt: log.openedAt ?? new Date(),
          openCount: { increment: 1 },
          status: log.status === EmailStatus.SENT ? EmailStatus.OPENED : log.status,
        },
      });
    }
  } catch (error) {
    // Tracking is best-effort: a database hiccup must not break the email body.
    console.error('[track/open] failed to record open', error);
  }

  return pixel();
}

export async function HEAD() {
  return new NextResponse(null, { status: 200, headers: PIXEL_HEADERS });
}
