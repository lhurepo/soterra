// [S] Orchestration internals shared by backend modules (types locked, logic in src/orchestration).
import { z } from "zod";
import { AreaRef, EpochMs, HazardType, Language, Severity, TrustTier } from "./common";
import { ReplyKind } from "./voice";

/**
 * How we know who is calling. Caller ID alone ("caller_id") can be spoofed, so stored personal
 * details are never exposed to the model on that basis (see src/memory/callerContext.ts).
 */
export const IdentityLevel = z.enum(["anonymous", "caller_id", "verified_account"]);

export const CallerContext = z.object({
  callerId: z.string().optional(),
  accountId: z.string().optional(),
  identity: IdentityLevel,
  language: Language,
  knownArea: AreaRef.optional(),
  needs: z.array(z.string()).optional(),
  lastCallSummary: z.string().optional(),
  activeSubscriptions: z.array(z.string()).optional(),
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
  score: z.number(),
});
export type RetrievedChunk = z.infer<typeof RetrievedChunk>;

export const FollowUpRequest = z.object({
  targetKind: z.enum(["incident", "area", "question"]),
  incidentKey: z.string().optional(),
  area: AreaRef.optional(),
  trigger: z.enum(["any_update", "severity_change", "evacuation_change", "answer_available"]),
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
