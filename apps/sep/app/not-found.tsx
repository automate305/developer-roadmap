import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-hairline bg-panel px-6 py-8 text-center">
      <h1 className="text-base font-semibold text-ink">Not found</h1>
      <p className="mt-2 text-sm text-ink-muted">That record does not exist or was deleted.</p>
      <Button asChild className="mt-4" size="sm" variant="outline">
        <Link href="/">Back to dashboard</Link>
      </Button>
    </div>
  );
}
