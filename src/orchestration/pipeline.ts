// [B] The turn pipeline. Convex-free and side-effect-free: convex/voice.ts loads the call state and
// persists the user turn (one mutation), calls runTurn with a retriever and an LLM, then applies the
// returned effects and stores the reply (one mutation).
// Order: danger check (no retrieval, no LLM) → deterministic intents (stop updates, transcript consent)
// → area resolution → retrieval → prompt → LLM with timeout → parse → grounding → effects plan.
import type { AreaRef, CallerContext, Citation, FollowUpRequest, HazardType, ReplyKind, RetrievedChunk } from "../contracts";
import { DEFAULTS, supportedLanguage } from "../config/defaults";
import { t, tf } from "../config/strings";
import { toLlmContext } from "../memory/callerContext";
import { isLlmError, withTimeout } from "../providers/llm/errors";
import type { LlmClient, LlmMessage } from "../providers/llm/types";
import type { RetrievalRequest, RetrievalResult } from "../retrieval/retriever";
import { resolveArea, type AreaCandidate, type AreaSource } from "./area";
import { dangerLanguage } from "./danger";
import { enforceGrounding } from "./grounding";
import { asksToStopUpdates, declinesTranscript } from "./intents";
import { buildTurnRequest, parseDraft } from "./prompt";

export type TurnInput = {
  utterance: string;
  /** The language the voice agent reported for this turn (BCP-47). */
  language: string;
  /** When the backend started handling the request; timings are measured from here. */
  startedAt?: number;
};

/** What the backend knows about the call when the turn starts (loaded by calls.beginTurn). */
export type TurnState = {
  hasCallerPhone: boolean;
  callArea?: AreaRef;
  /** The full, server-side caller context cached on the call. Filtered before the model sees it. */
  context: CallerContext;
  areaCandidates: AreaCandidate[];
  history: LlmMessage[];
  /** The caller's previous utterances in this call (most recent last), used to widen retrieval. */
  recentCallerUtterances: string[];
  /** Whether this call already has an open unanswered question (for "call me when you know"). */
  hasOpenQuestion: boolean;
  /** Incident keys cited earlier in this call, most recent first ("call me if it changes" refers to them). */
  callIncidentKeys?: string[];
};

export type TurnDeps = {
  now: () => number;
  llm: LlmClient;
  model: string;
  timeoutMs?: number;
  retrieve: (request: RetrievalRequest) => Promise<RetrievalResult>;
};

/** Side effects for calls.completeTurn to apply in one transaction. */
export type TurnEffects = {
  recordUnanswered?: { text: string; area?: AreaRef };
  createSubscription?: FollowUpRequest;
  cancelSubscriptions?: true;
  setKnownArea?: AreaRef;
  declineTranscript?: true;
};

export type TurnOutcome = {
  kind: ReplyKind;
  reply: string;
  /** The reply language actually used: "en" or "es". */
  language: string;
  citations: Citation[];
  endCall: boolean;
  degraded?: boolean;
  effects: TurnEffects;
  retrievedChunkIds: string[];
  citedChunkIds: string[];
  /** Copied from the cited chunks for caller memory and summaries (chunk rows are rewritten on updates). */
  citedIncidentKeys: string[];
  citedHazards: HazardType[];
  retriever?: string;
  retrievedAt?: number;
  /** Set only when the LLM was actually called. */
  llmModel?: string;
  /** Why the turn degraded or was rewritten (logged and stored, never spoken). */
  errorCode?: string;
  areaSource: AreaSource;
  timingsMs: Record<string, number>;
};

function followUpTopic(request: FollowUpRequest, language: string): string {
  if (request.targetKind === "question" || request.trigger === "answer_available") return t("topicQuestion", language);
  if (request.targetKind === "area" && request.area) return tf("topicArea", language, { area: request.area.label });
  if (request.trigger === "evacuation_change") return t("topicEvacuation", language);
  if (request.trigger === "severity_change") return t("topicSeverity", language);
  return t("topicIncident", language);
}

