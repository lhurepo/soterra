// [B] Backend defaults in one place (listed in docs/backend.md). Durations are milliseconds.
// TTLs that operators may tune per deployment are also read from env (src/config/env.ts).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const DEFAULTS = {
  /** Turns of finalized anonymous calls are deleted after this (env ANON_TRANSCRIPT_TTL_HOURS). */
  anonTranscriptTtlMs: 7 * DAY,
  /** Anonymous caller memory (caller row, summaries, call rows) is forgotten after this (env ANON_MEMORY_TTL_DAYS). */
  anonMemoryTtlMs: 30 * DAY,
  /** A previous call's summary is only used as caller context while it is this recent. */
  lastSummaryTtlMs: 7 * DAY,
  /** Follow-up subscriptions created on a call expire after this; nothing may last longer than the max. */
  subscriptionTtlMs: 24 * HOUR,
  subscriptionMaxTtlMs: 72 * HOUR,
  /** Per subscription: at most one notification per window, and at most `notifyMaxPerHour` per hour. */
  notifyMinIntervalMs: 15 * MINUTE,
  notifyMaxPerHour: 4,
  /** When the newest cited source is older than this, the reply says "as of" its time. */
  staleSourceMs: 3 * HOUR,
  /** Sessions silent this long are finalized by the sweeper (docs/contracts/live-call.md says 15 minutes). */
  staleSessionMs: 15 * MINUTE,
  /** LLM limits for call turns. Temperature is kept for reference only: the API rejects it (see DECISIONS.md). */
  llmTimeoutMs: 6_000,
  turnMaxTokens: 300,
  temperature: 0.2,
  summaryMaxTokens: 600,
  summaryTimeoutMs: 20_000,
  /** Retrieval: chunks and approximate token budget for the source blocks in the prompt. */
  retrievalMaxChunks: 6,
  retrievalTokenBudget: 1_500,
  /** Rows deleted per purge mutation (Convex per-transaction limits). */
  purgeBatchSize: 100,
  /** Prior turns given to the model, and the caller-context size cap (≈ 4 characters per token). */
  historyTurns: 6,
  callerContextTokenCap: 300,
  /** How long a call reuses its cached list of active area labels. */
  areaLabelCacheMs: 10 * MINUTE,
  /** Spoken reply length guidance (enforced by the prompt; grounding trims nothing). */
  replyMaxWords: 60,
} as const;

export const SUPPORTED_LANGUAGES = ["en", "es"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** English and Spanish only; any other language gets English. */
export function supportedLanguage(language: string | undefined): SupportedLanguage {
  const primary = language?.toLowerCase().split("-")[0];
  return primary === "es" ? "es" : "en";
}

export function isSupportedLanguage(language: string | undefined): boolean {
  const primary = language?.toLowerCase().split("-")[0];
  return primary === "en" || primary === "es";
}

/** Clamps a requested subscription lifetime to the allowed maximum. */
export function subscriptionTtl(requestedMs?: number): number {
  if (requestedMs === undefined || !Number.isFinite(requestedMs) || requestedMs <= 0) return DEFAULTS.subscriptionTtlMs;
  return Math.min(requestedMs, DEFAULTS.subscriptionMaxTtlMs);
}
