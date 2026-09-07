/**
 * Reply worker — polls each mailbox over IMAP and halts sequences on reply.
 *
 * Runs on a BullMQ repeatable schedule (every REPLY_POLL_MINUTES, default 2).
 * A matched inbound message flips Lead.status to REPLIED and clears nextSendAt,
 * which is what aborts every remaining step for that lead.
 */
import { Worker, type Job } from 'bullmq';
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { prisma } from '../lib/prisma';
import { EmailStatus, LeadStatus, type SendingAccount } from '../lib/generated/prisma';
import { connectionOptions, REPLY_QUEUE_NAME, type ReplyJobData } from '../lib/queue';
import { env } from '../lib/env';
import { isHalted } from '../lib/sequence';

/** Normalized view of an inbound message, independent of the IMAP client. */
export type InboundMessage = {
  from: string;
  subject: string;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  receivedAt?: Date;
};

export type InboundOutcome =
  | { status: 'replied'; leadId: string; campaignId: string; cancelledSteps: number }
  | { status: 'bounced'; leadId: string; emailLogId: string }
  | { status: 'ignored'; reason: string };

const AUTO_REPLY_PATTERN =
  /^(auto[- ]?reply|automatic reply|out of office|ooo\b|away from|vacation|undeliverable)/i;
const SYSTEM_SENDER_PATTERN = /(mailer-daemon|postmaster|no-?reply|bounce)/i;

function normalizeMessageId(value?: string | null): string | null {
  if (!value) return null;
  const match = value.match(/<[^>]+>/);
  return (match ? match[0] : value).trim() || null;
}

/**
 * Applies one inbound message to the pipeline. Exported so the reply path can be
 * exercised without a live IMAP server.
 */
export async function handleInboundMessage(
  message: InboundMessage,
  options: { sendingAccountId?: string } = {},
): Promise<InboundOutcome> {
  const from = message.from.trim().toLowerCase();
  if (!from) return { status: 'ignored', reason: 'no_sender' };

  const threadIds = [
    normalizeMessageId(message.inReplyTo),
    ...(message.references ?? []).map(normalizeMessageId),
  ].filter((value): value is string => Boolean(value));

  // Thread headers are the strongest signal; sender address is the fallback for
  // clients that strip References.
  const threadedLog = threadIds.length
    ? await prisma.emailLog.findFirst({
        where: { messageId: { in: threadIds } },
        include: { lead: true },
        orderBy: { sentAt: 'desc' },
      })
    : null;

  const lead =
    threadedLog?.lead ??
    (await prisma.lead.findFirst({
      where: {
        email: from,
        emailLogs: { some: {} },
        ...(options.sendingAccountId
          ? { campaign: { sendingAccountId: options.sendingAccountId } }
          : {}),
      },
      orderBy: { lastContactedAt: 'desc' },
    }));

  if (!lead) return { status: 'ignored', reason: 'no_matching_lead' };

  // A delivery failure notice is not a human reply: log the bounce, keep the
  // lead schedule untouched for the operator to decide.
  if (SYSTEM_SENDER_PATTERN.test(from) || /^(undeliverable|delivery status|mail delivery)/i.test(message.subject ?? '')) {
    const target =
      threadedLog ??
      (await prisma.emailLog.findFirst({ where: { leadId: lead.id }, orderBy: { sentAt: 'desc' } }));
    if (!target) return { status: 'ignored', reason: 'bounce_without_log' };

    await prisma.emailLog.update({
      where: { id: target.id },
      data: { status: EmailStatus.BOUNCED, error: 'Bounce reported by inbound mail.' },
    });
    return { status: 'bounced', leadId: lead.id, emailLogId: target.id };
  }

  if (AUTO_REPLY_PATTERN.test(message.subject ?? '')) {
    return { status: 'ignored', reason: 'auto_reply' };
  }

  if (isHalted(lead.status)) {
    return { status: 'ignored', reason: `lead_already_${lead.status.toLowerCase()}` };
  }

  const remainingSteps = await prisma.sequenceStep.count({
    where: { campaignId: lead.campaignId, stepOrder: { gt: lead.currentStep } },
  });

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status: LeadStatus.REPLIED,
      repliedAt: message.receivedAt ?? new Date(),
      // Clearing the schedule is what cancels every remaining step.
      nextSendAt: null,
    },
  });

  return {
    status: 'replied',
    leadId: lead.id,
    campaignId: lead.campaignId,
    cancelledSteps: remainingSteps,
  };
}

