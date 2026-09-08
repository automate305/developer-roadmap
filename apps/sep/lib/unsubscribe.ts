import { prisma } from './prisma';
import { LeadStatus } from './generated/prisma';
import { env } from './env';

/**
 * Unsubscribe handling.
 *
 * Every lead carries an opaque token. Two surfaces use it:
 *
 * - A footer link to a confirmation page. The page does not opt anyone out on
 *   GET, because corporate link scanners follow links in inbound mail and would
 *   silently unsubscribe people who never clicked. Confirming is a POST.
 * - RFC 8058 one-click headers, so a recipient can unsubscribe from their mail
 *   client's own button. Scanners do not POST, so that path is safe to action
 *   immediately, which is what the RFC requires.
 */

export function unsubscribePageUrl(token: string, baseUrl = env.appUrl): string {
  return `${baseUrl.replace(/\/+$/, '')}/unsubscribe/${encodeURIComponent(token)}`;
}

export function oneClickUnsubscribeUrl(token: string, baseUrl = env.appUrl): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/unsubscribe?t=${encodeURIComponent(token)}`;
}

/** RFC 8058 headers, giving mail clients a native unsubscribe button. */
export function unsubscribeHeaders(token: string, baseUrl = env.appUrl): Record<string, string> {
  return {
    'List-Unsubscribe': `<${oneClickUnsubscribeUrl(token, baseUrl)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

export function unsubscribeFooterHtml(token: string, baseUrl = env.appUrl): string {
  const url = unsubscribePageUrl(token, baseUrl);
  return [
    '<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e5e5;font-size:12px;color:#767676;">',
    `<a href="${url}" style="color:#767676;">Unsubscribe</a> to stop receiving these emails.`,
    '</div>',
  ].join('');
}

export function unsubscribeFooterText(token: string, baseUrl = env.appUrl): string {
  return `\n\n---\nUnsubscribe: ${unsubscribePageUrl(token, baseUrl)}`;
}

export type OptOutResult =
  | { status: 'opted_out'; leadId: string; email: string; cancelledSteps: number }
  | { status: 'already_opted_out'; leadId: string; email: string }
  | { status: 'not_found' };

/**
 * Opts a lead out by token. Idempotent: a second request reports the existing
 * state rather than failing, because mail clients retry one-click requests.
 */
export async function optOutByToken(token: string, now = new Date()): Promise<OptOutResult> {
  const trimmed = token.trim();
  if (!trimmed) return { status: 'not_found' };

  const lead = await prisma.lead.findUnique({ where: { unsubscribeToken: trimmed } });
  if (!lead) return { status: 'not_found' };

  if (lead.status === LeadStatus.OPTED_OUT) {
    return { status: 'already_opted_out', leadId: lead.id, email: lead.email };
  }

  const cancelledSteps = await prisma.sequenceStep.count({
    where: { campaignId: lead.campaignId, stepOrder: { gt: lead.currentStep } },
  });

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status: LeadStatus.OPTED_OUT,
      optedOutAt: now,
      // Clearing the schedule is what stops every remaining step.
      nextSendAt: null,
    },
  });

  return { status: 'opted_out', leadId: lead.id, email: lead.email, cancelledSteps };
}
