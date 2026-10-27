import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import express from 'express';

import { createOperatorAuth } from '../src/backend/operatorAuth.js';
import { createApiRouter } from '../src/backend/routes/api.js';
import { createWorkspaceRouter } from '../src/backend/routes/workspace.js';

const key = 'test-operator-key';
let server;
let base;
let activeSessions = [];
let savedOutcome = null;
let crmEnqueues = 0;

before(async () => {
  const auth = createOperatorAuth({ key, publicBaseUrl: 'http://localhost:5173' });
  const engine = { listSessions: () => activeSessions, snapshotSession: () => null };
  const store = {
    getState: () => ({ contacts: [], lists: [], sessionHistory: [] }),
    async appendCallOutcome(outcome) {
      if (savedOutcome) return { saved: savedOutcome, created: false };
      savedOutcome = outcome;
      return { saved: outcome, created: true };
    },
  };
  const outcomeQueue = { enqueue: () => { crmEnqueues += 1; return true; } };
  const app = express();
  app.use('/api', createApiRouter({ engine, auth }));
  app.use('/api/workspace', createWorkspaceRouter({ store, outcomeQueue, auth }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test('unauthenticated browser cannot access token, sessions, workspace or SSE', async () => {
  for (const path of ['/api/token', '/api/sessions', '/api/workspace/state', '/api/events?key=test-operator-key']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 401, path);
  }
});

test('dashboard login creates HttpOnly session; logout revokes it', async () => {
  const invalid = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ key: 'wrong' }),
  });
  assert.equal(invalid.status, 401);

  const login = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ key }),
  });
  assert.equal(login.status, 200);
  const cookieHeader = login.headers.get('set-cookie');
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /SameSite=Strict/i);
  const cookie = cookieHeader.split(';')[0];
  const headers = { Cookie: cookie };
  assert.deepEqual(await (await fetch(base + '/api/auth/session', { headers })).json(), { authenticated: true });
  assert.equal((await fetch(base + '/api/workspace/state', { headers })).status, 200);
  assert.equal((await fetch(base + '/api/sessions', { headers })).status, 200);
  assert.notEqual((await fetch(base + '/api/token', { headers })).status, 401);

  const crossOrigin = await fetch(base + '/api/sessions/any', {
    method: 'DELETE', headers: { ...headers, Origin: 'https://untrusted.example' },
  });
  assert.equal(crossOrigin.status, 401);
  assert.equal((await fetch(base + '/api/sessions/any', { method: 'DELETE', headers })).status, 401);

  const logout = await fetch(base + '/api/auth/logout', {
    method: 'POST', headers: { ...headers, Origin: 'http://localhost:5173' },
  });
  assert.equal(logout.status, 200);
  assert.equal((await fetch(base + '/api/workspace/state', { headers })).status, 401);
});

test('trusted API clients can still use x-dialer-key but not query-string keys', async () => {
  assert.equal((await fetch(base + '/api/workspace/state', { headers: { 'x-dialer-key': key } })).status, 200);
  assert.equal((await fetch(base + `/api/workspace/state?key=${key}`)).status, 401);
});

test('a second active dialing session is rejected before placing a call', async () => {
  activeSessions = [{ state: 'DIALING' }];
  try {
    const response = await fetch(base + '/api/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-dialer-key': key },
      body: JSON.stringify({ leads: ['+13055550100'] }),
    });
    assert.equal(response.status, 409);
  } finally {
    activeSessions = [];
  }
});

test('retrying a saved outcome does not queue a duplicate CRM update', async () => {
  const payload = { callSid: 'CA-owned-test', outcome: 'meeting', notes: 'Booked' };
  const request = (body) => fetch(base + '/api/workspace/outcomes', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-dialer-key': key }, body: JSON.stringify(body),
  });
  const first = await request(payload);
  assert.equal(first.status, 201);
  assert.equal((await first.json()).created, true);
  const retry = await request(payload);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).created, false);
  assert.equal(crmEnqueues, 1);
  const conflicting = await request({ ...payload, outcome: 'do_not_call' });
  assert.equal(conflicting.status, 409);
  assert.equal(crmEnqueues, 1);
});
