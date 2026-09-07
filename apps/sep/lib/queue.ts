import { Queue, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { env } from './env';

export const EMAIL_QUEUE_NAME = 'sep-email-send';
export const REPLY_QUEUE_NAME = 'sep-reply-poll';

// The payload type lives with the send path so importing it does not drag
// BullMQ and Redis into the serverless bundle.
export type { SendJobData } from './dispatch';
import type { SendJobData } from './dispatch';

export type { ReplyJobData } from './inbound';
import type { ReplyJobData } from './inbound';

const globalForQueue = globalThis as unknown as {
  sepRedis?: IORedis;
  sepEmailQueue?: Queue<SendJobData>;
  sepReplyQueue?: Queue<ReplyJobData>;
};

/**
 * BullMQ requires `maxRetriesPerRequest: null` so blocking commands used by
 * workers are not aborted by ioredis' own retry ceiling.
 */
export function createRedisConnection(): IORedis {
  return new IORedis(env.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export function getRedis(): IORedis {
  if (!globalForQueue.sepRedis) {
    globalForQueue.sepRedis = createRedisConnection();
  }
  return globalForQueue.sepRedis;
}

export function connectionOptions(): ConnectionOptions {
  return getRedis() as unknown as ConnectionOptions;
}

export function getEmailQueue(): Queue<SendJobData> {
  if (!globalForQueue.sepEmailQueue) {
    globalForQueue.sepEmailQueue = new Queue<SendJobData>(EMAIL_QUEUE_NAME, {
      connection: connectionOptions(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 60 * 60 * 24, count: 5_000 },
        removeOnFail: { age: 60 * 60 * 24 * 7 },
      },
    });
  }
  return globalForQueue.sepEmailQueue;
}

export function getReplyQueue(): Queue<ReplyJobData> {
  if (!globalForQueue.sepReplyQueue) {
    globalForQueue.sepReplyQueue = new Queue<ReplyJobData>(REPLY_QUEUE_NAME, {
      connection: connectionOptions(),
      defaultJobOptions: {
        attempts: 2,
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return globalForQueue.sepReplyQueue;
}

/**
 * Deterministic job id: one send per lead per step, so a re-scheduled campaign
 * or a duplicated scheduler tick cannot double-send. BullMQ reserves the colon
 * as its own key separator, so the parts are joined with dashes.
 */
export function sendJobId(leadId: string, stepOrder: number): string {
  return `send-${leadId}-${stepOrder}`;
}
