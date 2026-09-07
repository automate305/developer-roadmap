/**
 * Reply worker — runs the IMAP poll on a BullMQ repeatable schedule (every
 * REPLY_POLL_MINUTES, default 2). The polling itself lives in lib/inbound.ts,
 * shared with the cron route.
 */
import { Worker, type Job } from 'bullmq';
import { connectionOptions, REPLY_QUEUE_NAME, type ReplyJobData } from '../lib/queue';
import { pollAllAccounts, type InboundOutcome } from '../lib/inbound';

export { pollAllAccounts, handleInboundMessage, pollAccount, hasImapConfig } from '../lib/inbound';
export type { InboundOutcome, InboundMessage } from '../lib/inbound';

export function createReplyWorker(): Worker<ReplyJobData> {
  const worker = new Worker<ReplyJobData>(
    REPLY_QUEUE_NAME,
    async (job: Job<ReplyJobData>) => pollAllAccounts(job.data),
    { connection: connectionOptions(), concurrency: 1 },
  );

  worker.on('completed', (job, result: InboundOutcome[]) => {
    const replied = result.filter((outcome) => outcome.status === 'replied').length;
    if (replied > 0) console.log(`[reply-worker] ${job.id} → ${replied} lead(s) marked REPLIED`);
  });
  worker.on('failed', (job, error) => {
    console.error(`[reply-worker] ${job?.id} failed:`, error.message);
  });

  return worker;
}

if (process.argv[1] && process.argv[1].endsWith('reply-worker.ts')) {
  const worker = createReplyWorker();
  console.log(`[reply-worker] listening on ${REPLY_QUEUE_NAME}`);
  const shutdown = async () => {
    await worker.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
