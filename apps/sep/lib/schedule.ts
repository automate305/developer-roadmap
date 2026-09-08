/**
 * Sending windows and warmup.
 *
 * Two deliverability controls that live on the mailbox, because reputation is
 * judged per sending address:
 *
 * - A send window. Cold email that arrives at 03:00 local time reads as
 *   automated to a person and looks like bulk to a filter. Sends are confined to
 *   working hours in the mailbox's own timezone, on chosen weekdays.
 * - A warmup ramp. A brand-new mailbox that starts at fifty a day is a
 *   spam-filter signal. The effective cap climbs daily until it reaches the
 *   configured ceiling.
 *
 * Timezone handling uses Intl rather than a date library: it is the only
 * dependency-free way to ask "what is the local hour there right now", and it
 * respects daylight saving, which matters for a Miami mailbox in March.
 */

export type SendWindow = {
  timezone: string;
  sendWindowStartHour: number;
  sendWindowEndHour: number;
  /** ISO weekdays, 1 = Monday through 7 = Sunday. */
  sendDays: number[];
};

export type WarmupSettings = {
  maxDaily: number;
  warmupEnabled: boolean;
  warmupStartedAt: Date | null;
  warmupInitialDaily: number;
  warmupDailyIncrement: number;
};

const HOUR_MS = 60 * 60 * 1000;
const ISO_WEEKDAY: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** Local hour and ISO weekday at a moment, in a given timezone. */
export function localParts(at: Date, timezone: string): { hour: number; weekday: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
      weekday: 'short',
    }).formatToParts(at);

    const hour = Number.parseInt(parts.find((part) => part.type === 'hour')?.value ?? '0', 10);
    const weekday = ISO_WEEKDAY[parts.find((part) => part.type === 'weekday')?.value ?? 'Mon'] ?? 1;

    // Intl renders midnight as 24 in some environments.
    return { hour: hour === 24 ? 0 : hour, weekday };
  } catch {
    // An invalid timezone must not stop sending; fall back to UTC.
    return { hour: at.getUTCHours(), weekday: ((at.getUTCDay() + 6) % 7) + 1 };
  }
}

export function isWithinWindow(at: Date, window: SendWindow): boolean {
  const { hour, weekday } = localParts(at, window.timezone);
  if (!window.sendDays.includes(weekday)) return false;

  const { sendWindowStartHour: start, sendWindowEndHour: end } = window;
  // A window that wraps past midnight, e.g. 20:00 to 02:00.
  if (start > end) return hour >= start || hour < end;
  return hour >= start && hour < end;
}

/**
 * The next moment sending is allowed. Steps forward an hour at a time, which
 * keeps daylight-saving and weekday arithmetic in Intl's hands rather than ours.
 */
export function nextWindowOpen(from: Date, window: SendWindow, horizonDays = 8): Date {
  if (isWithinWindow(from, window)) return from;

  for (let step = 1; step <= horizonDays * 24; step += 1) {
    const candidate = new Date(from.getTime() + step * HOUR_MS);
    if (isWithinWindow(candidate, window)) return candidate;
  }

  // No open hour in the horizon: the window is misconfigured. Try again tomorrow
  // rather than deferring a lead forever.
  return new Date(from.getTime() + 24 * HOUR_MS);
}

/**
 * Today's cap for a mailbox. During warmup it climbs from the starting volume by
 * the daily increment, never past the configured ceiling.
 */
export function effectiveDailyCap(account: WarmupSettings, now = new Date()): number {
  if (!account.warmupEnabled || !account.warmupStartedAt) return account.maxDaily;

  const elapsedDays = Math.floor(
    (now.getTime() - account.warmupStartedAt.getTime()) / (24 * HOUR_MS),
  );
  if (elapsedDays < 0) return Math.max(0, account.warmupInitialDaily);

  const ramped = account.warmupInitialDaily + account.warmupDailyIncrement * elapsedDays;
  return Math.max(0, Math.min(account.maxDaily, ramped));
}

/** Days until warmup reaches the ceiling, for showing progress. */
export function warmupDaysRemaining(account: WarmupSettings, now = new Date()): number {
  if (!account.warmupEnabled || !account.warmupStartedAt) return 0;
  if (account.warmupDailyIncrement <= 0) return 0;

  const current = effectiveDailyCap(account, now);
  if (current >= account.maxDaily) return 0;
  return Math.ceil((account.maxDaily - current) / account.warmupDailyIncrement);
}

/**
 * A random offset in milliseconds, up to `minutes`. Sends scheduled to the same
 * instant leave in a burst that reads as machine-timed; spreading them does not.
 */
export function jitterMs(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.floor(Math.random() * minutes * 60 * 1000);
}

/** Applies jitter to a scheduled moment. */
export function withJitter(at: Date, minutes: number): Date {
  return new Date(at.getTime() + jitterMs(minutes));
}
