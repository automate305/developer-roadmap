'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { CampaignStatus } from '@/lib/generated/prisma';
import { requireUser } from '@/lib/auth';
import { ok, fail, type ActionResult } from '@/lib/errors';
import { scheduleCampaignLeads, unscheduleCampaignLeads } from '@/lib/sequence';

const campaignInput = z.object({
  name: z.string().trim().min(1, 'Campaign name is required.').max(120),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  sendingAccountId: z.string().trim().min(1).optional().or(z.literal('')),
});

export async function createCampaign(formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    // Server actions are their own HTTP request: the layout's check does not
    // cover them, so each one authenticates for itself.
    await requireUser();
    const parsed = campaignInput.parse({
      name: formData.get('name') ?? '',
      description: formData.get('description') ?? '',
      sendingAccountId: formData.get('sendingAccountId') ?? '',
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: parsed.name,
        description: parsed.description || null,
        sendingAccountId: parsed.sendingAccountId || null,
      },
    });

    revalidatePath('/campaigns');
    revalidatePath('/');
    return ok({ id: campaign.id });
  } catch (error) {
    return fail(error, 'Could not create the campaign.');
  }
}

export async function updateCampaign(
  id: string,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireUser();
    const parsed = campaignInput.parse({
      name: formData.get('name') ?? '',
      description: formData.get('description') ?? '',
      sendingAccountId: formData.get('sendingAccountId') ?? '',
    });

    await prisma.campaign.update({
      where: { id },
      data: {
        name: parsed.name,
        description: parsed.description || null,
        sendingAccountId: parsed.sendingAccountId || null,
      },
    });

    revalidatePath(`/campaigns/${id}`);
    revalidatePath('/campaigns');
    return ok({ id });
  } catch (error) {
    return fail(error, 'Could not update the campaign.');
  }
}

/**
 * Status transitions carry scheduling side effects: activating enrols leads on
 * step one, pausing clears pending schedule so no worker picks them up.
 */
export async function setCampaignStatus(
  id: string,
  status: CampaignStatus,
): Promise<ActionResult<{ status: CampaignStatus }>> {
  try {
    await requireUser();
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: { _count: { select: { steps: true, leads: true } } },
    });
    if (!campaign) throw new Error('Campaign not found.');

    if (status === CampaignStatus.ACTIVE) {
      if (campaign._count.steps === 0) {
        throw new Error('Add at least one sequence step before activating.');
      }
      if (!campaign.sendingAccountId) {
        throw new Error('Attach a sending account before activating.');
      }
    }

    await prisma.campaign.update({ where: { id }, data: { status } });

    if (status === CampaignStatus.ACTIVE) {
      await scheduleCampaignLeads(id);
    } else if (status === CampaignStatus.PAUSED || status === CampaignStatus.COMPLETED) {
      await unscheduleCampaignLeads(id);
    }

    revalidatePath(`/campaigns/${id}`);
    revalidatePath('/campaigns');
    revalidatePath('/');
    return ok({ status });
  } catch (error) {
    return fail(error, 'Could not change the campaign status.');
  }
}

export async function deleteCampaign(id: string): Promise<ActionResult> {
  try {
    await requireUser();
    await prisma.campaign.delete({ where: { id } });
    revalidatePath('/campaigns');
    revalidatePath('/');
    return ok();
  } catch (error) {
    return fail(error, 'Could not delete the campaign.');
  }
}
