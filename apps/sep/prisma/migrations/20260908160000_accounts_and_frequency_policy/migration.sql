-- Operator accounts and browser sessions, plus the single-row policy table that
-- holds the per-contact frequency cap.

CREATE TABLE IF NOT EXISTS "User" (
    "id"           TEXT NOT NULL,
    "email"        TEXT NOT NULL,
    "name"         TEXT,
    "passwordHash" TEXT NOT NULL,
    "isActive"     BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt"  TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
CREATE INDEX IF NOT EXISTS "User_isActive_idx" ON "User"("isActive");

CREATE TABLE IF NOT EXISTS "Session" (
    "id"         TEXT NOT NULL,
    "tokenHash"  TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "expiresAt"  TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent"  TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");
CREATE INDEX IF NOT EXISTS "Session_expiresAt_idx" ON "Session"("expiresAt");

DO $$
BEGIN
    ALTER TABLE "Session"
        ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Setting" (
    "id"                  TEXT NOT NULL DEFAULT 'singleton',
    "maxEmailsPerContact" INTEGER NOT NULL DEFAULT 2,
    "contactWindowDays"   INTEGER NOT NULL DEFAULT 30,
    "updatedAt"           TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);
