'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { changePassword, inviteUser, signOut } from '@/app/actions/auth';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { ErrorAlert, SuccessAlert } from '@/components/ui/alert';
import { MIN_PASSWORD_LENGTH } from '@/lib/password-policy';

export function ChangePasswordForm() {
  const formRef = React.useRef<HTMLFormElement>(null);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);

  return (
    <form
      ref={formRef}
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        setSaved(null);
        startTransition(async () => {
          const result = await changePassword(formData);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          formRef.current?.reset();
          setSaved('Password changed. Other browsers have been signed out.');
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Current password">
          <Input name="currentPassword" type="password" autoComplete="current-password" required />
        </Field>
        <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
          <Input
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </Field>
      </div>
      <ErrorAlert message={error} />
      <SuccessAlert message={saved} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? 'Changing…' : 'Change password'}
      </Button>
    </form>
  );
}

export function InviteUserForm() {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);

  return (
    <form
      ref={formRef}
      className="space-y-4 border-t border-hairline pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        setSaved(null);
        startTransition(async () => {
          const result = await inviteUser(formData);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          formRef.current?.reset();
          setSaved('Account created. Give them the password in person, not by email.');
          router.refresh();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name">
          <Input name="name" type="text" placeholder="Optional" />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" required />
        </Field>
        <Field label="Password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </Field>
      </div>
      <ErrorAlert message={error} />
      <SuccessAlert message={saved} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? 'Creating…' : 'Add account'}
      </Button>
    </form>
  );
}

export function SignOutButton() {
  const [pending, startTransition] = React.useTransition();

  return (
    <form action={() => startTransition(async () => { await signOut(); })}>
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? 'Signing out…' : 'Sign out'}
      </Button>
    </form>
  );
}
