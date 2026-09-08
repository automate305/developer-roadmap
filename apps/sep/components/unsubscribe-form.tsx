'use client';

import * as React from 'react';
import { confirmUnsubscribe } from '@/app/actions/unsubscribe';
import { Button } from '@/components/ui/button';
import { ErrorAlert, SuccessAlert } from '@/components/ui/alert';

export function UnsubscribeForm({ token }: { token: string }) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await confirmUnsubscribe(token);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(`${result.data.email} has been unsubscribed. You will not receive further emails.`);
    });
  }

  if (done) return <SuccessAlert className="mt-4" message={done} />;

  return (
    <div className="mt-4 space-y-3">
      <ErrorAlert message={error} />
      <Button onClick={submit} disabled={pending}>
        {pending ? 'Unsubscribing…' : 'Unsubscribe me'}
      </Button>
    </div>
  );
}
