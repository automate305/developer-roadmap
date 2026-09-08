'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { saveSettings } from '@/lib/settings';
import { ok, fail, type ActionResult } from '@/lib/errors';

function readInt(formData: FormData, field: string, label: string): number {
  const raw = String(formData.get(field) ?? '').trim();
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a whole number.`);
  return parsed;
}

export async function updateFrequencyPolicy(formData: FormData): Promise<ActionResult> {
  try {
    await requireUser();

    await saveSettings({
      maxEmailsPerContact: readInt(formData, 'maxEmailsPerContact', 'The contact cap'),
      contactWindowDays: readInt(formData, 'contactWindowDays', 'The window'),
    });

    revalidatePath('/settings');
    revalidatePath('/');
    return ok();
  } catch (error) {
    return fail(error, 'Could not save the sending policy.');
  }
}
