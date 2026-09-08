import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { toMessage } from '@/lib/errors';
import { currentUser } from '@/lib/auth';
import { scheduleCampaignLeads } from '@/lib/sequence';
import { checkRateLimit, clientKey, isSameOrigin } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ROWS = 25_000;
const CHUNK_SIZE = 250;

const rowSchema = z.object({
  email: z.string().trim().min(1),
  firstName: z.string().trim().max(120).optional().nullable(),
  lastName: z.string().trim().max(120).optional().nullable(),
  company: z.string().trim().max(200).optional().nullable(),
  customFields: z.record(z.string(), z.string()).optional().nullable(),
});

const payloadSchema = z.object({
  campaignId: z.string().trim().min(1, 'campaignId is required.'),
  rows: z.array(rowSchema).min(1, 'No rows to import.').max(MAX_ROWS),
});

export type ImportRow = z.infer<typeof rowSchema>;

export type ImportResponse = {
  imported: number;
  updated: number;
  skipped: number;
  duplicates: number;
  scheduled: number;
  errors: string[];
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function POST(request: Request) {
  // This endpoint writes the addresses the platform will email, so an open one
  // is a way to make someone else's mailbox send to a list of your choosing.
  // Signing in is the boundary; the origin check and the rate limit below sit
  // behind it, against a signed-in browser being driven from another page.
  if (!(await currentUser())) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  }

  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 });
  }

  const limit = checkRateLimit(clientKey(request, 'import'), { limit: 10, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many import requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const json = await request.json();
    const payload = payloadSchema.parse(json);

    const campaign = await prisma.campaign.findUnique({
      where: { id: payload.campaignId },
      select: { id: true, status: true },
    });
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
    }

    const errors: string[] = [];
    const seen = new Set<string>();
    let skipped = 0;
    let duplicates = 0;

    const prepared: ImportRow[] = [];
    for (const [index, row] of payload.rows.entries()) {
      const email = row.email.trim().toLowerCase();
      if (!EMAIL_PATTERN.test(email)) {
        skipped += 1;
        if (errors.length < 10) errors.push(`Row ${index + 1}: "${row.email}" is not a valid email.`);
        continue;
      }
      if (seen.has(email)) {
        duplicates += 1;
        continue;
      }
      seen.add(email);
      prepared.push({
        email,
        firstName: clean(row.firstName),
        lastName: clean(row.lastName),
        company: clean(row.company),
        customFields: row.customFields ?? null,
      });
    }

    if (prepared.length === 0) {
      return NextResponse.json(
        { error: 'No valid rows found. Check the email column mapping.', skipped, duplicates },
        { status: 422 },
      );
    }

    const existing = await prisma.lead.findMany({
      where: { campaignId: campaign.id, email: { in: prepared.map((row) => row.email) } },
      select: { email: true },
    });
    const existingEmails = new Set(existing.map((lead) => lead.email));

    // Upserts run in bounded chunks so a large CSV cannot hold one giant
    // transaction open against Postgres.
    for (let offset = 0; offset < prepared.length; offset += CHUNK_SIZE) {
      const chunk = prepared.slice(offset, offset + CHUNK_SIZE);
      await prisma.$transaction(
        chunk.map((row) =>
          prisma.lead.upsert({
            where: { campaignId_email: { campaignId: campaign.id, email: row.email } },
            create: {
              campaignId: campaign.id,
              email: row.email,
              firstName: row.firstName,
              lastName: row.lastName,
              company: row.company,
              customFields: row.customFields ?? undefined,
            },
            // An existing lead keeps its status and schedule; only enrichment
            // fields are refreshed by a re-import.
            update: {
              firstName: row.firstName,
              lastName: row.lastName,
              company: row.company,
              customFields: row.customFields ?? undefined,
            },
          }),
        ),
      );
    }

    const updated = prepared.filter((row) => existingEmails.has(row.email)).length;
    const imported = prepared.length - updated;

    // New leads join step one straight away when the campaign is already live.
    const scheduled =
      campaign.status === 'ACTIVE' ? await scheduleCampaignLeads(campaign.id) : 0;

    const response: ImportResponse = {
      imported,
      updated,
      skipped,
      duplicates,
      scheduled,
      errors,
    };
    return NextResponse.json(response);
  } catch (error) {
    const message = toMessage(error, 'Import failed.');
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
