import { prisma } from './prisma';
import { LeadStatus, SuppressionReason } from './generated/prisma';

/**
 * Bounce classification and address suppression.
 *
 * Two things matter for deliverability: never send to an address that has hard
 * bounced, and do not treat a temporary failure as permanent. Mailbox providers
 * judge a sender partly on how many dead addresses it keeps hitting, so a
 * suppression list is a sending-reputation control, not bookkeeping.
 *
 * Suppression is keyed on the address, not the lead, because the same owner can
 * sit in several campaigns.
 */

/** How many soft bounces an address may collect before it is suppressed. */
export const SOFT_BOUNCE_LIMIT = 3;

export type BounceKind = 'hard' | 'soft' | 'none';

export type BounceVerdict = {
  kind: BounceKind;
  /** Address the report says failed, when the report names one. */
  recipient: string | null;
  /** Enhanced status code such as 5.1.1, when present. */
  status: string | null;
  /** Short human-readable reason, safe to store on the log row. */
  detail: string | null;
};

const FINAL_RECIPIENT = /(?:Final|Original)-Recipient:\s*(?:rfc822\s*;)?\s*<?([^\s<>;]+@[^\s<>;]+)/i;
const ENHANCED_STATUS = /^\s*Status:\s*([245])\.(\d+)\.(\d+)/im;
const ACTION_FAILED = /^\s*Action:\s*failed/im;
const SMTP_REPLY_CODE = /(?:^|\s)([45]\d\d)[\s-]/m;

// Phrasings used by providers that do not send a machine-readable report.
const HARD_TEXT =
  /(user unknown|no such user|does not exist|doesn'?t exist|unknown recipient|recipient (?:address )?rejected|mailbox (?:is )?unavailable|address (?:is )?not found|invalid (?:recipient|mailbox|address)|account (?:has been )?disabled|no mailbox here|domain not found)/i;
const SOFT_TEXT =
  /(mailbox (?:is )?full|over ?quota|quota exceeded|insufficient storage|temporar(?:y|ily)|try again later|greylist|deferred|rate limited|too many (?:messages|connections)|service unavailable)/i;

/**
 * Reads a delivery status notification. Prefers the machine-readable
 * delivery-status part, and falls back to the wording providers use when they
 * do not send one.
 */
export function classifyBounce(input: {
  subject?: string | null;
  body?: string | null;
  deliveryStatus?: string | null;
}): BounceVerdict {
  const report = [input.deliveryStatus ?? '', input.body ?? ''].join('\n');
  const haystack = [input.subject ?? '', report].join('\n');

  const recipient = report.match(FINAL_RECIPIENT)?.[1]?.trim().toLowerCase() ?? null;

  const enhanced = report.match(ENHANCED_STATUS);
  if (enhanced) {
    const status = `${enhanced[1]}.${enhanced[2]}.${enhanced[3]}`;
    if (enhanced[1] === '5') {
      return { kind: 'hard', recipient, status, detail: describe(report) ?? `Permanent failure ${status}` };
    }
    if (enhanced[1] === '4') {
      return { kind: 'soft', recipient, status, detail: describe(report) ?? `Temporary failure ${status}` };
    }
    // 2.x.x is a success report, e.g. a delivery receipt.
    return { kind: 'none', recipient, status, detail: null };
  }

  const replyCode = report.match(SMTP_REPLY_CODE)?.[1] ?? null;
  const failed = ACTION_FAILED.test(report);

  if (SOFT_TEXT.test(haystack) || replyCode?.startsWith('4')) {
    return { kind: 'soft', recipient, status: replyCode, detail: describe(haystack) ?? 'Temporary delivery failure' };
  }
  if (HARD_TEXT.test(haystack) || replyCode?.startsWith('5') || failed) {
    return { kind: 'hard', recipient, status: replyCode, detail: describe(haystack) ?? 'Permanent delivery failure' };
  }

  return { kind: 'none', recipient, status: null, detail: null };
}

/** Pulls the provider's own diagnostic line out, trimmed for storage. */
function describe(text: string): string | null {
  const diagnostic = text.match(/Diagnostic-Code:\s*(?:smtp\s*;)?\s*([^\n\r]+)/i)?.[1];
  const line = diagnostic ?? text.match(/^.*?\b[45]\d\d\b.*$/m)?.[0];
  return line ? line.trim().slice(0, 300) : null;
}

/** Classifies a failure reported by the SMTP server at send time. */
export function classifySmtpError(error: unknown): BounceKind {
  const code = (error as { responseCode?: number } | null)?.responseCode;
  const response = String((error as { response?: string } | null)?.response ?? '');
  const message = error instanceof Error ? error.message : String(error ?? '');

  if (typeof code === 'number') {
    if (code >= 500 && code < 600) return 'hard';
    if (code >= 400 && code < 500) return 'soft';
  }

  const haystack = `${response}\n${message}`;
  if (SOFT_TEXT.test(haystack)) return 'soft';
  if (HARD_TEXT.test(haystack)) return 'hard';
  return 'none';
}

export async function isSuppressed(email: string): Promise<boolean> {
  const found = await prisma.suppressedAddress.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true },
  });
  return Boolean(found);
}

