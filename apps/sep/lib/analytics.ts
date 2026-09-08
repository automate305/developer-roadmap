import { prisma } from './prisma';
import { EmailStatus, LeadStatus } from './generated/prisma';

export type PipelineStats = {
  totalLeads: number;
  activeLeads: number;
  totalSent: number;
  totalOpened: number;
  totalReplied: number;
  bounced: number;
  bouncedLeads: number;
  suppressedAddresses: number;
  openRate: number;
  replyRate: number;
  bounceRate: number;
};

const EMPTY: PipelineStats = {
  totalLeads: 0,
  activeLeads: 0,
  totalSent: 0,
  totalOpened: 0,
  totalReplied: 0,
  bounced: 0,
  bouncedLeads: 0,
  suppressedAddresses: 0,
  openRate: 0,
  replyRate: 0,
  bounceRate: 0,
};

/**
 * Rates are measured against delivered mail, not against the whole list:
 *   open rate   = emails with an open beacon / emails sent
 *   reply rate  = leads that replied / leads that received at least one email
 *   bounce rate = bounced emails / all delivery attempts
 *
 * Bounce rate counts bounces in its denominator, unlike the other two: a run
 * where half the attempts bounced should read 50%, not vanish because bounces
 * are excluded from "sent".
 */
export async function getPipelineStats(campaignId?: string): Promise<PipelineStats> {
  const scope = campaignId ? { campaignId } : {};

  try {
    const [
      totalLeads,
      activeLeads,
      totalSent,
      totalOpened,
      bounced,
      totalReplied,
      contactedLeads,
      bouncedLeads,
      suppressedAddresses,
    ] = await Promise.all([
      prisma.lead.count({ where: scope }),
      prisma.lead.count({ where: { ...scope, status: LeadStatus.IN_SEQUENCE } }),
      prisma.emailLog.count({ where: { ...scope, status: { not: EmailStatus.FAILED } } }),
      prisma.emailLog.count({ where: { ...scope, openedAt: { not: null } } }),
      prisma.emailLog.count({ where: { ...scope, status: EmailStatus.BOUNCED } }),
      prisma.lead.count({ where: { ...scope, status: LeadStatus.REPLIED } }),
      prisma.lead.count({ where: { ...scope, emailLogs: { some: {} } } }),
      prisma.lead.count({ where: { ...scope, status: LeadStatus.BOUNCED } }),
      // The suppression list is global: an address blocked anywhere is blocked
      // everywhere, so this figure is not scoped to one campaign.
      prisma.suppressedAddress.count(),
    ]);

    // Opens are only counted against mail that was actually delivered.
    const delivered = Math.max(0, totalSent - bounced);

    return {
      totalLeads,
      activeLeads,
      totalSent,
      totalOpened,
      totalReplied,
      bounced,
      bouncedLeads,
      suppressedAddresses,
      openRate: delivered === 0 ? 0 : (totalOpened / delivered) * 100,
      replyRate: contactedLeads === 0 ? 0 : (totalReplied / contactedLeads) * 100,
      bounceRate: totalSent === 0 ? 0 : (bounced / totalSent) * 100,
    };
  } catch (error) {
    console.error('[analytics] failed to compute stats', error);
    throw error;
  }
}

export function emptyStats(): PipelineStats {
  return { ...EMPTY };
}
