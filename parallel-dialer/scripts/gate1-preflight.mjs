#!/usr/bin/env node
/**
 * Gate 1 preflight — checks every credential the first real call needs,
 * WITHOUT placing a call or spending money. Read-only API requests only.
 *
 *   node scripts/gate1-preflight.mjs            # reads .env / the environment
 *
 * Prints PASS / FAIL / WARN per check and exits 1 on any FAIL. Never prints a
 * secret value — only key names and HTTP status codes.
 */
import { config, validateConfig } from '../src/config/env.js';

const results = [];
const record = (status, name, detail = '') => {
  results.push({ status, name });
  console.log(`${status.padEnd(4)}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function get(url, headers) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    let body = null;
    try {
      body = await res.json();
    } catch {
      // Non-JSON body; the status code is enough.
    }
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, error: err.cause?.code ?? err.name };
  }
}

// ── 1. Config the process validates at boot ─────────────────────────────────
const { missing, warnings } = validateConfig();
if (missing.length) record('FAIL', 'required env vars', `missing: ${missing.join(', ')}`);
else record('PASS', 'required env vars');
for (const warning of warnings) record('WARN', 'boot warning', warning);
record('INFO', 'provider', config.telephony.provider);
record('INFO', 'mode', `${config.dialer.screening ? 'screening (parallel)' : 'power-dial'}, batch ${config.dialer.batchSize}`);
record(
  'INFO',
  'agent bridge',
  config.dialer.agentPhoneNumber ? 'phone-bridge to AGENT_PHONE_NUMBER' : `SIP endpoint at ${config.signalwire.sipDomain}`,
);

// ── 2. SignalWire: auth works and the caller ID is a number this project owns ─
if (config.telephony.provider === 'signalwire') {
  const { projectId, apiToken, spaceUrl, callerId } = config.signalwire;
  if (projectId && apiToken && spaceUrl) {
    const auth = `Basic ${Buffer.from(`${projectId}:${apiToken}`).toString('base64')}`;
    const base = `https://${spaceUrl}/api/laml/2010-04-01/Accounts/${projectId}`;
    const account = await get(`${base}.json`, { Authorization: auth });
    if (account.status !== 200) {
      record('FAIL', 'SignalWire credentials', `HTTP ${account.status || account.error}`);
    } else {
      record('PASS', 'SignalWire credentials');
      // Placing calls needs the token's Voice scope.
      const calls = await get(`${base}/Calls.json?PageSize=1`, { Authorization: auth });
      if (calls.status === 200) record('PASS', 'SignalWire Voice scope');
      else record('FAIL', 'SignalWire Voice scope', `HTTP ${calls.status || calls.error} — enable Voice on the API token`);

      if (!callerId) {
        record('FAIL', 'SignalWire caller ID', 'SIGNALWIRE_CALLER_ID unset — buy a number and set it');
      } else {
        const query = `?PhoneNumber=${encodeURIComponent(callerId)}`;
        const res = await get(`${base}/IncomingPhoneNumbers.json${query}`, { Authorization: auth });
        const owned = res.body?.incoming_phone_numbers ?? [];
        if (res.status === 401) {
          record('WARN', 'SignalWire caller ID', 'token lacks the Numbers scope — confirm the number in the Dashboard');
        } else if (res.status === 200 && owned.length) {
          record('PASS', 'SignalWire caller ID', 'number is on this project');
        } else if (res.status === 200) {
          record('FAIL', 'SignalWire caller ID', 'SIGNALWIRE_CALLER_ID is not a number on this project');
        } else {
          record('WARN', 'SignalWire caller ID', `could not check — HTTP ${res.status || res.error}`);
        }
      }
    }
  }
}

// ── 3. Deepgram ──────────────────────────────────────────────────────────────
if (config.deepgram.apiKey) {
  const res = await get('https://api.deepgram.com/v1/projects', { Authorization: `Token ${config.deepgram.apiKey}` });
  if (res.status === 200) record('PASS', 'Deepgram key');
  else record('FAIL', 'Deepgram key', `HTTP ${res.status || res.error}`);
} else {
  record('FAIL', 'Deepgram key', 'DEEPGRAM_API_KEY unset — AMD would be timeout-only');
}

// ── 4. HubSpot: token valid and has the two scopes the dialer writes with ───
if (config.hubspot.accessToken) {
  const headers = { Authorization: `Bearer ${config.hubspot.accessToken}` };
  for (const object of ['contacts', 'calls']) {
    const res = await get(`https://api.hubapi.com/crm/v3/objects/${object}?limit=1`, headers);
    if (res.status === 200) record('PASS', `HubSpot ${object} scope`);
    else record('FAIL', `HubSpot ${object} scope`, `HTTP ${res.status || res.error}`);
  }
} else {
  record('FAIL', 'HubSpot token', 'HUBSPOT_ACCESS_TOKEN unset — no Call engagement will be written');
}

// ── 5. Deployment reachable over HTTPS ───────────────────────────────────────
if (config.publicBaseUrl.startsWith('https://')) {
  const res = await get(`${config.publicBaseUrl}/health`);
  if (res.status === 200) record('PASS', 'deployment /health', config.publicBaseUrl);
  else record('FAIL', 'deployment /health', `${config.publicBaseUrl} → HTTP ${res.status || res.error}`);
} else {
  record('FAIL', 'public HTTPS URL', `PUBLIC_BASE_URL is ${config.publicBaseUrl} — the carrier cannot reach it`);
}

const failed = results.filter((r) => r.status === 'FAIL').length;
console.log(`\n${failed ? `${failed} check(s) failed — not ready for a real call.` : 'All checks passed — ready for the Gate 1 call.'}`);
process.exit(failed ? 1 : 0);
