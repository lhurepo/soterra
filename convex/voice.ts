// [B] /voice/* HTTP handlers (docs/contracts/live-call.md). Thin: authorize, validate, then
// calls.beginTurn → src/orchestration/pipeline.ts → calls.completeTurn.
// After validation, any internal failure on /voice/turn returns 200 with the canonical fallback reply
// (911 line included) and degraded: true. 4xx/5xx only happen before or during validation, or when a
// session cannot exist (start/end failures, unknown sessionId).
import {
  CONTRACT_VERSION,
  SessionEndRequest,
  SessionStartRequest,
  TurnRequest,
  type SessionEndResponse,
  type SessionStartResponse,
  type TurnResponse,
} from "../src/contracts";
import { DEFAULTS, supportedLanguage } from "../src/config/defaults";
import type { Config } from "../src/config/env";
import { t } from "../src/config/strings";
import { normalizeE164 } from "../src/memory/phone";
import { runTurn, type TurnOutcome } from "../src/orchestration/pipeline";
import { selectLlm } from "../src/providers/llm";
import { withTimeout } from "../src/providers/llm/errors";
import { createMossRetriever } from "../src/providers/moss";
import { createConvexRetriever, withFallback, type RetrievalRequest, type Retriever } from "../src/retrieval/retriever";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, type ActionCtx } from "./_generated/server";
import { config, errorResponse, json, parseBody, requireVoiceAuth } from "./lib/http";

/** Caller IDs arrive in many shapes; normalize to E.164 before validation, and treat "anonymous" as withheld. */
function normalizePhones(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const body = { ...(raw as Record<string, unknown>) };
  for (const key of ["callerPhone", "calledPhone"] as const) {
    if (typeof body[key] === "string") {
      const phone = normalizeE164(body[key] as string);
      if (phone) body[key] = phone;
      else delete body[key];
    } else if (body[key] === null) {
      delete body[key];
    }
  }
  return body;
}

export const sessionStart = httpAction(async (ctx, req) => {
  const cfg = config();
  const denied = requireVoiceAuth(req, cfg);
  if (denied) return denied;
  const body = await parseBody(req, SessionStartRequest, normalizePhones);
  if (!body.ok) return body.response;
  const { contractVersion: _v, provider: _p, ...args } = body.data;
  try {
    const session = await ctx.runMutation(internal.calls.startSession, args);
    const response: SessionStartResponse = {
      contractVersion: CONTRACT_VERSION,
      sessionId: session.sessionId,
      language: session.language,
      greeting: session.greeting,
    };
    return json(response);
  } catch (err) {
    // No session exists, so there is no id to return: the agent speaks its fallback greeting and lazily starts on the first turn.
    console.error("[voice] session start failed:", err);
    return errorResponse(500, "internal", "session start failed");
  }
});

function retrieverFor(ctx: ActionCtx, cfg: Config): Retriever {
  const searchArgs = (q: RetrievalRequest) => ({
    text: q.text,
    contextText: q.contextText,
    area: q.area,
    topK: q.topK,
    now: q.now,
    serveFixtures: cfg.SERVE_FIXTURES,
  });
  const convex = createConvexRetriever((q) => ctx.runQuery(internal.retrieval.search, searchArgs(q)));
  if (cfg.RETRIEVER !== "moss") return convex;
  const moss = createMossRetriever({
    query: async (text, topK) =>
      (await withTimeout(ctx.runAction(internal.mossNode.query, { text, topK }), DEFAULTS.mossTimeoutMs, "Moss query")).hits,
    hydrate: (chunkIds, q) => ctx.runQuery(internal.retrieval.hydrateChunks, { chunkIds, ...searchArgs(q) }),
  });
  return withFallback(moss, convex);
}

type ResponseBody = Omit<TurnResponse, "contractVersion">;

function fallbackOutcome(language: string, errorCode: string, timingsMs: Record<string, number>): TurnOutcome {
  return {
    kind: "no_info",
    reply: t("fallback", language),
    language: supportedLanguage(language),
    citations: [],
    endCall: false,
    degraded: true,
    effects: {},
    retrievedChunkIds: [],
    citedChunkIds: [],
    citedIncidentKeys: [],
    citedHazards: [],
    errorCode,
    areaSource: "none",
    timingsMs,
  };
}

