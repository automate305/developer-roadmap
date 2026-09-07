import { env } from './env';

/** 1x1 fully transparent GIF, the smallest valid payload for an open beacon. */
export const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

export function trackingPixelUrl(trackingId: string, baseUrl = env.appUrl): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/track/open?t=${encodeURIComponent(trackingId)}`;
}

export function trackingPixelTag(trackingId: string, baseUrl = env.appUrl): string {
  return `<img src="${trackingPixelUrl(trackingId, baseUrl)}" width="1" height="1" alt="" style="display:block;border:0;outline:none;" />`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Treats a plain-text step body as HTML, preserving paragraph breaks. */
export function bodyToHtml(body: string): string {
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(body);
  if (looksLikeHtml) return body;
  return escapeHtml(body).replace(/\r?\n/g, '<br />');
}

/**
 * Appends the open beacon to an HTML body. Inserted just before </body> when
 * present so the pixel stays inside the rendered document.
 */
export function injectTrackingPixel(html: string, trackingId: string, baseUrl = env.appUrl): string {
  const pixel = trackingPixelTag(trackingId, baseUrl);
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${pixel}</body>`);
  }
  return `${html}${pixel}`;
}

/** Plain-text alternative part, so the message is not HTML-only. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}
