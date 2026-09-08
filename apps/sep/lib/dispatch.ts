/**
 * Dispatch — renders one sequence step for one lead and sends it over SMTP.
 *
 * This is the single send path. The BullMQ worker and the cron route both call
 * it, so the execution guard cannot be bypassed by choosing a runtime: every
 * call re-reads the lead immediately before dispatch and refuses to send when
 * it is REPLIED or OPTED_OUT, so a reply landing between scheduling and
 * dispatch still cancels the remaining sequence.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from './prisma';
import { CampaignStatus, EmailStatus, LeadStatus } from './generated/prisma';
import { env } from './env';
import { leadVariables, renderTemplate } from './template';
import { bodyToHtml, htmlToPlainText, injectTrackingPixel } from './tracking';
import {
  unsubscribeFooterHtml,
  unsubscribeFooterText,
  unsubscribeHeaders,
} from './unsubscribe';
import { advanceLead, completeCampaignIfDrained, isHalted, addDays } from './sequence';
import { releaseDailySend, reserveDailySend, smtpSender, type MailSender } from './mailer';
import { classifySmtpError, isSuppressed, recordSoftBounce, suppressAddress } from './bounce';
import { isWithinWindow, nextWindowOpen, withJitter } from './schedule';
import { SuppressionReason } from './generated/prisma';

/** One scheduled sequence step for one lead. */
export type SendJobData = {
  leadId: string;
  campaignId: string;
  stepOrder: number;
};

export type SendOutcome =
  | { status: 'sent'; emailLogId: string; messageId: string | null }
  | { status: 'bounced'; emailLogId: string; reason: string }
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

  // The address may have bounced under a different campaign.
  if (await isSuppressed(lead.email)) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: LeadStatus.BOUNCED, bouncedAt: now, nextSendAt: null },
    });
    return { status: 'skipped', reason: 'address_suppressed' };
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

  // The mailbox only sends inside its own working hours. A lead that comes due
  // outside them is pushed to the next opening rather than sent at 3am.
  if (!isWithinWindow(now, account)) {
    const opensAt = withJitter(nextWindowOpen(now, account), account.jitterMinutes);
    await prisma.lead.update({ where: { id: lead.id }, data: { nextSendAt: opensAt } });
    return { status: 'deferred', reason: 'outside_send_window', retryAt: opensAt };
  }

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
  // Every outbound message carries a way out, in the body and in the headers.
  const bodyHtml = bodyToHtml(renderedBody) + unsubscribeFooterHtml(lead.unsubscribeToken, deps.appUrl);
  const html = injectTrackingPixel(bodyHtml, trackingId, deps.appUrl);
  const text =
    htmlToPlainText(bodyToHtml(renderedBody)) +
    unsubscribeFooterText(lead.unsubscribeToken, deps.appUrl);

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
        ...unsubscribeHeaders(lead.unsubscribeToken, deps.appUrl),
        'X-SEP-Tracking-Id': trackingId,
        'X-SEP-Campaign-Id': lead.campaignId,
        'X-SEP-Lead-Id': lead.id,
      },
    });

    await prisma.emailLog.update({
      where: { id: emailLog.id },
      data: { messageId: result.messageId },
    });

    await advanceLead(lead, step.stepOrder, now, account.jitterMinutes);
    await completeCampaignIfDrained(lead.campaignId);

    return { status: 'sent', emailLogId: emailLog.id, messageId: result.messageId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'SMTP dispatch failed.';
    const kind = classifySmtpError(error);

    await prisma.emailLog.update({
      where: { id: emailLog.id },
      data: {
        status: kind === 'hard' ? EmailStatus.BOUNCED : EmailStatus.FAILED,
        error: reason.slice(0, 500),
      },
    });
    await releaseDailySend(account.id);

    if (kind === 'hard') {
      // A permanent rejection is answered now, not retried: further attempts
      // only cost sending reputation.
      await suppressAddress(lead.email, SuppressionReason.HARD_BOUNCE, reason);
      return { status: 'bounced', emailLogId: emailLog.id, reason };
    }

    if (kind === 'soft') {
      await recordSoftBounce(lead, reason);
    }

    // Rethrow so BullMQ applies its backoff and retry policy.
    throw new Error(reason);
  }
}
