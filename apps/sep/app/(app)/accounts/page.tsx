import { prisma } from '@/lib/prisma';
import { SendingAccountForm } from '@/components/sending-account-form';
import { AccountControls } from '@/components/account-controls';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, Th, Td, EmptyRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ErrorAlert } from '@/components/ui/alert';
import { toMessage } from '@/lib/errors';
import { effectiveDailyCap, warmupDaysRemaining } from '@/lib/schedule';

export const dynamic = 'force-dynamic';

const DAY_LABELS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Renders 1-5 as "Mon–Fri" and anything irregular as a list. */
function describeDays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 0) return 'No days';
  if (sorted.length === 7) return 'Every day';

  const consecutive = sorted.every((day, index) => index === 0 || day === sorted[index - 1] + 1);
  if (consecutive && sorted.length > 2) {
    return `${DAY_LABELS[sorted[0]]}–${DAY_LABELS[sorted[sorted.length - 1]]}`;
  }
  return sorted.map((day) => DAY_LABELS[day]).join(', ');
}

function formatHour(hour: number): string {
  const period = hour < 12 ? 'am' : 'pm';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${period}`;
}

/** "America/New_York" reads better as "New York" in a dense table. */
function shortZone(timezone: string): string {
  return timezone.split('/').pop()?.replace(/_/g, ' ') ?? timezone;
}

export default async function AccountsPage() {
  try {
    const accounts = await prisma.sendingAccount.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { campaigns: true } } },
    });

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Sending accounts</h1>
          <p className="mt-1 text-sm text-ink-muted">
            One row per mailbox. Daily counters roll over at UTC midnight.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Mailboxes</CardTitle>
              <CardDescription>{accounts.length} configured</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-0 py-0">
            <Table>
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th>Sends</Th>
                  <Th>Today</Th>
                  <Th>Warmup</Th>
                  <Th>IMAP</Th>
                  <Th className="text-right">Campaigns</Th>
                  <Th>State</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} className="hover:bg-panel-raised/40">
                    <Td>
                      <div className="font-medium text-ink">{account.name}</div>
                      <div className="text-xs text-ink-faint">{account.fromEmail}</div>
                    </Td>
                    <Td className="text-ink-muted">
                      <div className="text-xs">{describeDays(account.sendDays)}</div>
                      <div className="text-xs text-ink-faint">
                        {formatHour(account.sendWindowStartHour)}–{formatHour(account.sendWindowEndHour)}{' '}
                        {shortZone(account.timezone)}
                        {account.jitterMinutes > 0 ? ` · ±${account.jitterMinutes}m` : ''}
                      </div>
                    </Td>
                    <Td className="tabular text-ink-muted">
                      {account.sentToday}/{effectiveDailyCap(account)}
                      {effectiveDailyCap(account) < account.maxDaily ? (
                        <div className="text-xs text-ink-faint">ceiling {account.maxDaily}</div>
                      ) : null}
                    </Td>
                    <Td className="text-ink-muted">
                      {account.warmupEnabled ? (
                        <div className="text-xs">
                          <Badge tone="warning">Warming</Badge>
                          <div className="mt-1 text-ink-faint">
                            {warmupDaysRemaining(account) === 0
                              ? 'at full volume'
                              : `${warmupDaysRemaining(account)} day${
                                  warmupDaysRemaining(account) === 1 ? '' : 's'
                                } to full`}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-ink-faint">Off</span>
                      )}
                    </Td>
                    <Td className="text-ink-muted">
                      {account.imapHost ? `${account.imapHost}:${account.imapPort ?? 993}` : 'Not set'}
                    </Td>
                    <Td className="tabular text-right text-ink-muted">{account._count.campaigns}</Td>
                    <Td>
                      <Badge tone={account.isActive ? 'accent' : 'neutral'}>
                        {account.isActive ? 'Active' : 'Paused'}
                      </Badge>
                    </Td>
                    <Td>
                      <AccountControls id={account.id} isActive={account.isActive} />
                    </Td>
                  </tr>
                ))}
                {accounts.length === 0 ? (
                  <EmptyRow colSpan={8}>No mailboxes yet. Add one below.</EmptyRow>
                ) : null}
              </tbody>
            </Table>
          </CardContent>
        </Card>

        <SendingAccountForm />
      </div>
    );
  } catch (error) {
    return (
      <ErrorAlert message={`Could not load sending accounts: ${toMessage(error, 'database unavailable')}`} />
    );
  }
}
