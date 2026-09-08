import { redirect } from 'next/navigation';
import { currentUser, userCount } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ui/alert';
import { SignInForm, FirstAccountForm } from '@/components/auth-forms';
import { toMessage } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Only ever redirect within this app: an attacker-supplied absolute URL here
  // would turn the sign-in page into an open redirect.
  const destination = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  try {
    if (await currentUser()) redirect(destination);
    const accounts = await userCount();

    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid h-8 w-8 -rotate-3 place-items-center rounded-[10px_10px_10px_3px] bg-[linear-gradient(145deg,#ce9cff,#7d31df)] text-sm font-black text-[#170822] shadow-[0_0_24px_#9b5cf661]">
            A
          </span>
          <span className="text-base font-semibold tracking-tight">Automate305 SEP</span>
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{accounts === 0 ? 'Set up your account' : 'Sign in'}</CardTitle>
              <CardDescription>
                {accounts === 0
                  ? 'Nobody has an account on this install yet. The first one you create is yours, and after that this page only signs people in.'
                  : 'This platform sends real mail from your domain. It is not open to the internet.'}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {accounts === 0 ? (
              <FirstAccountForm destination={destination} />
            ) : (
              <SignInForm destination={destination} />
            )}
          </CardContent>
        </Card>
      </div>
    );
  } catch (error) {
    // redirect() signals by throwing; let it through rather than rendering it
    // as a failure.
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') throw error;
    if (typeof error === 'object' && error !== null && 'digest' in error) throw error;

    return (
      <div className="mx-auto w-full max-w-md pt-16">
        <ErrorAlert message={toMessage(error, 'The sign-in page could not load.')} />
      </div>
    );
  }
}
