'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { ok, fail, type ActionResult } from '@/lib/errors';
import { encryptSecret, encryptOptionalSecret } from '@/lib/crypto';

const optionalText = z.string().trim().optional().or(z.literal(''));

const accountInput = z.object({
  name: z.string().trim().min(1, 'Account name is required.').max(120),
  fromName: z.string().trim().min(1, 'From name is required.').max(120),
  fromEmail: z.string().trim().toLowerCase().email('A valid from address is required.'),
  smtpHost: z.string().trim().min(1, 'SMTP host is required.'),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpSecure: z.coerce.boolean(),
  smtpUser: z.string().trim().min(1, 'SMTP user is required.'),
  smtpPassword: z.string().min(1, 'SMTP password is required.'),
  imapHost: optionalText,
  imapPort: z.coerce.number().int().min(1).max(65535).optional(),
  imapSecure: z.coerce.boolean(),
  imapUser: optionalText,
  imapPassword: optionalText,
  maxDaily: z.coerce.number().int().min(1, 'Daily cap must be at least 1.').max(2000),
  timezone: z.string().trim().min(1).default('America/New_York'),
  sendWindowStartHour: z.coerce.number().int().min(0).max(23),
  sendWindowEndHour: z.coerce.number().int().min(0).max(23),
  sendDays: z.array(z.coerce.number().int().min(1).max(7)).min(1, 'Pick at least one sending day.'),
  jitterMinutes: z.coerce.number().int().min(0).max(240),
  warmupEnabled: z.coerce.boolean(),
  warmupInitialDaily: z.coerce.number().int().min(1).max(500),
  warmupDailyIncrement: z.coerce.number().int().min(1).max(500),
});

function readForm(formData: FormData) {
  return accountInput.parse({
    name: formData.get('name') ?? '',
    fromName: formData.get('fromName') ?? '',
    fromEmail: formData.get('fromEmail') ?? '',
    smtpHost: formData.get('smtpHost') ?? '',
    smtpPort: formData.get('smtpPort') ?? 587,
    smtpSecure: formData.get('smtpSecure') === 'on' || formData.get('smtpSecure') === 'true',
    smtpUser: formData.get('smtpUser') ?? '',
    smtpPassword: formData.get('smtpPassword') ?? '',
    imapHost: formData.get('imapHost') ?? '',
    imapPort: formData.get('imapPort') || 993,
    imapSecure: formData.get('imapSecure') !== 'false',
    imapUser: formData.get('imapUser') ?? '',
    imapPassword: formData.get('imapPassword') ?? '',
    maxDaily: formData.get('maxDaily') ?? 50,
    timezone: formData.get('timezone') || 'America/New_York',
    sendWindowStartHour: formData.get('sendWindowStartHour') ?? 8,
    sendWindowEndHour: formData.get('sendWindowEndHour') ?? 17,
    // Checkbox groups arrive as repeated entries.
    sendDays: formData.getAll('sendDays').map(String),
    jitterMinutes: formData.get('jitterMinutes') ?? 45,
    warmupEnabled: formData.get('warmupEnabled') === 'on',
    warmupInitialDaily: formData.get('warmupInitialDaily') ?? 5,
    warmupDailyIncrement: formData.get('warmupDailyIncrement') ?? 5,
  });
}

export async function createSendingAccount(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    // Server actions are their own HTTP request: the layout's check does not
    // cover them, so each one authenticates for itself.
    await requireUser();
    const parsed = readForm(formData);

    // Passwords are encrypted here so a plaintext credential never reaches the
    // database. Missing CREDENTIAL_KEY fails the save rather than storing raw.
    const account = await prisma.sendingAccount.create({
      data: {
        ...parsed,
        smtpPassword: encryptSecret(parsed.smtpPassword),
        imapHost: parsed.imapHost || null,
        imapUser: parsed.imapUser || null,
        imapPassword: encryptOptionalSecret(parsed.imapPassword),
        // Warmup counts from the moment the mailbox is created.
        warmupStartedAt: parsed.warmupEnabled ? new Date() : null,
      },
    });

    revalidatePath('/accounts');
    return ok({ id: account.id });
  } catch (error) {
    return fail(error, 'Could not save the sending account.');
  }
}

export async function toggleSendingAccount(id: string): Promise<ActionResult> {
  try {
    await requireUser();
    const account = await prisma.sendingAccount.findUnique({ where: { id } });
    if (!account) throw new Error('Sending account not found.');

    await prisma.sendingAccount.update({
      where: { id },
      data: { isActive: !account.isActive },
    });

    revalidatePath('/accounts');
    return ok();
  } catch (error) {
    return fail(error, 'Could not change the account state.');
  }
}

export async function deleteSendingAccount(id: string): Promise<ActionResult> {
  try {
    await requireUser();
    await prisma.sendingAccount.delete({ where: { id } });
    revalidatePath('/accounts');
    return ok();
  } catch (error) {
    return fail(error, 'Could not delete the sending account.');
  }
}