function toInbound(parsed: ParsedMail): InboundMessage {
  const fromAddress = parsed.from?.value?.[0]?.address ?? '';
  const references = Array.isArray(parsed.references)
    ? parsed.references
    : parsed.references
      ? [parsed.references]
      : [];

  return {
    from: fromAddress,
    subject: parsed.subject ?? '',
    messageId: parsed.messageId ?? null,
    inReplyTo: parsed.inReplyTo ?? null,
    references,
    receivedAt: parsed.date ?? new Date(),
  };
}

export function hasImapConfig(account: SendingAccount): boolean {
  return Boolean(account.imapHost && account.imapUser && account.imapPassword);
}

/** Polls one mailbox for messages newer than the overlapping poll window. */
export async function pollAccount(
  account: SendingAccount,
  now = new Date(),
): Promise<InboundOutcome[]> {
  if (!hasImapConfig(account)) return [];

  const client = new ImapFlow({
    host: account.imapHost!,
    port: account.imapPort ?? 993,
    secure: account.imapSecure,
    auth: { user: account.imapUser!, pass: account.imapPassword! },
    logger: false,
  });

  const outcomes: InboundOutcome[] = [];

  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      // Window is twice the poll interval so a slow delivery is not missed at
      // the boundary; per-lead guards make re-processing harmless.
      const since = new Date(now.getTime() - env.replyPollMinutes * 2 * 60_000);

      for await (const message of client.fetch({ since }, { source: true, uid: true })) {
        if (!message.source) continue;
        try {
          const parsed = await simpleParser(message.source);
          const outcome = await handleInboundMessage(toInbound(parsed), {
            sendingAccountId: account.id,
          });
          outcomes.push(outcome);
        } catch (error) {
          console.error('[reply-worker] could not process message', error);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }

  return outcomes;
}

export async function pollAllAccounts(data: ReplyJobData = {}): Promise<InboundOutcome[]> {
  const accounts = await prisma.sendingAccount.findMany({
    where: {
      isActive: true,
      ...(data.sendingAccountId ? { id: data.sendingAccountId } : {}),
      imapHost: { not: null },
    },
  });

  const outcomes: InboundOutcome[] = [];
  for (const account of accounts) {
    try {
      outcomes.push(...(await pollAccount(account)));
    } catch (error) {
      // One unreachable mailbox must not stop the others.
      console.error(`[reply-worker] poll failed for ${account.fromEmail}:`, error);
    }
  }
  return outcomes;
}

export function createReplyWorker(): Worker<ReplyJobData> {
  const worker = new Worker<ReplyJobData>(
    REPLY_QUEUE_NAME,
    async (job: Job<ReplyJobData>) => pollAllAccounts(job.data),
    { connection: connectionOptions(), concurrency: 1 },
  );

  worker.on('completed', (job, result: InboundOutcome[]) => {
    const replied = result.filter((outcome) => outcome.status === 'replied').length;
    if (replied > 0) console.log(`[reply-worker] ${job.id} → ${replied} lead(s) marked REPLIED`);
  });
  worker.on('failed', (job, error) => {
    console.error(`[reply-worker] ${job?.id} failed:`, error.message);
  });

  return worker;
}

if (process.argv[1] && process.argv[1].endsWith('reply-worker.ts')) {
  const worker = createReplyWorker();
  console.log(`[reply-worker] listening on ${REPLY_QUEUE_NAME}`);
  const shutdown = async () => {
    await worker.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
