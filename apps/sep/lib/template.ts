/**
 * Variable substitution for sequence subjects and bodies.
 *
 * Supported tags: {{firstName}}, {{lastName}}, {{company}}, {{email}} plus any
 * extra column captured during CSV import. A fallback may be supplied with a
 * pipe, e.g. {{firstName|there}}, which is used when the value is missing.
 */

export type TemplateVars = Record<string, string | null | undefined>;

const TAG_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*(?:\|([^}]*))?\}\}/g;

export function leadVariables(lead: {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  customFields?: unknown;
}): TemplateVars {
  const custom: TemplateVars = {};
  if (lead.customFields && typeof lead.customFields === 'object' && !Array.isArray(lead.customFields)) {
    for (const [key, value] of Object.entries(lead.customFields as Record<string, unknown>)) {
      if (value === null || value === undefined) continue;
      custom[key] = String(value);
    }
  }

  return {
    ...custom,
    email: lead.email,
    firstName: lead.firstName ?? '',
    lastName: lead.lastName ?? '',
    company: lead.company ?? '',
    fullName: [lead.firstName, lead.lastName].filter(Boolean).join(' '),
  };
}

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(TAG_PATTERN, (_match, rawKey: string, fallback?: string) => {
    const key = rawKey.trim();
    const direct = vars[key];
    if (direct !== undefined && direct !== null && direct !== '') return direct;

    // Case-insensitive second pass so {{FirstName}} and {{firstname}} both work.
    const lower = key.toLowerCase();
    for (const [candidate, value] of Object.entries(vars)) {
      if (candidate.toLowerCase() === lower && value) return value;
    }

    return (fallback ?? '').trim();
  });
}

/** Lists the tags used by a template, for previewing which columns a step needs. */
export function extractTags(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(TAG_PATTERN)) {
    found.add(match[1].trim());
  }
  return [...found];
}
