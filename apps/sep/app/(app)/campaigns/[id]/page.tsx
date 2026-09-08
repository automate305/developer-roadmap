import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getPipelineStats } from '@/lib/analytics';
import { AnalyticsCards } from '@/components/analytics-cards';
import { CampaignControls } from '@/components/campaign-controls';
import { SequenceEditor } from '@/components/sequence-editor';
import { CsvImporter } from '@/components/csv-importer';
import { LeadsTable, type LeadView } from '@/components/leads-table';
import { CampaignStatusBadge } from '@/components/status-badge';
import { ErrorAlert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { toMessage } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const LEAD_PAGE_SIZE = 200;

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        sendingAccount: true,
        steps: { orderBy: { stepOrder: 'asc' } },
      },
    });

    if (!campaign) notFound();

    const [stats, leads] = await Promise.all([
      getPipelineStats(campaign.id),
      prisma.lead.findMany({
        where: { campaignId: campaign.id },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: LEAD_PAGE_SIZE,
        include: { _count: { select: { emailLogs: true } }, emailLogs: { select: { openCount: true } } },
      }),
    ]);

    const leadViews: LeadView[] = leads.map((lead) => ({
      id: lead.id,
      email: lead.email,
      firstName: lead.firstName,
      lastName: lead.lastName,
      company: lead.company,
      status: lead.status,
      currentStep: lead.currentStep,
      nextSendAt: lead.nextSendAt?.toISOString() ?? null,
      lastContactedAt: lead.lastContactedAt?.toISOString() ?? null,
      opens: lead.emailLogs.reduce((total, log) => total + log.openCount, 0),
    }));

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/campaigns" className="text-xs text-ink-faint hover:text-ink">
              ← Campaigns
            </Link>
            <div className="mt-1 flex items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">{campaign.name}</h1>
              <CampaignStatusBadge status={campaign.status} />
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              {campaign.description ?? 'No description.'}
            </p>
            <div className="mt-2 flex items-center gap-2 text-xs text-ink-faint">
              <Badge>
                {campaign.sendingAccount
                  ? `${campaign.sendingAccount.fromEmail} · cap ${campaign.sendingAccount.maxDaily}/day`
                  : 'No sending account attached'}
              </Badge>
            </div>
          </div>
          <CampaignControls campaignId={campaign.id} status={campaign.status} />
        </div>

        <AnalyticsCards stats={stats} />

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <SequenceEditor campaignId={campaign.id} steps={campaign.steps} />
          <CsvImporter campaignId={campaign.id} />
        </div>

        <LeadsTable leads={leadViews} totalSteps={campaign.steps.length} />

        {leads.length === LEAD_PAGE_SIZE ? (
          <p className="text-xs text-ink-faint">
            Showing the first {LEAD_PAGE_SIZE} leads. Filter above to narrow the list.
          </p>
        ) : null}
      </div>
    );
  } catch (error) {
    return (
      <ErrorAlert message={`Could not load this campaign: ${toMessage(error, 'database unavailable')}`} />
    );
  }
}
