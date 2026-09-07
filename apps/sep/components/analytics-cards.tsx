import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { PipelineStats } from '@/lib/analytics';

type Metric = {
  label: string;
  value: string;
  hint: string;
  tone?: 'default' | 'accent' | 'positive';
};

function buildMetrics(stats: PipelineStats): Metric[] {
  return [
    {
      label: 'Total leads',
      value: stats.totalLeads.toLocaleString(),
      hint: 'Across every imported list',
    },
    {
      label: 'Active leads',
      value: stats.activeLeads.toLocaleString(),
      hint: 'Currently moving through a sequence',
      tone: 'accent',
    },
    {
      label: 'Total sent',
      value: stats.totalSent.toLocaleString(),
      hint: stats.bounced ? `${stats.bounced.toLocaleString()} bounced` : 'Delivered sequence emails',
    },
    {
      label: 'Open rate',
      value: `${stats.openRate.toFixed(1)}%`,
      hint: `${stats.totalOpened.toLocaleString()} of ${stats.totalSent.toLocaleString()} opened`,
    },
    {
      label: 'Reply rate',
      value: `${stats.replyRate.toFixed(1)}%`,
      hint: `${stats.totalReplied.toLocaleString()} replied, sequences halted`,
      tone: 'positive',
    },
  ];
}

export function AnalyticsCards({ stats, className }: { stats: PipelineStats; className?: string }) {
  const metrics = buildMetrics(stats);

  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-5', className)}>
      {metrics.map((metric) => (
        <Card key={metric.label} className="px-4 py-3.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            {metric.label}
          </p>
          <p
            className={cn(
              'tabular mt-2 text-2xl font-semibold tracking-tight',
              metric.tone === 'accent' && 'text-accent',
              metric.tone === 'positive' && 'text-positive',
            )}
          >
            {metric.value}
          </p>
          <p className="mt-1 text-xs text-ink-faint">{metric.hint}</p>
        </Card>
      ))}
    </div>
  );
}
