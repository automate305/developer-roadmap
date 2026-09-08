/**
 * Worker runner — starts the send worker, the IMAP reply worker, and the
 * scheduler tick that turns due sequence steps into queued jobs.
 *
 *   npm run workers
 */
import { getEmailQueue, getReplyQueue } from '../lib/queue';
import { enqueueDueSteps } from '../lib/sequence';
import { env } from '../lib/env';
import { createEmailWorker } from './email-worker';
import { createReplyWorker } from './reply-worker';

const SCHEDULER_TICK_MS = 60_000;

async function main() {
  const emailWorker = createEmailWorker();
  const replyWorker = createReplyWorker();

  // IMAP polling is driven by a BullMQ repeatable schedule so exactly one poll
  // runs per interval no matter how many runner processes are up.
  await getReplyQueue().upsertJobScheduler(
    'reply-poll',
    { every: env.replyPollMinutes * 60_000 },
    { name: 'poll-inboxes', data: {} },
  );

  console.log(
    `[workers] send concurrency ${env.emailWorkerConcurrency}, reply poll every ${env.replyPollMinutes}m`,
  );

  const tick = async () => {
    try {
      const queued = await enqueueDueSteps();
      if (queued > 0) console.log(`[scheduler] queued ${queued} step(s)`);
    } catch (error) {
      console.error('[scheduler] tick failed:', error);
    }
  };

  await tick();
  const timer = setInterval(tick, SCHEDULER_TICK_MS);

  const shutdown = async () => {
    console.log('[workers] shutting down…');
    clearInterval(timer);
    await Promise.allSettled([
      emailWorker.close(),
      replyWorker.close(),
      getEmailQueue().close(),
      getReplyQueue().close(),
    ]);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[workers] fatal:', error);
  process.exit(1);
});
