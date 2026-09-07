import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma';
import { env } from './env';

/**
 * Prisma 7 takes its connection through a driver adapter rather than a
 * datasource URL in the schema. A single client is cached on globalThis so
 * Next.js hot reloads and worker restarts do not exhaust the connection pool.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.databaseUrl });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
