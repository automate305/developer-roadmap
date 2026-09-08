/**
 * Session records, with no Next.js imports.
 *
 * Split out from lib/auth.ts so the parts that only touch the database can be
 * exercised by scripts and tests: lib/auth.ts reaches for `next/headers` and
 * `next/navigation`, which only exist inside a request.
 */
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from './prisma';
import { SESSION_TTL_MS } from './session-cookie';

/** Only the digest is ever stored, so a database dump yields no usable tokens. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSessionRecord(
  userId: string,
  userAgent: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: { tokenHash: hashSessionToken(token), userId, expiresAt, userAgent },
  });

  return { token, expiresAt };
}

/** The session's user, or null when the token is unknown, expired or deactivated. */
export async function resolveSessionToken(token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  if (!session.user.isActive) return null;
  return session.user;
}

export async function deleteSessionByToken(token: string): Promise<void> {
  // deleteMany rather than delete: an already-gone session must still sign the
  // browser out, not throw.
  await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}

export async function deleteSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

/** Housekeeping: drops sessions that have already expired. */
export async function purgeExpiredSessions(now = new Date()): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { expiresAt: { lte: now } } });
  return result.count;
}
