/**
 * Email worker — consumes scheduled sequence steps from Redis and dispatches
 * them. The sending itself lives in lib/dispatch.ts, shared with the cron route.
 */
import { Worker, type Job } from 'bullmq';
import { connectionOptions, EMAIL_QUEUE_NAME, type SendJobData } from '../lib/queue';
import { env } from '../lib/env';
import { processSendJob, type SendOutcome } from '../lib/dispatch';

export { processSendJob, type SendOutcome };

export function createEmailWorker(): Worker<SendJobData> {
  const worker = new Worker<SendJobData>(
    EMAIL_QUEUE_NAME,
    async (job: Job<SendJobData>) => processSendJob(job.data),
    {
      connection: connectionOptions(),
      concurrency: env.emailWorkerConcurrency,
      // Gentle global pacing so a burst of due steps does not hammer SMTP.
      limiter: { max: 30, duration: 60_000 },
    },
  );

  worker.on('completed', (job, result: SendOutcome) => {
    console.log(`[email-worker] ${job.id} → ${result.status}`);
  });
  worker.on('failed', (job, error) => {
    console.error(`[email-worker] ${job?.id} failed:`, error.message);
  });

  return worker;
}

// Allow running this worker on its own: `npm run worker:email`
if (process.argv[1] && process.argv[1].endsWith('email-worker.ts')) {
  const worker = createEmailWorker();
  console.log(`[email-worker] listening on ${EMAIL_QUEUE_NAME}`);
  const shutdown = async () => {
    await worker.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
