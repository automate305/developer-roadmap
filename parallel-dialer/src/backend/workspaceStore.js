/**
 * workspaceStore.js — durable home for Contacts, Lists and Session History.
 *
 * These three lived only in the browser's localStorage until now (see
 * AGENTS.md): fine for "don't lose it on a page reload", not for "don't lose
 * it on a server restart" or "share it across a browser that isn't this one".
 * This is the backend half of closing that gap.
 *
 * Storage is three whole-file JSON documents under `dataDir`, loaded into
 * memory on boot and rewritten (temp file + rename, so a crash mid-write
 * never leaves a half-written file behind) on every mutation. No database:
 * this project has none today, and pilot-scale data (hundreds of contacts)
 * doesn't need one — the same reasoning `AMD_AUDIT_PATH` and
 * `HUBSPOT_DEAD_LETTER_PATH` already rest on.
 *
 * Writes are serialised through one promise chain per store instance so two
 * near-simultaneous mutations (e.g. importing a list while a session ends)
 * cannot interleave and corrupt a write.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'workspaceStore' });

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    log.warn('failed to read workspace file — starting from empty', { filePath, err });
    return fallback;
  }
}

async function writeJsonFileAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmpPath, filePath);
}

export class WorkspaceStore {
  /** @param {object} opts @param {string} opts.dataDir */
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.contactsPath = path.join(dataDir, 'contacts.json');
    this.listsPath = path.join(dataDir, 'lists.json');
    this.sessionHistoryPath = path.join(dataDir, 'session-history.json');

    this.contacts = [];
    this.lists = [];
    this.sessionHistory = [];
    this.loaded = false;

    /** Serialises every mutation's write. */
    this.tail = Promise.resolve();
  }

  /** Read all three files into memory. Call once before serving traffic. */
  async load() {
    [this.contacts, this.lists, this.sessionHistory] = await Promise.all([
      readJsonFile(this.contactsPath, []),
      readJsonFile(this.listsPath, []),
      readJsonFile(this.sessionHistoryPath, []),
    ]);
    this.loaded = true;
    log.info('workspace store loaded', {
      contacts: this.contacts.length,
      lists: this.lists.length,
      sessionHistory: this.sessionHistory.length,
    });
  }

  /** Snapshot of everything the workstation needs on first paint. */
  getState() {
    return { contacts: this.contacts, lists: this.lists, sessionHistory: this.sessionHistory };
  }

  /**
   * Add one imported list and its contacts. The frontend already parsed the
   * CSV and assigned ids (see `lib/csv.js` and `App.jsx#handleImport`) — this
   * only persists what it's given, after checking the shape is sane.
   *
   * @param {{ id: string, name: string, count: number, dialableCount: number, importedAt: number }} list
   * @param {object[]} contacts
   */
  async importList(list, contacts) {
    if (!list?.id || !list?.name) throw new Error('list requires id and name');
    if (!Array.isArray(contacts)) throw new Error('contacts must be an array');

    this.lists = [...this.lists, list];
    this.contacts = [...this.contacts, ...contacts];
    await this.#persist('lists', 'contacts');
    return { list, contacts };
  }

  /** Delete a list and every contact that belongs to it. */
  async deleteList(listId) {
    const existed = this.lists.some((l) => l.id === listId);
    this.lists = this.lists.filter((l) => l.id !== listId);
    this.contacts = this.contacts.filter((c) => c.listId !== listId);
    await this.#persist('lists', 'contacts');
    return existed;
  }

  /** Append one finished session's summary. */
  async appendSessionHistory(summary) {
    if (!summary?.id) throw new Error('session summary requires an id');
    this.sessionHistory = [...this.sessionHistory, summary];
    await this.#persist('sessionHistory');
    return summary;
  }

  /** @param {...('contacts'|'lists'|'sessionHistory')} keys */
  async #persist(...keys) {
    const writers = {
      contacts: () => writeJsonFileAtomic(this.contactsPath, this.contacts),
      lists: () => writeJsonFileAtomic(this.listsPath, this.lists),
      sessionHistory: () => writeJsonFileAtomic(this.sessionHistoryPath, this.sessionHistory),
    };
    const job = () => Promise.all(keys.map((key) => writers[key]()));
    // Chain onto the tail so overlapping mutations serialise instead of
    // racing two writers on the same file. Capture this call's own position
    // in the chain before any concurrent caller reassigns `this.tail` out
    // from under it — awaiting `this.tail` itself here could pick up a later
    // caller's write instead of this one's.
    const previous = this.tail;
    const current = previous.then(job, job);
    this.tail = current;
    await current;
  }
}

export default WorkspaceStore;
