/**
 * Email worker — consumes scheduled sequence steps and dispatches them over SMTP.
 *
 * Execution guard: every job re-reads the lead immediately before dispatch and
 * refuses to send when the lead is REPLIED or OPTED_OUT, so a reply landing
 * between scheduling and dispatch still cancels the remaining sequence.
 */
import { Worker, type Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { CampaignStatus, EmailStatus, LeadStatus } from '../lib/generated/prisma';
import { connectionOptions, EMAIL_QUEUE_NAME, type SendJobData } from '../lib/queue';
import { env } from '../lib/env';
import { leadVariables, renderTemplate } from '../lib/template';
import { bodyToHtml, htmlToPlainText, injectTrackingPixel } from '../lib/tracking';
import { advanceLead, completeCampaignIfDrained, isHalted, addDays } from '../lib/sequence';
import { releaseDailySend, reserveDailySend, smtpSender, type MailSender } from '../lib/mailer';

export type SendOutcome =
  | { status: 'sent'; emailLogId: string; messageId: string | null }
  | { status: 'skipped'; reason: string }
  | { status: 'deferred'; reason: string; retryAt: Date | null }
  | { status: 'failed'; reason: string; emailLogId?: string };

export type SendDeps = {
  sendMail: MailSender;
  now: () => Date;
  appUrl: string;
};

function defaultDeps(): SendDeps {
  return { sendMail: smtpSender, now: () => new Date(), appUrl: env.appUrl };
}

export async function processSendJob(
  data: SendJobData,
  overrides: Partial<SendDeps> = {},
): Promise<SendOutcome> {
  const deps: SendDeps = { ...defaultDeps(), ...overrides };
  const now = deps.now();

  const lead = await prisma.lead.findUnique({
    where: { id: data.leadId },
    include: { campaign: { include: { sendingAccount: true } } },
  });

  if (!lead) return { status: 'skipped', reason: 'lead_not_found' };

  // ---- Execution guard -----------------------------------------------------
  if (isHalted(lead.status)) {
    await prisma.lead.update({ where: { id: lead.id }, data: { nextSendAt: null } });
    return { status: 'skipped', reason: `lead_${lead.status.toLowerCase()}` };
  }

  if (lead.campaign.status !== CampaignStatus.ACTIVE) {
    return { status: 'skipped', reason: `campaign_${lead.campaign.status.toLowerCase()}` };
  }

  if (lead.currentStep >= data.stepOrder) {
    return { status: 'skipped', reason: 'step_already_sent' };
  }

  const step = await prisma.sequenceStep.findUnique({
    where: { campaignId_stepOrder: { campaignId: lead.campaignId, stepOrder: data.stepOrder } },
  });
  if (!step) {
    await prisma.lead.update({ where: { id: lead.id }, data: { nextSendAt: null } });
    return { status: 'skipped', reason: 'step_not_found' };
  }

  // Second idempotency net beyond the deterministic job id.
  const alreadyLogged = await prisma.emailLog.findFirst({
    where: { leadId: lead.id, sequenceStepId: step.id, status: { not: EmailStatus.FAILED } },
    select: { id: true },
  });
  if (alreadyLogged) return { status: 'skipped', reason: 'already_logged' };

  const account = lead.campaign.sendingAccount;
  if (!account) return { status: 'skipped', reason: 'no_sending_account' };

  const quota = await reserveDailySend(account.id, now);
  if (!quota.allowed) {
    // Push the lead past the cap window instead of burning retries on the queue.
    const retryAt = quota.retryAt ?? addDays(now, 1);
    await prisma.lead.update({ where: { id: lead.id }, data: { nextSendAt: retryAt } });
    return { status: 'deferred', reason: quota.reason, retryAt };
  }

  const vars = leadVariables(lead);
  const subject = renderTemplate(step.subject, vars);
  const trackingId = randomUUID();
  const renderedBody = renderTemplate(step.body, vars);
  const html = injectTrackingPixel(bodyToHtml(renderedBody), trackingId, deps.appUrl);
  const text = htmlToPlainText(bodyToHtml(renderedBody));

  // The log row is written before dispatch so an open beacon that races the
  // SMTP response still finds a row to stamp. A retry of a previously failed
  // attempt reuses its row rather than stacking duplicates.
  const priorFailure = await prisma.emailLog.findFirst({
    where: { leadId: lead.id, sequenceStepId: step.id, status: EmailStatus.FAILED },
    orderBy: { sentAt: 'desc' },
  });

  const emailLog = priorFailure
    ? await prisma.emailLog.update({
        where: { id: priorFailure.id },
        data: {
          status: EmailStatus.SENT,
          subject,
          trackingId,
          sentAt: now,
          messageId: null,
          error: null,
        },
      })
    : await prisma.emailLog.create({
        data: {
          leadId: lead.id,
          campaignId: lead.campaignId,
          sequenceStepId: step.id,
          sendingAccountId: account.id,
          status: EmailStatus.SENT,
          subject,
          stepOrder: step.stepOrder,
          trackingId,
          sentAt: now,
        },
      });

  // ---- Final guard: re-read status right before dispatch -------------------
  const fresh = await prisma.lead.findUnique({
    where: { id: lead.id },
    select: { status: true },
  });
  if (!fresh || isHalted(fresh.status)) {
    if (priorFailure) {
      await prisma.emailLog.update({
        where: { id: emailLog.id },
        data: { status: EmailStatus.FAILED, error: priorFailure.error },
      });
    } else {
      await prisma.emailLog.delete({ where: { id: emailLog.id } });
    }
    await releaseDailySend(account.id);
    await prisma.lead.update({ where: { id: lead.id }, data: { nextSendAt: null } });
    return { status: 'skipped', reason: `lead_${(fresh?.status ?? 'missing').toLowerCase()}` };
  }

  try {
    const result = await deps.sendMail(account, {
      to: lead.email,
      from: account.fromEmail,
      subject,
      html,
      text,
      headers: {
        'X-SEP-Tracking-Id': trackingId,
        'X-SEP-Campaign-Id': lead.campaignId,
        'X-SEP-Lead-Id': lead.id,
      },
    });

    await prisma.emailLog.update({
      where: { id: emailLog.id },
      data: { messageId: result.messageId },
    });

    await advanceLead(lead, step.stepOrder, now);
    await completeCampaignIfDrained(lead.campaignId);

    return { status: 'sent', emailLogId: emailLog.id, messageId: result.messageId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'SMTP dispatch failed.';
    await prisma.emailLog.update({
      where: { id: emailLog.id },
      data: { status: EmailStatus.FAILED, error: reason.slice(0, 500) },
    });
    await releaseDailySend(account.id);
    // Rethrow so BullMQ applies its backoff and retry policy.
    throw new Error(reason);
  }
}

export function createEmailWorker(): Worker<SendJobData> {
  const worker = new Worker<SendJobData>(
    EMAIL_QUEUE_NAME,
    async (job: Job<SendJobData>) => processSendJob(job.data),
    {
      connection: connectionOptions(),
      concurrency: env.emailWorkerConcurrency,
      // Gentle global pacing so a burst of due steps does not hammer SMTP.
      limiter: { max: 30, duration: 60_000 },
    },
  );

  worker.on('completed', (job, result: SendOutcome) => {
    console.log(`[email-worker] ${job.id} → ${result.status}`);
  });
  worker.on('failed', (job, error) => {
    console.error(`[email-worker] ${job?.id} failed:`, error.message);
  });

  return worker;
}

// Allow running this worker on its own: `npm run worker:email`
if (process.argv[1] && process.argv[1].endsWith('email-worker.ts')) {
  const worker = createEmailWorker();
  console.log(`[email-worker] listening on ${EMAIL_QUEUE_NAME}`);
  const shutdown = async () => {
    await worker.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
