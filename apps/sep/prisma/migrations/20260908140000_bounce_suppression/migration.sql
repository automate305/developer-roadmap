-- Bounce suppression: a BOUNCED lead status, per-lead soft bounce counting, and
-- an address-level suppression list.

-- AlterEnum
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'BOUNCED';

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SuppressionReason') THEN
    CREATE TYPE "SuppressionReason" AS ENUM ('HARD_BOUNCE', 'REPEATED_SOFT_BOUNCE', 'COMPLAINT', 'MANUAL');
  END IF;
END
$$;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "bouncedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "softBounceCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "SuppressedAddress" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "detail" TEXT,
    "bounceCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuppressedAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SuppressedAddress_email_key" ON "SuppressedAddress"("email");
CREATE INDEX IF NOT EXISTS "SuppressedAddress_reason_idx" ON "SuppressedAddress"("reason");
