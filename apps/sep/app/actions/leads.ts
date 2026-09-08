'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { LeadStatus } from '@/lib/generated/prisma';
import { requireUser } from '@/lib/auth';
import { ok, fail, type ActionResult } from '@/lib/errors';
import { scheduleCampaignLeads } from '@/lib/sequence';

const leadInput = z.object({
  email: z.string().trim().toLowerCase().email('A valid email is required.'),
  firstName: z.string().trim().max(80).optional().or(z.literal('')),
  lastName: z.string().trim().max(80).optional().or(z.literal('')),
  company: z.string().trim().max(160).optional().or(z.literal('')),
});

export async function createLead(
  campaignId: string,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    // Server actions are their own HTTP request: the layout's check does not
    // cover them, so each one authenticates for itself.
    await requireUser();
    const parsed = leadInput.parse({
      email: formData.get('email') ?? '',
      firstName: formData.get('firstName') ?? '',
      lastName: formData.get('lastName') ?? '',
      company: formData.get('company') ?? '',
    });

    const lead = await prisma.lead.upsert({
      where: { campaignId_email: { campaignId, email: parsed.email } },
      create: {
        campaignId,
        email: parsed.email,
        firstName: parsed.firstName || null,
        lastName: parsed.lastName || null,
        company: parsed.company || null,
      },
      update: {
        firstName: parsed.firstName || null,
        lastName: parsed.lastName || null,
        company: parsed.company || null,
      },
    });

    // Picks up step one immediately if the campaign is already running.
    await scheduleCampaignLeadsIfActive(campaignId);

    revalidatePath(`/campaigns/${campaignId}`);
    return ok({ id: lead.id });
  } catch (error) {
    return fail(error, 'Could not add the lead.');
  }
}

export async function setLeadStatus(id: string, status: LeadStatus): Promise<ActionResult> {
  try {
    await requireUser();
    const now = new Date();
    const lead = await prisma.lead.update({
      where: { id },
      data: {
        status,
        // A halted lead must never be picked up by the scheduler again.
        nextSendAt: status === LeadStatus.REPLIED || status === LeadStatus.OPTED_OUT ? null : undefined,
        repliedAt: status === LeadStatus.REPLIED ? now : undefined,
        optedOutAt: status === LeadStatus.OPTED_OUT ? now : undefined,
      },
    });

    revalidatePath(`/campaigns/${lead.campaignId}`);
    revalidatePath('/');
    return ok();
  } catch (error) {
    return fail(error, 'Could not update the lead.');
  }
}

export async function deleteLead(id: string): Promise<ActionResult> {
  try {
    await requireUser();
    const lead = await prisma.lead.delete({ where: { id } });
    revalidatePath(`/campaigns/${lead.campaignId}`);
    return ok();
  } catch (error) {
    return fail(error, 'Could not delete the lead.');
  }
}

/** Internal helper — deliberately not exported: every export of a 'use server'
 * module becomes a callable endpoint, and this one needs no caller outside. */
async function scheduleCampaignLeadsIfActive(campaignId: string): Promise<number> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true },
  });
  if (campaign?.status !== 'ACTIVE') return 0;
  return scheduleCampaignLeads(campaignId);
}
