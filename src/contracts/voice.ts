// [S] Voice ⇄ backend HTTP contract (docs/contracts/live-call.md). Mirrored in voice/soterra_voice/models.py.
import { z } from "zod";
import { Citation, E164, EpochMs, Language } from "./common";

const ContractVersion = z.string().min(1);

export const CallDirection = z.enum(["inbound", "outbound"]);

export const ReplyKind = z.enum([
  "answer",
  "no_info",
  "clarify",
  "safety",
  "smalltalk",
  "followup",
  "goodbye",
]);
export type ReplyKind = z.infer<typeof ReplyKind>;

export const SessionStartRequest = z.object({
  contractVersion: ContractVersion,
  provider: z.literal("cartesia"),
  providerCallId: z.string().min(1),
  direction: CallDirection,
  /** Absent when the caller withheld their number. */
  callerPhone: E164.optional(),
  calledPhone: E164.optional(),
  languageHint: Language.optional(),
  /** Outbound callbacks only: the notification this call delivers. */
  notificationId: z.string().optional(),
  /**
   * Additive (2026-10-24): Cartesia's agent_call_id (Line CallRequest.agent_call_id). For outbound callbacks it
   * equals the id the outbound-call API returned, which the backend stored as the notification's providerRef,
   * so the call is tied to its notification even if notificationId does not reach the agent.
   */
  providerAgentCallId: z.string().optional(),
  startedAt: EpochMs,
});
export type SessionStartRequest = z.infer<typeof SessionStartRequest>;

export const SessionStartResponse = z.object({
  contractVersion: ContractVersion,
  sessionId: z.string().min(1),
  language: Language,
  /** Speakable. Includes the one-sentence transcription notice; for outbound calls it carries the update. */
  greeting: z.string().min(1),
});
export type SessionStartResponse = z.infer<typeof SessionStartResponse>;

const SessionRef = z.object({
  sessionId: z.string().min(1).optional(),
  providerCallId: z.string().min(1).optional(),
});
const requireSessionRef = (v: { sessionId?: string; providerCallId?: string }) =>
  v.sessionId !== undefined || v.providerCallId !== undefined;
const sessionRefMessage = { message: "sessionId or providerCallId is required" };

export const TurnRequest = z
  .object({
    contractVersion: ContractVersion,
    turnIndex: z.number().int().nonnegative(),
    utterance: z.string(),
    language: Language,
    /** True when the caller barged in over the previous reply. */
    interruptedPrevious: z.boolean().optional(),
    receivedAt: EpochMs,
  })
  .extend(SessionRef.shape)
  .refine(requireSessionRef, sessionRefMessage);
export type TurnRequest = z.infer<typeof TurnRequest>;

export const TurnResponse = z.object({
  contractVersion: ContractVersion,
  sessionId: z.string().min(1),
  turnIndex: z.number().int().nonnegative(),
  reply: z.string().min(1),
  language: Language,
  kind: ReplyKind,
  citations: z.array(Citation),
  endCall: z.boolean(),
  unansweredQuestionId: z.string().optional(),
  subscriptionId: z.string().optional(),
  /** True when the backend fell back to a safe reply because a provider failed. */
  degraded: z.boolean().optional(),
  timingsMs: z.record(z.string(), z.number()).optional(),
});
export type TurnResponse = z.infer<typeof TurnResponse>;

export const EndReason = z.enum(["caller_hangup", "agent_end", "transfer", "error", "timeout"]);
export type EndReason = z.infer<typeof EndReason>;

export const SessionEndRequest = z
  .object({
    contractVersion: ContractVersion,
    endedAt: EpochMs,
    reason: EndReason,
  })
  .extend(SessionRef.shape)
  .refine(requireSessionRef, sessionRefMessage);
export type SessionEndRequest = z.infer<typeof SessionEndRequest>;

export const SessionEndResponse = z.object({
  contractVersion: ContractVersion,
  ok: z.literal(true),
  callId: z.string().min(1),
});
export type SessionEndResponse = z.infer<typeof SessionEndResponse>;

export const ErrorCode = z.enum([
  "unauthorized",
  "bad_request",
  "contract_version_mismatch",
  "not_found",
  "internal",
]);
export const ErrorResponse = z.object({
  error: z.object({ code: ErrorCode, message: z.string() }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const IntegrationStatus = z.enum(["live", "mock", "unconfigured"]);
export type IntegrationStatus = z.infer<typeof IntegrationStatus>;

export const HealthResponse = z.object({
  contractVersion: ContractVersion,
  ok: z.boolean(),
  integrations: z.record(z.string(), IntegrationStatus),
  flags: z.record(z.string(), z.boolean()).optional(),
  now: EpochMs,
});
export type HealthResponse = z.infer<typeof HealthResponse>;
