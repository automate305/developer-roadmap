/**
 * Application shell — masthead, tab navigation, and the state shared across
 * tabs (contacts, lists, session history, call outcomes). Reads deployment
 * settings from Vite env vars so the same bundle can point at a local
 * backend or a deployed one.
 *
 * Contacts, Lists and Session History are persisted server-side (see
 * workspaceStore.js) — they used to live only in this browser's localStorage
 * (AGENTS.md still documents why that was a deliberate scope line, and why
 * it no longer holds). The tabs below are unchanged; only where this state
 * comes from moved.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import DialerDevice, { AgentStatus } from './DialerDevice.jsx';
import ContactsTab from './tabs/ContactsTab.jsx';
import ListsTab from './tabs/ListsTab.jsx';
import ReportsTab from './tabs/ReportsTab.jsx';
import { parseContactsCsv, toE164 } from './lib/csv.js';

const TABS = [
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'lists', label: 'Lists' },
  { key: 'reports', label: 'Reports' },
];

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function App() {
  const [activeTab, setActiveTab] = useState('campaigns');

  const [lists, setLists] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [sessionHistory, setSessionHistory] = useState([]);
  const [loadRequest, setLoadRequest] = useState(null);

  // phone (E.164) → { disposition, at }. Not persisted — it is a live-shift
  // view of "who did we just call", not a call log; the durable record of a
  // call is the HubSpot engagement the backend already writes.
  const [callHistory, setCallHistory] = useState(new Map());

  const identity = import.meta.env.VITE_AGENT_IDENTITY ?? 'agent_1';
  const apiBase = import.meta.env.VITE_API_BASE ?? '';
  const apiKey = import.meta.env.VITE_DIALER_API_KEY ?? '';
  const authHeaders = useMemo(() => (apiKey ? { 'x-dialer-key': apiKey } : {}), [apiKey]);

  // Contacts/Lists/Session History all live on the server now; load the
  // snapshot once on mount. A failure here is loud (console only, no retry
  // UI yet) rather than silent — leaving the tabs empty is confusing enough
  // to notice and report, which beats pretending the workspace is empty.
  useEffect(() => {
    let cancelled = false;
    fetch(`${apiBase}/api/workspace/state`, { headers: authHeaders })
      .then((res) => {
        if (!res.ok) throw new Error(`workspace state request failed (${res.status})`);
        return res.json();
      })
      .then((state) => {
        if (cancelled) return;
        setContacts(state.contacts ?? []);
        setLists(state.lists ?? []);
        setSessionHistory(state.sessionHistory ?? []);
      })
      .catch((err) => {
        if (!cancelled) console.error('failed to load workspace state', err);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, authHeaders]);

  const handleImport = useCallback(
    async (csvText, name) => {
      const { contacts: parsed } = parseContactsCsv(csvText);
      const listId = newId();
      const withIds = parsed.map((c) => ({
        ...c,
        id: newId(),
        phone1: toE164(c.phone1),
        phone2: toE164(c.phone2),
        listId,
        listName: name,
      }));
      const dialableCount = withIds.filter((c) => c.phone1).length;
      const list = { id: listId, name, count: withIds.length, dialableCount, importedAt: Date.now() };

      try {
        const response = await fetch(`${apiBase}/api/workspace/lists`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ list, contacts: withIds }),
        });
        if (!response.ok) throw new Error(`import failed (${response.status})`);

        // Only reflected in the UI once the server confirms it persisted —
        // otherwise a failed write would look like a successful import until
        // the next reload silently dropped it.
        setContacts((prev) => [...prev, ...withIds]);
        setLists((prev) => [...prev, list]);
      } catch (err) {
        console.error('failed to import list', err);
      }
    },
    [apiBase, authHeaders],
  );

  const handleDeleteList = useCallback(
    async (listId) => {
      try {
        const response = await fetch(`${apiBase}/api/workspace/lists/${encodeURIComponent(listId)}`, {
          method: 'DELETE',
          headers: authHeaders,
        });
        if (!response.ok && response.status !== 404) throw new Error(`delete failed (${response.status})`);

        setLists((prev) => prev.filter((l) => l.id !== listId));
        setContacts((prev) => prev.filter((c) => c.listId !== listId));
      } catch (err) {
        console.error('failed to delete list', err);
      }
    },
    [apiBase, authHeaders],
  );

  const handleStartCampaign = useCallback(
    (list) => {
      const listContacts = contacts.filter((c) => c.listId === list.id && c.phone1);
      const numbers = listContacts.map((c) => c.phone1).join('\n');
      // The full records ride along too, keyed by phone1 in DialerDevice, so
      // a connected call can screen-pop the company/name instead of just the
      // number — see DialerDevice's `phoneToContact`.
      setLoadRequest({ text: numbers, listName: list.name, contacts: listContacts, token: Date.now() });
      setActiveTab('campaigns');
    },
    [contacts],
  );

  const handleLegEnded = useCallback(({ phone, disposition, at }) => {
    setCallHistory((prev) => {
      const next = new Map(prev);
      next.set(phone, { disposition, at });
      return next;
    });
  }, []);

  const handleSessionEnded = useCallback(
    (summary) => {
      // Reflected immediately — an agent switching to Reports right after a
      // session shouldn't wait on a network round trip to see it. Persisted
      // in the background; a failure here is logged, not surfaced, since
      // Reports is a convenience view and the durable record of what
      // actually happened on each call is the HubSpot engagement.
      setSessionHistory((prev) => [...prev, summary]);
      setActiveTab('reports');

      fetch(`${apiBase}/api/workspace/session-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(summary),
      })
        .then((response) => {
          if (!response.ok) throw new Error(`save failed (${response.status})`);
        })
        .catch((err) => console.error('failed to persist session history', err));
    },
    [apiBase, authHeaders],
  );

  const dialableCount = useMemo(() => contacts.filter((c) => c.phone1).length, [contacts]);

  return (
    <main className="app">
      <div className="shell">
        <header className="dialer__header">
          <div>
            <h1 className="dialer__title">A305 Dialer</h1>
            <p className="dialer__subtitle">Agent workstation · {identity}</p>
          </div>
          <span className="pill pill--muted">{dialableCount} dialable contacts</span>
        </header>

        <nav className="tabs" role="tablist" aria-label="Workstation sections">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              className={`tabs__item ${activeTab === tab.key ? 'tabs__item--active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Campaigns stays mounted across tab switches so a live call and its
            Device registration survive the agent checking Reports mid-shift. */}
        <div className="tab-panel" hidden={activeTab !== 'campaigns'}>
          <DialerDevice
            apiBase={apiBase}
            identity={identity}
            apiKey={apiKey}
            loadRequest={loadRequest}
            contacts={contacts}
            onLegEnded={handleLegEnded}
            onSessionEnded={handleSessionEnded}
          />
        </div>

        {activeTab === 'contacts' && (
          <div className="tab-panel">
            <ContactsTab contacts={contacts} lists={lists} onImport={handleImport} callHistory={callHistory} />
          </div>
        )}

        {activeTab === 'lists' && (
          <div className="tab-panel">
            <ListsTab lists={lists} onStartCampaign={handleStartCampaign} onDelete={handleDeleteList} />
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="tab-panel">
            <ReportsTab sessionHistory={sessionHistory} />
          </div>
        )}
      </div>
    </main>
  );
}

export { AgentStatus };
