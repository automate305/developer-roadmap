/**
 * Fast path for signed-out traffic.
 *
 * This runs on the edge runtime, so it cannot reach the database. It only
 * checks whether a session cookie is present, which is enough to send a
 * signed-out browser to the sign-in page without rendering a page first.
 *
 * It is NOT the security boundary. A forged cookie gets past this and is then
 * rejected by `currentUser()` in lib/auth.ts, which every protected layout and
 * every server action calls for itself.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { PATH_HEADER, SESSION_COOKIE } from '@/lib/session-cookie';

/**
 * Paths that must stay reachable without signing in:
 *   /login              — the sign-in page itself
 *   /unsubscribe/*      — a recipient clicking the footer link
 *   /api/unsubscribe    — RFC 8058 one-click, posted by the mail client
 *   /api/track/*        — the open pixel, fetched by the recipient's mail client
 *   /api/cron/*         — the scheduler, which authenticates with a bearer token
 */
const PUBLIC_PREFIXES = [
  '/login',
  '/unsubscribe',
  '/api/unsubscribe',
  '/api/track',
  '/api/cron',
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  if (request.cookies.has(SESSION_COOKIE)) {
    // Forward where the visitor was headed. If the cookie turns out to be
    // expired or forged, the layout can still send them back here after they
    // sign in, instead of dumping them on the dashboard.
    const forwarded = new Headers(request.headers);
    forwarded.set(PATH_HEADER, pathname + search);
    return NextResponse.next({ request: { headers: forwarded } });
  }

  // An API client gets an answer it can read. Redirecting a fetch to an HTML
  // sign-in page would surface as a confusing parse error instead.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's own static output and the favicon.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
