import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getPipelineStats } from '@/lib/analytics';
import { AnalyticsCards } from '@/components/analytics-cards';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, Th, Td, EmptyRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/alert';
import { CampaignStatusBadge, EmailStatusBadge } from '@/components/status-badge';
import { formatDate } from '@/lib/utils';
import { toMessage } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  try {
    const [stats, campaigns, recentLogs] = await Promise.all([
      getPipelineStats(),
      prisma.campaign.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 8,
        include: { _count: { select: { leads: true, steps: true } } },
      }),
      prisma.emailLog.findMany({
        orderBy: { sentAt: 'desc' },
        take: 10,
        include: { lead: { select: { email: true } }, campaign: { select: { name: true } } },
      }),
    ]);

    return (
      <div className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Pipeline</h1>
            <p className="mt-1 text-sm text-ink-muted">
              Live counters across every campaign, refreshed on each request.
            </p>
          </div>
          <Button asChild size="sm">
            <Link href="/campaigns">New campaign</Link>
          </Button>
        </div>

        <AnalyticsCards stats={stats} />

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Campaigns</CardTitle>
                <CardDescription>Most recently updated first.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="px-0 py-0">
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Steps</Th>
                    <Th className="text-right">Leads</Th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((campaign) => (
                    <tr key={campaign.id} className="hover:bg-panel-raised/40">
                      <Td>
                        <Link href={`/campaigns/${campaign.id}`} className="font-medium hover:text-accent">
                          {campaign.name}
                        </Link>
                      </Td>
                      <Td>
                        <CampaignStatusBadge status={campaign.status} />
                      </Td>
                      <Td className="tabular text-right text-ink-muted">{campaign._count.steps}</Td>
                      <Td className="tabular text-right text-ink-muted">{campaign._count.leads}</Td>
                    </tr>
                  ))}
                  {campaigns.length === 0 ? (
                    <EmptyRow colSpan={4}>No campaigns yet.</EmptyRow>
                  ) : null}
                </tbody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Recent sends</CardTitle>
                <CardDescription>Last ten dispatches and their tracking state.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="px-0 py-0">
              <Table>
                <thead>
                  <tr>
                    <Th>Recipient</Th>
                    <Th>Campaign</Th>
                    <Th>State</Th>
                    <Th>Sent</Th>
                  </tr>
                </thead>
                <tbody>
                  {recentLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-panel-raised/40">
                      <Td className="text-ink-muted">{log.lead.email}</Td>
                      <Td className="text-ink-muted">{log.campaign.name}</Td>
                      <Td>
                        <EmailStatusBadge status={log.status} />
                      </Td>
                      <Td className="tabular text-ink-muted">{formatDate(log.sentAt)}</Td>
                    </tr>
                  ))}
                  {recentLogs.length === 0 ? (
                    <EmptyRow colSpan={4}>Nothing sent yet.</EmptyRow>
                  ) : null}
                </tbody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  } catch (error) {
    return (
      <ErrorAlert
        message={`Could not load the dashboard: ${toMessage(error, 'database unavailable')}`}
      />
    );
  }
}
