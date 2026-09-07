'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createSendingAccount } from '@/app/actions/accounts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { ErrorAlert, SuccessAlert } from '@/components/ui/alert';

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
            <Field label="Daily cap" hint="Maximum sends per UTC day for this mailbox.">
              <Input name="maxDaily" type="number" defaultValue={50} min={1} max={2000} required />
            </Field>
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save mailbox'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
