import { Badge } from '@/components/ui/badge';
import { CampaignStatus, LeadStatus, EmailStatus } from '@/lib/generated/prisma';

const CAMPAIGN_TONE: Record<CampaignStatus, 'neutral' | 'accent' | 'warning' | 'positive'> = {
  DRAFT: 'neutral',
  ACTIVE: 'accent',
  PAUSED: 'warning',
  COMPLETED: 'positive',
};

const LEAD_TONE: Record<LeadStatus, 'neutral' | 'accent' | 'positive' | 'danger'> = {
  UNCONTACTED: 'neutral',
  IN_SEQUENCE: 'accent',
  REPLIED: 'positive',
  OPTED_OUT: 'danger',
};

const EMAIL_TONE: Record<EmailStatus, 'neutral' | 'accent' | 'warning' | 'danger'> = {
  SENT: 'neutral',
  OPENED: 'accent',
  BOUNCED: 'warning',
  FAILED: 'danger',
};

export function label(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return <Badge tone={CAMPAIGN_TONE[status]}>{label(status)}</Badge>;
}

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return <Badge tone={LEAD_TONE[status]}>{label(status)}</Badge>;
}

export function EmailStatusBadge({ status }: { status: EmailStatus }) {
  return <Badge tone={EMAIL_TONE[status]}>{label(status)}</Badge>;
}
