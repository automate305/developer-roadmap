import 'dotenv/config';

/**
 * Reads a required environment variable, failing loudly at boot rather than
 * with an opaque connection error deep inside a worker.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value.trim();
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const env = {
  get databaseUrl() {
    return required('DATABASE_URL');
  },
  get redisUrl() {
    return process.env.REDIS_URL?.trim() || 'redis://localhost:6379';
  },
  /**
   * Postgres schema holding the SEP tables. Defaults to `public`, but the
   * deployment shares a database with another app, so its tables live in a
   * dedicated schema. Read from `?schema=` on the connection string when
   * present, else DATABASE_SCHEMA.
   */
  get databaseSchema(): string | undefined {
    const fromUrl = (() => {
      try {
        return new URL(required('DATABASE_URL')).searchParams.get('schema');
      } catch {
        return null;
      }
    })();
    const schema = fromUrl?.trim() || process.env.DATABASE_SCHEMA?.trim();
    return schema && schema !== 'public' ? schema : undefined;
  },
  /**
   * Key encrypting mailbox credentials at rest. Required before a sending
   * account can be saved, so a password never lands in the database in the
   * clear. Generate with: openssl rand -base64 32
   */
  get credentialKey(): string {
    return required('CREDENTIAL_KEY');
  },
  /** Absolute origin used to build tracking-pixel URLs embedded in outbound mail. */
  get appUrl() {
    return (process.env.APP_URL?.trim() || 'http://localhost:3000').replace(/\/+$/, '');
  },
  get emailWorkerConcurrency() {
    return optionalNumber('EMAIL_WORKER_CONCURRENCY', 5);
  },
  get replyPollMinutes() {
    return optionalNumber('REPLY_POLL_MINUTES', 2);
  },
};
