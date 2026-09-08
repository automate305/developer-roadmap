import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, Th, Td, EmptyRow } from '@/components/ui/table';
import { ErrorAlert } from '@/components/ui/alert';
import { FrequencyPolicyForm } from '@/components/settings-forms';
import { ChangePasswordForm, InviteUserForm } from '@/components/account-forms';
import { formatDate } from '@/lib/utils';
import { toMessage } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  try {
    const [settings, users, me] = await Promise.all([
      getSettings(),
      prisma.user.findMany({
        orderBy: { createdAt: 'asc' },
        select: { id: true, email: true, name: true, lastLoginAt: true, createdAt: true },
        take: 50,
      }),
      currentUser(),
    ]);

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Policy that applies across every campaign and mailbox. Anything belonging to one
            mailbox — its daily cap, its sending hours, its warmup — lives on that mailbox instead.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>How often one person hears from you</CardTitle>
              <CardDescription>
                Daily caps limit how hard a mailbox pushes. This limits how often a single human
                is contacted, counted across every campaign they appear in — so a prospect who
                lands on two lists does not receive both sequences at once. A lead over the cap is
                held, not dropped: it sends once the oldest email falls outside the window.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <FrequencyPolicyForm settings={settings} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Your password</CardTitle>
              <CardDescription>
                Changing it signs out every other browser holding a session for{' '}
                {me?.email ?? 'this account'}.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>
                {users.length} account{users.length === 1 ? '' : 's'}
              </CardTitle>
              <CardDescription>
                Anyone with an account can send from every mailbox configured here. There is no
                password reset by email — set a colleague's password with them present, and let
                them change it once they are in.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Added</Th>
                  <Th>Last signed in</Th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <EmptyRow colSpan={4}>No accounts yet.</EmptyRow>
                ) : (
                  users.map((user) => (
                    <tr key={user.id}>
                      <Td>{user.name ?? '—'}</Td>
                      <Td>{user.email}</Td>
                      <Td>{formatDate(user.createdAt)}</Td>
                      <Td>{user.lastLoginAt ? formatDate(user.lastLoginAt) : 'Never'}</Td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
            <InviteUserForm />
          </CardContent>
        </Card>
      </div>
    );
  } catch (error) {
    return <ErrorAlert message={toMessage(error, 'Settings could not load.')} />;
  }
}
