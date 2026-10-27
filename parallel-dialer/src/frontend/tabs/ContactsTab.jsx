/**
 * Contacts tab — bring a list in, then work it as a spreadsheet.
 *
 * Import is deliberately two paths (file or paste) because a paste from a
 * spreadsheet is often faster than a save-then-upload round trip when the
 * list came from Sheets or Apollo's own export preview.
 */
import { useMemo, useRef, useState } from 'react';
import { parseContactsCsv, toE164 } from '../lib/csv.js';

const SAMPLE_CSV =
  'company,first_name,last_name,title,email,phone1,phone2,company_url,linkedin,signal,status\n' +
  'Example Company,Test,Contact,Owner,test@example.invalid,+1XXXXXXXXXX,,example.invalid,,Sample note,New';

const COLUMNS = [
  { key: 'company', label: 'Company', width: 168 },
  { key: 'firstName', label: 'First', width: 104 },
  { key: 'lastName', label: 'Last', width: 104 },
  { key: 'title', label: 'Title', width: 132 },
  { key: 'email', label: 'Email', width: 196 },
  { key: 'phone1', label: 'Cell', width: 132, mono: true },
  { key: 'phone2', label: 'Phone 2', width: 132, mono: true },
  { key: 'companyUrl', label: 'Company URL', width: 160 },
  { key: 'linkedin', label: 'LinkedIn', width: 160 },
  { key: 'signal', label: 'Signal', width: 180 },
  { key: 'status', label: 'Status', width: 120 },
  { key: 'lastCall', label: 'Last call', width: 140 },
];

/**
 * @param {object} props
 * @param {object[]} props.contacts all imported contacts, across lists
 * @param {object[]} props.lists list metadata (id, name, count, importedAt)
 * @param {(text: string, name: string) => void} props.onImport
 * @param {Map<string, {disposition: string, at: number}>} props.callHistory phone → last outcome
 */
