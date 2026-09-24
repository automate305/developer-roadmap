/**
 * Inbound CRM webhooks.
 *
 * The HubSpot lead hook is the entry point for "call this person the moment
 * they convert". It validates the signature, drops the leads into the throttled
 * queue, and returns 200 immediately — HubSpot retries anything slower than a
 * few seconds, and a retry storm during a burst is exactly what the queue
 * exists to prevent.
 */
import express from 'express';

import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { dialerEngine } from '../dialerEngine.js';
import { LeadQueue, extractLeadsFromWebhook, hubspotWebhookAuth } from '../hubspotService.js';

const log = logger.child({ module: 'routes/webhooks' });

/**
 * @param {object} [opts]
 * @param {object} [opts.engine]
 * @param {LeadQueue} [opts.queue]
 */
export function createWebhookRouter({ engine = dialerEngine, queue } = {}) {
  const router = express.Router();

  const leadQueue =
    queue ??
    new LeadQueue({
      batchSize: config.dialer.batchSize,
      concurrency: config.hubspot.queueConcurrency,
      /**
       * One released batch becomes one dialing session. `autoAdvance: false`
       * keeps webhook-driven work to exactly the leads that were released —
       * the queue, not the engine, owns pacing here.
       */
      handler: async (leads) => {
        log.info('dialing webhook lead batch', { size: leads.length });
        await engine.startSession({
          agentIdentity: config.dialer.agentIdentity,
          leads,
          batchSize: leads.length,
          autoAdvance: false,
        });
      },
    });

  leadQueue.on('drain', (stats) => log.info('lead queue drained', stats));

  /**
   * `POST /api/webhooks/hubspot-lead`
   * Body is captured raw by the JSON parser's verify hook in server.js so the
   * v3 HMAC can be computed over the exact bytes HubSpot signed.
   */
  router.post('/hubspot-lead', hubspotWebhookAuth(), async (req, res) => {
    let leads = [];
    try {
      leads = await extractLeadsFromWebhook(req.body);
    } catch (err) {
      log.warn('failed to parse HubSpot lead payload', { err });
      return res.status(400).json({ error: 'unparseable_payload' });
    }

    if (leads.length === 0) {
      log.debug('webhook carried no dialable leads');
      return res.status(202).json({ accepted: 0, queued: leadQueue.size });
    }

    const accepted = leadQueue.enqueue(leads);
    log.info('accepted leads from HubSpot', { received: leads.length, accepted, queued: leadQueue.size });

    return res.status(202).json({ accepted, queued: leadQueue.size, stats: leadQueue.stats });
  });

  /** Operational visibility into the queue without touching the CRM. */
  router.get('/hubspot-lead/status', (_req, res) => {
    res.json({ queued: leadQueue.size, paused: leadQueue.paused, stats: leadQueue.stats });
  });

  return { router, leadQueue };
}

export default createWebhookRouter;
