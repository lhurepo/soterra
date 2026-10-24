// [I] Crisis-mode trigger rule (stub). Crisis mode shortens polling intervals and reverts on its own.
// TODO(I): tune the rule and the duration; consider unverified social spikes as a signal only.
import type { NormalizedBulletin } from "../contracts";

export const CRISIS_DURATION_MS = 6 * 60 * 60_000;

const CRISIS_EVENT_PATTERNS = [
  /evacuation order/i,
  /tsunami warning/i,
  /hurricane warning/i,
  /fire warning/i,
  /flash flood emergency/i,
  /extreme wind warning/i,
];

export function triggersCrisis(b: NormalizedBulletin, ingestStates: string[]): boolean {
  if (b.trustTier !== "official" || b.status !== "actual" || b.isFixture) return false;
  const inScope = b.areas.some((a) => ingestStates.includes(a.state));
  if (!inScope) return false;
  if (b.severity === "extreme" || b.severity === "severe") return true;
  return CRISIS_EVENT_PATTERNS.some((re) => re.test(b.title));
}
