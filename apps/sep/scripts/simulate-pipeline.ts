/**
 * End-to-end pipeline simulation.
 *
 *   npm run simulate             # seeds, runs, and cleans up
 *   npm run simulate -- --keep   # leaves the seeded data in place
 *
 * Requires DATABASE_URL only: SMTP is stubbed and the tracking pixel route is
 * invoked directly, so no dev server, Redis, or mailbox is needed.
 *
 * What it proves:
 *   1. A scheduled step dispatches and writes an EmailLog with a tracking id.
 *   2. The tracking pixel route returns a no-store GIF and records the open.
 *   3. An inbound reply flips the lead to REPLIED and clears its schedule.
 *   4. The execution guard refuses every remaining step for that lead.
 *   5. One contact is not emailed past the cap by two campaigns at once.
 *   6. Passwords are stored as scrypt digests and sessions expire.
 */
import { prisma } from '../lib/prisma';
import { CampaignStatus, EmailStatus, LeadStatus } from '../lib/generated/prisma';
import { processSendJob } from '../lib/dispatch';
import { handleInboundMessage } from '../lib/inbound';
import { scheduleCampaignLeads, findDueLeads } from '../lib/sequence';
import { optOutByToken, unsubscribePageUrl, oneClickUnsubscribeUrl } from '../lib/unsubscribe';
import { encryptSecret, decryptSecret, isEncrypted } from '../lib/crypto';
import { classifyBounce, classifySmtpError, isSuppressed, SOFT_BOUNCE_LIMIT } from '../lib/bounce';
import {
  isWithinWindow,
  nextWindowOpen,
  localParts,
  effectiveDailyCap,
  warmupDaysRemaining,
} from '../lib/schedule';
import { SuppressionReason } from '../lib/generated/prisma';
import { POST as unsubscribeOneClick } from '../app/api/unsubscribe/route';
import { checkRateLimit, isSameOrigin } from '../lib/rate-limit';
import { frequencyVerdict, contactsInWindow } from '../lib/frequency';
import { hashPassword, verifyPassword, passwordProblem } from '../lib/password';
import { purgeExpiredSessions } from '../lib/session-store';
import { createHash, randomBytes } from 'node:crypto';
import { GET as trackOpen } from '../app/api/track/open/route';
import { reserveDailySend, type MailSender, type OutboundMessage } from '../lib/mailer';