/** Fills in a usable target, or returns null when there is nothing to watch (no incident, area or question). */
export function completeFollowUp(
  requested: FollowUpRequest | undefined,
  ctx: { retrieved: RetrievedChunk[]; area?: AreaRef; hasOpenQuestion: boolean; recentIncidentKeys?: string[] },
): FollowUpRequest | null {
  const incidentKey =
    requested?.incidentKey ?? ctx.retrieved.find((c) => c.incidentKey)?.incidentKey ?? ctx.recentIncidentKeys?.[0];
  const trigger = requested?.trigger ?? "any_update";
  if (requested?.targetKind === "question" || trigger === "answer_available") {
    if (ctx.hasOpenQuestion) return { targetKind: "question", trigger: "answer_available" };
  }
  const nonQuestionTrigger = trigger === "answer_available" ? "any_update" : trigger;
  if (requested?.targetKind === "area" && (requested.area ?? ctx.area)) {
    return { targetKind: "area", area: requested.area ?? ctx.area, trigger: nonQuestionTrigger };
  }
  if (incidentKey) return { targetKind: "incident", incidentKey, trigger: nonQuestionTrigger };
  if (ctx.area) return { targetKind: "area", area: ctx.area, trigger: nonQuestionTrigger };
  return null;
}

export async function runTurn(input: TurnInput, state: TurnState, deps: TurnDeps): Promise<TurnOutcome> {
  const startedAt = input.startedAt ?? deps.now();
  const language = supportedLanguage(input.language);
  const timingsMs: Record<string, number> = {};
  type Defaulted = "effects" | "retrievedChunkIds" | "citedChunkIds" | "citedIncidentKeys" | "citedHazards" | "areaSource";
  const finish = (o: Omit<TurnOutcome, "timingsMs" | "language" | Defaulted> & Partial<Pick<TurnOutcome, Defaulted>>): TurnOutcome => ({
    effects: {},
    retrievedChunkIds: [],
    citedChunkIds: [],
    citedIncidentKeys: [],
    citedHazards: [],
    areaSource: "none",
    ...o,
    language,
    timingsMs: { ...timingsMs, total: deps.now() - startedAt },
  });
  const simple = (kind: ReplyKind, reply: string, effects: TurnEffects = {}) => finish({ kind, reply, citations: [], endCall: false, effects });

  // 1. Danger first: deterministic, before retrieval and the LLM, and its reply needs neither.
  const inDangerIn = dangerLanguage(input.utterance, language === "es" ? "es" : "en");
  if (inDangerIn) return { ...simple("safety", t("safety", inDangerIn)), language: inDangerIn };

  // 2. Deterministic intents that must not depend on the model.
  if (asksToStopUpdates(input.utterance)) {
    return state.hasCallerPhone
      ? simple("followup", t("updatesStopped", language), { cancelSubscriptions: true })
      : simple("followup", t("callbackDeclined", language));
  }
  if (declinesTranscript(input.utterance)) return simple("smalltalk", t("consentDeclined", language), { declineTranscript: true });

  // 3. Area for this turn.
  const effects: TurnEffects = {};
  const resolved = resolveArea({
    utterance: input.utterance,
    candidates: state.areaCandidates,
    callArea: state.callArea,
    contextArea: state.context.knownArea,
  });
  if (resolved.area && (resolved.source === "zip" || resolved.source === "place")) effects.setKnownArea = resolved.area;

  // 4–6. Retrieval, prompt, model. A failure here is spoken as the safe fallback, never as an error.
  let retrieval: RetrievalResult | undefined;
  const failed = (errorCode: string) =>
    finish({
      kind: "no_info",
      reply: t("fallback", language),
      citations: [],
      endCall: false,
      degraded: true,
      errorCode,
      effects,
      areaSource: resolved.source,
      retrievedChunkIds: retrieval?.chunks.map((c) => c.chunkId) ?? [],
      retriever: retrieval?.retriever,
      retrievedAt: retrieval?.retrievedAt,
    });

  const t0 = deps.now();
  try {
    retrieval = await deps.retrieve({
      text: input.utterance,
      contextText: state.recentCallerUtterances.slice(-2).join(" ") || undefined,
      language,
      area: resolved.area,
      topK: DEFAULTS.retrievalMaxChunks,
      now: t0,
    });
  } catch (err) {
    console.error("[turn] retrieval failed:", err);
    timingsMs.retrieval = deps.now() - t0;
    return failed("retrieval_failed");
  }
  timingsMs.retrieval = deps.now() - t0;
  const retrieved = retrieval.chunks;

  const t1 = deps.now();
  timingsMs.preLlm = t1 - startedAt;
  const request = buildTurnRequest(
    {
      utterance: input.utterance,
      language,
      retrieved,
      context: toLlmContext(state.context),
      area: resolved.area,
      history: state.history,
      now: t1,
    },
    deps.model,
  );
  let draft;
  let llmModel: string | undefined = deps.model;
  try {
    const attempt = async () => {
      const response = await withTimeout(deps.llm.complete(request), deps.timeoutMs ?? DEFAULTS.llmTimeoutMs);
      llmModel = response.model;
      return parseDraft(response);
    };
    try {
      draft = await attempt();
    } catch (err) {
      // Invalid structured output is usually a one-off and the retry is fast; slow failures are not retried.
      if (!(isLlmError(err) && err.code === "invalid_output")) throw err;
      console.warn("[turn] invalid LLM output, retrying once");
      draft = await attempt();
    }
  } catch (err) {
    timingsMs.llm = deps.now() - t1;
    const code = isLlmError(err) ? `llm_${err.code}` : "llm_failed";
    console.error(`[turn] LLM failed (${code}):`, err);
    return { ...failed(code), llmModel };
  }
  timingsMs.llm = deps.now() - t1;

  // 7. Grounding enforcement.
  const g = enforceGrounding({ draft, retrieved, utterance: input.utterance, language, now: deps.now() });
  let kind = g.kind;
  let reply = g.reply;
  let endCall = g.endCall;

  // 8. Effects.
  if (g.unansweredQuestion !== undefined) effects.recordUnanswered = { text: g.unansweredQuestion, area: resolved.area };
  if (draft.detectedArea && !effects.setKnownArea) effects.setKnownArea = draft.detectedArea;
  if (kind === "followup") {
    if (!state.hasCallerPhone) {
      reply = t("callbackDeclined", language);
    } else {
      const request = completeFollowUp(draft.followUpRequest, {
        retrieved,
        area: resolved.area ?? draft.detectedArea,
        hasOpenQuestion: state.hasOpenQuestion,
        recentIncidentKeys: [...(state.callIncidentKeys ?? []), ...(state.context.recentIncidentKeys ?? [])],
      });
      if (request) {
        effects.createSubscription = request;
        const hours = Math.round(DEFAULTS.subscriptionTtlMs / 3_600_000);
        reply = `${tf("followupCreated", language, { topic: followUpTopic(request, language), hours })} ${t("stopUpdates", language)}`;
      } else {
        kind = "clarify";
        reply = t("clarifyArea", language);
      }
    }
  }
  if (kind === "goodbye") {
    reply = t("goodbye", language);
    endCall = true;
  }

  return finish({
    kind,
    reply,
    citations: g.citations,
    endCall,
    degraded: g.rewritten || undefined,
    errorCode: g.issue,
    effects,
    areaSource: resolved.source,
    retrievedChunkIds: retrieved.map((c) => c.chunkId),
    citedChunkIds: g.citedChunks.map((c) => c.chunkId),
    citedIncidentKeys: [...new Set(g.citedChunks.flatMap((c) => (c.incidentKey ? [c.incidentKey] : [])))],
    citedHazards: [...new Set(g.citedChunks.map((c) => c.hazardType))],
    retriever: retrieval.retriever,
    retrievedAt: retrieval.retrievedAt,
    llmModel,
  });
}
