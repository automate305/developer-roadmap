'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { unsuppressAddress } from '@/lib/bounce';
import { SuppressionReason } from '@/lib/generated/prisma';
import { requireUser } from '@/lib/auth';
import { ok, fail, type ActionResult } from '@/lib/errors';

export async function liftSuppression(email: string): Promise<ActionResult> {
  try {
    // Server actions are their own HTTP request: the layout's check does not
    // cover them, so each one authenticates for itself.
    await requireUser();
    const lifted = await unsuppressAddress(email);
    if (!lifted) throw new Error('That address is no longer on the list.');

    revalidatePath('/suppressions');
    revalidatePath('/');
    return ok();
  } catch (error) {
    return fail(error, 'Could not lift the suppression.');
  }
}

export async function blockAddress(formData: FormData): Promise<ActionResult> {
  try {
    await requireUser();
    const email = String(formData.get('email') ?? '')
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      throw new Error('Enter a valid email address.');
    }

    // Blocking by hand goes through the same path as a bounce, so leads are
    // halted across every campaign the address appears in.
    const { suppressAddress } = await import('@/lib/bounce');
    await suppressAddress(email, SuppressionReason.MANUAL, 'Blocked by hand.');

    revalidatePath('/suppressions');
    revalidatePath('/');
    return ok();
  } catch (error) {
    return fail(error, 'Could not block that address.');
  }
}
