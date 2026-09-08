-- Adds the unsubscribe token to Lead.
--
-- Written by hand rather than generated: cuid() is produced by the Prisma
-- client, not the database, so a plain NOT NULL UNIQUE column would fail on any
-- table that already holds rows. Add it nullable, backfill, then constrain.

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "unsubscribeToken" TEXT;

-- Backfill existing rows with a unique value.
UPDATE "Lead" SET "unsubscribeToken" = gen_random_uuid()::text WHERE "unsubscribeToken" IS NULL;

-- AlterTable
ALTER TABLE "Lead" ALTER COLUMN "unsubscribeToken" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Lead_unsubscribeToken_key" ON "Lead"("unsubscribeToken");
