// [B] Subscription matcher rules: does this bulletin event warrant a callback for this subscription?
import type { BulletinEvent, HazardType, Severity, Subscription } from "../contracts";

const SEVERITY_RANK: Record<Severity, number> = { unknown: 0, minor: 1, moderate: 2, severe: 3, extreme: 4 };

export type MatchableEvent = Pick<BulletinEvent, "change" | "incidentKey" | "severityBefore" | "severityAfter"> & {
  hazardType: HazardType;
  areaStates: string[];
  areaCountyFips: string[];
};

export function eventMatches(sub: Pick<Subscription, "target" | "trigger" | "status">, event: MatchableEvent): boolean {
  if (sub.status !== "active") return false;

  const targetHit =
    sub.target.kind === "incident"
      ? sub.target.incidentKey !== undefined && sub.target.incidentKey === event.incidentKey
      : sub.target.kind === "area"
        ? sub.target.area !== undefined &&
          (sub.target.area.countyFips
            ? event.areaCountyFips.includes(sub.target.area.countyFips)
            : event.areaStates.includes(sub.target.area.state))
        : false; // "question" targets are answered by a responder flow, not by bulletin events (TODO(B)).
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

/** One notification per subscription per bulletin version. */
export function dedupeKeyFor(subscriptionId: string, bulletinId: string, versionNumber: number): string {
  return `${subscriptionId}:${bulletinId}:v${versionNumber}`;
}
