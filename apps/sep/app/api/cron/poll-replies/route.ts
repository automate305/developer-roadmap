import { NextResponse } from 'next/server';
import { pollAllAccounts } from '@/lib/inbound';
import { authorizeCron } from '@/lib/cron-auth';
import { toMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Scheduled reply detection — polls every active mailbox over IMAP and halts
 * the sequence for any lead that answered. Same code path as the reply worker.
 */
export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const startedAt = Date.now();

  try {
    const outcomes = await pollAllAccounts();

    const replied = outcomes.filter((outcome) => outcome.status === 'replied');
    const bounced = outcomes.filter((outcome) => outcome.status === 'bounced');

    return NextResponse.json({
      ok: true,
      examined: outcomes.length,
      replied: replied.length,
      bounced: bounced.length,
      ignored: outcomes.length - replied.length - bounced.length,
      cancelledSteps: replied.reduce(
        (total, outcome) => total + (outcome.status === 'replied' ? outcome.cancelledSteps : 0),
        0,
      ),
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: toMessage(error, 'Reply poll failed.') },
      { status: 500 },
    );
  }
}

export const POST = GET;
