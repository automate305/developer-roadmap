-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('UNCONTACTED', 'IN_SEQUENCE', 'REPLIED', 'OPTED_OUT');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('SENT', 'OPENED', 'BOUNCED', 'FAILED');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "sendingAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceStep" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "company" TEXT,
    "customFields" JSONB,
    "status" "LeadStatus" NOT NULL DEFAULT 'UNCONTACTED',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "nextSendAt" TIMESTAMP(3),
    "lastContactedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "optedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendingAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "smtpHost" TEXT NOT NULL,
    "smtpPort" INTEGER NOT NULL DEFAULT 587,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "smtpUser" TEXT NOT NULL,
    "smtpPassword" TEXT NOT NULL,
    "imapHost" TEXT,
    "imapPort" INTEGER DEFAULT 993,
    "imapSecure" BOOLEAN NOT NULL DEFAULT true,
    "imapUser" TEXT,
    "imapPassword" TEXT,
    "maxDaily" INTEGER NOT NULL DEFAULT 50,
    "sentToday" INTEGER NOT NULL DEFAULT 0,
    "lastResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SendingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sequenceStepId" TEXT,
    "sendingAccountId" TEXT,
    "status" "EmailStatus" NOT NULL DEFAULT 'SENT',
    "subject" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL DEFAULT 1,
    "messageId" TEXT,
    "trackingId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "Campaign_sendingAccountId_idx" ON "Campaign"("sendingAccountId");

-- CreateIndex
CREATE INDEX "SequenceStep_campaignId_idx" ON "SequenceStep"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceStep_campaignId_stepOrder_key" ON "SequenceStep"("campaignId", "stepOrder");

-- CreateIndex
CREATE INDEX "Lead_campaignId_status_idx" ON "Lead"("campaignId", "status");

-- CreateIndex
CREATE INDEX "Lead_status_nextSendAt_idx" ON "Lead"("status", "nextSendAt");

-- CreateIndex
CREATE INDEX "Lead_email_idx" ON "Lead"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_campaignId_email_key" ON "Lead"("campaignId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "SendingAccount_fromEmail_key" ON "SendingAccount"("fromEmail");

-- CreateIndex
CREATE INDEX "SendingAccount_isActive_idx" ON "SendingAccount"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "EmailLog_messageId_key" ON "EmailLog"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailLog_trackingId_key" ON "EmailLog"("trackingId");

-- CreateIndex
CREATE INDEX "EmailLog_campaignId_status_idx" ON "EmailLog"("campaignId", "status");

-- CreateIndex
CREATE INDEX "EmailLog_leadId_idx" ON "EmailLog"("leadId");

-- CreateIndex
CREATE INDEX "EmailLog_sentAt_idx" ON "EmailLog"("sentAt");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_sendingAccountId_fkey" FOREIGN KEY ("sendingAccountId") REFERENCES "SendingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_sequenceStepId_fkey" FOREIGN KEY ("sequenceStepId") REFERENCES "SequenceStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_sendingAccountId_fkey" FOREIGN KEY ("sendingAccountId") REFERENCES "SendingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

