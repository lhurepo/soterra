// [B] The turn pipeline. Convex-free: convex/voice.ts persists the user turn, calls runTurn with real
// dependencies, then persists the assistant turn. Order inside: danger check (no LLM) → consent →
// caller context → retrieval → LLM → grounding enforcement → side effects.
import {
  AnswerDraft,
  type CallerContext,
  type Citation,
  type FollowUpRequest,
  type ReplyKind,
  type RetrievalQuery,
  type RetrievedChunk,
} from "../contracts";
import { toLlmContext } from "../memory/callerContext";
import type { LlmClient, LlmMessage, LlmResponse } from "../providers/llm/types";
import { detectDanger } from "./danger";
import { enforceGrounding, type GroundedReply } from "./grounding";
import { declinesTranscript } from "./intents";
import { phrase } from "./phrases";
import { buildTurnRequest } from "./prompt";

export type TurnInput = { utterance: string; language: string };

export type TurnDeps = {
  now: () => number;
  llm: LlmClient;
  model: string;
  loadContext: () => Promise<CallerContext>;
  loadHistory: () => Promise<LlmMessage[]>;
  retrieve: (query: RetrievalQuery) => Promise<RetrievedChunk[]>;
  recordUnanswered: (q: { question: string; language: string; area?: CallerContext["knownArea"] }) => Promise<string>;
  /** Returns null when the caller's number is withheld (no callback possible). */
  createSubscription: (request: FollowUpRequest, language: string) => Promise<string | null>;
  declineTranscript: () => Promise<unknown>;
};

export type TurnOutcome = {
  kind: ReplyKind;
  reply: string;
  citations: Citation[];
  endCall: boolean;
  unansweredQuestionId?: string;
  subscriptionId?: string;
  degraded?: boolean;
  retrievedChunkIds: string[];
  citedChunkIds: string[];
  timingsMs: Record<string, number>;
};

export function parseDraft(response: LlmResponse): AnswerDraft {
  const raw = response.structured ?? JSON.parse(response.text.replace(/^```(json)?|```$/g, "").trim());
  return AnswerDraft.parse(raw);
}

export async function runTurn(input: TurnInput, deps: TurnDeps): Promise<TurnOutcome> {
  const start = deps.now();
  const timingsMs: Record<string, number> = {};
  const done = (o: Omit<TurnOutcome, "timingsMs" | "retrievedChunkIds" | "citedChunkIds"> & Partial<TurnOutcome>): TurnOutcome => ({
    retrievedChunkIds: [],
    citedChunkIds: [],
    ...o,
    timingsMs: { ...timingsMs, total: deps.now() - start },
  });

  // 1. Danger first. Deterministic, before any model call.
  if (detectDanger(input.utterance)) {
    return done({ kind: "safety", reply: phrase("safety", input.language), citations: [], endCall: false });
  }

  // 2. Transcript consent ("summary only") is honoured without the model.
  if (declinesTranscript(input.utterance)) {
    await deps.declineTranscript();
    return done({ kind: "smalltalk", reply: phrase("consentDeclined", input.language), citations: [], endCall: false });
  }

  // 3–5. Context, retrieval, model. Any failure here becomes a safe spoken fallback.
  let retrieved: RetrievedChunk[] = [];
  let context: CallerContext;
  let draft: AnswerDraft;
  try {
    const t0 = deps.now();
    context = await deps.loadContext();
    retrieved = await deps.retrieve({
      text: input.utterance,
      language: input.language,
      area: context.knownArea,
      topK: 5,
      now: deps.now(),
    });
    timingsMs.retrieval = deps.now() - t0;

    const t1 = deps.now();
    const history = await deps.loadHistory();
    const response = await deps.llm.complete(
      buildTurnRequest(
        { utterance: input.utterance, language: input.language, retrieved, context: toLlmContext(context), history },
        deps.model,
      ),
    );
    draft = parseDraft(response);
    timingsMs.llm = deps.now() - t1;
  } catch (err) {
    console.error("[turn] context/retrieval/LLM failed:", err);
    return done({
      kind: "no_info",
      reply: phrase("fallback", input.language),
      citations: [],
      endCall: false,
      degraded: true,
      retrievedChunkIds: retrieved.map((c) => c.chunkId),
    });
  }

  // 6. Grounding enforcement.
  const grounded: GroundedReply = enforceGrounding({ draft, retrieved, utterance: input.utterance, language: input.language });
  const outcome = done({
    kind: grounded.kind,
    reply: grounded.reply,
    citations: grounded.citations,
    endCall: grounded.endCall,
    retrievedChunkIds: retrieved.map((c) => c.chunkId),
    citedChunkIds: grounded.citedChunks.map((c) => c.chunkId),
  });

  // 7. Side effects. A failed side effect never changes what the caller hears about the facts.
  if (grounded.unansweredQuestion !== undefined) {
    try {
      outcome.unansweredQuestionId = await deps.recordUnanswered({
        question: grounded.unansweredQuestion,
        language: input.language,
        area: context.knownArea,
      });
    } catch (err) {
      console.error("[turn] recordUnanswered failed:", err);
      outcome.degraded = true;
    }
  }
  if (grounded.kind === "followup") {
    if (draft.followUpRequest) {
      try {
        const subscriptionId = await deps.createSubscription(draft.followUpRequest, input.language);
        outcome.subscriptionId = subscriptionId ?? undefined;
        outcome.reply = phrase(subscriptionId ? "followupCreated" : "followupNoPhone", input.language);
      } catch (err) {
        console.error("[turn] createSubscription failed:", err);
        outcome.reply = phrase("fallback", input.language);
        outcome.degraded = true;
      }
    } else {
      outcome.reply ||= phrase("fallback", input.language);
    }
  }
  if (grounded.kind === "goodbye") {
    outcome.reply = phrase("goodbye", input.language);
    outcome.endCall = true;
  }
  outcome.timingsMs.total = deps.now() - start;
  return outcome;
}
