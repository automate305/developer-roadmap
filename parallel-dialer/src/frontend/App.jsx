/**
 * Application shell. Reads deployment settings from Vite env vars so the same
 * bundle can point at a local backend or a deployed one.
 */
import DialerDevice from './DialerDevice.jsx';

export default function App() {
  return (
    <main className="app">
      <DialerDevice
        apiBase={import.meta.env.VITE_API_BASE ?? ''}
        identity={import.meta.env.VITE_AGENT_IDENTITY ?? 'agent_1'}
        apiKey={import.meta.env.VITE_DIALER_API_KEY ?? ''}
      />
    </main>
  );
}
