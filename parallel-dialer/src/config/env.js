/**
 * Centralised, validated environment configuration.
 *
 * Every other module imports `config` from here rather than touching
 * `process.env` directly, so a missing key fails loudly at boot instead of
 * surfacing as an undefined-header error in the middle of a live call.
 */
import 'dotenv/config';

/** @param {string} name @param {string} [fallback] */
function str(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    if (fallback !== undefined) return fallback;
    return undefined;
  }
  return raw.trim();
}

/** @param {string} name @param {number} fallback */
function int(name, fallback) {
  const raw = str(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  }
  return parsed;
}

/** @param {string} name @param {boolean} fallback */
function bool(name, fallback) {
  const raw = str(name);
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

/** @param {string} name @param {string[]} fallback */
function list(name, fallback) {
  const raw = str(name);
  if (raw === undefined) return fallback;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const publicBaseUrl = (str('PUBLIC_BASE_URL', 'http://localhost:3000') ?? '').replace(/\/+$/, '');

export const config = Object.freeze({
  env: str('NODE_ENV', 'development'),
  isProduction: str('NODE_ENV', 'development') === 'production',
  port: int('PORT', 3000),
  logLevel: str('LOG_LEVEL', 'info'),

  publicBaseUrl,
  /** wss:// origin derived from the public base URL, for <Stream url="..."> */
  publicWsUrl: publicBaseUrl.replace(/^http/, 'ws'),

  corsOrigins: list('CORS_ORIGINS', ['http://localhost:5173']),
  dialerApiKey: str('DIALER_API_KEY'),

  twilio: {
    accountSid: str('TWILIO_ACCOUNT_SID'),
    authToken: str('TWILIO_AUTH_TOKEN'),
    callerId: str('TWILIO_CALLER_ID'),
    apiKeySid: str('TWILIO_API_KEY_SID'),
    apiKeySecret: str('TWILIO_API_KEY_SECRET'),
    twimlAppSid: str('TWILIO_TWIML_APP_SID'),
    tokenTtlSeconds: Math.min(int('TWILIO_TOKEN_TTL_SECONDS', 3600), 86400),
    validateSignature: bool('TWILIO_VALIDATE_SIGNATURE', true),
  },

  deepgram: {
    apiKey: str('DEEPGRAM_API_KEY'),
    model: str('DEEPGRAM_MODEL', 'nova-2-phonecall'),
    endpointingMs: int('DEEPGRAM_ENDPOINTING_MS', 300),
    // Twilio Media Streams are always 8 kHz μ-law mono; piping these values
    // straight through means zero transcoding on the hot path.
    encoding: 'mulaw',
    sampleRate: 8000,
    channels: 1,
  },

  amd: {
    initialSpeechTimeoutMs: int('AMD_INITIAL_SPEECH_TIMEOUT_MS', 3800),
    maxContinuousSpeechMs: int('AMD_MAX_CONTINUOUS_SPEECH_MS', 2800),
    decisionDeadlineMs: int('AMD_DECISION_DEADLINE_MS', 9000),
  },

  dialer: {
    batchSize: Math.min(Math.max(int('DIALER_BATCH_SIZE', 4), 1), 10),
    ringTimeoutSeconds: int('DIALER_RING_TIMEOUT_SECONDS', 22),
    agentIdentity: str('DIALER_AGENT_IDENTITY', 'agent_1'),
  },

  hubspot: {
    accessToken: str('HUBSPOT_ACCESS_TOKEN'),
    clientSecret: str('HUBSPOT_CLIENT_SECRET'),
    signatureMaxAgeMs: int('HUBSPOT_SIGNATURE_MAX_AGE_MS', 300000),
    queueConcurrency: int('HUBSPOT_QUEUE_CONCURRENCY', 2),
    // Call activities that exhaust their retries land here rather than
    // vanishing. Put this on a volume that survives a restart.
    deadLetterPath: str('HUBSPOT_DEAD_LETTER_PATH', './data/crm-dead-letter.jsonl'),
    replayDeadLetterOnBoot: bool('HUBSPOT_REPLAY_DEAD_LETTER_ON_BOOT', true),
  },
});

/**
 * Keys the process genuinely cannot run without. Integration-specific keys
 * (HubSpot, Deepgram) are checked lazily by their own services so the dialer
 * still boots in a degraded, testable mode when they are absent.
 */
const REQUIRED = [
  ['TWILIO_ACCOUNT_SID', config.twilio.accountSid],
  ['TWILIO_AUTH_TOKEN', config.twilio.authToken],
  ['TWILIO_CALLER_ID', config.twilio.callerId],
];

/**
 * Validates required configuration.
 * @returns {{ ok: boolean, missing: string[], warnings: string[] }}
 */
export function validateConfig() {
  const missing = REQUIRED.filter(([, value]) => !value).map(([name]) => name);
  const warnings = [];

  if (!config.deepgram.apiKey) {
    warnings.push('DEEPGRAM_API_KEY is unset — AMD will fall back to timeout-only classification.');
  }
  if (!config.hubspot.accessToken) {
    warnings.push('HUBSPOT_ACCESS_TOKEN is unset — call activities will not be logged to the CRM.');
  }
  if (!config.hubspot.clientSecret) {
    warnings.push('HUBSPOT_CLIENT_SECRET is unset — the lead webhook will reject every request.');
  }
  if (!config.twilio.apiKeySid || !config.twilio.apiKeySecret || !config.twilio.twimlAppSid) {
    warnings.push('Twilio API key/secret or TwiML App SID missing — /api/token cannot mint WebRTC tokens.');
  }
  if (!config.publicBaseUrl.startsWith('https://') && config.isProduction) {
    warnings.push('PUBLIC_BASE_URL is not HTTPS — Twilio will not reach the TwiML or Media Stream endpoints.');
  }
  if (!config.dialerApiKey && config.isProduction) {
    warnings.push('DIALER_API_KEY is unset in production — control endpoints are unauthenticated.');
  }

  return { ok: missing.length === 0, missing, warnings };
}

export default config;
