// [B] Retention rules (defaults in src/config/defaults.ts, overridable from env):
// - turns of finalized anonymous calls: ANON_TRANSCRIPT_TTL_HOURS (7 days),
// - anonymous caller memory (caller row, its calls and summaries): ANON_MEMORY_TTL_DAYS (30 days),
// - account data: kept until the account deletes it,
// - anything an active subscription needs (its caller row): kept while the subscription is active.
import type { Config } from "../config/env";
import { DEFAULTS } from "../config/defaults";

export type RetentionCutoffs = {
  /** Delete turns of finalized calls with no account that finalized before this time. */
  anonymousTranscriptsBefore: number;
  /** Forget anonymous callers, calls and summaries older than this. */
  anonymousMemoryBefore: number;
};

export function anonTranscriptTtlMs(config: Pick<Config, "ANON_TRANSCRIPT_TTL_HOURS">): number {
  return config.ANON_TRANSCRIPT_TTL_HOURS * 3_600_000;
}

export function anonMemoryTtlMs(config: Pick<Config, "ANON_MEMORY_TTL_DAYS">): number {
  return config.ANON_MEMORY_TTL_DAYS * 86_400_000;
}

export function retentionCutoffs(config: Pick<Config, "ANON_TRANSCRIPT_TTL_HOURS" | "ANON_MEMORY_TTL_DAYS">, now: number): RetentionCutoffs {
  return {
    anonymousTranscriptsBefore: now - anonTranscriptTtlMs(config),
    anonymousMemoryBefore: now - anonMemoryTtlMs(config),
  };
}

/** When an anonymous caller's memory expires, counted from their last call. Accounts never expire here. */
export function callerMemoryExpiresAt(config: Pick<Config, "ANON_MEMORY_TTL_DAYS">, lastCallAt: number, hasVerifiedAccount: boolean): number | undefined {
  return hasVerifiedAccount ? undefined : lastCallAt + anonMemoryTtlMs(config);
}

/** Calls that never sent /voice/session/end are finalized by the sweeper after this much silence. */
export const STALE_SESSION_MS = DEFAULTS.staleSessionMs;
