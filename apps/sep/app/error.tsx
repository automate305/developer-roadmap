'use client';

import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-danger/40 bg-danger/5 px-6 py-8 text-center">
      <h1 className="text-base font-semibold text-ink">Something broke on this page</h1>
      <p className="mt-2 text-sm text-ink-muted">{error.message || 'Unexpected error.'}</p>
      <Button className="mt-4" size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
