/**
 * Sessions and the current user.
 *
 * The browser holds a random 32-byte token in an httpOnly cookie. Only the
 * SHA-256 digest of that token is stored, so a database dump does not let
 * anyone sign in as someone else — the same reasoning as storing password
 * hashes rather than passwords.
 *
 * `proxy.ts` does a cheap cookie-presence check for fast redirects. It is
 * not the security boundary: every page load resolves the session against the
 * database here, and every server action calls `requireUser()` for itself,
 * because a server action is its own HTTP request and a layout never runs for it.
 */
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from './prisma';
import { SESSION_COOKIE } from './session-cookie';
import { verifyPassword } from './password';
import {
  createSessionRecord,
  deleteSessionByToken,
  resolveSessionToken,
} from './session-store';

export { purgeExpiredSessions } from './session-store';

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
};

/** Thrown by requireUser() inside a server action, caught by the action's own try/catch. */
export class NotSignedInError extends Error {
  constructor() {
    super('You are signed out. Reload the page and sign in again.');
    this.name = 'NotSignedInError';
  }
}

/**
 * A well-formed hash of nothing, verified against when the address is unknown so
 * a missing account costs the same wall-clock time as a wrong password.
 */
const DUMMY_HASH = `s1:${Buffer.alloc(16).toString('base64')}:${Buffer.alloc(64).toString('base64')}`;

/** How many accounts exist. Zero means this install still needs its first one. */
export async function userCount(): Promise<number> {
  return prisma.user.count();
}

/**
 * Verifies an email and password. Returns null for a wrong password, an unknown
 * address or a deactivated account — the caller must not tell them apart, or the
 * form becomes a way to enumerate who has an account.
 */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  });

  if (!user || !user.isActive) {
    // Still spend the time a real verification would, so a missing address and
    // a wrong password take the same wall-clock time to answer.
    await verifyPassword(password, DUMMY_HASH);
    return null;
  }

  if (!(await verifyPassword(password, user.passwordHash))) return null;

  return { id: user.id, email: user.email, name: user.name };
}

/** Issues a session for a user and sets the cookie. Server actions only. */
export async function startSession(userId: string): Promise<void> {
  const headerList = await headers();
  const { token, expiresAt } = await createSessionRecord(
    userId,
    headerList.get('user-agent')?.slice(0, 500) ?? null,
  );

  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

/** Ends the caller's session and clears the cookie. Server actions only. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSessionByToken(token);
  jar.delete(SESSION_COOKIE);
}

/**
 * The signed-in user, or null. Safe to call from a server component; it never
 * writes a cookie, because a server component is not allowed to.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const user = await resolveSessionToken(token);
  if (!user) return null;

  return { id: user.id, email: user.email, name: user.name };
}

/**
 * The signed-in user, or a redirect to the sign-in page. Use from layouts and
 * pages, where a redirect is the right answer.
 */
export async function requireUserOrRedirect(next?: string): Promise<SessionUser> {
  const user = await currentUser();
  if (user) return user;

  const target = next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login';
  redirect(target);
}

/**
 * The signed-in user, or a thrown NotSignedInError. Use from server actions and
 * route handlers, where the caller turns it into an error the UI can render.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new NotSignedInError();
  return user;
}
