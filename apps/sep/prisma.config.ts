import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// DATABASE_URL is only required by commands that touch a database (migrate,
// db push, studio). `prisma generate` runs during a build where the variable
// may legitimately be absent, so the datasource is attached conditionally
// rather than through env(), which throws when unset.
const databaseUrl = process.env.DATABASE_URL?.trim();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx scripts/seed.ts',
  },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
