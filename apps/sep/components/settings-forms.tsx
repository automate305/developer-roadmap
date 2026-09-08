'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { updateFrequencyPolicy } from '@/app/actions/settings';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { ErrorAlert, SuccessAlert } from '@/components/ui/alert';
import type { PlatformSettings } from '@/lib/settings';

export function FrequencyPolicyForm({ settings }: { settings: PlatformSettings }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [cap, setCap] = React.useState(String(settings.maxEmailsPerContact));
  const [days, setDays] = React.useState(String(settings.contactWindowDays));

  const capNumber = Number.parseInt(cap, 10);
  const off = Number.isFinite(capNumber) && capNumber <= 0;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        setSaved(null);
        startTransition(async () => {
          const result = await updateFrequencyPolicy(formData);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setSaved('Saved. It applies to the next send, not to mail already gone.');
          router.refresh();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Emails per person" hint="Zero switches the cap off entirely.">
          <Input
            name="maxEmailsPerContact"
            type="number"
            min={0}
            max={100}
            step={1}
            value={cap}
            onChange={(event) => setCap(event.target.value)}
            required
          />
        </Field>
        <Field label="Window, in days" hint="Rolling, not calendar: it always looks back from now.">
          <Input
            name="contactWindowDays"
            type="number"
            min={1}
            max={365}
            step={1}
            value={days}
            onChange={(event) => setDays(event.target.value)}
            required
          />
        </Field>
      </div>

      <p className="text-sm text-ink-muted">
        {off
          ? 'No cap: a person on several campaigns receives every one of them.'
          : `At most ${cap || '—'} email${cap === '1' ? '' : 's'} to the same address in any ${days || '—'} days, across all campaigns.`}
      </p>

      <ErrorAlert message={error} />
      <SuccessAlert message={saved} />

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save policy'}
      </Button>
    </form>
  );
}
