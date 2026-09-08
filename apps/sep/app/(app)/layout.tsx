import { headers } from 'next/headers';
import { requireUserOrRedirect } from '@/lib/auth';
import { PATH_HEADER } from '@/lib/session-cookie';
import { AppNav } from '@/components/app-nav';

/**
 * Everything inside this group requires a signed-in operator. The check runs
 * once per page render here rather than being repeated in each page.
 *
 * Server actions do NOT pass through this layout — each one calls requireUser()
 * itself, in app/actions.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The proxy records where the visitor was headed, so a stale cookie rejected
  // here still returns them there once they have signed in.
  const headerList = await headers();
  const user = await requireUserOrRedirect(headerList.get(PATH_HEADER) ?? undefined);

  return (
    <>
      <AppNav user={user} />
      <main className="mx-auto w-full max-w-7xl px-6 py-8">{children}</main>
    </>
  );
}
