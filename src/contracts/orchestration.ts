// [S] Orchestration internals shared by backend modules (types locked, logic in src/orchestration).
import { z } from "zod";
import { AreaRef, EpochMs, HazardType, Language, Severity, TrustTier } from "./common";
import { TimeBasis } from "./ingestion";
import { ReplyKind } from "./voice";

/**
 * How we know who is calling. Caller ID alone ("caller_id") can be spoofed, so stored personal
 * details are never exposed to the model on that basis (see src/memory/callerContext.ts).
 */
// "verified_phone": this call was placed BY us to the caller's number (callback check), so whoever answered holds the phone.
// Valid for that one call only. "verified_account": the number is linked to an account in the app.
export const IdentityLevel = z.enum(["anonymous", "caller_id", "verified_phone", "verified_account"]);

export const CallerContext = z.object({
  callerId: z.string().optional(),
  accountId: z.string().optional(),
  identity: IdentityLevel,
  language: Language,
  knownArea: AreaRef.optional(),
  needs: z.array(z.string()).optional(),
  /** Free text from the linked account's profile (accommodations, medical conditions). verified_account only. */
  personalContext: z.string().optional(),
  lastCallSummary: z.string().optional(),
  activeSubscriptions: z.array(z.string()).optional(),
  /**
   * Public incident keys (e.g. "ridgeview-fire-demo") the caller asked about on a recent call. Safe to
   * use on caller ID alone: they name public incidents, never the caller's address, needs or household.
   */
  recentIncidentKeys: z.array(z.string()).optional(),
});
export type CallerContext = z.infer<typeof CallerContext>;

export const RetrievalQuery = z.object({
  text: z.string(),
  language: Language,
  area: AreaRef.optional(),
  hazardTypes: z.array(HazardType).optional(),
  topK: z.number().int().positive().max(20),
  now: EpochMs,
});
export type RetrievalQuery = z.infer<typeof RetrievalQuery>;

/**
 * How well other independent sources back a retrieved chunk (src/retrieval/corroboration.ts):
 * "confirmed" = another source from a different independence group reports the same incident,
 * "differs" = such a source reports different figures, "single" = no other independent source was found.
 */
export const Corroboration = z.object({
  tier: z.enum(["confirmed", "single", "differs"]),
  /** Full names of the other independent sources that matched (empty for "single"). */
  sources: z.array(z.string()),
});
export type Corroboration = z.infer<typeof Corroboration>;

export const RetrievedChunk = z.object({
  chunkId: z.string(),
  bulletinId: z.string(),
  text: z.string(),
  sourceId: z.string(),
  sourceName: z.string(),
  url: z.string(),
  trustTier: TrustTier,
  issuedAt: EpochMs,
  updatedAt: EpochMs.optional(),
  expiresAt: EpochMs.optional(),
  areas: z.array(AreaRef),
  hazardType: HazardType,
  severity: Severity,
  incidentKey: z.string().optional(),
  isFixture: z.boolean().optional(),
  /** Position within the bulletin's chunks; lets retrieval add the next chunk of the same bulletin. */
  chunkIndex: z.number().int().nonnegative().optional(),
  /** What issuedAt/updatedAt mean: "issued" (default), "page_updated" (a scraped page says so) or "observed" (when we checked). */
  timeBasis: TimeBasis.optional(),
  /** Set by retrieval when it compared this chunk's incident with other sources. Absent = not compared. */
  corroboration: Corroboration.optional(),
  score: z.number(),
});
export type RetrievedChunk = z.infer<typeof RetrievedChunk>;

export const FollowUpRequest = z.object({
  targetKind: z.enum(["incident", "area", "question"]),
  incidentKey: z.string().optional(),
  area: AreaRef.optional(),
  trigger: z.enum(["any_update", "severity_change", "evacuation_change", "answer_available"]),
  /** Additive (2026-10-24): how the caller wants updates. Absent = their saved preference, else a phone call. */
  channel: z.enum(["phone_call", "sms"]).optional(),
  /** Additive (2026-10-24): time-based updates ("every 2 hours"). Clamped to 60 minutes–24 hours. */
  intervalMinutes: z.number().positive().optional(),
});
export type FollowUpRequest = z.infer<typeof FollowUpRequest>;

/** What the LLM returns. The backend never trusts it: see src/orchestration/grounding.ts. */
export const AnswerDraft = z.object({
  kind: ReplyKind,
  reply: z.string(),
  citedChunkIds: z.array(z.string()),
  followUpRequest: FollowUpRequest.optional(),
  unansweredQuestion: z.string().optional(),
  detectedArea: AreaRef.optional(),
  endCall: z.boolean(),
});
export type AnswerDraft = z.infer<typeof AnswerDraft>;
