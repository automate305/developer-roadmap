'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createSendingAccount } from '@/app/actions/accounts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Field, Input, Label, Select } from '@/components/ui/input';
import { ErrorAlert, SuccessAlert } from '@/components/ui/alert';

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'UTC',
];

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

export function SendingAccountForm() {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    setSaved(null);

    startTransition(async () => {
      const result = await createSendingAccount(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      formRef.current?.reset();
      setSaved('Mailbox saved. It is available to campaigns straight away.');
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Add sending account</CardTitle>
          <CardDescription>
            SMTP dispatches the sequence; IMAP is polled for replies. Leave IMAP blank to send
            without automatic reply detection.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
          <ErrorAlert message={error} />
          <SuccessAlert message={saved} />

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Account name">
              <Input name="name" placeholder="Cam — Automate305" required />
            </Field>
            <Field label="From name">
              <Input name="fromName" placeholder="Cam at Automate305" required />
            </Field>
            <Field label="From email">
              <Input name="fromEmail" type="email" placeholder="cam@automate305.com" required />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="SMTP host">
              <Input name="smtpHost" placeholder="smtp.example.com" required />
            </Field>
            <Field label="SMTP port">
              <Input name="smtpPort" type="number" defaultValue={587} min={1} max={65535} required />
            </Field>
            <Field label="SMTP user">
              <Input name="smtpUser" autoComplete="off" required />
            </Field>
            <Field label="SMTP password">
              <Input name="smtpPassword" type="password" autoComplete="new-password" required />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <input type="checkbox" name="smtpSecure" className="accent-[var(--color-accent)]" />
            Use implicit TLS (port 465)
          </label>

          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="IMAP host">
              <Input name="imapHost" placeholder="imap.example.com" />
            </Field>
            <Field label="IMAP port">
              <Input name="imapPort" type="number" defaultValue={993} min={1} max={65535} />
            </Field>
            <Field label="IMAP user">
              <Input name="imapUser" autoComplete="off" />
            </Field>
            <Field label="IMAP password">
              <Input name="imapPassword" type="password" autoComplete="new-password" />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Daily cap" hint="Ceiling on sends per UTC day.">
              <Input name="maxDaily" type="number" defaultValue={50} min={1} max={2000} required />
            </Field>
            <Field label="Timezone" hint="The window below is in this timezone.">
              <Select name="timezone" defaultValue="America/New_York">
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Send from" hint="Local hour, 24h.">
              <Input name="sendWindowStartHour" type="number" defaultValue={8} min={0} max={23} required />
            </Field>
            <Field label="Send until" hint="Local hour, 24h.">
              <Input name="sendWindowEndHour" type="number" defaultValue={17} min={0} max={23} required />
            </Field>
          </div>

          <div>
            <Label>Sending days</Label>
            <div className="flex flex-wrap gap-3">
              {DAYS.map((day) => (
                <label key={day.value} className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    name="sendDays"
                    value={day.value}
                    defaultChecked={day.value <= 5}
                    className="accent-[var(--color-accent)]"
                  />
                  {day.label}
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Jitter (minutes)" hint="Random spread so sends do not leave in a burst.">
              <Input name="jitterMinutes" type="number" defaultValue={45} min={0} max={240} />
            </Field>
            <Field label="Warmup start" hint="Sends per day on day one.">
              <Input name="warmupInitialDaily" type="number" defaultValue={5} min={1} max={500} />
            </Field>
            <Field label="Warmup increment" hint="Added to the cap each day.">
              <Input name="warmupDailyIncrement" type="number" defaultValue={5} min={1} max={500} />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <input type="checkbox" name="warmupEnabled" className="accent-[var(--color-accent)]" />
            Ramp this mailbox up from the warmup start rather than opening at the full cap
          </label>

          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save mailbox'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
