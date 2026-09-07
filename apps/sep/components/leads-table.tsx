'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { setLeadStatus, deleteLead } from '@/app/actions/leads';
import { LeadStatus } from '@/lib/generated/prisma';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, Th, Td, EmptyRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { ErrorAlert } from '@/components/ui/alert';
import { LeadStatusBadge } from '@/components/status-badge';
import { formatDate } from '@/lib/utils';

export type LeadView = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  status: LeadStatus;
  currentStep: number;
  nextSendAt: string | null;
  lastContactedAt: string | null;
  opens: number;
};

const STATUS_FILTERS: (LeadStatus | 'ALL')[] = [
  'ALL',
  LeadStatus.UNCONTACTED,
  LeadStatus.IN_SEQUENCE,
  LeadStatus.REPLIED,
  LeadStatus.OPTED_OUT,
];

export function LeadsTable({ leads, totalSteps }: { leads: LeadView[]; totalSteps: number }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<LeadStatus | 'ALL'>('ALL');

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return leads.filter((lead) => {
      if (filter !== 'ALL' && lead.status !== filter) return false;
      if (!needle) return true;
      return [lead.email, lead.firstName, lead.lastName, lead.company]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle));
    });
  }, [leads, query, filter]);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? 'Something went wrong.');
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Leads</CardTitle>
          <CardDescription>
            {leads.length.toLocaleString()} in this campaign. A lead marked replied or opted out is
            dropped from every remaining step.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Input
            className="h-8 w-48 text-xs"
            placeholder="Search name, email, company"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Select
            className="h-8 w-40 text-xs"
            value={filter}
            onChange={(event) => setFilter(event.target.value as LeadStatus | 'ALL')}
          >
            {STATUS_FILTERS.map((value) => (
              <option key={value} value={value}>
                {value === 'ALL' ? 'All statuses' : value.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </div>
      </CardHeader>

      <CardContent className="px-0 py-0">
        {error ? <ErrorAlert message={error} className="mx-5 mt-4" /> : null}
        <Table>
          <thead>
            <tr>
              <Th>Lead</Th>
              <Th>Company</Th>
              <Th>Status</Th>
              <Th>Progress</Th>
              <Th>Next send</Th>
              <Th>Last contacted</Th>
              <Th className="text-right">Opens</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {visible.map((lead) => (
              <tr key={lead.id} className="hover:bg-panel-raised/40">
                <Td>
                  <div className="font-medium text-ink">
                    {[lead.firstName, lead.lastName].filter(Boolean).join(' ') || '—'}
                  </div>
                  <div className="text-xs text-ink-faint">{lead.email}</div>
                </Td>
                <Td className="text-ink-muted">{lead.company ?? '—'}</Td>
                <Td>
                  <LeadStatusBadge status={lead.status} />
                </Td>
                <Td className="tabular text-ink-muted">
                  {lead.currentStep}/{totalSteps}
                </Td>
                <Td className="tabular text-ink-muted">{formatDate(lead.nextSendAt)}</Td>
                <Td className="tabular text-ink-muted">{formatDate(lead.lastContactedAt)}</Td>
                <Td className="tabular text-right text-ink-muted">{lead.opens}</Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    {lead.status !== LeadStatus.REPLIED ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => run(() => setLeadStatus(lead.id, LeadStatus.REPLIED))}
                      >
                        Replied
                      </Button>
                    ) : null}
                    {lead.status !== LeadStatus.OPTED_OUT ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => run(() => setLeadStatus(lead.id, LeadStatus.OPTED_OUT))}
                      >
                        Opt out
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => run(() => deleteLead(lead.id))}
                    >
                      Delete
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <EmptyRow colSpan={8}>
                {leads.length === 0 ? 'No leads yet. Import a CSV above.' : 'No leads match that filter.'}
              </EmptyRow>
            ) : null}
          </tbody>
        </Table>
      </CardContent>
    </Card>
  );
}
