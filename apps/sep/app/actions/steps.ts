'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, fail, type ActionResult } from '@/lib/errors';

const stepInput = z.object({
  subject: z.string().trim().min(1, 'Subject is required.').max(250),
  body: z.string().trim().min(1, 'Body is required.'),
  delayDays: z.coerce.number().int().min(0, 'Delay cannot be negative.').max(365),
});

export async function createStep(
  campaignId: string,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = stepInput.parse({
      subject: formData.get('subject') ?? '',
      body: formData.get('body') ?? '',
      delayDays: formData.get('delayDays') ?? 0,
    });

    const last = await prisma.sequenceStep.findFirst({
      where: { campaignId },
      orderBy: { stepOrder: 'desc' },
      select: { stepOrder: true },
    });

    const step = await prisma.sequenceStep.create({
      data: {
        campaignId,
        stepOrder: (last?.stepOrder ?? 0) + 1,
        subject: parsed.subject,
        body: parsed.body,
        delayDays: parsed.delayDays,
      },
    });

    revalidatePath(`/campaigns/${campaignId}`);
    return ok({ id: step.id });
  } catch (error) {
    return fail(error, 'Could not add the step.');
  }
}

export async function updateStep(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const parsed = stepInput.parse({
      subject: formData.get('subject') ?? '',
      body: formData.get('body') ?? '',
      delayDays: formData.get('delayDays') ?? 0,
    });

    const step = await prisma.sequenceStep.update({
      where: { id },
      data: parsed,
    });

    revalidatePath(`/campaigns/${step.campaignId}`);
    return ok();
  } catch (error) {
    return fail(error, 'Could not update the step.');
  }
}

export async function deleteStep(id: string): Promise<ActionResult> {
  try {
    const step = await prisma.sequenceStep.delete({ where: { id } });
    await renumber(step.campaignId);
    revalidatePath(`/campaigns/${step.campaignId}`);
    return ok();
  } catch (error) {
    return fail(error, 'Could not delete the step.');
  }
}

/**
 * Swaps a step with its neighbour. Ordering is written in a transaction through
 * a temporary negative slot because (campaignId, stepOrder) is unique.
 */
export async function moveStep(id: string, direction: 'up' | 'down'): Promise<ActionResult> {
  try {
    const step = await prisma.sequenceStep.findUnique({ where: { id } });
    if (!step) throw new Error('Step not found.');

    const neighbour = await prisma.sequenceStep.findFirst({
      where: {
        campaignId: step.campaignId,
        stepOrder: direction === 'up' ? { lt: step.stepOrder } : { gt: step.stepOrder },
      },
      orderBy: { stepOrder: direction === 'up' ? 'desc' : 'asc' },
    });
    if (!neighbour) return ok();

    await prisma.$transaction([
      prisma.sequenceStep.update({ where: { id: step.id }, data: { stepOrder: -1 } }),
      prisma.sequenceStep.update({
        where: { id: neighbour.id },
        data: { stepOrder: step.stepOrder },
      }),
      prisma.sequenceStep.update({
        where: { id: step.id },
        data: { stepOrder: neighbour.stepOrder },
      }),
    ]);

    revalidatePath(`/campaigns/${step.campaignId}`);
    return ok();
  } catch (error) {
    return fail(error, 'Could not reorder the step.');
  }
}

/** Closes gaps left by a deletion so stepOrder stays 1..n. */
async function renumber(campaignId: string): Promise<void> {
  const steps = await prisma.sequenceStep.findMany({
    where: { campaignId },
    orderBy: { stepOrder: 'asc' },
    select: { id: true, stepOrder: true },
  });

  const updates = steps
    .map((step, index) => ({ step, target: index + 1 }))
    .filter(({ step, target }) => step.stepOrder !== target);

  if (updates.length === 0) return;

  await prisma.$transaction([
    // Park every row out of the way first so the unique constraint never trips.
    ...updates.map(({ step }, index) =>
      prisma.sequenceStep.update({ where: { id: step.id }, data: { stepOrder: -(index + 1) } }),
    ),
    ...updates.map(({ step, target }) =>
      prisma.sequenceStep.update({ where: { id: step.id }, data: { stepOrder: target } }),
    ),
  ]);
}
