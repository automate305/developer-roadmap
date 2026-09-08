/**
 * A small fixed-window rate limiter for the endpoints that face the open
 * internet: the tracking pixel, the unsubscribe routes and lead import.
 *
 * Counters live in process memory. On a serverless platform each instance keeps
 * its own, so the effective limit is per instance rather than global — enough to
 * blunt casual abuse and accidental loops, not a defence against a distributed
 * attacker. Moving the store to Redis would make it exact; the interface below
 * is deliberately narrow so that swap is a single file.
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 60_000;

/** Drops expired windows so the map cannot grow without bound. */
function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function checkRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
  now = Date.now(),
): RateLimitResult {
  sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, remaining: options.limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const remaining = Math.max(0, options.limit - existing.count);

  return {
    allowed: existing.count <= options.limit,
    remaining,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/**
 * Best-effort client identity. Behind Vercel the first entry of
 * x-forwarded-for is the real client; everything else is a proxy hop.
 */
export function clientKey(request: Request, prefix: string): string {
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const ip =
    forwarded.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown';
  return `${prefix}:${ip}`;
}

/**
 * True when the request came from this deployment's own pages.
 *
 * The app has no user authentication of its own, so this is not a security
 * boundary — a direct client can set any Origin it likes. It stops a page on
 * another site from posting here on a visitor's behalf, which is the realistic
 * abuse for a browser-called endpoint.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // Same-origin GETs and server-side calls send none.

  try {
    const host = request.headers.get('host');
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
