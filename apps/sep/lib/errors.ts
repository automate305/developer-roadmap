/**
 * Every server action returns this shape so the UI can render an error state
 * instead of throwing an unhandled rejection into the React tree.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function ok(): ActionResult<undefined>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

export function fail(error: unknown, fallback = 'Something went wrong.'): ActionResult<never> {
  return { ok: false, error: toMessage(error, fallback) };
}

export function toMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}
