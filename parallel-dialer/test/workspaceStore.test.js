/**
 * Contacts/Lists/Session History persistence. Each test gets its own temp
 * directory so nothing here touches the real ./data.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { WorkspaceStore } from '../src/backend/workspaceStore.js';

let tmpDir;
before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dialer-workspace-'));
});
after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

let dataDir;
beforeEach(async () => {
  dataDir = path.join(tmpDir, `run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
});

describe('WorkspaceStore', () => {
  it('starts empty when no files exist yet', async () => {
    const store = new WorkspaceStore({ dataDir });
    await store.load();
    assert.deepEqual(store.getState(), { contacts: [], lists: [], sessionHistory: [] });
  });

  it('importList persists both the list and its contacts', async () => {
    const store = new WorkspaceStore({ dataDir });
    await store.load();

    const list = { id: 'list-1', name: 'Brickell HVAC', count: 2, dialableCount: 2, importedAt: 1000 };
    const contacts = [
      { id: 'c1', listId: 'list-1', phone1: '+13055550100' },
      { id: 'c2', listId: 'list-1', phone1: '+13055550101' },
    ];
    await store.importList(list, contacts);

    assert.deepEqual(store.getState().lists, [list]);
    assert.deepEqual(store.getState().contacts, contacts);

    // Reload from disk as a fresh instance — this is the "survives a
    // restart" guarantee, not just "still in this instance's memory".
    const reloaded = new WorkspaceStore({ dataDir });
    await reloaded.load();
    assert.deepEqual(reloaded.getState().lists, [list]);
    assert.deepEqual(reloaded.getState().contacts, contacts);
  });

  it('rejects a list missing an id or name', async () => {
    const store = new WorkspaceStore({ dataDir });
    await store.load();
    await assert.rejects(() => store.importList({ name: 'no id' }, []), /id and name/);
    await assert.rejects(() => store.importList({ id: 'x' }, []), /id and name/);
  });

  it('deleteList removes the list and cascades to its contacts, leaving others alone', async () => {
    const store = new WorkspaceStore({ dataDir });
    await store.load();

    await store.importList({ id: 'a', name: 'List A', count: 1, dialableCount: 1, importedAt: 1 }, [
      { id: 'a1', listId: 'a', phone1: '+13055550100' },
    ]);
    await store.importList({ id: 'b', name: 'List B', count: 1, dialableCount: 1, importedAt: 2 }, [
      { id: 'b1', listId: 'b', phone1: '+13055550101' },
    ]);

    const existed = await store.deleteList('a');
    assert.equal(existed, true);

    const state = store.getState();
    assert.deepEqual(state.lists.map((l) => l.id), ['b']);
    assert.deepEqual(state.contacts.map((c) => c.id), ['b1']);

    const reloaded = new WorkspaceStore({ dataDir });
    await reloaded.load();
    assert.deepEqual(reloaded.getState().lists.map((l) => l.id), ['b']);
  });

  it('deleteList on an unknown id is a no-op that reports it did nothing', async () => {
    const store = new WorkspaceStore({ dataDir });
    await store.load();
    const existed = await store.deleteList('does-not-exist');
    assert.equal(existed, false);
  });

  it('appendSessionHistory accumulates across calls and survives a reload', async () => {
    const store = new WorkspaceStore({ dataDir });
    await store.load();

    await store.appendSessionHistory({ id: 'session-1', startedAt: 1, endedAt: 2 });
    await store.appendSessionHistory({ id: 'session-2', startedAt: 3, endedAt: 4 });

    assert.deepEqual(store.getState().sessionHistory.map((s) => s.id), ['session-1', 'session-2']);

    const reloaded = new WorkspaceStore({ dataDir });
    await reloaded.load();
    assert.deepEqual(reloaded.getState().sessionHistory.map((s) => s.id), ['session-1', 'session-2']);
  });

  it('serialises overlapping writes instead of one clobbering the other', async () => {
    const store = new WorkspaceStore({ dataDir });
    await store.load();

    // Fired without awaiting each one — the point is that both must land.
    await Promise.all([
      store.appendSessionHistory({ id: 's1' }),
      store.appendSessionHistory({ id: 's2' }),
      store.importList({ id: 'l1', name: 'L1', count: 0, dialableCount: 0, importedAt: 1 }, []),
    ]);

    const reloaded = new WorkspaceStore({ dataDir });
    await reloaded.load();
    assert.deepEqual(
      reloaded.getState().sessionHistory.map((s) => s.id).sort(),
      ['s1', 's2'],
    );
    assert.deepEqual(reloaded.getState().lists.map((l) => l.id), ['l1']);
  });
});
