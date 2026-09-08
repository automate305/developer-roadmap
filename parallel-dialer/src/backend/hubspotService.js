/**
 * hubspotService.js — HubSpot webhook validation, lead throttling, and
 * post-call activity logging.
 *
 * Three responsibilities, deliberately kept in one module because they share
 * the same client and the same rate-limit budget:
 *
 *  1. `verifySignatureV3()` — HMAC validation of inbound lead webhooks.
 *  2. `LeadQueue` — absorbs webhook bursts and releases leads to the dialer in
 *     bounded concurrent batches, so a 500-lead import does not open 500 lines.
 *  3. `logCallActivity()` — writes a Call engagement onto the contact timeline
 *     when a leg disconnects.
 */
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

import { Client } from '@hubspot/api-client';

import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'hubspotService' });

/** Association type id for Call → Contact in the v3 associations API. */
const CALL_TO_CONTACT_ASSOCIATION_TYPE_ID = 194;

/** Dialer dispositions → HubSpot `hs_call_status` values. */
const CALL_STATUS_MAP = Object.freeze({
  HUMAN: 'COMPLETED',
  MACHINE: 'COMPLETED',
  NO_ANSWER: 'NO_ANSWER',
  BUSY: 'BUSY',
  FAILED: 'FAILED',
  CANCELED: 'CANCELED',
  ABANDONED: 'CANCELED',
});

/** @type {Client | null} */
let client = null;

/** Lazily construct the client so the app boots without HubSpot configured. */
export function getHubSpotClient() {
  if (client) return client;
  if (!config.hubspot.accessToken) {
    throw new Error('HUBSPOT_ACCESS_TOKEN is not configured');
  }
  client = new Client({
    accessToken: config.hubspot.accessToken,
    numberOfApiCallRetries: 3, // SDK backs off on 429/5xx for us
  });
  return client;
}

export function isHubSpotConfigured() {
  return Boolean(config.hubspot.accessToken);
}

// ───────────────────────────────────────────────── webhook signature (v3) ────

/**
 * Validate `x-hubspot-signature-v3`.
 *
 * HubSpot signs `method + fullUri + rawBody + timestamp` with the app's client
 * secret and base64-encodes the HMAC-SHA256. The raw body matters: re-encoding
 * the parsed JSON changes key order and whitespace and the hash will not match,
 * which is why `server.js` captures `req.rawBody` in the body-parser verify
 * hook.
 *
 * @param {object} args
 * @param {string} args.method HTTP method, uppercase
 * @param {string} args.uri full request URI including scheme, host and query
 * @param {string|Buffer} args.rawBody exact bytes received
 * @param {string} args.signature value of `x-hubspot-signature-v3`
 * @param {string} args.timestamp value of `x-hubspot-request-timestamp`
 * @param {string} [args.clientSecret]
 * @returns {{ valid: boolean, reason?: string }}
 */
export function verifySignatureV3({ method, uri, rawBody, signature, timestamp, clientSecret }) {
  const secret = clientSecret ?? config.hubspot.clientSecret;
  if (!secret) return { valid: false, reason: 'client_secret_not_configured' };
  if (!signature) return { valid: false, reason: 'missing_signature_header' };
  if (!timestamp) return { valid: false, reason: 'missing_timestamp_header' };

  // Replay window. HubSpot's documented maximum is 5 minutes.
  const sentAt = Number.parseInt(String(timestamp), 10);
  if (!Number.isFinite(sentAt)) return { valid: false, reason: 'malformed_timestamp' };
  if (Math.abs(Date.now() - sentAt) > config.hubspot.signatureMaxAgeMs) {
    return { valid: false, reason: 'timestamp_outside_replay_window' };
  }

  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
  const source = `${method}${uri}${body}${timestamp}`;
  const expected = crypto.createHmac('sha256', secret).update(source, 'utf8').digest('base64');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(String(signature), 'utf8');
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (expectedBuf.length !== actualBuf.length) return { valid: false, reason: 'signature_mismatch' };
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) return { valid: false, reason: 'signature_mismatch' };

  return { valid: true };
}

/**
 * Express middleware enforcing the v3 signature on a webhook route.
 * Requires `req.rawBody` (see the `verify` hook in server.js).
 */
export function hubspotWebhookAuth() {
  return (req, res, next) => {
    const uri = `${config.publicBaseUrl}${req.originalUrl}`;
    const result = verifySignatureV3({
      method: req.method.toUpperCase(),
      uri,
      rawBody: req.rawBody ?? '',
      signature: req.get('x-hubspot-signature-v3'),
      timestamp: req.get('x-hubspot-request-timestamp'),
    });

    if (!result.valid) {
      log.warn('rejected HubSpot webhook', { reason: result.reason, path: req.originalUrl });
      return res.status(401).json({ error: 'invalid_signature', reason: result.reason });
    }
    return next();
  };
}

