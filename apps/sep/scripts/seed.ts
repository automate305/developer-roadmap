/**
 * Demo seed: one mailbox, one draft campaign with a three-step sequence and a
 * few leads. Safe to re-run.
 *
 *   npx prisma db seed
 */
import { prisma } from '../lib/prisma';
import { CampaignStatus } from '../lib/generated/prisma';

const DEMO_EMAIL = 'demo@automate305.test';
const DEMO_CAMPAIGN = 'Demo - Home services outbound';

async function main() {
  const account = await prisma.sendingAccount.upsert({
    where: { fromEmail: DEMO_EMAIL },
    update: {},
    create: {
      name: 'Demo mailbox',
      fromName: 'Cam at Automate305',
      fromEmail: DEMO_EMAIL,
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpUser: 'demo',
      smtpPassword: 'change-me',
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapUser: 'demo',
      imapPassword: 'change-me',
      maxDaily: 40,
    },
  });

  const existing = await prisma.campaign.findFirst({ where: { name: DEMO_CAMPAIGN } });
  if (existing) {
    console.log(`Seed already present (campaign ${existing.id}).`);
    return;
  }

  const campaign = await prisma.campaign.create({
    data: {
      name: DEMO_CAMPAIGN,
      description: 'Three-touch sequence for HVAC owner-operators.',
      status: CampaignStatus.DRAFT,
      sendingAccountId: account.id,
      steps: {
        create: [
          {
            stepOrder: 1,
            delayDays: 0,
            subject: 'Quick question about {{company}}',
            body: 'Hi {{firstName|there}},\n\nAre after-hours calls still going to voicemail at {{company}}?',
          },
          {
            stepOrder: 2,
            delayDays: 3,
            subject: 'Re: {{company}}',
            body: 'Floating this back up in case it got buried.',
          },
          {
            stepOrder: 3,
            delayDays: 5,
            subject: 'Closing the loop',
            body: 'I will leave it here unless you want the detail.',
          },
        ],
      },
      leads: {
        create: [
          { email: 'dana@demo-hvac.test', firstName: 'Dana', lastName: 'Reyes', company: 'Demo HVAC' },
          { email: 'luis@demo-roofing.test', firstName: 'Luis', lastName: 'Ortega', company: 'Demo Roofing' },
          { email: 'pat@demo-plumbing.test', firstName: 'Pat', lastName: 'Nguyen', company: 'Demo Plumbing' },
        ],
      },
    },
  });

  console.log(`Seeded campaign ${campaign.id} on mailbox ${account.fromEmail}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
