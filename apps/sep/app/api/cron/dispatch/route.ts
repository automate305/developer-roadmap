import { NextResponse } from 'next/server';
import { findDueLeads } from '@/lib/sequence';
import { processSendJob, type SendOutcome } from '@/lib/dispatch';
import { authorizeCron } from '@/lib/cron-auth';
import { toMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Hobby allows 60s; Pro allows more. The batch cap below keeps a run inside it.
export const maxDuration = 60;

/**
 * Scheduled dispatch — the serverless equivalent of the scheduler tick plus the
 * send worker, for deployments with no long-lived process to run BullMQ.
 *
 * Sends inline rather than through Redis. Every send still goes through
 * lib/dispatch.ts, so the execution guard, the per-mailbox daily cap and the
 * tracking pixel behave exactly as they do under the worker.
 */
const DEFAULT_BATCH = 40;
const MAX_BATCH = 200;
// Leaves room to finish the in-flight send and return a summary before Vercel
// cuts the invocation off.
const TIME_BUDGET_MS = 45_000;

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const startedAt = Date.now();
  const url = new URL(request.url);
  const requested = Number.parseInt(url.searchParams.get('batch') ?? '', 10);
  const batch = Math.min(
    Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_BATCH,
    MAX_BATCH,
  );

  const counts = { sent: 0, skipped: 0, deferred: 0, failed: 0 };
  const errors: string[] = [];
  let processed = 0;
  let timedOut = false;

  try {
    const due = await findDueLeads(new Date(), batch);

    for (const lead of due) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        timedOut = true;
        break;
      }

      processed += 1;
      try {
        const outcome: SendOutcome = await processSendJob({
          leadId: lead.id,
          campaignId: lead.campaignId,
          stepOrder: lead.currentStep + 1,
        });
        counts[outcome.status] += 1;
      } catch (error) {
        // A transport failure is already recorded on the EmailLog row by the
        // dispatcher; the lead stays scheduled and the next run retries it.
        counts.failed += 1;
        if (errors.length < 5) errors.push(toMessage(error, 'Send failed.'));
      }
    }

    return NextResponse.json({
      ok: true,
      due: due.length,
      processed,
      ...counts,
      // True when the batch ran out of time; the next run picks up the rest.
      truncated: timedOut || due.length === batch,
      errors,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: toMessage(error, 'Dispatch run failed.'), processed, ...counts },
      { status: 500 },
    );
  }
}

// Vercel Cron issues GET; POST is here so any external scheduler works too.
export const POST = GET;