// ─────────────────────────────────────────────────────────────── queueing ────

/**
 * Bounded-concurrency lead queue.
 *
 * HubSpot delivers webhooks in bursts — a list import can fan out hundreds of
 * `contact.propertyChange` events in a second. The queue absorbs the burst and
 * releases leads in fixed-size batches with at most `concurrency` batches in
 * flight, so the dialer opens a predictable number of lines no matter how
 * lumpy the input is.
 *
 * Emits: `batch` (leads[]), `drain`, `error`.
 */
export class LeadQueue extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {number} [opts.batchSize] leads released per batch
   * @param {number} [opts.concurrency] batches processed simultaneously
   * @param {number} [opts.maxQueueLength] backpressure ceiling
   * @param {(leads: object[]) => Promise<unknown>} [opts.handler]
   */
  constructor(opts = {}) {
    super();
    this.batchSize = Math.max(1, opts.batchSize ?? config.dialer.batchSize);
    this.concurrency = Math.max(1, opts.concurrency ?? config.hubspot.queueConcurrency);
    this.maxQueueLength = opts.maxQueueLength ?? 10000;
    this.handler = opts.handler ?? null;

    /** @type {object[]} */ this.queue = [];
    this.inFlight = 0;
    this.paused = false;
    /**
     * De-dupes repeat webhooks for the same contact. Entries expire, because a
     * long-running process would otherwise accumulate one per lead forever —
     * and a lead legitimately re-enters the queue on a later dialing day.
     * @type {Map<string, number>} key → epoch ms first seen
     */
    this.seen = new Map();
    this.seenTtlMs = opts.seenTtlMs ?? 6 * 60 * 60 * 1000;
    this.maxSeenEntries = opts.maxSeenEntries ?? 50000;
    this.stats = { enqueued: 0, dropped: 0, duplicates: 0, batches: 0, failed: 0, seenEvicted: 0 };
  }

  /**
   * Add leads. Duplicates (same contactId or phone) already queued are ignored.
   * @param {object[]} leads
   * @returns {number} how many were actually accepted
   */
  enqueue(leads) {
    let accepted = 0;
    this.#pruneSeenByTtl();

    for (const lead of Array.isArray(leads) ? leads : [leads]) {
      if (!lead) continue;

      const key = lead.contactId ? `id:${lead.contactId}` : `tel:${lead.phone}`;
      if (this.seen.has(key)) {
        this.stats.duplicates += 1;
        continue;
      }
      if (this.queue.length >= this.maxQueueLength) {
        this.stats.dropped += 1;
        log.warn('lead queue full — dropping lead', { queued: this.queue.length });
        continue;
      }

      this.seen.set(key, Date.now());
      this.queue.push(lead);
      this.stats.enqueued += 1;
      accepted += 1;
    }

    this.#trimSeenToCap();
    if (accepted > 0) setImmediate(() => this.#pump());
    return accepted;
  }

  /** Stop releasing batches; queued leads are retained. */
  pause() {
    this.paused = true;
  }

  /** Resume releasing batches. */
  resume() {
    this.paused = false;
    setImmediate(() => this.#pump());
  }

  /** Drop everything pending (e.g. the agent ended their session). */
  clear() {
    const dropped = this.queue.length;
    this.queue = [];
    this.seen.clear();
    return dropped;
  }

  get size() {
    return this.queue.length;
  }

  /**
   * Drop de-dupe entries past their TTL. Runs before an enqueue, so expired
   * keys do not make a legitimate re-dial look like a duplicate.
   */
  #pruneSeenByTtl() {
    const cutoff = Date.now() - this.seenTtlMs;
    for (const [key, at] of this.seen) {
      // Insertion order is chronological, so the first live entry ends the scan.
      if (at >= cutoff) break;
      this.seen.delete(key);
      this.stats.seenEvicted += 1;
    }
  }

  /**
   * Enforce the hard ceiling, oldest first. Runs after inserts — trimming
   * beforehand would leave the map one over the cap on every enqueue.
   */
  #trimSeenToCap() {
    if (this.seen.size <= this.maxSeenEntries) return;
    const excess = this.seen.size - this.maxSeenEntries;
    let removed = 0;
    for (const key of this.seen.keys()) {
      if (removed >= excess) break;
      this.seen.delete(key);
      removed += 1;
      this.stats.seenEvicted += 1;
    }
  }

  /** Release batches until the concurrency budget or the queue is exhausted. */
  #pump() {
    if (this.paused) return;

    while (this.inFlight < this.concurrency && this.queue.length > 0) {
      const batch = this.queue.splice(0, this.batchSize);
      this.inFlight += 1;
      this.stats.batches += 1;
      this.emit('batch', batch);

      const work = this.handler ? Promise.resolve(this.handler(batch)) : Promise.resolve();
      work
        .catch((err) => {
          this.stats.failed += 1;
          log.warn('lead batch handler failed', { size: batch.length, err });
          this.emit('error', err);
        })
        .finally(() => {
          this.inFlight -= 1;
          if (this.queue.length > 0) setImmediate(() => this.#pump());
          else if (this.inFlight === 0) this.emit('drain', { ...this.stats });
        });
    }
  }
}

