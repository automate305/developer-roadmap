import { cn } from '@/lib/utils';

/** Inline error surface used by every form and data view. */
export function ErrorAlert({ message, className }: { message?: string | null; className?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={cn(
        'rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger',
        className,
      )}
    >
      {message}
    </div>
  );
}

export function SuccessAlert({ message, className }: { message?: string | null; className?: string }) {
  if (!message) return null;
  return (
    <div
      className={cn(
        'rounded-md border border-positive/40 bg-positive/10 px-3 py-2 text-sm text-positive',
        className,
      )}
    >
      {message}
    </div>
  );
}
