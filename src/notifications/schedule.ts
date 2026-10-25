// [B] Time-based updates ("every 2 hours"): interval limits, subscription lifetime, and how the interval is said.
import { DEFAULTS, subscriptionTtl } from "../config/defaults";

const MINUTE = 60_000;

/** Clamps a requested interval to 1–24 hours. */
export function clampIntervalMs(minutes: number): number {
  return Math.min(Math.max(Math.round(minutes) * MINUTE, DEFAULTS.scheduledMinIntervalMs), DEFAULTS.scheduledMaxIntervalMs);
}

/**
 * How long a subscription lasts. Change alerts: the default (24 h). Scheduled updates: at least three updates, within
 * the 24 h default and the 72 h maximum (daily updates last 72 h, hourly ones 24 h).
 */
export function subscriptionLifetimeMs(intervalMs?: number): number {
  if (intervalMs === undefined) return subscriptionTtl();
  return subscriptionTtl(Math.max(DEFAULTS.subscriptionTtlMs, 3 * intervalMs));
}

/** "hour", "2 hours", "day" / "hora", "2 horas", "día": said after "every" / "cada". */
export function formatInterval(intervalMs: number, language: string): string {
  const es = language.toLowerCase().startsWith("es");
  const hours = Math.max(1, Math.round(intervalMs / 3_600_000));
  if (hours === 24) return es ? "día" : "day";
  if (hours === 1) return es ? "hora" : "hour";
  return es ? `${hours} horas` : `${hours} hours`;
}

/** The next due time after `from`, skipping slots already in the past (a late cron never sends a burst). */
export function nextRunAfter(previousDue: number, intervalMs: number, now: number): number {
  let next = previousDue + intervalMs;
  if (next <= now) next = now + intervalMs;
  return next;
}

/** "an hour", "2 hours", "a day" / "una hora", "2 horas", "un día": said after "in" / "en". */
export function formatDuration(intervalMs: number, language: string): string {
  const es = language.toLowerCase().startsWith("es");
  const hours = Math.max(1, Math.round(intervalMs / 3_600_000));
  if (hours === 24) return es ? "un día" : "a day";
  if (hours === 1) return es ? "una hora" : "an hour";
  return es ? `${hours} horas` : `${hours} hours`;
}
