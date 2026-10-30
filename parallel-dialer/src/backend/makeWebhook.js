/**
 * Fires a Make (Integromat) webhook when a session ends, sending KPIs to the
 * client RevOps dashboard. Configured via MAKE_SESSION_WEBHOOK_URL.
 * No-ops silently when the URL is absent.
 */
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'makeWebhook' });

/**
 * @param {object} sessionSummary  the full session payload (same shape stored
 *   in session_reports.raw_kpi_payload)
 * @returns {Promise<boolean>} true if the webhook was fired successfully
 */
export async function fireSessionWebhook(sessionSummary) {
  const url = config.make.sessionWebhookUrl;
  if (!url) {
    log.debug('MAKE_SESSION_WEBHOOK_URL not set — skipping webhook');
    return false;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'session_ended',
        firedAt: new Date().toISOString(),
        ...sessionSummary,
      }),
    });
    if (!res.ok) {
      log.warn('make webhook returned non-2xx', { status: res.status });
      return false;
    }
    log.info('make session webhook fired', { sessionId: sessionSummary.id });
    return true;
  } catch (err) {
    log.warn('make webhook request failed', { err: err.message });
    return false;
  }
}

export default { fireSessionWebhook };
