// [B] /voice/* HTTP handlers (docs/contracts/live-call.md). Thin: parse, authorize, call src/orchestration.
import {
  CONTRACT_VERSION,
  SessionEndRequest,
  SessionStartRequest,
  TurnRequest,
  type SessionEndResponse,
  type SessionStartResponse,
  type TurnResponse,
} from "../src/contracts";
import { runTurn } from "../src/orchestration/pipeline";
import { selectLlm } from "../src/providers/llm";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { httpAction, type ActionCtx } from "./_generated/server";
import { config, errorResponse, json, parseBody, requireVoiceAuth } from "./lib/http";

export const sessionStart = httpAction(async (ctx, req) => {
  const cfg = config();
  const denied = requireVoiceAuth(req, cfg);
  if (denied) return denied;
  const body = await parseBody(req, SessionStartRequest);
  if (!body.ok) return body.response;
  const { contractVersion: _v, provider: _p, ...args } = body.data;
  const session = await ctx.runMutation(internal.calls.startSession, args);
  const response: SessionStartResponse = {
    contractVersion: CONTRACT_VERSION,
    sessionId: session.sessionId,
    language: session.language,
    greeting: session.greeting,
  };
  return json(response);
});

async function resolveOrStart(
  ctx: ActionCtx,
  ref: { sessionId?: string; providerCallId?: string },
  startedAt: number,
  language: string,
): Promise<Doc<"calls"> | null> {
  const call = await ctx.runQuery(internal.calls.resolveSession, ref);
  if (call || !ref.providerCallId) return call;
  // A turn for an unknown providerCallId lazily starts the session (e.g. the caller spoke before start finished).
  const started = await ctx.runMutation(internal.calls.startSession, {
    providerCallId: ref.providerCallId,
    direction: "inbound",
    languageHint: language,
    startedAt,
  });
  return await ctx.runQuery(internal.calls.resolveSession, { sessionId: started.sessionId });
}

export const turn = httpAction(async (ctx, req) => {
  const cfg = config();
  const denied = requireVoiceAuth(req, cfg);
  if (denied) return denied;
  const body = await parseBody(req, TurnRequest);
  if (!body.ok) return body.response;
  const t = body.data;

  const call = await resolveOrStart(ctx, { sessionId: t.sessionId, providerCallId: t.providerCallId }, t.receivedAt, t.language);
  if (!call) return errorResponse(404, "not_found", "unknown session");

  const begun = await ctx.runMutation(internal.calls.beginTurn, {
    callId: call._id,
    turnIndex: t.turnIndex,
    utterance: t.utterance,
    language: t.language,
    receivedAt: t.receivedAt,
    interruptedPrevious: t.interruptedPrevious,
  });

  const respond = (r: Omit<TurnResponse, "contractVersion" | "sessionId" | "turnIndex" | "language">) =>
    json({ contractVersion: CONTRACT_VERSION, sessionId: call._id, turnIndex: t.turnIndex, language: t.language, ...r } satisfies TurnResponse);

  if (begun.status === "replay") return respond(begun.response);

  const outcome = await runTurn(
    { utterance: t.utterance, language: t.language },
    {
      now: Date.now,
      llm: selectLlm(cfg),
      model: cfg.CLAUDE_FAST_MODEL,
      loadContext: () => ctx.runQuery(internal.memory.loadCallerContext, { callId: call._id }),
      loadHistory: () => ctx.runQuery(internal.calls.recentHistory, { callId: call._id, beforeTurnIndex: t.turnIndex, limit: 6 }),
      // TODO(B): RETRIEVER=moss → createMossRetriever with Convex fallback (src/retrieval/retriever.ts).
      retrieve: (q) =>
        ctx.runQuery(internal.retrieval.search, {
          text: q.text,
          area: q.area,
          topK: q.topK,
          now: q.now,
          serveFixtures: cfg.SERVE_FIXTURES,
        }),
      recordUnanswered: (q) =>
        ctx.runMutation(internal.unanswered.record, { callId: call._id, turnIndex: t.turnIndex, ...q }),
      createSubscription: (request, language) =>
        ctx.runMutation(internal.subscriptions.createFromCall, { callId: call._id, language, request }),
      declineTranscript: () => ctx.runMutation(internal.calls.declineTranscript, { callId: call._id }),
    },
  );

  const stored = {
    reply: outcome.reply,
    kind: outcome.kind,
    citations: outcome.citations,
    endCall: outcome.endCall,
    unansweredQuestionId: outcome.unansweredQuestionId,
    subscriptionId: outcome.subscriptionId,
    degraded: outcome.degraded,
    timingsMs: outcome.timingsMs,
  };
  await ctx.runMutation(internal.calls.completeTurn, {
    turnId: begun.turnId,
    response: stored,
    retrievedChunkIds: outcome.retrievedChunkIds,
    citedChunkIds: outcome.citedChunkIds,
  });
  return respond(stored);
});

export const sessionEnd = httpAction(async (ctx, req) => {
  const cfg = config();
  const denied = requireVoiceAuth(req, cfg);
  if (denied) return denied;
  const body = await parseBody(req, SessionEndRequest);
  if (!body.ok) return body.response;
  const call = await ctx.runQuery(internal.calls.resolveSession, {
    sessionId: body.data.sessionId,
    providerCallId: body.data.providerCallId,
  });
  if (!call) return errorResponse(404, "not_found", "unknown session");
  await ctx.runMutation(internal.calls.endSession, { callId: call._id, endedAt: body.data.endedAt, reason: body.data.reason });
  const response: SessionEndResponse = { contractVersion: CONTRACT_VERSION, ok: true, callId: call._id };
  return json(response);
});