export type SuppressionResult = {
  email: string;
  reason: SuppressionReason;
  /** Leads moved to BOUNCED as a result, across every campaign. */
  leadsHalted: number;
};

/**
 * Adds an address to the suppression list and halts it everywhere.
 *
 * Leads move to BOUNCED rather than OPTED_OUT: the recipient did not ask to
 * leave, the address is simply undeliverable, and the two want different
 * reporting.
 */
export async function suppressAddress(
  email: string,
  reason: SuppressionReason,
  detail?: string | null,
  now = new Date(),
): Promise<SuppressionResult> {
  const address = email.trim().toLowerCase();

  await prisma.suppressedAddress.upsert({
    where: { email: address },
    create: { email: address, reason, detail: detail ?? null },
    update: { reason, detail: detail ?? undefined, bounceCount: { increment: 1 } },
  });

  const halted = await prisma.lead.updateMany({
    where: { email: address, status: { notIn: [LeadStatus.BOUNCED, LeadStatus.OPTED_OUT] } },
    data: { status: LeadStatus.BOUNCED, bouncedAt: now, nextSendAt: null },
  });

  return { email: address, reason, leadsHalted: halted.count };
}

export type SoftBounceResult =
  | { status: 'counted'; softBounces: number }
  | { status: 'suppressed'; softBounces: number; suppression: SuppressionResult };

/**
 * Records a temporary failure. An address that keeps failing is eventually
 * treated as dead, because repeatedly hitting it costs sending reputation.
 */
export async function recordSoftBounce(
  lead: { id: string; email: string },
  detail?: string | null,
): Promise<SoftBounceResult> {
  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: { softBounceCount: { increment: 1 } },
    select: { softBounceCount: true },
  });

  if (updated.softBounceCount < SOFT_BOUNCE_LIMIT) {
    return { status: 'counted', softBounces: updated.softBounceCount };
  }

  const suppression = await suppressAddress(
    lead.email,
    SuppressionReason.REPEATED_SOFT_BOUNCE,
    detail ?? `Soft bounced ${updated.softBounceCount} times`,
  );
  return { status: 'suppressed', softBounces: updated.softBounceCount, suppression };
}

/** Lifts a suppression, for an address a human judges deliverable again. */
export async function unsuppressAddress(email: string): Promise<boolean> {
  const address = email.trim().toLowerCase();
  const deleted = await prisma.suppressedAddress.deleteMany({ where: { email: address } });
  if (deleted.count === 0) return false;

  await prisma.lead.updateMany({
    where: { email: address, status: LeadStatus.BOUNCED },
    data: { status: LeadStatus.UNCONTACTED, bouncedAt: null, softBounceCount: 0 },
  });
  return true;
}
