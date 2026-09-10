/**
 * Small CSV parser and column matcher for the Contacts import.
 *
 * No dependency: the frontend has none today, and a proper RFC 4180 parser is
 * short enough to own — quoted fields, embedded commas, escaped `""`, and
 * both `\n` and `\r\n` line endings are the only things that ever show up in
 * an export from Apollo, Sales Nav, or a spreadsheet "Save as CSV".
 */

/** @returns {string[][]} rows of raw string cells, header included */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    // Skip fully blank trailing lines (a common export artifact).
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushRow();
    } else if (c === '\r') {
      // swallowed; \r\n is handled by the following \n
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) pushRow();

  return rows;
}

/** Canonical contact fields the dialer knows about, and the header spellings
 * that map to each. First match wins, so put the most specific alias first. */
const FIELD_ALIASES = {
  company: ['company', 'company_name', 'account', 'business', 'organization'],
  firstName: ['first_name', 'firstname', 'first'],
  lastName: ['last_name', 'lastname', 'last'],
  title: ['title', 'job_title', 'role', 'position'],
  email: ['email', 'e_mail', 'email_address', 'verified_email'],
  // phone1 is the cell — the number the dialer actually calls.
  phone1: ['phone1', 'phone_1', 'cell', 'cellphone', 'cell_phone', 'mobile', 'mobile_phone', 'phone'],
  phone2: ['phone2', 'phone_2', 'office', 'office_phone', 'work_phone', 'landline', 'direct_dial'],
  companyUrl: ['company_url', 'company_website', 'website', 'domain', 'url'],
  linkedin: ['linkedin', 'linkedin_url', 'li_url', 'personal_linkedin'],
  signal: ['signal', 'intent_signal', 'buying_signal', 'trigger'],
  status: ['status', 'stage', 'lead_status'],
};

/** 'Cell Phone #' → 'cell_phone' */
function normalizeHeader(h) {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** @param {string[]} headers raw header row @returns {Record<string,number>} field → column index */
export function matchColumns(headers) {
  const normalized = headers.map(normalizeHeader);
  const mapping = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      const idx = normalized.indexOf(alias);
      if (idx !== -1) {
        mapping[field] = idx;
        break;
      }
    }
  }
  return mapping;
}

/**
 * Parse a CSV into contact records. Unmatched columns are ignored rather than
 * rejected — a list with extra Apollo columns should still import cleanly.
 * @returns {{ contacts: object[], matched: string[], rowCount: number }}
 */
export function parseContactsCsv(text) {
  const rows = parseCsv(text.trim());
  if (rows.length === 0) return { contacts: [], matched: [], rowCount: 0 };

  const [header, ...body] = rows;
  const mapping = matchColumns(header);
  const cell = (row, field) => (mapping[field] !== undefined ? (row[mapping[field]] ?? '').trim() : '');

  const contacts = body
    .filter((row) => row.some((v) => String(v ?? '').trim() !== ''))
    .map((row) => ({
      company: cell(row, 'company'),
      firstName: cell(row, 'firstName'),
      lastName: cell(row, 'lastName'),
      title: cell(row, 'title'),
      email: cell(row, 'email'),
      phone1: cell(row, 'phone1'),
      phone2: cell(row, 'phone2'),
      companyUrl: cell(row, 'companyUrl'),
      linkedin: cell(row, 'linkedin'),
      signal: cell(row, 'signal'),
      status: cell(row, 'status') || 'New',
    }));

  return { contacts, matched: Object.keys(mapping), rowCount: body.length };
}

/**
 * Best-effort E.164 normalization for US/Canada numbers, which is what a
 * Miami-metro list is. Anything already in +<country><number> form, or that
 * cannot be confidently normalized, passes through unchanged — the dialer's
 * own validation is the final word and rejects what this misses.
 */
export function toE164(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) return trimmed.replace(/[^\d+]/g, '');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return trimmed;
}
