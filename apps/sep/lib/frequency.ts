/**
 * Per-contact frequency cap.
 *
 * Daily caps are per mailbox, which is a limit on how hard we push a sending
 * domain. This is the other kind of limit: how often one human hears from us,
 * counted across every campaign they appear in.
 *
 * Without it, a prospect who lands on two lists — an HVAC list and a
 * storm-season list, say — receives both sequences in parallel and experiences
 * that as spam, no matter what the per-mailbox numbers say.
 *
 * The idea is borrowed from Mautic's frequency rules; the implementation is our
 * own, and counts against the EmailLog rows we already write.
 */
import { prisma } from './prisma';
import { EmailStatus } from './generated/prisma';
import { getSettings, type PlatformSettings } from './settings';

const DAY_MS = 24 * 60 * 60 * 1000;

export type FrequencyVerdict =
  | { allowed: true }
  | { allowed: false; recentCount: number; retryAt: Date };

/** The live policy. Separate so the send path can inject one in a test. */
export async function loadFrequencyPolicy(): Promise<PlatformSettings> {
  return getSettings();
}

/**
 * Whether this address may receive one more email right now.
 *
 * Counts delivered attempts only: a FAILED row is a message that never reached
 * the recipient, so holding it against them would be punishing them for our own
 * SMTP trouble.
 */
export async function frequencyVerdict(
  email: string,
  now: Date,
  policy: PlatformSettings,
): Promise<FrequencyVerdict> {
  const cap = policy.maxEmailsPerContact;
  if (cap <= 0) return { allowed: true }; // Zero switches the cap off.

  const windowMs = policy.contactWindowDays * DAY_MS;
  const cutoff = new Date(now.getTime() - windowMs);

  // Only the most recent `cap` rows matter: if there are fewer, we are under the
  // cap, and if there are that many the oldest of them is what has to expire.
  const recent = await prisma.emailLog.findMany({
    where: {
      sentAt: { gte: cutoff },
      status: { not: EmailStatus.FAILED },
      lead: { is: { email } },
    },
    orderBy: { sentAt: 'desc' },
    take: cap,
    select: { sentAt: true },
  });

  if (recent.length < cap) return { allowed: true };

  // The cap-th most recent send is the one whose age releases the next slot.
  const oldestCounted = recent[recent.length - 1].sentAt;
  const releasesAt = new Date(oldestCounted.getTime() + windowMs + 60_000);

  return {
    allowed: false,
    recentCount: recent.length,
    // Never schedule into the past, however the clock and the data line up.
    retryAt: releasesAt.getTime() > now.getTime() ? releasesAt : new Date(now.getTime() + 60_000),
  };
}

/**
 * How many emails an address has had inside the window. Used by the UI, which
 * wants the number rather than the verdict.
 */
export async function contactsInWindow(
  email: string,
  now: Date,
  windowDays: number,
): Promise<number> {
  return prisma.emailLog.count({
    where: {
      sentAt: { gte: new Date(now.getTime() - windowDays * DAY_MS) },
      status: { not: EmailStatus.FAILED },
      lead: { is: { email } },
    },
  });
}
