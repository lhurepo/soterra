// [B] Retention rules (defaults from env): anonymous transcripts 72 h, anonymous caller memory 30 days,
// account data until deleted, and whatever an active subscription needs while it is active.
import type { Config } from "../config/env";

export type RetentionCutoffs = {
  /** Delete turns of finalized calls with no account that started before this time. */
  anonymousTranscriptsBefore: number;
  /** Forget anonymous callers (no account link, no active subscription) last seen before this time. */
  anonymousCallersBefore: number;
};

export function retentionCutoffs(config: Config, now: number): RetentionCutoffs {
  return {
    anonymousTranscriptsBefore: now - config.ANON_TRANSCRIPT_TTL_HOURS * 3_600_000,
    anonymousCallersBefore: now - config.ANON_MEMORY_TTL_DAYS * 86_400_000,
  };
}

/** Calls that never sent /voice/session/end are finalized by the sweeper after this much silence. */
export const STALE_SESSION_MS = 15 * 60_000;