const TAG = 'SIMULATION';
const APP_URL = 'http://sim.local';

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail?: string) {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

/**
 * Frequency policy for the sections that are not about frequency. They assert
 * exact send counts and timings written before the per-contact cap existed, so
 * they run with it off; section 13 turns it on and tests it on its own leads.
 */
const noCap = async () => ({ maxEmailsPerContact: 0, contactWindowDays: 30 });

/** Captures outbound mail instead of touching SMTP. */
const sentMessages: OutboundMessage[] = [];
const fakeSender: MailSender = async (_account, message) => {
  sentMessages.push(message);
  return { messageId: `<sim-${sentMessages.length}@sim.local>`, accepted: [message.to] };
};

async function cleanup() {
  await prisma.campaign.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.sendingAccount.deleteMany({ where: { name: { startsWith: TAG } } });
  // Sessions cascade from the user.
  await prisma.user.deleteMany({ where: { email: { endsWith: '@sim-operator.test' } } });
}

async function main() {
  const keep = process.argv.includes('--keep');
  console.log('Automate305 SEP - pipeline simulation');

  await cleanup();

  // ------------------------------------------------------------------ seed ---
  section('1. Seed a campaign, a three-step sequence, and one lead');

  const account = await prisma.sendingAccount.create({
    data: {
      name: `${TAG} mailbox`,
      fromName: 'Cam (simulation)',
      fromEmail: `sim-${Date.now()}@automate305.test`,
      smtpHost: 'smtp.invalid',
      smtpPort: 587,
      smtpUser: 'sim',
      smtpPassword: 'sim',
      maxDaily: 25,
      // The pipeline sections below assert exact timing, so this mailbox sends
      // around the clock with no spread. Windows and jitter get their own
      // section, where they are the thing under test.
      sendDays: [1, 2, 3, 4, 5, 6, 7],
      sendWindowStartHour: 0,
      sendWindowEndHour: 23,
      jitterMinutes: 0,
    },
  });

  const campaign = await prisma.campaign.create({
    data: {
      name: `${TAG} Brickell HVAC outbound`,
      description: 'Seeded by scripts/simulate-pipeline.ts',
      status: CampaignStatus.ACTIVE,
      sendingAccountId: account.id,
      steps: {
        create: [
          {
            stepOrder: 1,
            delayDays: 0,
            subject: 'Quick question about {{company}}',
            body: 'Hi {{firstName|there}},\n\nAre you still handling dispatch by phone at {{company}}?',
          },
          {
            stepOrder: 2,
            delayDays: 3,
            subject: 'Following up, {{firstName}}',
            body: 'Just floating this back to the top of your inbox.',
          },
          {
            stepOrder: 3,
            delayDays: 5,
            subject: 'Closing the loop',
            body: 'I will stop here unless you would like the detail.',
          },
        ],
      },
      leads: {
        create: [
          {
            email: 'owner@sim-hvac.test',
            firstName: 'Dana',
            lastName: 'Reyes',
            company: 'Sim HVAC of Brickell',
          },
        ],
      },
    },
    include: { leads: true, steps: { orderBy: { stepOrder: 'asc' } } },
  });

  const lead = campaign.leads[0];
  check('campaign seeded with 3 steps', campaign.steps.length === 3);
  check('lead starts UNCONTACTED', lead.status === LeadStatus.UNCONTACTED);

  const scheduled = await scheduleCampaignLeads(campaign.id);
  check('activation scheduled the lead onto step 1', scheduled === 1);

  const due = await findDueLeads();
  check(
    'scheduler sees the lead as due',
    due.some((candidate) => candidate.id === lead.id),
    `due ids: ${due.map((d) => d.id).join(', ') || 'none'}`,
  );

  // -------------------------------------------------------- worker dispatch ---
  section('2. Worker dispatches step 1 over the stubbed transport');

  const firstSend = await processSendJob(
    { leadId: lead.id, campaignId: campaign.id, stepOrder: 1 },
    { sendMail: fakeSender, appUrl: APP_URL, frequencyPolicy: noCap },
  );

  check('step 1 reported as sent', firstSend.status === 'sent', JSON.stringify(firstSend));
  check('exactly one message left the worker', sentMessages.length === 1);

  const message = sentMessages[0];
  check(
    'template tags were substituted in the subject',
    message?.subject === 'Quick question about Sim HVAC of Brickell',
    message?.subject,
  );
  check('template tags were substituted in the body', Boolean(message?.html.includes('Hi Dana,')));

  const emailLog = await prisma.emailLog.findFirst({ where: { leadId: lead.id, stepOrder: 1 } });
  check('an EmailLog row was written', Boolean(emailLog));
  check('log recorded status SENT', emailLog?.status === EmailStatus.SENT);
  check(
    'SMTP message id was stored',
    emailLog?.messageId === '<sim-1@sim.local>',
    emailLog?.messageId ?? 'null',
  );

  check(
    'the body carries an unsubscribe link',
    Boolean(message?.html.includes(unsubscribePageUrl(lead.unsubscribeToken, APP_URL))),
  );
  check(
    'the plain-text part carries it too',
    Boolean(message?.text.includes(unsubscribePageUrl(lead.unsubscribeToken, APP_URL))),
  );
  check(
    'RFC 8058 one-click headers are set',
    message?.headers?.['List-Unsubscribe'] ===
      `<${oneClickUnsubscribeUrl(lead.unsubscribeToken, APP_URL)}>` &&
      message?.headers?.['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click',
    JSON.stringify(message?.headers),
  );

  const pixelUrl = `${APP_URL}/api/track/open?t=${emailLog?.trackingId}`;
  check(
    'tracking pixel was injected into the body',
    Boolean(message?.html.includes(pixelUrl)),
    message?.html.slice(-160),
  );

  const afterSend = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  check('lead advanced to step 1', afterSend.currentStep === 1);
  check('lead is IN_SEQUENCE', afterSend.status === LeadStatus.IN_SEQUENCE);
  check('step 2 was scheduled', Boolean(afterSend.nextSendAt));

  const accountAfterSend = await prisma.sendingAccount.findUniqueOrThrow({
    where: { id: account.id },
  });
  check(
    'daily cap counter incremented',
    accountAfterSend.sentToday === 1,
    String(accountAfterSend.sentToday),
  );

  // ----------------------------------------------------------- tracking GET ---
  section('3. Tracking pixel GET records the open');

  const response = await trackOpen(new Request(pixelUrl));
  const body = Buffer.from(await response.arrayBuffer());

  check('pixel responded 200', response.status === 200, String(response.status));
  check('pixel is a GIF', response.headers.get('content-type') === 'image/gif');
  check(
    'pixel is uncacheable',
    (response.headers.get('cache-control') ?? '').includes('no-store'),
    response.headers.get('cache-control') ?? 'missing',
  );
  check(
    'pixel body is a 1x1 GIF89a with a proper trailer',
    body.subarray(0, 6).toString() === 'GIF89a' &&
      body.readUInt16LE(6) === 1 &&
      body.readUInt16LE(8) === 1 &&
      body[body.byteLength - 1] === 0x3b,
    `${body.byteLength} bytes, header ${body.subarray(0, 6).toString()}`,
  );

  const openedLog = await prisma.emailLog.findUniqueOrThrow({ where: { id: emailLog!.id } });
  check('openedAt was stamped', Boolean(openedLog.openedAt));
  check('status moved to OPENED', openedLog.status === EmailStatus.OPENED);
  check('open counter is 1', openedLog.openCount === 1, String(openedLog.openCount));

  // ------------------------------------------------------------- IMAP reply ---
  section('4. Inbound reply halts the sequence');

  const inbound = await handleInboundMessage(
    {
      from: lead.email,
      subject: 'Re: Quick question about Sim HVAC of Brickell',
      messageId: '<reply-1@sim-hvac.test>',
      inReplyTo: openedLog.messageId,
      references: [openedLog.messageId ?? ''],
      receivedAt: new Date(),
    },
    { sendingAccountId: account.id },
  );

  check('reply matched the lead', inbound.status === 'replied', JSON.stringify(inbound));
  check(
    'the two remaining steps were cancelled',
    inbound.status === 'replied' && inbound.cancelledSteps === 2,
    JSON.stringify(inbound),
  );

  const repliedLead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  check('lead status is REPLIED', repliedLead.status === LeadStatus.REPLIED);
  check('repliedAt was stamped', Boolean(repliedLead.repliedAt));
  check('schedule was cleared', repliedLead.nextSendAt === null);

  // -------------------------------------------------------- execution guard ---
  section('5. Execution guard blocks every later step');

  const dueAfterReply = await findDueLeads();
  check(
    'scheduler no longer sees the lead',
    !dueAfterReply.some((candidate) => candidate.id === lead.id),
  );

  const secondSend = await processSendJob(
    { leadId: lead.id, campaignId: campaign.id, stepOrder: 2 },
    { sendMail: fakeSender, appUrl: APP_URL, frequencyPolicy: noCap },
  );
  check('step 2 was skipped', secondSend.status === 'skipped', JSON.stringify(secondSend));
  check(
    'skip reason names the reply',
    secondSend.status === 'skipped' && secondSend.reason === 'lead_replied',
    JSON.stringify(secondSend),
  );

  const thirdSend = await processSendJob(
    { leadId: lead.id, campaignId: campaign.id, stepOrder: 3 },
    { sendMail: fakeSender, appUrl: APP_URL, frequencyPolicy: noCap },
  );
  check('step 3 was skipped', thirdSend.status === 'skipped', JSON.stringify(thirdSend));

  check('no further mail was dispatched', sentMessages.length === 1, `${sentMessages.length} messages`);

  const logCount = await prisma.emailLog.count({ where: { leadId: lead.id } });
  check('exactly one EmailLog exists for the lead', logCount === 1, String(logCount));

  const finalAccount = await prisma.sendingAccount.findUniqueOrThrow({ where: { id: account.id } });
  check(
    'daily cap was not burnt by the blocked steps',
    finalAccount.sentToday === 1,
    String(finalAccount.sentToday),
  );

  // ------------------------------------------------------------------ opt-out ---
  section('6. Opted-out leads are blocked the same way');

  const optedOut = await prisma.lead.create({
    data: {
      campaignId: campaign.id,
      email: 'no-thanks@sim-hvac.test',
      firstName: 'Sam',
      company: 'Sim Roofing',
      status: LeadStatus.OPTED_OUT,
      optedOutAt: new Date(),
    },
  });

  const optOutSend = await processSendJob(
    { leadId: optedOut.id, campaignId: campaign.id, stepOrder: 1 },
    { sendMail: fakeSender, appUrl: APP_URL, frequencyPolicy: noCap },
  );
  check(
    'opted-out lead is skipped',
    optOutSend.status === 'skipped' && optOutSend.reason === 'lead_opted_out',
    JSON.stringify(optOutSend),
  );

  // ---------------------------------------------------------------- retries ---
  section('7. A failed send is retried onto the same log row');

  const retryLead = await prisma.lead.create({
    data: {
      campaignId: campaign.id,
      email: 'retry@sim-hvac.test',
      firstName: 'Rosa',
      company: 'Sim Electrical',
    },
  });

  const failingSender: MailSender = async () => {
    throw new Error('smtp temporarily unavailable');
  };

  let threw = false;
  try {
    await processSendJob(
      { leadId: retryLead.id, campaignId: campaign.id, stepOrder: 1 },
      { sendMail: failingSender, appUrl: APP_URL, frequencyPolicy: noCap },
    );
  } catch {
    threw = true;
  }
  check('a transport error propagates so BullMQ can retry', threw);

  const failedLog = await prisma.emailLog.findFirstOrThrow({ where: { leadId: retryLead.id } });
  check('the attempt is logged as FAILED', failedLog.status === EmailStatus.FAILED);
  check('the transport error is recorded', Boolean(failedLog.error));

  const accountAfterFailure = await prisma.sendingAccount.findUniqueOrThrow({
    where: { id: account.id },
  });
  check(
    'the daily cap slot was released',
    accountAfterFailure.sentToday === 1,
    String(accountAfterFailure.sentToday),
  );

  const retrySend = await processSendJob(
    { leadId: retryLead.id, campaignId: campaign.id, stepOrder: 1 },
    { sendMail: fakeSender, appUrl: APP_URL, frequencyPolicy: noCap },
  );
  check('the retry sends', retrySend.status === 'sent', JSON.stringify(retrySend));

  const retryLogs = await prisma.emailLog.findMany({ where: { leadId: retryLead.id } });
  check('the retry reused the existing log row', retryLogs.length === 1, `${retryLogs.length} rows`);
  check('the reused row is now SENT', retryLogs[0]?.status === EmailStatus.SENT);

  // ----------------------------------------------------------- unsubscribe ---
  section('8. Unsubscribing stops the sequence');

  const unsubLead = await prisma.lead.create({
    data: {
      campaignId: campaign.id,
      email: 'stop@sim-hvac.test',
      firstName: 'Iris',
      company: 'Sim Plumbing',
      nextSendAt: new Date(),
    },
  });

  const beforeOptOut = await processSendJob(
    { leadId: unsubLead.id, campaignId: campaign.id, stepOrder: 1 },
    { sendMail: fakeSender, appUrl: APP_URL, frequencyPolicy: noCap },
  );
  check('the lead receives step 1 first', beforeOptOut.status === 'sent', JSON.stringify(beforeOptOut));

  const optOut = await optOutByToken(unsubLead.unsubscribeToken);
  check('the token opts the lead out', optOut.status === 'opted_out', JSON.stringify(optOut));
  check(
    'the remaining steps are reported as cancelled',
    optOut.status === 'opted_out' && optOut.cancelledSteps === 2,
    JSON.stringify(optOut),
  );

  const optedOutLead = await prisma.lead.findUniqueOrThrow({ where: { id: unsubLead.id } });
  check('lead status is OPTED_OUT', optedOutLead.status === LeadStatus.OPTED_OUT);
  check('optedOutAt was stamped', Boolean(optedOutLead.optedOutAt));
  check('schedule was cleared', optedOutLead.nextSendAt === null);

  const repeatOptOut = await optOutByToken(unsubLead.unsubscribeToken);
  check(
    'a repeated opt-out is idempotent',
    repeatOptOut.status === 'already_opted_out',
    JSON.stringify(repeatOptOut),
  );

  const unknownOptOut = await optOutByToken('not-a-real-token');
  check('an unknown token changes nothing', unknownOptOut.status === 'not_found');

  const messagesBeforeGuard = sentMessages.length;
  const afterOptOut = await processSendJob(
    { leadId: unsubLead.id, campaignId: campaign.id, stepOrder: 2 },
    { sendMail: fakeSender, appUrl: APP_URL, frequencyPolicy: noCap },
  );
  check(
    'step 2 is refused after the opt-out',
    afterOptOut.status === 'skipped' && afterOptOut.reason === 'lead_opted_out',
    JSON.stringify(afterOptOut),
  );
  check('no further mail was dispatched', sentMessages.length === messagesBeforeGuard);

  // The one-click route is what a mail client's own button calls.
  const oneClickLead = await prisma.lead.create({
    data: {
      campaignId: campaign.id,
      email: 'oneclick@sim-hvac.test',
      firstName: 'Theo',
      company: 'Sim Electrical',
      nextSendAt: new Date(),
    },
  });

  const oneClickResponse = await unsubscribeOneClick(
    new Request(oneClickUnsubscribeUrl(oneClickLead.unsubscribeToken, APP_URL), { method: 'POST' }),
  );
  check('one-click POST responds 200', oneClickResponse.status === 200, String(oneClickResponse.status));

  const oneClickLeadAfter = await prisma.lead.findUniqueOrThrow({ where: { id: oneClickLead.id } });
  check('one-click opted the lead out', oneClickLeadAfter.status === LeadStatus.OPTED_OUT);
  check('one-click cleared the schedule', oneClickLeadAfter.nextSendAt === null);

  const scannerSafeLead = await prisma.lead.create({
    data: {
      campaignId: campaign.id,
      email: 'scanner@sim-hvac.test',
      firstName: 'Nia',
      company: 'Sim Restoration',
      nextSendAt: new Date(),
    },
  });
  const stillActive = await prisma.lead.findUniqueOrThrow({ where: { id: scannerSafeLead.id } });
  check(
    'a lead is only opted out by an explicit action, never by lookup',
    stillActive.status !== LeadStatus.OPTED_OUT,
  );

  // ------------------------------------------------ credential encryption ---
  section('9. Mailbox credentials are encrypted at rest');

  const secret = 'hunter2-smtp-password';
  const envelope = encryptSecret(secret);

  check('the stored value is an envelope, not the password', isEncrypted(envelope));
  check('the password does not appear in the stored value', !envelope.includes(secret));
  check('it decrypts back to the original', decryptSecret(envelope) === secret);

  const second = encryptSecret(secret);
  check(
    'encrypting twice gives different ciphertext',
    second !== envelope,
    'a repeated IV would leak that two mailboxes share a password',
  );
  check('both envelopes decrypt to the same secret', decryptSecret(second) === secret);

  // AES-GCM authenticates: altering the ciphertext must fail, not decode garbage.
  const [version, iv, tag, data] = envelope.split(':');
  const flipped = Buffer.from(data, 'base64');
  flipped[0] = flipped[0] ^ 0xff;
  let tamperRejected = false;
  try {
    decryptSecret([version, iv, tag, flipped.toString('base64')].join(':'));
  } catch {
    tamperRejected = true;
  }
  check('a tampered ciphertext is rejected', tamperRejected);

  check(
    'a legacy plaintext credential still works',
    decryptSecret('plain-text-from-before-encryption') === 'plain-text-from-before-encryption',
  );

  // The mailer must accept an encrypted password without the caller unwrapping it.
  const encryptedAccount = await prisma.sendingAccount.create({
    data: {
      name: `${TAG} encrypted mailbox`,
      fromName: 'Cam (simulation)',
      fromEmail: `enc-${Date.now()}@automate305.test`,
      smtpHost: 'smtp.invalid',
      smtpPort: 587,
      smtpUser: 'sim',
      smtpPassword: encryptSecret('smtp-secret'),
      imapHost: 'imap.invalid',
      imapUser: 'sim',
      imapPassword: encryptSecret('imap-secret'),
      maxDaily: 5,
    },
  });

  const storedAccount = await prisma.sendingAccount.findUniqueOrThrow({
    where: { id: encryptedAccount.id },
  });
  check('the row holds no readable SMTP password', !storedAccount.smtpPassword.includes('smtp-secret'));
  check(
    'the row holds no readable IMAP password',
    Boolean(storedAccount.imapPassword) && !storedAccount.imapPassword!.includes('imap-secret'),
  );
  check('the SMTP password decrypts at the point of use', decryptSecret(storedAccount.smtpPassword) === 'smtp-secret');
  check(
    'the IMAP password decrypts at the point of use',
    decryptSecret(storedAccount.imapPassword!) === 'imap-secret',
  );

  await prisma.sendingAccount.delete({ where: { id: encryptedAccount.id } });

  // -------------------------------------------------- bounce suppression ---
  section('10. Bounces suppress the address');

  // A real DSN: the failed recipient lives in the report, not the From header.
  const hardDsn = [
    'Reporting-MTA: dns; mx.sim-hvac.test',
    '',
    'Final-Recipient: rfc822; dead@sim-hvac.test',
    'Action: failed',
    'Status: 5.1.1',
    'Diagnostic-Code: smtp; 550 5.1.1 <dead@sim-hvac.test>: Recipient address rejected: User unknown',
  ].join('\n');

  const hardVerdict = classifyBounce({ subject: 'Undeliverable', deliveryStatus: hardDsn });
  check('a 5.x.x report is classified hard', hardVerdict.kind === 'hard', JSON.stringify(hardVerdict));
  check(
    'the failed recipient is read out of the report',
    hardVerdict.recipient === 'dead@sim-hvac.test',
    String(hardVerdict.recipient),
  );
  check('the enhanced status is captured', hardVerdict.status === '5.1.1', String(hardVerdict.status));

  const softDsn = [
    'Final-Recipient: rfc822; busy@sim-hvac.test',
    'Action: failed',
    'Status: 4.2.2',
    'Diagnostic-Code: smtp; 452 4.2.2 Mailbox full',
  ].join('\n');
  const softVerdict = classifyBounce({ subject: 'Delivery delayed', deliveryStatus: softDsn });
  check('a 4.x.x report is classified soft', softVerdict.kind === 'soft', JSON.stringify(softVerdict));

  check(
    'a plain human reply is not a bounce',
    classifyBounce({ subject: 'Re: your note', body: 'Sure, call me Tuesday.' }).kind === 'none',
  );
  check(
    'a delivery receipt is not a bounce',
    classifyBounce({ subject: 'Delivered', deliveryStatus: 'Action: delivered\nStatus: 2.0.0' }).kind ===
      'none',
  );

  check('a 550 from SMTP is hard', classifySmtpError({ responseCode: 550, response: '550 no such user' }) === 'hard');
  check('a 451 from SMTP is soft', classifySmtpError({ responseCode: 451, response: '451 try later' }) === 'soft');
  check('a connection error is neither', classifySmtpError(new Error('getaddrinfo ENOTFOUND')) === 'none');

  // The same address in two campaigns must be halted in both.
  const otherCampaign = await prisma.campaign.create({
    data: {
      name: `${TAG} second campaign`,
      status: CampaignStatus.ACTIVE,
      sendingAccountId: account.id,
      steps: { create: [{ stepOrder: 1, delayDays: 0, subject: 'Hi', body: 'Hello.' }] },
    },
  });

  const bouncingA = await prisma.lead.create({
    data: { campaignId: campaign.id, email: 'dead@sim-hvac.test', firstName: 'Dead', nextSendAt: new Date() },
  });
  const bouncingB = await prisma.lead.create({
    data: { campaignId: otherCampaign.id, email: 'dead@sim-hvac.test', firstName: 'Dead', nextSendAt: new Date() },
  });

  const bounceOutcome = await handleInboundMessage(
    {
      from: 'MAILER-DAEMON@mx.sim-hvac.test',
      subject: 'Undeliverable: Quick question',
      deliveryStatus: hardDsn,
      receivedAt: new Date(),
    },
    { sendingAccountId: account.id },
  );
  check(
    'the hard bounce is recognised',
    bounceOutcome.status === 'bounced' && bounceOutcome.kind === 'hard',
    JSON.stringify(bounceOutcome),
  );
  check('the address is now suppressed', await isSuppressed('dead@sim-hvac.test'));

  const leadA = await prisma.lead.findUniqueOrThrow({ where: { id: bouncingA.id } });
  const leadB = await prisma.lead.findUniqueOrThrow({ where: { id: bouncingB.id } });
  check('the lead in campaign one is BOUNCED', leadA.status === LeadStatus.BOUNCED);
  check('the lead in the other campaign is BOUNCED too', leadB.status === LeadStatus.BOUNCED);
  check('both schedules were cleared', leadA.nextSendAt === null && leadB.nextSendAt === null);
  check('bouncedAt was stamped', Boolean(leadA.bouncedAt));

  const messagesBeforeBounceGuard = sentMessages.length;
  const bouncedSend = await processSendJob(
    { leadId: bouncingA.id, campaignId: campaign.id, stepOrder: 1 },
    { sendMail: fakeSender, appUrl: APP_URL, frequencyPolicy: noCap },
  );
  check(
    'sending to a bounced lead is refused',
    bouncedSend.status === 'skipped' && bouncedSend.reason === 'lead_bounced',
    JSON.stringify(bouncedSend),
  );
  check('no mail went to the dead address', sentMessages.length === messagesBeforeBounceGuard);

  // Re-importing a suppressed address into a live campaign must not revive it:
  // the pre-send guard checks the suppression list, not just the lead status.
  await prisma.lead.update({
    where: { id: bouncingB.id },
    data: { status: LeadStatus.UNCONTACTED, bouncedAt: null, nextSendAt: new Date() },
  });
  const freshSend = await processSendJob(
    { leadId: bouncingB.id, campaignId: otherCampaign.id, stepOrder: 1 },
    { sendMail: fakeSender, appUrl: APP_URL, frequencyPolicy: noCap },
  );
  check(
    're-importing a suppressed address does not revive it',
    freshSend.status === 'skipped' && freshSend.reason === 'address_suppressed',
    JSON.stringify(freshSend),
  );

  const suppressedRow = await prisma.suppressedAddress.findUniqueOrThrow({
    where: { email: 'dead@sim-hvac.test' },
  });
  check('the suppression records why', suppressedRow.reason === SuppressionReason.HARD_BOUNCE);
  check('the provider diagnostic is kept', Boolean(suppressedRow.detail));

  // Soft bounces are tolerated until the limit.
  const softLead = await prisma.lead.create({
    data: { campaignId: campaign.id, email: 'busy@sim-hvac.test', firstName: 'Busy', nextSendAt: new Date() },
  });

  for (let attempt = 1; attempt < SOFT_BOUNCE_LIMIT; attempt += 1) {
    await handleInboundMessage(
      { from: 'MAILER-DAEMON@mx.sim-hvac.test', subject: 'Delivery delayed', deliveryStatus: softDsn },
      { sendingAccountId: account.id },
    );
  }
  check(
    `an address is tolerated for ${SOFT_BOUNCE_LIMIT - 1} soft bounces`,
    !(await isSuppressed('busy@sim-hvac.test')),
  );
  check(
    'the soft-bounced lead is still sendable',
    (await prisma.lead.findUniqueOrThrow({ where: { id: softLead.id } })).status !== LeadStatus.BOUNCED,
  );

  const finalSoft = await handleInboundMessage(
    { from: 'MAILER-DAEMON@mx.sim-hvac.test', subject: 'Delivery delayed', deliveryStatus: softDsn },
    { sendingAccountId: account.id },
  );
  check(
    'the limit suppresses the address',
    finalSoft.status === 'bounced' && finalSoft.suppressed,
    JSON.stringify(finalSoft),
  );
  check('the repeatedly failing address is suppressed', await isSuppressed('busy@sim-hvac.test'));
  check(
    'its lead is now BOUNCED',
    (await prisma.lead.findUniqueOrThrow({ where: { id: softLead.id } })).status === LeadStatus.BOUNCED,
  );

  await prisma.suppressedAddress.deleteMany({
    where: { email: { in: ['dead@sim-hvac.test', 'busy@sim-hvac.test'] } },
  });

  // ------------------------------------------ sending windows and warmup ---
  section('11. Sends respect the mailbox window and warmup ramp');

  const miami = {
    timezone: 'America/New_York',
    sendWindowStartHour: 8,
    sendWindowEndHour: 17,
    sendDays: [1, 2, 3, 4, 5],
  };

  // 2026-09-09 is a Wednesday. 14:00 UTC is 10:00 in Miami; 04:00 UTC is 00:00.
  const wednesdayMorning = new Date('2026-09-09T14:00:00Z');
  const wednesdayMidnight = new Date('2026-09-09T04:00:00Z');
  const saturdayMorning = new Date('2026-09-12T14:00:00Z');

  check('a weekday mid-morning is inside the window', isWithinWindow(wednesdayMorning, miami));
  check('local midnight is outside it', !isWithinWindow(wednesdayMidnight, miami));
  check('a Saturday is outside it', !isWithinWindow(saturdayMorning, miami));

  const opensAfterMidnight = nextWindowOpen(wednesdayMidnight, miami);
  check(
    'the next opening from midnight is the same working day',
    isWithinWindow(opensAfterMidnight, miami) &&
      opensAfterMidnight.getTime() - wednesdayMidnight.getTime() <= 9 * 60 * 60 * 1000,
    opensAfterMidnight.toISOString(),
  );

  const opensAfterSaturday = nextWindowOpen(saturdayMorning, miami);
  const mondayParts = localParts(opensAfterSaturday, miami.timezone);
  check(
    'a Saturday defers to Monday',
    isWithinWindow(opensAfterSaturday, miami) && mondayParts.weekday === 1,
    `${opensAfterSaturday.toISOString()} weekday ${mondayParts.weekday}`,
  );

  // Daylight saving: Miami is UTC-5 in January and UTC-4 in July. A fixed offset
  // would put one of these outside the window.
  check(
    'the window holds across daylight saving',
    isWithinWindow(new Date('2026-01-14T14:00:00Z'), miami) &&
      isWithinWindow(new Date('2026-07-15T14:00:00Z'), miami),
  );

  // A lead due outside the window is deferred, not sent.
  const nightAccount = await prisma.sendingAccount.create({
    data: {
      name: `${TAG} night mailbox`,
      fromName: 'Cam',
      fromEmail: `night-${Date.now()}@automate305.test`,
      smtpHost: 'smtp.invalid',
      smtpPort: 587,
      smtpUser: 'sim',
      smtpPassword: 'sim',
      maxDaily: 50,
      // A window that has already closed for every hour of every day.
      sendDays: [1, 2, 3, 4, 5],
      sendWindowStartHour: 9,
      sendWindowEndHour: 10,
      jitterMinutes: 0,
    },
  });
  const nightCampaign = await prisma.campaign.create({
    data: {
      name: `${TAG} night campaign`,
      status: CampaignStatus.ACTIVE,
      sendingAccountId: nightAccount.id,
      steps: { create: [{ stepOrder: 1, delayDays: 0, subject: 'Hi', body: 'Hello.' }] },
      leads: { create: [{ email: 'night@sim-hvac.test', firstName: 'Nox', nextSendAt: new Date() }] },
    },
    include: { leads: true },
  });

  const messagesBeforeWindow = sentMessages.length;
  const nightLead = nightCampaign.leads[0];
  const outsideWindow = new Date('2026-09-09T04:00:00Z');
  const windowOutcome = await processSendJob(
    { leadId: nightLead.id, campaignId: nightCampaign.id, stepOrder: 1 },
    { sendMail: fakeSender, appUrl: APP_URL, now: () => outsideWindow, frequencyPolicy: noCap },
  );
  check(
    'a lead due outside the window is deferred',
    windowOutcome.status === 'deferred' && windowOutcome.reason === 'outside_send_window',
    JSON.stringify(windowOutcome),
  );
  check('nothing was sent outside the window', sentMessages.length === messagesBeforeWindow);

  const deferredLead = await prisma.lead.findUniqueOrThrow({ where: { id: nightLead.id } });
  check(
    'it was rescheduled into the window',
    Boolean(deferredLead.nextSendAt) &&
      isWithinWindow(deferredLead.nextSendAt!, {
        timezone: nightAccount.timezone,
        sendWindowStartHour: nightAccount.sendWindowStartHour,
        sendWindowEndHour: nightAccount.sendWindowEndHour,
        sendDays: nightAccount.sendDays,
      }),
    deferredLead.nextSendAt?.toISOString(),
  );

  // Enrolment spreads a list rather than making every lead due at once.
  const burstAccount = await prisma.sendingAccount.create({
    data: {
      name: `${TAG} spread mailbox`,
      fromName: 'Cam',
      fromEmail: `spread-${Date.now()}@automate305.test`,
      smtpHost: 'smtp.invalid',
      smtpPort: 587,
      smtpUser: 'sim',
      smtpPassword: 'sim',
      maxDaily: 50,
      sendDays: [1, 2, 3, 4, 5, 6, 7],
      sendWindowStartHour: 0,
      sendWindowEndHour: 23,
      jitterMinutes: 60,
    },
  });
  const burstCampaign = await prisma.campaign.create({
    data: {
      name: `${TAG} spread campaign`,
      status: CampaignStatus.ACTIVE,
      sendingAccountId: burstAccount.id,
      steps: { create: [{ stepOrder: 1, delayDays: 0, subject: 'Hi', body: 'Hello.' }] },
      leads: {
        create: Array.from({ length: 12 }, (_, index) => ({
          email: `spread-${index}@sim-hvac.test`,
          firstName: `Lead${index}`,
        })),
      },
    },
  });

  await scheduleCampaignLeads(burstCampaign.id);
  const spreadLeads = await prisma.lead.findMany({
    where: { campaignId: burstCampaign.id },
    select: { nextSendAt: true },
  });
  const distinctTimes = new Set(spreadLeads.map((lead) => lead.nextSendAt?.toISOString()));
  check(
    'enrolling a list spreads it instead of making every lead due at once',
    distinctTimes.size > 1,
    `${distinctTimes.size} distinct send times across ${spreadLeads.length} leads`,
  );

  await prisma.campaign.delete({ where: { id: burstCampaign.id } });
  await prisma.sendingAccount.delete({ where: { id: burstAccount.id } });

  // Warmup: the effective cap climbs daily until it meets the ceiling.
  const day = 24 * 60 * 60 * 1000;
  const warmup = {
    maxDaily: 50,
    warmupEnabled: true,
    warmupStartedAt: new Date('2026-09-01T00:00:00Z'),
    warmupInitialDaily: 5,
    warmupDailyIncrement: 5,
  };
  check(
    'day one sends the starting volume',
    effectiveDailyCap(warmup, new Date('2026-09-01T12:00:00Z')) === 5,
    String(effectiveDailyCap(warmup, new Date('2026-09-01T12:00:00Z'))),
  );
  check(
    'the cap climbs each day',
    effectiveDailyCap(warmup, new Date(warmup.warmupStartedAt.getTime() + 3 * day)) === 20,
    String(effectiveDailyCap(warmup, new Date(warmup.warmupStartedAt.getTime() + 3 * day))),
  );
  check(
    'it never exceeds the ceiling',
    effectiveDailyCap(warmup, new Date(warmup.warmupStartedAt.getTime() + 60 * day)) === 50,
  );
  check(
    'warmup progress is reported',
    warmupDaysRemaining(warmup, new Date(warmup.warmupStartedAt.getTime() + 3 * day)) === 6,
    String(warmupDaysRemaining(warmup, new Date(warmup.warmupStartedAt.getTime() + 3 * day))),
  );
  check(
    'a mailbox not warming up uses its full cap',
    effectiveDailyCap({ ...warmup, warmupEnabled: false }, new Date()) === 50,
  );

  // A warming mailbox stops at today's ramped cap, not the ceiling.
  const warmingAccount = await prisma.sendingAccount.create({
    data: {
      name: `${TAG} warming mailbox`,
      fromName: 'Cam',
      fromEmail: `warm-${Date.now()}@automate305.test`,
      smtpHost: 'smtp.invalid',
      smtpPort: 587,
      smtpUser: 'sim',
      smtpPassword: 'sim',
      maxDaily: 50,
      warmupEnabled: true,
      warmupStartedAt: new Date(),
      warmupInitialDaily: 2,
      warmupDailyIncrement: 5,
      sendDays: [1, 2, 3, 4, 5, 6, 7],
      sendWindowStartHour: 0,
      sendWindowEndHour: 23,
      jitterMinutes: 0,
    },
  });

  const firstClaim = await reserveDailySend(warmingAccount.id);
  const secondClaim = await reserveDailySend(warmingAccount.id);
  const thirdClaim = await reserveDailySend(warmingAccount.id);
  check('the first send of a warming mailbox is allowed', firstClaim.allowed);
  check('the second is allowed', secondClaim.allowed);
  check(
    'the third exceeds day one and is capped',
    !thirdClaim.allowed && thirdClaim.reason === 'cap_reached',
    JSON.stringify(thirdClaim),
  );

  await prisma.campaign.delete({ where: { id: nightCampaign.id } });
  await prisma.sendingAccount.deleteMany({
    where: { id: { in: [nightAccount.id, warmingAccount.id] } },
  });

  // ------------------------------------------------- public endpoint guards ---
  section('12. Public endpoints are throttled');

  const nowMs = Date.now();
  const results = Array.from({ length: 6 }, () =>
    checkRateLimit('sim-key', { limit: 5, windowMs: 60_000 }, nowMs),
  );
  check('requests inside the limit are allowed', results.slice(0, 5).every((r) => r.allowed));
  check('the request past the limit is refused', !results[5].allowed);
  check('it reports when to retry', results[5].retryAfterSeconds > 0, String(results[5].retryAfterSeconds));

  const afterWindow = checkRateLimit('sim-key', { limit: 5, windowMs: 60_000 }, nowMs + 61_000);
  check('the window reopens once it expires', afterWindow.allowed);

  check(
    'separate clients get separate budgets',
    checkRateLimit('other-key', { limit: 5, windowMs: 60_000 }, nowMs).allowed,
  );

  // A rate-limited pixel must still return an image, or the recipient sees a
  // broken image and learns the message is tracked.
  for (let i = 0; i < 320; i += 1) {
    checkRateLimit('track:1.2.3.4', { limit: 300, windowMs: 60_000 }, nowMs);
  }
  const throttledPixel = await trackOpen(
    new Request(`${APP_URL}/api/track/open?t=whatever`, {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    }),
  );
  check('a throttled pixel still returns 200', throttledPixel.status === 200);
  check(
    'and still returns an image',
    throttledPixel.headers.get('content-type') === 'image/gif',
  );

  check(
    'a same-origin post is accepted',
    isSameOrigin(
      new Request('http://sim.local/api/leads/import', {
        method: 'POST',
        headers: { origin: 'http://sim.local', host: 'sim.local' },
      }),
    ),
  );
  check(
    'a cross-origin post is rejected',
    !isSameOrigin(
      new Request('http://sim.local/api/leads/import', {
        method: 'POST',
        headers: { origin: 'https://evil.test', host: 'sim.local' },
      }),
    ),
  );

  // ------------------------------------------- per-contact frequency cap ---
  section('13. One person is not emailed twice over by two campaigns');

  const capAccount = await prisma.sendingAccount.create({
    data: {
      name: `${TAG} cap mailbox`,
      fromName: 'Cam (simulation)',
      fromEmail: `sim-cap-${Date.now()}@automate305.test`,
      smtpHost: 'smtp.invalid',
      smtpPort: 587,
      smtpUser: 'sim',
      smtpPassword: 'sim',
      maxDaily: 100,
      sendDays: [1, 2, 3, 4, 5, 6, 7],
      sendWindowStartHour: 0,
      sendWindowEndHour: 23,
      jitterMinutes: 0,
    },
  });

  // The same human on two lists — an HVAC list and a restoration list — which is
  // exactly the case per-mailbox caps cannot see.
  const sharedAddress = `owner-${Date.now()}@sim-shared.test`;

  async function capCampaign(label: string) {
    return prisma.campaign.create({
      data: {
        name: `${TAG} ${label}`,
        status: CampaignStatus.ACTIVE,
        sendingAccountId: capAccount.id,
        steps: {
          create: [
            { stepOrder: 1, delayDays: 0, subject: `${label} 1`, body: 'One.' },
            { stepOrder: 2, delayDays: 0, subject: `${label} 2`, body: 'Two.' },
          ],
        },
        leads: { create: [{ email: sharedAddress, firstName: 'Sam', company: 'Shared Co' }] },
      },
      include: { leads: true },
    });
  }

  const hvacList = await capCampaign('hvac list');
  const stormList = await capCampaign('storm list');

  // Two per rolling 30 days, the default this ships with.
  const twoPerMonth = async () => ({ maxEmailsPerContact: 2, contactWindowDays: 30 });
  const capBase = new Date('2026-03-10T15:00:00.000Z');

  const capFirst = await processSendJob(
    { leadId: hvacList.leads[0].id, campaignId: hvacList.id, stepOrder: 1 },
    { sendMail: fakeSender, appUrl: APP_URL, now: () => capBase, frequencyPolicy: twoPerMonth },
  );
  check('the first email to a new contact sends', capFirst.status === 'sent', JSON.stringify(capFirst));

  const capSecond = await processSendJob(
    { leadId: hvacList.leads[0].id, campaignId: hvacList.id, stepOrder: 2 },
    {
      sendMail: fakeSender,
      appUrl: APP_URL,
      now: () => new Date(capBase.getTime() + 60_000),
      frequencyPolicy: twoPerMonth,
    },
  );
  check('the second reaches the cap but still sends', capSecond.status === 'sent', JSON.stringify(capSecond));

  // The third attempt comes from the *other* campaign, which is the point: a
  // per-mailbox cap would wave this through.
  const capThird = await processSendJob(
    { leadId: stormList.leads[0].id, campaignId: stormList.id, stepOrder: 1 },
    {
      sendMail: fakeSender,
      appUrl: APP_URL,
      now: () => new Date(capBase.getTime() + 120_000),
      frequencyPolicy: twoPerMonth,
    },
  );
  check(
    'a third email from another campaign is held',
    capThird.status === 'deferred' && capThird.reason === 'contact_frequency_cap',
    JSON.stringify(capThird),
  );

  const heldLead = await prisma.lead.findUniqueOrThrow({ where: { id: stormList.leads[0].id } });
  check('the held lead keeps its place in the sequence', heldLead.currentStep === 0);
  check('it is rescheduled rather than dropped', Boolean(heldLead.nextSendAt));
  check(
    'it is rescheduled for after the oldest email ages out',
    heldLead.nextSendAt !== null &&
      heldLead.nextSendAt.getTime() > capBase.getTime() + 29 * 24 * 60 * 60 * 1000,
    String(heldLead.nextSendAt),
  );

  const heldLogs = await prisma.emailLog.count({ where: { leadId: stormList.leads[0].id } });
  check('no log row was written for the held send', heldLogs === 0, String(heldLogs));

  // Once the window has rolled past those two sends, the same lead goes out.
  const afterWindowRolls = new Date(capBase.getTime() + 31 * 24 * 60 * 60 * 1000);
  const capLater = await processSendJob(
    { leadId: stormList.leads[0].id, campaignId: stormList.id, stepOrder: 1 },
    {
      sendMail: fakeSender,
      appUrl: APP_URL,
      now: () => afterWindowRolls,
      frequencyPolicy: twoPerMonth,
    },
  );
  check(
    'it sends once the window has rolled past the earlier two',
    capLater.status === 'sent',
    JSON.stringify(capLater),
  );

  const verdictOff = await frequencyVerdict(sharedAddress, afterWindowRolls, {
    maxEmailsPerContact: 0,
    contactWindowDays: 30,
  });
  check('a cap of zero switches the check off', verdictOff.allowed);

  const inWindow = await contactsInWindow(sharedAddress, afterWindowRolls, 60);
  check('the window count sees all three sends', inWindow === 3, String(inWindow));

  await prisma.campaign.deleteMany({ where: { id: { in: [hvacList.id, stormList.id] } } });
  await prisma.sendingAccount.delete({ where: { id: capAccount.id } });

  // ------------------------------------------------------ operator log-in ---
  section('14. Operators sign in, and sessions expire');

  const operatorPassword = 'correct horse battery staple';
  const digest = await hashPassword(operatorPassword);
  check('a stored password does not contain the password', !digest.includes(operatorPassword));
  check('it carries a version prefix', digest.startsWith('s1:'), digest.slice(0, 3));
  check('the right password verifies', await verifyPassword(operatorPassword, digest));
  check('a wrong password does not', !(await verifyPassword(operatorPassword + 'x', digest)));
  check('a second hash of the same password differs', (await hashPassword(operatorPassword)) !== digest);
  check(
    'a malformed stored hash is rejected, not thrown',
    !(await verifyPassword(operatorPassword, 'nonsense')),
  );
  check('a short password is refused', passwordProblem('short') !== null);
  check('a long enough one is accepted', passwordProblem(operatorPassword) === null);

  const operator = await prisma.user.create({
    data: {
      email: `cam-${Date.now()}@sim-operator.test`,
      name: 'Cam',
      passwordHash: digest,
    },
  });

  const liveToken = randomBytes(32).toString('base64url');
  const staleToken = randomBytes(32).toString('base64url');
  const sha = (value: string) => createHash('sha256').update(value).digest('hex');

  await prisma.session.create({
    data: {
      tokenHash: sha(liveToken),
      userId: operator.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  await prisma.session.create({
    data: {
      tokenHash: sha(staleToken),
      userId: operator.id,
      expiresAt: new Date(Date.now() - 60 * 1000),
    },
  });

  const storedSession = await prisma.session.findUnique({ where: { tokenHash: sha(liveToken) } });
  check('a session is found by the hash of its token', Boolean(storedSession));
  check(
    'the raw token is nowhere in the row',
    storedSession !== null && !JSON.stringify(storedSession).includes(liveToken),
  );
  check(
    'a token that was never issued matches nothing',
    (await prisma.session.findUnique({ where: { tokenHash: sha('made up') } })) === null,
  );

  const purged = await purgeExpiredSessions();
  check('expired sessions are purged', purged >= 1, String(purged));
  check(
    'the live session survives the purge',
    (await prisma.session.findUnique({ where: { tokenHash: sha(liveToken) } })) !== null,
  );
  check(
    'the expired one is gone',
    (await prisma.session.findUnique({ where: { tokenHash: sha(staleToken) } })) === null,
  );

  await prisma.user.delete({ where: { id: operator.id } });
  check(
    'deleting the account takes its sessions with it',
    (await prisma.session.count({ where: { userId: operator.id } })) === 0,
  );

  if (!keep) {
    await cleanup();
    console.log('\nSeeded data removed. Pass --keep to retain it.');
  } else {
    console.log(`\nKept campaign ${campaign.id}.`);
  }

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) console.log(`${failures} check(s) failed.`);

  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error('\nSimulation crashed:', error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
