'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toggleSendingAccount, deleteSendingAccount } from '@/app/actions/accounts';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/alert';

export function AccountControls({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? 'Something went wrong.');
      else router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => run(() => toggleSendingAccount(id))}
      >
        {isActive ? 'Pause' : 'Enable'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => run(() => deleteSendingAccount(id))}
      >
        Delete
      </Button>
      {error ? <ErrorAlert message={error} className="ml-2" /> : null}
    </div>
  );
}
