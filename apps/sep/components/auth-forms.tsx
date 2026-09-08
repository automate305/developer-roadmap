'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { signIn, createFirstUser } from '@/app/actions/auth';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { ErrorAlert } from '@/components/ui/alert';
import { MIN_PASSWORD_LENGTH } from '@/lib/password-policy';

function useAuthSubmit(
  action: (formData: FormData) => Promise<{ ok: boolean; error?: string }>,
  destination: string,
) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await action(formData);
      if (!result.ok) {
        setError(result.error ?? 'Could not sign you in.');
        return;
      }
      // The session cookie is set by the action; refresh so the server
      // re-renders with it, then move on.
      router.replace(destination);
      router.refresh();
    });
  };

  return { pending, error, onSubmit };
}

export function SignInForm({ destination }: { destination: string }) {
  const { pending, error, onSubmit } = useAuthSubmit(signIn, destination);

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <Field label="Email">
        <Input name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <ErrorAlert message={error} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}

export function FirstAccountForm({ destination }: { destination: string }) {
  const { pending, error, onSubmit } = useAuthSubmit(createFirstUser, destination);

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <Field label="Name" hint="Shown in the corner so you know which account you are using.">
        <Input name="name" type="text" autoComplete="name" placeholder="Cam" />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Field
        label="Password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. There is no reset link, so store it somewhere you trust.`}
      >
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </Field>
      <ErrorAlert message={error} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Creating…' : 'Create account and sign in'}
      </Button>
    </form>
  );
}
