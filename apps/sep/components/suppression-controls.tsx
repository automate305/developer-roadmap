'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { liftSuppression, blockAddress } from '@/app/actions/suppressions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorAlert } from '@/components/ui/alert';

export function LiftSuppressionButton({ email }: { email: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  return (
    <div className="flex items-center justify-end gap-2">
      {error ? <ErrorAlert message={error} /> : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await liftSuppression(email);
            if (!result.ok) setError(result.error);
            else router.refresh();
          })
        }
      >
        {pending ? 'Unblocking…' : 'Unblock'}
      </Button>
    </div>
  );
}

export function BlockAddressForm() {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  return (
    <form
      ref={formRef}
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await blockAddress(formData);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          formRef.current?.reset();
          router.refresh();
        });
      }}
    >
      <Input name="email" type="email" placeholder="owner@example.com" className="h-8 w-64 text-xs" required />
      <Button size="sm" variant="outline" type="submit" disabled={pending}>
        {pending ? 'Blocking…' : 'Block address'}
      </Button>
      {error ? <ErrorAlert message={error} /> : null}
    </form>
  );
}
