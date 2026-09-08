'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createCampaign } from '@/app/actions/campaigns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ErrorAlert } from '@/components/ui/alert';

export type AccountOption = { id: string; name: string; fromEmail: string };

export function CampaignForm({ accounts }: { accounts: AccountOption[] }) {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);

    startTransition(async () => {
      const result = await createCampaign(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      formRef.current?.reset();
      router.push(`/campaigns/${result.data.id}`);
    });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>New campaign</CardTitle>
          <CardDescription>Starts as a draft. Add steps and leads before activating.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
          <ErrorAlert message={error} />
          <Field label="Name">
            <Input name="name" placeholder="Brickell HVAC — Q1 outbound" required maxLength={120} />
          </Field>
          <Field label="Description">
            <Input name="description" placeholder="Optional context for your team" maxLength={500} />
          </Field>
          <Field
            label="Sending account"
            hint={accounts.length === 0 ? 'No mailboxes yet — add one under Sending Accounts.' : undefined}
          >
            <Select name="sendingAccountId" defaultValue="">
              <option value="">Choose later</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {account.fromEmail}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? 'Creating…' : 'Create campaign'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