// ───────────────────────────────────────────────────────── webhook parsing ────

/**
 * Turn a HubSpot webhook payload into dialer leads.
 *
 * Handles both shapes seen in practice: the subscription event array
 * (`[{ objectId, subscriptionType, ... }]`) and a workflow/custom-code POST
 * carrying contact properties directly.
 *
 * @param {unknown} payload parsed request body
 * @returns {Promise<object[]>} leads shaped `{ phone, contactId, name, company }`
 */
export async function extractLeadsFromWebhook(payload) {
  const events = Array.isArray(payload) ? payload : [payload];
  const leads = [];
  /** Contact ids we must hydrate because the event carried no phone number. */
  const needsLookup = [];

  for (const event of events) {
    if (!event || typeof event !== 'object') continue;

    const contactId = String(event.objectId ?? event.contactId ?? event.hs_object_id ?? '') || null;
    const phone =
      event.phone ??
      event.mobilephone ??
      event.properties?.phone ??
      event.properties?.mobilephone ??
      (event.propertyName === 'phone' ? event.propertyValue : null);

    if (phone) {
      leads.push({
        phone: normalizePhone(String(phone)),
        contactId,
        name: joinName(event.firstname ?? event.properties?.firstname, event.lastname ?? event.properties?.lastname),
        company: event.company ?? event.properties?.company ?? null,
      });
    } else if (contactId) {
      needsLookup.push(contactId);
    }
  }

  if (needsLookup.length > 0 && isHubSpotConfigured()) {
    const hydrated = await fetchContacts(needsLookup);
    leads.push(...hydrated);
  }

  // Drop anything that did not survive normalisation into E.164.
  return leads.filter((lead) => lead.phone);
}

/**
 * Batch-read contacts by id and shape them as leads.
 * @param {string[]} contactIds
 */
export async function fetchContacts(contactIds) {
  try {
    const hubspot = getHubSpotClient();
    const response = await hubspot.crm.contacts.batchApi.read({
      properties: ['phone', 'mobilephone', 'firstname', 'lastname', 'company'],
      inputs: contactIds.map((id) => ({ id })),
    });

    return (response.results ?? [])
      .map((contact) => {
        const props = contact.properties ?? {};
        const phone = normalizePhone(props.phone || props.mobilephone || '');
        if (!phone) return null;
        return {
          phone,
          contactId: contact.id,
          name: joinName(props.firstname, props.lastname),
          company: props.company ?? null,
        };
      })
      .filter(Boolean);
  } catch (err) {
    log.warn('failed to hydrate contacts from HubSpot', { count: contactIds.length, err });
    return [];
  }
}

/**
 * Find a contact by phone number so a call can be associated even when the
 * dialer was fed a bare number.
 * @param {string} phone E.164
 * @returns {Promise<string|null>} contact id
 */
export async function findContactIdByPhone(phone) {
  if (!isHubSpotConfigured() || !phone) return null;
  try {
    const hubspot = getHubSpotClient();
    const response = await hubspot.crm.contacts.searchApi.doSearch({
      // Separate filter groups are OR'd: match either phone field.
      filterGroups: [
        { filters: [{ propertyName: 'phone', operator: 'EQ', value: phone }] },
        { filters: [{ propertyName: 'mobilephone', operator: 'EQ', value: phone }] },
      ],
      properties: ['phone', 'mobilephone'],
      limit: 1,
    });
    return response.results?.[0]?.id ?? null;
  } catch (err) {
    log.warn('contact search by phone failed', { err });
    return null;
  }
}

// ──────────────────────────────────────────────────────── activity logging ────

/**
 * Write a Call engagement onto the contact timeline.
 *
 * Called from the `leg:ended` handler, so it runs after the audio path is
 * already torn down — a slow CRM write can never delay the next batch. Failures
 * are logged and swallowed: losing a timeline entry must not fail a call.
 *
 * @param {object} args
 * @param {string|null} args.contactId
 * @param {string} args.phone
 * @param {string} [args.fromNumber]
 * @param {number} [args.durationSeconds]
 * @param {string} args.disposition one of Disposition.*
 * @param {string} [args.transcript]
 * @param {string} [args.callSid]
 * @param {string} [args.agentIdentity]
 * @param {number} [args.timestamp] epoch ms the call started
 * @returns {Promise<{ ok: boolean, id?: string, reason?: string }>}
 */
