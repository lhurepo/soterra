// [I] Crisis-mode rules. Crisis shortens polling intervals; it is entered only from official bulletins,
// is extended while a triggering bulletin stays active, and reverts on its own at expiresAt.
// Unverified signals never trigger it.

export const CRISIS_DURATION_MS = 6 * 60 * 60_000;

/** Event names (matched against the title) that trigger crisis mode regardless of severity. */
export const CRISIS_EVENT_PATTERNS = [
  /evacuation order/i,
  /tsunami warning/i,
  /hurricane warning/i,
  /fire warning/i,
  /flash flood emergency/i,
  /extreme wind warning/i,
  /tornado emergency/i,
  /storm surge warning/i,
];

export type CrisisCandidate = {
  trustTier: "official" | "official_social" | "unverified";
  status: "actual" | "test" | "exercise" | "cancelled";
  isActive: boolean;
  isFixture: boolean;
  severity: "extreme" | "severe" | "moderate" | "minor" | "unknown";
  title: string;
  states: string[];
};

/**
 * Fixture bulletins only count when the deployment is serving fixtures (a demo deployment);
 * otherwise fictional data could change polling on a real deployment.
 */
export function triggersCrisis(b: CrisisCandidate, ingestStates: string[], serveFixtures: boolean): boolean {
  if (b.trustTier !== "official" || b.status !== "actual" || !b.isActive) return false;
  if (b.isFixture && !serveFixtures) return false;
  if (!b.states.some((s) => ingestStates.includes(s))) return false;
  if (b.severity === "extreme" || b.severity === "severe") return true;
  return CRISIS_EVENT_PATTERNS.some((re) => re.test(b.title));
}

export type CrisisState = { mode: "normal" | "crisis"; since: number; expiresAt?: number; reason: string; triggeredBy?: string };

/** Next state after seeing a triggering bulletin: enter crisis, or extend the current crisis. */
export function enterOrExtendCrisis(current: CrisisState | null, reason: string, triggeredBy: string, now: number): CrisisState {
  const expiresAt = now + CRISIS_DURATION_MS;
  if (current?.mode === "crisis" && (current.expiresAt === undefined || current.expiresAt > now)) {
    return { ...current, expiresAt: Math.max(current.expiresAt ?? 0, expiresAt) };
  }
  return { mode: "crisis", since: now, expiresAt, reason, triggeredBy };
}

export function crisisExpired(current: CrisisState | null, now: number): boolean {
  return current?.mode === "crisis" && current.expiresAt !== undefined && current.expiresAt <= now;
}
