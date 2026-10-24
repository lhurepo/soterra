// [B] Subscription matcher rules, dedupe keys and rate limits for callbacks.
import type { AreaRef, BulletinEvent, HazardType, Severity, Subscription } from "../contracts";
import { DEFAULTS } from "../config/defaults";

const SEVERITY_RANK: Record<Severity, number> = { unknown: 0, minor: 1, moderate: 2, severe: 3, extreme: 4 };

export type MatchableEvent = Pick<BulletinEvent, "change" | "incidentKey" | "severityBefore" | "severityAfter"> & {
  hazardType: HazardType;
  /** Areas of the bulletin (from bulletinAreas). */
  areas: Pick<AreaRef, "state" | "countyFips" | "nwsZone">[];
};

export type MatchableSubscription = Pick<Subscription, "target" | "trigger" | "status" | "expiresAt">;

/** Area overlap: same county when the subscription names one, same NWS zone, otherwise same state. */
export function areaOverlaps(target: Pick<AreaRef, "state" | "countyFips" | "nwsZone">, areas: MatchableEvent["areas"]): boolean {
  if (target.countyFips) return areas.some((a) => a.countyFips === target.countyFips);
  if (target.nwsZone) return areas.some((a) => a.nwsZone === target.nwsZone);
  return areas.some((a) => a.state === target.state);
}

export function eventMatches(sub: MatchableSubscription, event: MatchableEvent, now: number): boolean {
  if (sub.status !== "active" || sub.expiresAt <= now) return false;

  const targetHit =
    sub.target.kind === "incident"
      ? sub.target.incidentKey !== undefined && sub.target.incidentKey === event.incidentKey
      : sub.target.kind === "area"
        ? sub.target.area !== undefined && areaOverlaps(sub.target.area, event.areas)
        : false; // "question" targets fire from answerUnansweredQuestion, never from bulletin events.
  if (!targetHit) return false;

  switch (sub.trigger) {
    case "any_update":
      return true;
    case "severity_change":
      return event.severityBefore !== undefined && SEVERITY_RANK[event.severityAfter] !== SEVERITY_RANK[event.severityBefore];
    case "evacuation_change":
      return event.hazardType === "evacuation" && event.change !== "created";
    case "answer_available":
      return false;
  }
}

/** One notification per subscription per bulletin version (subscriptionId + bulletinVersion). */
export function dedupeKeyFor(subscriptionId: string, bulletinId: string, versionNumber: number): string {
  return `${subscriptionId}:${bulletinId}:v${versionNumber}`;
}

export function answerDedupeKeyFor(subscriptionId: string, questionId: string): string {
  return `${subscriptionId}:question:${questionId}`;
}

/**
 * Per subscription: no more than one notification in the last 15 minutes and four in the last hour.
 * `recentSentAt` are the creation times of earlier notifications that were not rate-limited themselves.
 */
export function rateLimited(recentSentAt: number[], now: number): false | "min_interval" | "hourly_cap" {
  if (recentSentAt.some((at) => now - at < DEFAULTS.notifyMinIntervalMs)) return "min_interval";
  if (recentSentAt.filter((at) => now - at < 3_600_000).length >= DEFAULTS.notifyMaxPerHour) return "hourly_cap";
  return false;
}

export const RATE_LIMITED_ERROR = "rate_limited";
