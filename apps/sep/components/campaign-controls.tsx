'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { setCampaignStatus, deleteCampaign } from '@/app/actions/campaigns';
import { CampaignStatus } from '@/lib/generated/prisma';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/alert';

export function CampaignControls({
  campaignId,
  status,
}: {
  campaignId: string;
  status: CampaignStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function change(next: CampaignStatus) {
    setError(null);
    startTransition(async () => {
      const result = await setCampaignStatus(campaignId, next);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteCampaign(campaignId);
      if (!result.ok) setError(result.error);
      else router.push('/campaigns');
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {status !== CampaignStatus.ACTIVE ? (
          <Button size="sm" onClick={() => change(CampaignStatus.ACTIVE)} disabled={pending}>
            {status === CampaignStatus.PAUSED ? 'Resume' : 'Activate'}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => change(CampaignStatus.PAUSED)}
            disabled={pending}
          >
            Pause
          </Button>
        )}
        {status !== CampaignStatus.COMPLETED ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => change(CampaignStatus.COMPLETED)}
            disabled={pending}
          >
            Mark complete
          </Button>
        ) : null}
        <Button size="sm" variant="danger" onClick={remove} disabled={pending}>
          Delete
        </Button>
      </div>
      <ErrorAlert message={error} />
    </div>
  );
}
