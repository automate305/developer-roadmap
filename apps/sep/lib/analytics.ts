import { prisma } from './prisma';
import { EmailStatus, LeadStatus } from './generated/prisma';

export type PipelineStats = {
  totalLeads: number;
  activeLeads: number;
  totalSent: number;
  totalOpened: number;
  totalReplied: number;
  bounced: number;
  openRate: number;
  replyRate: number;
};

const EMPTY: PipelineStats = {
  totalLeads: 0,
  activeLeads: 0,
  totalSent: 0,
  totalOpened: 0,
  totalReplied: 0,
  bounced: 0,
  openRate: 0,
  replyRate: 0,
};

/**
 * Rates are measured against delivered mail, not against the whole list:
 *   open rate  = emails with an open beacon / emails sent
 *   reply rate = leads that replied / leads that received at least one email
 */
export async function getPipelineStats(campaignId?: string): Promise<PipelineStats> {
  const scope = campaignId ? { campaignId } : {};

  try {
    const [totalLeads, activeLeads, totalSent, totalOpened, bounced, totalReplied, contactedLeads] =
      await Promise.all([
        prisma.lead.count({ where: scope }),
        prisma.lead.count({ where: { ...scope, status: LeadStatus.IN_SEQUENCE } }),
        prisma.emailLog.count({ where: { ...scope, status: { not: EmailStatus.FAILED } } }),
        prisma.emailLog.count({ where: { ...scope, openedAt: { not: null } } }),
        prisma.emailLog.count({ where: { ...scope, status: EmailStatus.BOUNCED } }),
        prisma.lead.count({ where: { ...scope, status: LeadStatus.REPLIED } }),
        prisma.lead.count({ where: { ...scope, emailLogs: { some: {} } } }),
      ]);

    return {
      totalLeads,
      activeLeads,
      totalSent,
      totalOpened,
      totalReplied,
      bounced,
      openRate: totalSent === 0 ? 0 : (totalOpened / totalSent) * 100,
      replyRate: contactedLeads === 0 ? 0 : (totalReplied / contactedLeads) * 100,
    };
  } catch (error) {
    console.error('[analytics] failed to compute stats', error);
    throw error;
  }
}

export function emptyStats(): PipelineStats {
  return { ...EMPTY };
}
