/**
 * Inbound — polls each mailbox over IMAP and halts sequences on reply.
 *
 * The BullMQ reply worker and the cron route both drive this, so reply
 * detection behaves identically either way. A matched inbound message flips
 * Lead.status to REPLIED and clears nextSendAt, which is what aborts every
 * remaining step for that lead.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { prisma } from './prisma';
import { EmailStatus, LeadStatus, type SendingAccount } from './generated/prisma';
import { env } from './env';
import { isHalted } from './sequence';
import { decryptSecret } from './crypto';
import { classifyBounce, recordSoftBounce, suppressAddress } from './bounce';
import { SuppressionReason } from './generated/prisma';

/** Normalized view of an inbound message, independent of the IMAP client. */
export type InboundMessage = {
  from: string;
  subject: string;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  receivedAt?: Date;
  /** Text body, used to read a bounce that carries no machine-readable part. */
  body?: string | null;
  /** The message/delivery-status part of a DSN, when the report includes one. */
  deliveryStatus?: string | null;
};

/** Restrict polling to one mailbox; omitted means poll every active account. */
export type ReplyJobData = {
  sendingAccountId?: string;
};

export type InboundOutcome =
  | { status: 'replied'; leadId: string; campaignId: string; cancelledSteps: number }
  | {
      status: 'bounced';
      kind: 'hard' | 'soft';
      email: string;
      leadId: string | null;
      emailLogId: string | null;
      suppressed: boolean;
    }
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

  // ---- Bounces first ------------------------------------------------------
  // A delivery report comes from the postmaster, not from the lead, so the
  // recipient has to be read out of the report itself rather than the From
  // header. Doing this before the reply path stops a bounce being mistaken for
  // a human answer.
  const looksLikeReport =
    SYSTEM_SENDER_PATTERN.test(from) ||
    /^(undeliverable|delivery status|mail delivery|returned mail|failure notice)/i.test(
      message.subject ?? '',
    );

  if (looksLikeReport) {
    const verdict = classifyBounce({
      subject: message.subject,
      body: message.body,
      deliveryStatus: message.deliveryStatus,
    });

    if (verdict.kind !== 'none') {
      // The report names the failed address; fall back to the threaded log's
      // lead when it does not.
      const bouncedEmail = verdict.recipient ?? threadedLog?.lead.email ?? null;
      if (!bouncedEmail) return { status: 'ignored', reason: 'bounce_without_recipient' };

      const bouncedLead =
        threadedLog?.lead ??
        (await prisma.lead.findFirst({
          where: { email: bouncedEmail },
          orderBy: { lastContactedAt: 'desc' },
        }));

      const target =
        threadedLog ??
        (bouncedLead
          ? await prisma.emailLog.findFirst({
              where: { leadId: bouncedLead.id },
              orderBy: { sentAt: 'desc' },
            })
          : null);

      if (target) {
        await prisma.emailLog.update({
          where: { id: target.id },
          data: {
            status: EmailStatus.BOUNCED,
            error: (verdict.detail ?? 'Bounce reported by inbound mail.').slice(0, 500),
          },
        });
      }

      if (verdict.kind === 'hard') {
        const suppression = await suppressAddress(
          bouncedEmail,
          SuppressionReason.HARD_BOUNCE,
          verdict.detail,
        );
        return {
          status: 'bounced',
          kind: 'hard',
          email: bouncedEmail,
          leadId: bouncedLead?.id ?? null,
          emailLogId: target?.id ?? null,
          suppressed: suppression.leadsHalted >= 0,
        };
      }

      let suppressed = false;
      if (bouncedLead) {
        const soft = await recordSoftBounce(
          { id: bouncedLead.id, email: bouncedEmail },
          verdict.detail,
        );
        suppressed = soft.status === 'suppressed';
      }
      return {
        status: 'bounced',
        kind: 'soft',
        email: bouncedEmail,
        leadId: bouncedLead?.id ?? null,
        emailLogId: target?.id ?? null,
        suppressed,
      };
    }
  }

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

  // A DSN carries its machine-readable verdict in a message/delivery-status
  // part, which mailparser surfaces as an attachment.
  const deliveryStatus = (parsed.attachments ?? [])
    .filter((attachment) => /delivery-status|rfc822-headers/i.test(attachment.contentType ?? ''))
    .map((attachment) => attachment.content?.toString('utf8') ?? '')
    .join('\n');

  return {
    from: fromAddress,
    subject: parsed.subject ?? '',
    messageId: parsed.messageId ?? null,
    inReplyTo: parsed.inReplyTo ?? null,
    references,
    receivedAt: parsed.date ?? new Date(),
    body: parsed.text ?? null,
    deliveryStatus: deliveryStatus || null,
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
    // Decrypted only here, at the moment of use.
    auth: { user: account.imapUser!, pass: decryptSecret(account.imapPassword!) },
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