export default function ContactsTab({ contacts, lists, onImport, callHistory }) {
  const [pasted, setPasted] = useState('');
  const [fileName, setFileName] = useState('');
  const [listFilter, setListFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [phoneColumn, setPhoneColumn] = useState('');
  const [columnWidths, setColumnWidths] = useState(() => COLUMNS.map((column) => column.width));
  const fileRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setPhoneColumn('');
    const reader = new FileReader();
    reader.onload = () => setPasted(String(reader.result ?? ''));
    reader.readAsText(file);
  };

  const preview = useMemo(() => (pasted.trim() ? parseContactsCsv(pasted, { phone1Column: phoneColumn === '' ? undefined : Number(phoneColumn) }) : null), [pasted, phoneColumn]);
  const previewDialable = preview?.contacts.filter((contact) => /^\+[1-9]\d{6,14}$/.test(toE164(contact.phone1))).length ?? 0;

  function startResize(event, index) {
    event.preventDefault();
    const startX = event.clientX;
    const initial = columnWidths[index];
    const move = (pointer) => setColumnWidths((current) => current.map((width, column) => column === index
      ? Math.max(72, initial + pointer.clientX - startX) : width));
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  }

  const doImport = async () => {
    if (!pasted.trim()) return;
    const name = fileName || `Pasted list — ${new Date().toLocaleDateString()}`;
    const saved = await onImport(pasted, name, phoneColumn === '' ? undefined : Number(phoneColumn));
    if (!saved) return;
    setPasted('');
    setFileName('');
    setPhoneColumn('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (listFilter !== 'all' && c.listId !== listFilter) return false;
      if (!q) return true;
      return (
        c.company.toLowerCase().includes(q) ||
        c.firstName.toLowerCase().includes(q) ||
        c.lastName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
      );
    });
  }, [contacts, listFilter, query]);

  return (
    <div className="tab tab--contacts">
      <section className="panel panel--import">
        <div className="import__head">
          <div>
            <p className="panel__title">CSV import</p>
            <h2 className="import__heading">Bring in contacts first</h2>
          </div>
          <span className="pill">
            {contacts.length === 0 ? 'No contacts yet' : `${contacts.length} contact${contacts.length === 1 ? '' : 's'} on file`}
          </span>
        </div>

        <div className="import__body">
          <label className="field field--block">
            CSV file
            <div className="file-row">
              <button type="button" className="btn btn--primary" onClick={() => fileRef.current?.click()}>
                Choose file
              </button>
              <span className="file-row__name">{fileName || 'no file selected'}</span>
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} hidden />
            </div>
          </label>

          <label className="field field--block">
            Or paste CSV
            <textarea
              className="textarea mono"
              rows={5}
              placeholder={SAMPLE_CSV}
              value={pasted}
              onChange={(e) => {
                setPasted(e.target.value);
                setFileName('');
                setPhoneColumn('');
              }}
            />
          </label>

          {preview && <label className="field">Phone column
            <select className="select" value={phoneColumn} onChange={(event) => setPhoneColumn(event.target.value)}>
              <option value="">Auto-detect</option>
              {preview.headers.map((header, index) => <option key={index} value={index}>{header || `Column ${index + 1}`}</option>)}
            </select>
          </label>}
          <p className="import__hint">
            Headers match automatically. Recognized columns: company, first/last name, title, email, cell (phone1),
            phone2, company URL, LinkedIn, signal, status.
            {preview && (
              <>
                {' '}
                <strong>
                  {preview.rowCount} row{preview.rowCount === 1 ? '' : 's'} · {preview.matched.length} column
                  {preview.matched.length === 1 ? '' : 's'} matched
                </strong>
              </>
            )}
          </p>

          {preview && preview.contacts.length > 0 && <div className="sheet import__preview">
            <table className="sheet__table"><thead><tr><th>Company</th><th>Name</th><th>Phone</th><th>Email</th><th>Status</th></tr></thead>
              <tbody>{preview.contacts.slice(0, 5).map((c, index) => <tr key={index}>
                <td>{c.company || '—'}</td><td>{[c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}</td>
                <td className="mono">{c.phone1 || '—'}</td><td>{c.email || '—'}</td><td>{c.status}</td>
              </tr>)}</tbody></table>
          </div>}
          {preview && <p className="import__hint">Previewing {Math.min(5, preview.contacts.length)} of {preview.contacts.length} contacts. Review the phone column before importing.</p>}
          {preview && <p className={previewDialable ? 'import__hint' : 'alert alert--error'} role={previewDialable ? undefined : 'alert'}>
            {previewDialable} dialable numbers detected. {previewDialable === 0 && 'Select the correct phone column above. Import is paused so this does not create another unusable list.'}
          </p>}

          <button type="button" className="btn btn--primary btn--block" onClick={doImport} disabled={!pasted.trim() || !previewDialable}>
            Import contacts
          </button>
        </div>
      </section>

      {contacts.length > 0 && (
        <section className="panel panel--sheet">
          <div className="panel__head">
            <h2 className="panel__title">Contacts</h2>
            <div className="row">
              <select className="select" value={listFilter} onChange={(e) => setListFilter(e.target.value)}>
                <option value="all">All lists</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.count})
                  </option>
                ))}
              </select>
              <input
                className="search"
                type="search"
                placeholder="Search name, company, email…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="sheet">
            <table className="sheet__table sheet__table--contacts" style={{ width: columnWidths.reduce((sum, width) => sum + width, 0) }}>
              <colgroup>{COLUMNS.map((column, index) => <col key={column.key} style={{ width: columnWidths[index] }} />)}</colgroup>
              <thead>
                <tr>
                  {COLUMNS.map((col, index) => (
                    <th key={col.key}>
                      {col.label}<button type="button" className="column-resizer" aria-label={`Resize ${col.label} column`}
                        onPointerDown={(event) => startResize(event, index)}
                        onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                          event.preventDefault(); setColumnWidths((current) => current.map((width, at) => at === index
                            ? Math.max(72, width + (event.key === 'ArrowRight' ? 16 : -16)) : width));
                        } }} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const last = callHistory.get(c.phone1);
                  return (
                    <tr key={c.id}>
                      <td>{c.company || '—'}</td>
                      <td>{c.firstName || '—'}</td>
                      <td>{c.lastName || '—'}</td>
                      <td>{c.title || '—'}</td>
                      <td className="sheet__ellipsis">{c.email || '—'}</td>
                      <td className="mono">{c.phone1 || '—'}</td>
                      <td className="mono">{c.phone2 || '—'}</td>
                      <td className="sheet__ellipsis">{c.companyUrl || '—'}</td>
                      <td className="sheet__ellipsis">{c.linkedin || '—'}</td>
                      <td className="sheet__ellipsis">{c.signal || '—'}</td>
                      <td>
                        <span className="status-pill">{c.status || 'New'}</span>
                      </td>
                      <td>
                        {last ? (
                          <span className={`status-pill status-pill--${last.disposition.toLowerCase()}`}>
                            {last.disposition}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length} className="sheet__empty">
                      No contacts match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
