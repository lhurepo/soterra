// [I] Scheduling rules for the one-minute tick. Convex crons are static, so the tick holds the logic.
// Interval: normal or crisis; Apify sources never below APIFY_MIN_INTERVAL_MIN; failures back off
// exponentially up to BACKOFF_CAP_MIN.

export type ScheduleSource = {
  enabled: boolean;
  fetchVia: "direct" | "apify";
  normalIntervalMin: number;
  crisisIntervalMin: number;
  lastRunAt?: number;
  lastOutcome?: RunOutcome;
  consecutiveFailures?: number;
};

export type RunOutcome = "running" | "awaiting_apify" | "succeeded" | "failed";

export type ScheduleSettings = { apifyMinIntervalMin: number; backoffCapMin: number };

/** A run still marked running after this long is treated as lost and may be rescheduled. */
export const RUN_STALE_MS = { direct: 10 * 60_000, apify: 30 * 60_000 } as const;

const MIN = 60_000;

export function intervalMs(s: ScheduleSource, mode: "normal" | "crisis", settings: ScheduleSettings): number {
  const base = mode === "crisis" ? s.crisisIntervalMin : s.normalIntervalMin;
  const floor = s.fetchVia === "apify" ? settings.apifyMinIntervalMin : 0;
  return Math.max(base, floor) * MIN;
}

export function backoffMs(s: ScheduleSource, mode: "normal" | "crisis", settings: ScheduleSettings): number {
  const failures = s.consecutiveFailures ?? 0;
  const interval = intervalMs(s, mode, settings);
  if (failures === 0) return interval;
  return Math.min(interval * 2 ** failures, Math.max(interval, settings.backoffCapMin * MIN));
}

export function isRunning(s: ScheduleSource, now: number): boolean {
  if (s.lastOutcome !== "running" && s.lastOutcome !== "awaiting_apify") return false;
  return s.lastRunAt !== undefined && now - s.lastRunAt < RUN_STALE_MS[s.fetchVia];
}

/** When the source may run next, or undefined if it has never run (due now). */
export function nextDueAt(s: ScheduleSource, mode: "normal" | "crisis", settings: ScheduleSettings): number | undefined {
  if (s.lastRunAt === undefined) return undefined;
  return s.lastRunAt + backoffMs(s, mode, settings);
}

export function isDue(s: ScheduleSource, mode: "normal" | "crisis", now: number, settings: ScheduleSettings): boolean {
  if (!s.enabled || isRunning(s, now)) return false;
  const next = nextDueAt(s, mode, settings);
  // 5 s of slack so a 1-minute source is not skipped by cron jitter.
  return next === undefined || now >= next - 5_000;
}
