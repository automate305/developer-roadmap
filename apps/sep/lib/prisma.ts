import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma';
import { env } from './env';

/**
 * Prisma 7 takes its connection through a driver adapter rather than a
 * datasource URL in the schema. A single client is cached on globalThis so
 * Next.js hot reloads and worker restarts do not exhaust the connection pool.
 *
 * The client is created lazily on first use. That matters for deployment: the
 * build imports every route module, and a missing DATABASE_URL should surface
 * as a rendered error state on the page rather than a failed build.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.databaseUrl });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

function client(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const instance = client();
    const value = Reflect.get(instance, property, instance);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
  has(_target, property) {
    return Reflect.has(client(), property);
  },
});

/** True when a connection string is configured, for rendering setup guidance. */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}
