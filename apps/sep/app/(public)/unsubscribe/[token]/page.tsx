import { prisma } from '@/lib/prisma';
import { LeadStatus } from '@/lib/generated/prisma';
import { UnsubscribeForm } from '@/components/unsubscribe-form';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Unsubscribe',
  robots: { index: false, follow: false },
};

/**
 * Confirmation page for the footer link.
 *
 * Viewing this page does not opt anyone out. Corporate mail scanners fetch every
 * link in an inbound message, so a GET that unsubscribed would drop recipients
 * who never clicked. The visitor confirms with a POST.
 */
export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let email: string | null = null;
  let alreadyOptedOut = false;
  let lookupFailed = false;

  try {
    const lead = await prisma.lead.findUnique({
      where: { unsubscribeToken: token },
      select: { email: true, status: true },
    });
    if (lead) {
      email = lead.email;
      alreadyOptedOut = lead.status === LeadStatus.OPTED_OUT;
    }
  } catch (error) {
    console.error('[unsubscribe] lookup failed', error);
    lookupFailed = true;
  }

  return (
    <div className="mx-auto max-w-md rounded-lg border border-hairline bg-panel px-6 py-8">
      <h1 className="text-base font-semibold text-ink">Unsubscribe</h1>

      {lookupFailed ? (
        <p className="mt-2 text-sm text-ink-muted">
          We could not reach our records just now. Please try again in a moment.
        </p>
      ) : alreadyOptedOut ? (
        <p className="mt-2 text-sm text-ink-muted">
          {email} is already unsubscribed. No further emails will be sent.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-muted">
            {email
              ? `Confirm that ${email} should stop receiving these emails.`
              : 'Confirm that this address should stop receiving these emails.'}
          </p>
          <UnsubscribeForm token={token} />
        </>
      )}
    </div>
  );
}
