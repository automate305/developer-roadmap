import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, Th, Td, EmptyRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ErrorAlert } from '@/components/ui/alert';
import { LiftSuppressionButton, BlockAddressForm } from '@/components/suppression-controls';
import { formatDate } from '@/lib/utils';
import { toMessage } from '@/lib/errors';
import { SuppressionReason } from '@/lib/generated/prisma';

export const dynamic = 'force-dynamic';

const REASON_LABEL: Record<SuppressionReason, string> = {
  HARD_BOUNCE: 'Hard bounce',
  REPEATED_SOFT_BOUNCE: 'Repeated soft bounce',
  COMPLAINT: 'Complaint',
  MANUAL: 'Blocked by hand',
};

const REASON_TONE: Record<SuppressionReason, 'danger' | 'warning' | 'neutral'> = {
  HARD_BOUNCE: 'danger',
  REPEATED_SOFT_BOUNCE: 'warning',
  COMPLAINT: 'danger',
  MANUAL: 'neutral',
};

export default async function SuppressionsPage() {
  try {
    const [addresses, bouncedLeads] = await Promise.all([
      prisma.suppressedAddress.findMany({ orderBy: { updatedAt: 'desc' }, take: 500 }),
      prisma.lead.count({ where: { status: 'BOUNCED' } }),
    ]);

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Blocked addresses</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Nothing is ever sent to an address on this list, in any campaign. Addresses land here
            when mail hard bounces, when it keeps soft bouncing, or when you block one by hand.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{addresses.length.toLocaleString()} blocked</CardTitle>
              <CardDescription>
                {bouncedLeads.toLocaleString()} lead{bouncedLeads === 1 ? '' : 's'} halted as a
                result. Unblocking returns those leads to the start of their sequence.
              </CardDescription>
            </div>
            <BlockAddressForm />
          </CardHeader>
          <CardContent className="px-0 py-0">
            <Table>
              <thead>
                <tr>
                  <Th>Address</Th>
                  <Th>Why</Th>
                  <Th>What the server said</Th>
                  <Th className="text-right">Times</Th>
                  <Th>Blocked</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {addresses.map((address) => (
                  <tr key={address.id} className="hover:bg-panel-raised/40">
                    <Td className="font-medium text-ink">{address.email}</Td>
                    <Td>
                      <Badge tone={REASON_TONE[address.reason]}>{REASON_LABEL[address.reason]}</Badge>
                    </Td>
                    <Td className="max-w-md truncate text-xs text-ink-faint" title={address.detail ?? ''}>
                      {address.detail ?? '—'}
                    </Td>
                    <Td className="tabular text-right text-ink-muted">{address.bounceCount}</Td>
                    <Td className="tabular text-ink-muted">{formatDate(address.updatedAt)}</Td>
                    <Td>
                      <LiftSuppressionButton email={address.email} />
                    </Td>
                  </tr>
                ))}
                {addresses.length === 0 ? (
                  <EmptyRow colSpan={6}>
                    No blocked addresses. This is the healthy state.
                  </EmptyRow>
                ) : null}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  } catch (error) {
    return (
      <ErrorAlert
        message={`Could not load blocked addresses: ${toMessage(error, 'database unavailable')}`}
      />
    );
  }
}
