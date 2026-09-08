/**
 * The session cookie's name and shape, kept in a file with no Node imports so
 * `proxy.ts` — which runs on the edge runtime — can share it with the
 * server-side session code in `lib/auth.ts`.
 */
export const SESSION_COOKIE = 'sep_session';

/** Thirty days. Long enough not to nag, short enough that a stale laptop expires. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Request header carrying the path the visitor asked for, set by proxy.ts so
 * a layout that rejects a stale cookie can still return them there afterwards.
 */
export const PATH_HEADER = 'x-sep-path';
