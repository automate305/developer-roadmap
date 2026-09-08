'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, Label } from '@/components/ui/input';
import { ErrorAlert, SuccessAlert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type TargetField = 'email' | 'firstName' | 'lastName' | 'company';

const TARGETS: { key: TargetField; label: string; required: boolean; aliases: string[] }[] = [
  {
    key: 'email',
    label: 'Email',
    required: true,
    aliases: ['email', 'e-mail', 'emailaddress', 'email address', 'mail', 'workemail', 'work email'],
  },
  {
    key: 'firstName',
    label: 'First name',
    required: false,
    aliases: ['firstname', 'first name', 'first', 'fname', 'givenname', 'given name', 'contact first name'],
  },
  {
    key: 'lastName',
    label: 'Last name',
    required: false,
    aliases: ['lastname', 'last name', 'last', 'lname', 'surname', 'familyname', 'contact last name'],
  },
  {
    key: 'company',
    label: 'Company',
    required: false,
    aliases: ['company', 'companyname', 'company name', 'organization', 'organisation', 'account', 'business', 'employer'],
  },
];

const UNMAPPED = '__none__';

function normalize(header: string): string {
  return header.toLowerCase().replace(/[\s_\-.]/g, '');
}

/**
 * Best-effort header matching: exact normalized alias first, then a containment
 * pass so "Primary Email Address" still lands on Email.
 */
export function autoMatchColumns(headers: string[]): Record<TargetField, string> {
  const mapping: Record<TargetField, string> = {
    email: UNMAPPED,
    firstName: UNMAPPED,
    lastName: UNMAPPED,
    company: UNMAPPED,
  };
  const taken = new Set<string>();

  for (const target of TARGETS) {
    const aliases = target.aliases.map(normalize);

    const exact = headers.find(
      (header) => !taken.has(header) && aliases.includes(normalize(header)),
    );
    if (exact) {
      mapping[target.key] = exact;
      taken.add(exact);
      continue;
    }

    const partial = headers.find(
      (header) =>
        !taken.has(header) && aliases.some((alias) => normalize(header).includes(alias)),
    );
    if (partial) {
      mapping[target.key] = partial;
      taken.add(partial);
    }
  }

  return mapping;
}

type ParsedFile = {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
};

type ImportSummary = {
  imported: number;
  updated: number;
  skipped: number;
  duplicates: number;
  scheduled: number;
  errors: string[];
};

export function CsvImporter({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = React.useState<ParsedFile | null>(null);
  const [mapping, setMapping] = React.useState<Record<TargetField, string>>({
    email: UNMAPPED,
    firstName: UNMAPPED,
    lastName: UNMAPPED,
    company: UNMAPPED,
  });
  const [dragging, setDragging] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [summary, setSummary] = React.useState<ImportSummary | null>(null);

  function reset() {
    setParsed(null);
    setSummary(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  function handleFile(file: File) {
    setError(null);
    setSummary(null);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.trim(),
      complete: (result) => {
        const headers = (result.meta.fields ?? []).filter(Boolean);
        if (headers.length === 0) {
          setError('That file has no header row, so columns cannot be mapped.');
          return;
        }
        const rows = result.data.filter((row) =>
          Object.values(row).some((value) => (value ?? '').trim() !== ''),
        );
        if (rows.length === 0) {
          setError('That file has headers but no data rows.');
          return;
        }
        setParsed({ fileName: file.name, headers, rows });
        setMapping(autoMatchColumns(headers));
      },
      error: (parseError) => setError(`Could not read the file: ${parseError.message}`),
    });
  }

  async function submit() {
    if (!parsed) return;
    if (mapping.email === UNMAPPED) {
      setError('Map a column to Email before importing.');
      return;
    }

    setBusy(true);
    setError(null);
    setSummary(null);

    // Columns not bound to a known field ride along as customFields so they stay
    // available to template tags.
    const mapped = new Set(Object.values(mapping).filter((value) => value !== UNMAPPED));
    const extraHeaders = parsed.headers.filter((header) => !mapped.has(header));

    const rows = parsed.rows.map((row) => {
      const customFields: Record<string, string> = {};
      for (const header of extraHeaders) {
        const value = (row[header] ?? '').trim();
        if (value) customFields[header] = value;
      }
      return {
        email: (row[mapping.email] ?? '').trim(),
        firstName: mapping.firstName === UNMAPPED ? null : (row[mapping.firstName] ?? '').trim(),
        lastName: mapping.lastName === UNMAPPED ? null : (row[mapping.lastName] ?? '').trim(),
        company: mapping.company === UNMAPPED ? null : (row[mapping.company] ?? '').trim(),
        customFields: Object.keys(customFields).length ? customFields : null,
      };
    });

    try {
      const response = await fetch('/api/leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, rows }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? 'Import failed.');
      }
      setSummary(data as ImportSummary);
      setParsed(null);
      if (inputRef.current) inputRef.current.value = '';
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  const preview = parsed?.rows.slice(0, 5) ?? [];

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Import leads</CardTitle>
          <CardDescription>
            CSV is parsed in your browser. Columns are matched automatically; adjust anything that
            looks wrong before importing.
          </CardDescription>
        </div>
        {parsed ? (
          <Button variant="ghost" size="sm" onClick={reset} type="button">
            Clear
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        <ErrorAlert message={error} />

        {summary ? (
          <SuccessAlert
            message={`${summary.imported} added, ${summary.updated} updated, ${summary.duplicates} duplicate rows collapsed, ${summary.skipped} skipped${
              summary.scheduled ? `, ${summary.scheduled} scheduled onto step 1` : ''
            }.`}
          />
        ) : null}

        {!parsed ? (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files?.[0];
              if (file) handleFile(file);
            }}
            className={cn(
              'flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-6 py-10 text-center transition-colors',
              dragging ? 'border-accent bg-accent/5' : 'border-hairline-strong bg-panel-raised/40',
            )}
          >
            <p className="text-sm text-ink">Drop a CSV here</p>
            <p className="text-xs text-ink-faint">or</p>
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              Choose file
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-ink-muted">
              <Badge tone="accent">{parsed.fileName}</Badge>
              <span className="tabular">{parsed.rows.length.toLocaleString()} rows</span>
              <span className="text-ink-faint">·</span>
              <span className="tabular">{parsed.headers.length} columns</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {TARGETS.map((target) => (
                <div key={target.key}>
                  <Label>
                    {target.label}
                    {target.required ? <span className="ml-1 text-danger">*</span> : null}
                  </Label>
                  <Select
                    value={mapping[target.key]}
                    onChange={(event) =>
                      setMapping((current) => ({ ...current, [target.key]: event.target.value }))
                    }
                  >
                    <option value={UNMAPPED}>Not mapped</option>
                    {parsed.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto rounded-md border border-hairline">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {TARGETS.map((target) => (
                      <th
                        key={target.key}
                        className="border-b border-hairline px-3 py-2 text-left font-medium uppercase tracking-wide text-ink-faint"
                      >
                        {target.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, index) => (
                    <tr key={index}>
                      {TARGETS.map((target) => (
                        <td key={target.key} className="border-b border-hairline/60 px-3 py-2 text-ink-muted">
                          {mapping[target.key] === UNMAPPED
                            ? '—'
                            : (row[mapping[target.key]] ?? '').trim() || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-3">
              <Button type="button" onClick={submit} disabled={busy}>
                {busy ? 'Importing…' : `Import ${parsed.rows.length.toLocaleString()} leads`}
              </Button>
              <p className="text-xs text-ink-faint">
                Unmapped columns are stored as custom fields and stay usable as template tags.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
