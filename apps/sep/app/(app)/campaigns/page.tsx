import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { CampaignForm } from '@/components/campaign-form';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, Th, Td, EmptyRow } from '@/components/ui/table';
import { ErrorAlert } from '@/components/ui/alert';
import { CampaignStatusBadge } from '@/components/status-badge';
import { formatDate } from '@/lib/utils';
import { toMessage } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export default async function CampaignsPage() {
  try {
    const [campaigns, accounts] = await Promise.all([
      prisma.campaign.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          sendingAccount: { select: { name: true, fromEmail: true } },
          _count: { select: { leads: true, steps: true } },
        },
      }),
      prisma.sendingAccount.findMany({
        where: { isActive: true },
        select: { id: true, name: true, fromEmail: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Each campaign owns its sequence, its leads, and the mailbox it sends from.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>All campaigns</CardTitle>
                <CardDescription>{campaigns.length} total</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="px-0 py-0">
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Status</Th>
                    <Th>Mailbox</Th>
                    <Th className="text-right">Steps</Th>
                    <Th className="text-right">Leads</Th>
                    <Th>Created</Th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((campaign) => (
                    <tr key={campaign.id} className="hover:bg-panel-raised/40">
                      <Td>
                        <Link href={`/campaigns/${campaign.id}`} className="font-medium hover:text-accent">
                          {campaign.name}
                        </Link>
                        {campaign.description ? (
                          <div className="text-xs text-ink-faint">{campaign.description}</div>
                        ) : null}
                      </Td>
                      <Td>
                        <CampaignStatusBadge status={campaign.status} />
                      </Td>
                      <Td className="text-ink-muted">
                        {campaign.sendingAccount?.fromEmail ?? 'Not set'}
                      </Td>
                      <Td className="tabular text-right text-ink-muted">{campaign._count.steps}</Td>
                      <Td className="tabular text-right text-ink-muted">{campaign._count.leads}</Td>
                      <Td className="tabular text-ink-muted">{formatDate(campaign.createdAt)}</Td>
                    </tr>
                  ))}
                  {campaigns.length === 0 ? (
                    <EmptyRow colSpan={6}>No campaigns yet. Create one on the right.</EmptyRow>
                  ) : null}
                </tbody>
              </Table>
            </CardContent>
          </Card>

          <CampaignForm accounts={accounts} />
        </div>
      </div>
    );
  } catch (error) {
    return (
      <ErrorAlert message={`Could not load campaigns: ${toMessage(error, 'database unavailable')}`} />
    );
  }
}
