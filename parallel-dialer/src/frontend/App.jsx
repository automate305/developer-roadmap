/**
 * Application shell — masthead, tab navigation, and the state shared across
 * tabs (contacts, lists, session history, call outcomes). Reads deployment
 * settings from Vite env vars so the same bundle can point at a local
 * backend or a deployed one.
 *
 * Contacts, lists and reports live in this browser's localStorage today —
 * there is no backend concept of any of them yet (see AGENTS.md). That is a
 * deliberate scope line, not an oversight: the dialer's own state (sessions,
 * legs, CRM writes) is the part that has to be right before anything here
 * needs a server home too.
 */
import { useCallback, useMemo, useState } from 'react';
import DialerDevice, { AgentStatus } from './DialerDevice.jsx';
import ContactsTab from './tabs/ContactsTab.jsx';
import ListsTab from './tabs/ListsTab.jsx';
import ReportsTab from './tabs/ReportsTab.jsx';
import { parseContactsCsv, toE164 } from './lib/csv.js';
import { loadJSON, saveJSON } from './lib/storage.js';

const TABS = [
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'lists', label: 'Lists' },
  { key: 'reports', label: 'Reports' },
];

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function App() {
  const [activeTab, setActiveTab] = useState('campaigns');

  const [lists, setLists] = useState(() => loadJSON('lists', []));
  const [contacts, setContacts] = useState(() => loadJSON('contacts', []));
  const [sessionHistory, setSessionHistory] = useState(() => loadJSON('sessionHistory', []));
  const [loadRequest, setLoadRequest] = useState(null);

  // phone (E.164) → { disposition, at }. Not persisted — it is a live-shift
  // view of "who did we just call", not a call log; the durable record of a
  // call is the HubSpot engagement the backend already writes.
  const [callHistory, setCallHistory] = useState(new Map());

  const identity = import.meta.env.VITE_AGENT_IDENTITY ?? 'agent_1';
  const apiBase = import.meta.env.VITE_API_BASE ?? '';
  const apiKey = import.meta.env.VITE_DIALER_API_KEY ?? '';

  const handleImport = useCallback((csvText, name) => {
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

    setContacts((prev) => {
      const next = [...prev, ...withIds];
      saveJSON('contacts', next);
      return next;
    });
    setLists((prev) => {
      const next = [...prev, { id: listId, name, count: withIds.length, dialableCount, importedAt: Date.now() }];
      saveJSON('lists', next);
      return next;
    });
  }, []);

  const handleDeleteList = useCallback((listId) => {
    setLists((prev) => {
      const next = prev.filter((l) => l.id !== listId);
      saveJSON('lists', next);
      return next;
    });
    setContacts((prev) => {
      const next = prev.filter((c) => c.listId !== listId);
      saveJSON('contacts', next);
      return next;
    });
  }, []);

  const handleStartCampaign = useCallback(
    (list) => {
      const numbers = contacts
        .filter((c) => c.listId === list.id && c.phone1)
        .map((c) => c.phone1)
        .join('\n');
      setLoadRequest({ text: numbers, listName: list.name, token: Date.now() });
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

  const handleSessionEnded = useCallback((summary) => {
    setSessionHistory((prev) => {
      const next = [...prev, summary];
      saveJSON('sessionHistory', next);
      return next;
    });
    // The numbers an agent wants right after a session are on Reports.
    setActiveTab('reports');
  }, []);

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
