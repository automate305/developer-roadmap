/**
 * TwiML webhooks. Every route here is called by Twilio, not by the browser.
 *
 * Responses must be fast and small: the outbound answer document is on the
 * critical path between "the lead picked up" and "we can hear them", so it is
 * built by hand-free string assembly and returned in a single write.
 */
import express from 'express';
import twilio from 'twilio';

import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { dialerEngine } from '../dialerEngine.js';
import { twilioWebhookAuth } from '../twilioClient.js';

const log = logger.child({ module: 'routes/twiml' });
const { VoiceResponse } = twilio.twiml;

export function createTwimlRouter({ engine = dialerEngine } = {}) {
  const router = express.Router();

  // Twilio posts application/x-www-form-urlencoded.
  router.use(express.urlencoded({ extended: false }));
  router.use(twilioWebhookAuth());

  /**
   * Answer document for every outbound leg.
   *
   * `<Connect><Stream>` forks the leg's inbound audio to the AMD WebSocket and
   * holds the call open while we listen. The custom `<Parameter>` values ride
   * along in Twilio's `start` frame, which is how the socket finds its leg
   * without a second lookup.
   */
  router.post('/outbound', (req, res) => {
    const legId = String(req.query.legId ?? req.body.legId ?? '');
    const batchId = String(req.query.batchId ?? req.body.batchId ?? '');

    const response = new VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({ url: `${config.publicWsUrl}/media-stream` });
    stream.parameter({ name: 'legId', value: legId });
    stream.parameter({ name: 'batchId', value: batchId });

    log.debug('served outbound answer twiml', { legId, batchId, callSid: req.body.CallSid });
    res.type('text/xml').send(response.toString());
  });

  /**
   * Call status callbacks (initiated → ringing → answered → completed).
   * Drives batch resolution when a leg dies without ever reaching the AMD.
   */
  router.post('/status', async (req, res) => {
    // Acknowledge first: Twilio retries on a slow response and duplicate status
    // events would double-count dispositions.
    res.status(204).end();

    try {
      await engine.handleStatusCallback({ ...req.body, legId: req.query.legId });
    } catch (err) {
      log.warn('status callback handling failed', { callSid: req.body?.CallSid, err });
    }
  });

  /**
   * `action` target of the `<Dial>` that bridges a lead onto the agent. Fires
   * when the bridge ends, carrying the real conversation duration.
   */
  router.post('/bridge-status', async (req, res) => {
    const legId = String(req.query.legId ?? '');
    log.info('agent bridge ended', {
      legId,
      callSid: req.body.CallSid,
      dialCallStatus: req.body.DialCallStatus,
      dialCallDuration: req.body.DialCallDuration,
    });

    try {
      await engine.handleStatusCallback({
        CallSid: req.body.CallSid,
        CallStatus: 'completed',
        CallDuration: req.body.DialCallDuration,
        legId,
      });
    } catch (err) {
      log.warn('bridge-status handling failed', { legId, err });
    }

    // Empty response: hang the lead up once the agent leg is gone.
    res.type('text/xml').send(new VoiceResponse().toString());
  });

  /**
   * Voice Request URL for the TwiML App, used when the agent dials a number
   * manually from the workstation rather than through a batch.
   */
  router.post('/agent-outbound', (req, res) => {
    const to = String(req.body.To ?? '').trim();
    const response = new VoiceResponse();

    if (!/^\+[1-9]\d{6,14}$/.test(to)) {
      response.say('Sorry, that number is not valid.');
      response.hangup();
      return res.type('text/xml').send(response.toString());
    }

    const dial = response.dial({ callerId: config.twilio.callerId, answerOnBridge: true });
    dial.number(to); // VoiceResponse escapes the value for us

    log.info('agent manual dial', { to, from: req.body.From });
    return res.type('text/xml').send(response.toString());
  });

  return router;
}

export default createTwimlRouter;