export const turn = httpAction(async (ctx, req) => {
  const startedAt = Date.now();
  const cfg = config();
  const denied = requireVoiceAuth(req, cfg);
  if (denied) return denied;
  const body = await parseBody(req, TurnRequest);
  if (!body.ok) return body.response;
  const tr = body.data;
  const respond = (sessionId: string, r: Omit<ResponseBody, "sessionId" | "turnIndex">) =>
    json({ contractVersion: CONTRACT_VERSION, sessionId, turnIndex: tr.turnIndex, ...r } satisfies TurnResponse);
  const fallbackBody = (o: TurnOutcome) => ({
    reply: o.reply,
    language: o.language,
    kind: o.kind,
    citations: o.citations,
    endCall: o.endCall,
    degraded: true,
    timingsMs: o.timingsMs,
  });

  let begun;
  try {
    begun = await ctx.runMutation(internal.calls.beginTurn, {
      sessionId: tr.sessionId,
      providerCallId: tr.providerCallId,
      turnIndex: tr.turnIndex,
      utterance: tr.utterance,
      language: tr.language,
      receivedAt: tr.receivedAt,
      interruptedPrevious: tr.interruptedPrevious,
    });
  } catch (err) {
    console.error("[voice] beginTurn failed:", err);
    const o = fallbackOutcome(tr.language, "begin_turn_failed", { total: Date.now() - startedAt });
    return respond(tr.sessionId ?? tr.providerCallId ?? "unknown", fallbackBody(o));
  }
  if (begun.status === "not_found") return errorResponse(404, "not_found", "unknown session");
  if (begun.status === "replay") {
    const { language, ...stored } = begun.response;
    return respond(begun.callId, { ...stored, language });
  }
  const contextMs = Date.now() - startedAt;

  let outcome: TurnOutcome;
  try {
    outcome = await runTurn(
      { utterance: tr.utterance, language: tr.language, startedAt },
      begun,
      {
        now: Date.now,
        llm: selectLlm(cfg),
        model: cfg.CLAUDE_FAST_MODEL,
        timeoutMs: DEFAULTS.llmTimeoutMs,
        retrieve: async (q) => {
          const result = await retrieverFor(ctx, cfg).retrieve(q);
          const pinned = begun.pinnedChunkIds ?? [];
          if (pinned.length === 0) return result;
          // An update callback: the bulletin we phoned about is always among the sources, first.
          const extra = await ctx.runQuery(internal.retrieval.hydrateChunks, {
            chunkIds: pinned,
            text: q.text,
            contextText: q.contextText,
            area: q.area,
            topK: q.topK,
            now: q.now,
            serveFixtures: cfg.SERVE_FIXTURES,
          });
          const seen = new Set(extra.map((c) => c.chunkId));
          return { ...result, chunks: [...extra, ...result.chunks.filter((c) => !seen.has(c.chunkId))].slice(0, DEFAULTS.retrievalMaxChunks) };
        },
      },
    );
  } catch (err) {
    console.error("[voice] turn pipeline failed:", err);
    outcome = fallbackOutcome(tr.language, "pipeline_failed", { total: Date.now() - startedAt });
  }
  outcome.timingsMs = { context: contextMs, ...outcome.timingsMs };

  const store = (o: TurnOutcome) =>
    ctx.runMutation(internal.calls.completeTurn, {
      turnId: begun.turnId,
      reply: o.reply,
      replyLanguage: o.language,
      kind: o.kind,
      citations: o.citations,
      endCall: o.endCall,
      degraded: o.degraded,
      errorCode: o.errorCode,
      retriever: o.retriever,
      retrievedAt: o.retrievedAt,
      llmModel: o.llmModel,
      areaSource: o.areaSource,
      retrievedChunkIds: o.retrievedChunkIds,
      citedChunkIds: o.citedChunkIds,
      citedIncidentKeys: o.citedIncidentKeys,
      citedHazards: o.citedHazards,
      timingsMs: o.timingsMs,
      effects: o.effects,
    });

  let ids: { unansweredQuestionId?: Id<"unansweredQuestions">; subscriptionId?: Id<"subscriptions"> };
  try {
    ids = await store(outcome);
  } catch (err) {
    // Side effects failed (e.g. the subscription could not be written): never confirm what did not happen.
    console.error("[voice] completeTurn failed:", err);
    outcome = fallbackOutcome(tr.language, "complete_turn_failed", outcome.timingsMs);
    ids = await store(outcome).catch((e: unknown) => {
      console.error("[voice] storing the fallback reply failed:", e);
      return {};
    });
  }

  return respond(begun.callId, {
    reply: outcome.reply,
    language: outcome.language,
    kind: outcome.kind,
    citations: outcome.citations,
    endCall: outcome.endCall,
    unansweredQuestionId: ids.unansweredQuestionId,
    subscriptionId: ids.subscriptionId,
    degraded: outcome.degraded,
    timingsMs: outcome.timingsMs,
  });
});

export const sessionEnd = httpAction(async (ctx, req) => {
  const cfg = config();
  const denied = requireVoiceAuth(req, cfg);
  if (denied) return denied;
  const body = await parseBody(req, SessionEndRequest);
  if (!body.ok) return body.response;
  let callId: Id<"calls"> | null;
  try {
    callId = await ctx.runMutation(internal.calls.endSession, {
      sessionId: body.data.sessionId,
      providerCallId: body.data.providerCallId,
      endedAt: body.data.endedAt,
      reason: body.data.reason,
    });
  } catch (err) {
    // Turns are already stored and the sweeper finalizes silent sessions, so nothing is lost.
    console.error("[voice] session end failed:", err);
    return errorResponse(500, "internal", "session end failed; the sweeper will finalize the call");
  }
  if (!callId) return errorResponse(404, "not_found", "unknown session");
  const response: SessionEndResponse = { contractVersion: CONTRACT_VERSION, ok: true, callId };
  return json(response);
});
