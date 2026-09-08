'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createStep, updateStep, deleteStep, moveStep } from '@/app/actions/steps';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { ErrorAlert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

export type StepView = {
  id: string;
  stepOrder: number;
  delayDays: number;
  subject: string;
  body: string;
};

const TAG_HINT = 'Tags: {{firstName}}, {{lastName}}, {{company}}, {{email}} — fallback with {{firstName|there}}';

export function SequenceEditor({
  campaignId,
  steps,
}: {
  campaignId: string;
  steps: StepView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const addFormRef = React.useRef<HTMLFormElement>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? 'Something went wrong.');
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Sequence</CardTitle>
          <CardDescription>
            Steps send in order. Delay is counted from the previous step, so a 0-day first step
            sends as soon as the campaign is active.
          </CardDescription>
        </div>
        <Badge>{steps.length} step{steps.length === 1 ? '' : 's'}</Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        <ErrorAlert message={error} />

        <ol className="space-y-3">
          {steps.map((step, index) => (
            <li key={step.id} className="rounded-md border border-hairline bg-panel-raised/50">
              {editingId === step.id ? (
                <form
                  className="space-y-3 p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const formData = new FormData(event.currentTarget);
                    run(() => updateStep(step.id, formData), () => setEditingId(null));
                  }}
                >
                  <div className="grid gap-3 sm:grid-cols-[7rem_1fr]">
                    <Field label="Delay (days)">
                      <Input name="delayDays" type="number" min={0} max={365} defaultValue={step.delayDays} />
                    </Field>
                    <Field label="Subject">
                      <Input name="subject" defaultValue={step.subject} required maxLength={250} />
                    </Field>
                  </div>
                  <Field label="Body" hint={TAG_HINT}>
                    <Textarea name="body" defaultValue={step.body} required />
                  </Field>
                  <div className="flex gap-2">
                    <Button size="sm" type="submit" disabled={pending}>
                      Save step
                    </Button>
                    <Button size="sm" variant="ghost" type="button" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge tone="accent">Step {step.stepOrder}</Badge>
                      <span className="text-xs text-ink-faint">
                        {step.delayDays === 0
                          ? index === 0
                            ? 'sends immediately'
                            : 'same day as previous'
                          : `waits ${step.delayDays} day${step.delayDays === 1 ? '' : 's'}`}
                      </span>
                    </div>
                    <p className="mt-2 truncate text-sm font-medium text-ink">{step.subject}</p>
                    <p className="mt-1 line-clamp-2 text-xs whitespace-pre-wrap text-ink-muted">
                      {step.body}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Move up"
                      disabled={pending || index === 0}
                      onClick={() => run(() => moveStep(step.id, 'up'))}
                    >
                      ↑
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Move down"
                      disabled={pending || index === steps.length - 1}
                      onClick={() => run(() => moveStep(step.id, 'down'))}
                    >
                      ↓
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(step.id)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => run(() => deleteStep(step.id))}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
          {steps.length === 0 ? (
            <li className="rounded-md border border-dashed border-hairline-strong px-4 py-8 text-center text-sm text-ink-faint">
              No steps yet. The first step below becomes step 1.
            </li>
          ) : null}
        </ol>

        <form
          ref={addFormRef}
          className="space-y-3 rounded-md border border-hairline bg-panel-raised/30 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(() => createStep(campaignId, formData), () => addFormRef.current?.reset());
          }}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            Add step {steps.length + 1}
          </p>
          <div className="grid gap-3 sm:grid-cols-[7rem_1fr]">
            <Field label="Delay (days)">
              <Input name="delayDays" type="number" min={0} max={365} defaultValue={steps.length === 0 ? 0 : 3} />
            </Field>
            <Field label="Subject">
              <Input name="subject" placeholder="Quick question about {{company}}" required maxLength={250} />
            </Field>
          </div>
          <Field label="Body" hint={TAG_HINT}>
            <Textarea name="body" placeholder={'Hi {{firstName|there}},\n\n…'} required />
          </Field>
          <Button size="sm" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Add step'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
