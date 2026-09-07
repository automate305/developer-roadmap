import { prisma } from '@/lib/prisma';
import { SendingAccountForm } from '@/components/sending-account-form';
import { AccountControls } from '@/components/account-controls';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, Th, Td, EmptyRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ErrorAlert } from '@/components/ui/alert';
import { toMessage } from '@/lib/errors';

export const dynamic = 'force-dynamic';

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
                  <Th>SMTP</Th>
                  <Th>IMAP</Th>
                  <Th className="text-right">Sent today</Th>
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
                      {account.smtpHost}:{account.smtpPort}
                    </Td>
                    <Td className="text-ink-muted">
                      {account.imapHost ? `${account.imapHost}:${account.imapPort ?? 993}` : 'Not set'}
                    </Td>
                    <Td className="tabular text-right text-ink-muted">
                      {account.sentToday}/{account.maxDaily}
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
                  <EmptyRow colSpan={7}>No mailboxes yet. Add one below.</EmptyRow>
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
