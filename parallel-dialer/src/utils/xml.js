/**
 * Minimal XML escaping for values interpolated into hand-built TwiML/cXML.
 * Shared by dialerEngine.js and telephonyClient.js — pulled out of
 * dialerEngine.js so telephonyClient.js can use it too without an import
 * cycle (dialerEngine imports telephonyClient for the provider-aware call
 * verbs).
 */
export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default escapeXml;
