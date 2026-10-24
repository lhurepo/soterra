// [I] Which sources are due on this tick. Convex crons are static, so the one-minute tick holds the logic.
import type { SourceDefinition } from "../contracts";

export type SourceRuntime = Pick<SourceDefinition, "sourceId" | "enabled" | "normalIntervalMin" | "crisisIntervalMin"> & {
  lastFetchedAt?: number;
};

export function dueSources(sources: SourceRuntime[], mode: "normal" | "crisis", now: number): string[] {
  return sources
    .filter((s) => s.enabled)
    .filter((s) => {
      const intervalMs = (mode === "crisis" ? s.crisisIntervalMin : s.normalIntervalMin) * 60_000;
      // 5 s of slack so a 1-minute source is not skipped by cron jitter.
      return s.lastFetchedAt === undefined || now - s.lastFetchedAt >= intervalMs - 5_000;
    })
    .map((s) => s.sourceId);
}
