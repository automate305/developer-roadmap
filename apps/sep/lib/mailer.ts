import nodemailer, { type Transporter } from 'nodemailer';
import { prisma } from './prisma';
import type { SendingAccount } from './generated/prisma';

export type OutboundMessage = {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

export type SendResult = { messageId: string | null; accepted: string[] };

/** Injectable so tests and the pipeline simulation can run without an SMTP server. */
export type MailSender = (account: SendingAccount, message: OutboundMessage) => Promise<SendResult>;

const transports = new Map<string, Transporter>();

function transportKey(account: SendingAccount): string {
  return [account.id, account.smtpHost, account.smtpPort, account.smtpUser, account.updatedAt.getTime()].join(
    '|',
  );
}

export function getTransport(account: SendingAccount): Transporter {
  const key = transportKey(account);
  const existing = transports.get(key);
  if (existing) return existing;

  const transport = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    auth: { user: account.smtpUser, pass: account.smtpPassword },
    pool: true,
    maxConnections: 2,
    maxMessages: 50,
  });

  transports.set(key, transport);
  return transport;
}

export const smtpSender: MailSender = async (account, message) => {
  const transport = getTransport(account);
  const info = await transport.sendMail({
    from: `"${account.fromName}" <${account.fromEmail}>`,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    headers: message.headers,
  });

  return {
    messageId: info.messageId ?? null,
    accepted: (info.accepted ?? []).map(String),
  };
};

function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export function nextUtcMidnight(from = new Date()): Date {
  const next = new Date(from);
  next.setUTCHours(24, 0, 0, 0);
  return next;
}

export type QuotaResult =
  | { allowed: true; remaining: number }
  | { allowed: false; reason: 'inactive' | 'cap_reached'; retryAt: Date | null };

/**
 * Claims one send against a mailbox's daily cap. The counter is rolled over
 * lazily on the first send of a new UTC day, and the conditional update makes
 * the claim safe across concurrent workers.
 */
export async function reserveDailySend(accountId: string, now = new Date()): Promise<QuotaResult> {
  const account = await prisma.sendingAccount.findUnique({ where: { id: accountId } });
  if (!account) return { allowed: false, reason: 'inactive', retryAt: null };
  if (!account.isActive) return { allowed: false, reason: 'inactive', retryAt: null };

  const sentToday = isSameUtcDay(account.lastResetAt, now) ? account.sentToday : 0;
  if (sentToday >= account.maxDaily) {
    return { allowed: false, reason: 'cap_reached', retryAt: nextUtcMidnight(now) };
  }

  const claimed = await prisma.sendingAccount.updateMany({
    where: { id: accountId, sentToday: account.sentToday, lastResetAt: account.lastResetAt },
    data: { sentToday: sentToday + 1, lastResetAt: now },
  });

  if (claimed.count === 0) {
    // Another worker moved the counter between read and write; retry once.
    return reserveDailySend(accountId, now);
  }

  return { allowed: true, remaining: account.maxDaily - (sentToday + 1) };
}

/** Returns a claimed slot when a send ultimately fails, so the cap is not burnt. */
export async function releaseDailySend(accountId: string): Promise<void> {
  try {
    await prisma.sendingAccount.updateMany({
      where: { id: accountId, sentToday: { gt: 0 } },
      data: { sentToday: { decrement: 1 } },
    });
  } catch (error) {
    console.error('[mailer] could not release daily quota', error);
  }
}
