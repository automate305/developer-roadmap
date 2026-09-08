'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import {
  endSession,
  requireUser,
  startSession,
  userCount,
  verifyCredentials,
} from '@/lib/auth';
import { deleteSessionsForUser } from '@/lib/session-store';
import { hashPassword, passwordProblem } from '@/lib/password';
import { checkRateLimit } from '@/lib/rate-limit';
import { ok, fail, type ActionResult } from '@/lib/errors';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Best-effort client address, for rate limiting sign-in attempts. */
async function clientAddress(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get('x-forwarded-for') ?? '';
  return forwarded.split(',')[0]?.trim() || headerList.get('x-real-ip')?.trim() || 'unknown';
}

function readCredentials(formData: FormData): { email: string; password: string } {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  if (!EMAIL_PATTERN.test(email)) throw new Error('Enter a valid email address.');
  if (!password) throw new Error('Enter your password.');
  return { email, password };
}

export async function signIn(formData: FormData): Promise<ActionResult> {
  try {
    const address = await clientAddress();

    // Ten attempts per address per five minutes. Enough for a fat-fingered
    // password, not enough to work through a list.
    const limit = checkRateLimit(`signin:${address}`, { limit: 10, windowMs: 5 * 60_000 });
    if (!limit.allowed) {
      throw new Error(
        `Too many sign-in attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
      );
    }

    const { email, password } = readCredentials(formData);
    const user = await verifyCredentials(email, password);

    // One message for every kind of failure: a distinct "no such account" would
    // turn this form into a way to find out who has one.
    if (!user) throw new Error('That email and password do not match an account.');

    await startSession(user.id);
    return ok();
  } catch (error) {
    return fail(error, 'Could not sign you in.');
  }
}

/**
 * Creates the very first account on an empty install. Refuses once any account
 * exists, so this cannot be used to add a second one from outside.
 */
export async function createFirstUser(formData: FormData): Promise<ActionResult> {
  try {
    if ((await userCount()) > 0) {
      throw new Error('This platform already has an account. Sign in instead.');
    }

    const { email, password } = readCredentials(formData);
    const name = String(formData.get('name') ?? '').trim() || null;

    const problem = passwordProblem(password);
    if (problem) throw new Error(problem);

    const user = await prisma.user.create({
      data: { email, name, passwordHash: await hashPassword(password) },
    });

    await startSession(user.id);
    return ok();
  } catch (error) {
    return fail(error, 'Could not create the account.');
  }
}

/** Adds a colleague. Only someone already signed in can do this. */
export async function inviteUser(formData: FormData): Promise<ActionResult> {
  try {
    await requireUser();

    const { email, password } = readCredentials(formData);
    const name = String(formData.get('name') ?? '').trim() || null;

    const problem = passwordProblem(password);
    if (problem) throw new Error(problem);

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new Error('An account already uses that email address.');

    await prisma.user.create({
      data: { email, name, passwordHash: await hashPassword(password) },
    });

    revalidatePath('/settings');
    return ok();
  } catch (error) {
    return fail(error, 'Could not create that account.');
  }
}

export async function changePassword(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();

    const current = String(formData.get('currentPassword') ?? '');
    const next = String(formData.get('newPassword') ?? '');

    if (!(await verifyCredentials(user.email, current))) {
      throw new Error('Your current password is not right.');
    }

    const problem = passwordProblem(next);
    if (problem) throw new Error(problem);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(next) },
    });

    // Every browser holding a session for this account is signed out — a password
    // change is usually a response to thinking one was exposed — and this one is
    // then given a fresh session so the operator is not booted mid-task.
    await deleteSessionsForUser(user.id);
    await startSession(user.id);

    revalidatePath('/settings');
    return ok();
  } catch (error) {
    return fail(error, 'Could not change your password.');
  }
}

export async function signOut(): Promise<never> {
  await endSession();
  redirect('/login');
}
