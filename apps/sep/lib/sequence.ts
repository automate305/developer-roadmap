import { prisma } from './prisma';
import { LeadStatus, CampaignStatus, type Lead, type SequenceStep } from './generated/prisma';
import { getEmailQueue, sendJobId } from './queue';

/** A lead in one of these states is eligible for further sends. */
export const SENDABLE_LEAD_STATUSES = [LeadStatus.UNCONTACTED, LeadStatus.IN_SEQUENCE] as const;

/** A lead in one of these states must never receive another sequence email. */
export const HALTED_LEAD_STATUSES = [LeadStatus.REPLIED, LeadStatus.OPTED_OUT] as const;

export function isHalted(status: LeadStatus): boolean {
  return status === LeadStatus.REPLIED || status === LeadStatus.OPTED_OUT;
}

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Schedules every not-yet-started lead in a campaign onto its first step.
 * Called when a campaign is activated and when new leads are imported into an
 * already-running campaign.
 */
export async function scheduleCampaignLeads(campaignId: string, now = new Date()): Promise<number> {
  const firstStep = await prisma.sequenceStep.findFirst({
    where: { campaignId },
    orderBy: { stepOrder: 'asc' },
  });
  if (!firstStep) return 0;

  const result = await prisma.lead.updateMany({
    where: {
      campaignId,
      status: LeadStatus.UNCONTACTED,
      currentStep: 0,
      nextSendAt: null,
    },
    data: { nextSendAt: addDays(now, firstStep.delayDays) },
  });

  return result.count;
}

/** Clears pending schedule for a campaign, used when it is paused or completed. */
export async function unscheduleCampaignLeads(campaignId: string): Promise<number> {
  const result = await prisma.lead.updateMany({
    where: { campaignId, status: { in: [...SENDABLE_LEAD_STATUSES] } },
    data: { nextSendAt: null },
  });
  return result.count;
}

/**
 * Moves a lead to the step after `sentStepOrder`. When no further step exists
 * the lead stops being scheduled but keeps its IN_SEQUENCE status so analytics
 * still counts it as worked.
 */
export async function advanceLead(
  lead: Pick<Lead, 'id' | 'campaignId'>,
  sentStepOrder: number,
  now = new Date(),
): Promise<{ nextStep: SequenceStep | null }> {
  const nextStep = await prisma.sequenceStep.findFirst({
    where: { campaignId: lead.campaignId, stepOrder: { gt: sentStepOrder } },
    orderBy: { stepOrder: 'asc' },
  });

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status: LeadStatus.IN_SEQUENCE,
      currentStep: sentStepOrder,
      lastContactedAt: now,
      nextSendAt: nextStep ? addDays(now, nextStep.delayDays) : null,
    },
  });

  return { nextStep };
}

export type DueLead = Pick<Lead, 'id' | 'campaignId' | 'currentStep'>;

/** Leads whose next step is due, restricted to ACTIVE campaigns and live leads. */
export async function findDueLeads(now = new Date(), limit = 500): Promise<DueLead[]> {
  return prisma.lead.findMany({
    where: {
      status: { in: [...SENDABLE_LEAD_STATUSES] },
      nextSendAt: { not: null, lte: now },
      campaign: { status: CampaignStatus.ACTIVE },
    },
    select: { id: true, campaignId: true, currentStep: true },
    orderBy: { nextSendAt: 'asc' },
    take: limit,
  });
}

/**
 * Scheduler pass: turns due leads into queued send jobs. The job id is derived
 * from lead + step, so repeated ticks are idempotent.
 */
export async function enqueueDueSteps(now = new Date()): Promise<number> {
  const due = await findDueLeads(now);
  if (due.length === 0) return 0;

  const queue = getEmailQueue();
  let queued = 0;

  for (const lead of due) {
    const stepOrder = lead.currentStep + 1;
    await queue.add(
      'send-step',
      { leadId: lead.id, campaignId: lead.campaignId, stepOrder },
      { jobId: sendJobId(lead.id, stepOrder) },
    );
    queued += 1;
  }

  return queued;
}

/**
 * Marks a campaign COMPLETED once no live lead has work left. Returns true when
 * the status actually changed.
 */
export async function completeCampaignIfDrained(campaignId: string): Promise<boolean> {
  const remaining = await prisma.lead.count({
    where: {
      campaignId,
      status: { in: [...SENDABLE_LEAD_STATUSES] },
      nextSendAt: { not: null },
    },
  });
  if (remaining > 0) return false;

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status !== CampaignStatus.ACTIVE) return false;

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: CampaignStatus.COMPLETED },
  });
  return true;
}