export async function logCallActivity(args) {
  if (!isHubSpotConfigured()) return { ok: false, reason: 'hubspot_not_configured' };

  const {
    phone,
    fromNumber = config.twilio.callerId,
    durationSeconds = 0,
    disposition = 'FAILED',
    transcript = '',
    callSid = null,
    agentIdentity = config.dialer.agentIdentity,
    timestamp = Date.now(),
  } = args;

  // Without an association the engagement is orphaned and invisible on the
  // record, so fall back to a phone lookup before giving up.
  const contactId = args.contactId ?? (await findContactIdByPhone(phone));
  if (!contactId) {
    // Retryable: a contact created moments ago may not be in the search index
    // yet. The caller's queue decides how long to keep trying.
    log.warn('no HubSpot contact for call — deferring activity log', { phone, callSid });
    return { ok: false, reason: 'contact_not_found', error: { reason: 'contact_not_found' } };
  }

  const properties = {
    hs_timestamp: String(timestamp),
    hs_call_title: `Parallel dialer — ${disposition}`,
    hs_call_body: buildCallBody({ disposition, transcript, callSid, agentIdentity, durationSeconds }),
    hs_call_direction: 'OUTBOUND',
    // HubSpot stores call duration in milliseconds.
    hs_call_duration: String(Math.max(0, Math.round(durationSeconds * 1000))),
    hs_call_status: CALL_STATUS_MAP[disposition] ?? 'COMPLETED',
    hs_call_from_number: fromNumber ?? '',
    hs_call_to_number: phone,
  };
  if (callSid) properties.hs_call_external_id = callSid;

  try {
    const hubspot = getHubSpotClient();
    const created = await hubspot.crm.objects.calls.basicApi.create({
      properties,
      associations: [
        {
          to: { id: String(contactId) },
          types: [
            {
              associationCategory: 'HUBSPOT_DEFINED',
              associationTypeId: CALL_TO_CONTACT_ASSOCIATION_TYPE_ID,
            },
          ],
        },
      ],
    });

    log.info('call activity logged', { contactId, callSid, engagementId: created.id, disposition });
    return { ok: true, id: created.id };
  } catch (err) {
    log.warn('failed to log call activity', { contactId, callSid, err });
    // `error` is passed through so the retry queue can tell a 429 from a 400.
    return { ok: false, reason: err?.message ?? 'unknown_error', error: err };
  }
}

/**
 * Find an existing Call engagement by its external id (the Twilio call SID).
 *
 * This is the idempotency probe the retry queue uses: a write whose response
 * was lost would otherwise be duplicated on the next attempt.
 *
 * @param {string} callSid
 * @returns {Promise<string|null>} engagement id, or null when absent
 */
export async function findCallByExternalId(callSid) {
  if (!isHubSpotConfigured() || !callSid) return null;

  const hubspot = getHubSpotClient();
  const response = await hubspot.crm.objects.calls.searchApi.doSearch({
    filterGroups: [
      { filters: [{ propertyName: 'hs_call_external_id', operator: 'EQ', value: callSid }] },
    ],
    properties: ['hs_call_external_id'],
    limit: 1,
  });

  return response.results?.[0]?.id ?? null;
}

/** Human-readable timeline body. */
function buildCallBody({ disposition, transcript, callSid, agentIdentity, durationSeconds }) {
  const lines = [
    `Outcome: ${disposition}`,
    `Duration: ${durationSeconds}s`,
    `Agent: ${agentIdentity ?? 'unassigned'}`,
  ];
  if (callSid) lines.push(`Twilio Call SID: ${callSid}`);
  if (transcript) lines.push('', `Opening transcript: "${transcript.slice(0, 500)}"`);
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────── utils ────

/**
 * Best-effort E.164 normalisation. Assumes NANP when no country code is
 * present, which matches a US/Canada calling operation; swap this for
 * libphonenumber if you dial internationally.
 * @param {string} raw
 */
export function normalizePhone(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '');
    return digits.length >= 7 ? `+${digits}` : '';
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}

function joinName(first, last) {
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name || null;
}

export default {
  getHubSpotClient,
  isHubSpotConfigured,
  verifySignatureV3,
  hubspotWebhookAuth,
  LeadQueue,
  extractLeadsFromWebhook,
  fetchContacts,
  findContactIdByPhone,
  logCallActivity,
  findCallByExternalId,
  normalizePhone,
};
