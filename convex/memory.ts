// [B] Call completion: idempotent finalize, caller memory, the scheduled summary, summary-only mode,
// and the daily retention purge (batched to stay inside Convex per-mutation limits).
import { v } from "convex/values";
import type { HazardType } from "../src/contracts";
import { DEFAULTS } from "../src/config/defaults";
import { loadConfig } from "../src/config/env";
import { callerMemoryExpiresAt, anonMemoryTtlMs, anonTranscriptTtlMs } from "../src/memory/retention";
import { buildSummaryRequest, fallbackSummary, parseSummary, type SummaryInput } from "../src/memory/summary";
import { selectLlm } from "../src/providers/llm";
import { withTimeout } from "../src/providers/llm/errors";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { forgetCallerRows, hasActiveSubscription, verifiedAccountForPhone } from "./callers";
import { areaRef, hazardType } from "./validators";

/**
 * Idempotent. Called (scheduled) by /voice/session/end and by the stale-session sweeper.
 * Re-checks the verified phone link, sets retention deadlines, updates caller memory, schedules the summary.
 */
export const finalizeCall = internalMutation({
  args: { callId: v.id("calls") },
  returns: v.null(),
  handler: async (ctx, { callId }) => {
    const call = await ctx.db.get("calls", callId);
    if (!call || call.finalizedAt !== undefined) return null;
    const now = Date.now();
    const cfg = loadConfig(process.env);
    // accountId only ever comes from a verified link, checked again now.
    const accountId = call.callerPhone ? await verifiedAccountForPhone(ctx, call.callerPhone) : undefined;
    await ctx.db.patch("calls", callId, {
      status: "finalized",
      finalizedAt: now,
      endedAt: call.endedAt ?? now,
      accountId,
      transcriptExpiresAt: accountId ? undefined : now + anonTranscriptTtlMs(cfg),
      memoryExpiresAt: accountId ? undefined : now + anonMemoryTtlMs(cfg),
    });

    if (call.callerId) {
      const caller = await ctx.db.get("callers", call.callerId);
      if (caller) {
        const turns = await ctx.db
          .query("callTurns")
          .withIndex("by_callId_and_turnIndex", (q) => q.eq("callId", callId))
          .take(200);
        const incidentKeys = [...new Set(turns.flatMap((t) => t.citedIncidentKeys ?? []))].slice(0, 3);
        await ctx.db.patch("callers", caller._id, {
          language: call.language,
          knownArea: call.knownArea ?? caller.knownArea,
          lastCallAt: now,
          lastIncidentKeys: incidentKeys.length > 0 ? incidentKeys : caller.lastIncidentKeys,
          expiresAt: callerMemoryExpiresAt(cfg, now, accountId !== undefined),
        });
      }
    }
    await ctx.scheduler.runAfter(0, internal.memory.summarizeCall, { callId });
    return null;
  },
});

export const summaryInput = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }): Promise<SummaryInput | null> => {
    const call = await ctx.db.get("calls", callId);
    if (!call) return null;
    const turns = await ctx.db
      .query("callTurns")
      .withIndex("by_callId_and_turnIndex", (q) => q.eq("callId", callId))
      .take(200);
    const unanswered = await ctx.db
      .query("unansweredQuestions")
      .withIndex("by_callId_and_turnIndex", (q) => q.eq("callId", callId))
      .take(50);
    const hazards = new Set<HazardType>(turns.flatMap((t) => t.citedHazards ?? []));
    return {
      language: call.language,
      turns: turns.map((t) => ({ utterance: t.utterance, kind: t.kind, reply: t.reply })),
      unansweredQuestionIds: unanswered.map((u) => u._id as string),
      followUpsRequested: [...new Set(turns.flatMap((t) => (t.subscriptionId ? [t.subscriptionId as string] : [])))],
      hazards: [...hazards],
      safetyFlag: call.safetyFlag === true || turns.some((t) => t.kind === "safety"),
    };
  },
});

/** Scheduled by finalizeCall. Uses CLAUDE_SUMMARY_MODEL (default CLAUDE_SMART_MODEL); on any failure stores a deterministic summary. */
export const summarizeCall = internalAction({
  args: { callId: v.id("calls") },
  returns: v.null(),
  handler: async (ctx, { callId }) => {
    const input = await ctx.runQuery(internal.memory.summaryInput, { callId });
    if (!input) return null;
    const config = loadConfig(process.env);
    const model = config.CLAUDE_SUMMARY_MODEL ?? config.CLAUDE_SMART_MODEL;
    let summary = fallbackSummary(input);
    let usedModel = "fallback";
    let fallback = true;
    try {
      const llm = selectLlm(config);
      const request = buildSummaryRequest(input, model);
      const response = await withTimeout(llm.complete(request), DEFAULTS.summaryTimeoutMs, "summary");
      summary = parseSummary(response.structured ?? JSON.parse(response.text), input);
      usedModel = response.model;
      fallback = false;
    } catch (err) {
      console.error(`[summary] LLM summary failed for ${callId}; storing the deterministic summary:`, err);
    }
    await ctx.runMutation(internal.memory.saveSummary, { callId, model: usedModel, fallback, ...summary });
    return null;
  },
});

/** Deletes up to `limit` turns of a call. Returns true when none remain. */
async function deleteTurns(ctx: MutationCtx, callId: Id<"calls">, limit: number): Promise<{ deleted: number; done: boolean }> {
  const turns = await ctx.db
    .query("callTurns")
    .withIndex("by_callId_and_turnIndex", (q) => q.eq("callId", callId))
    .take(limit);
  for (const t of turns) await ctx.db.delete("callTurns", t._id);
  return { deleted: turns.length, done: turns.length < limit };
}

export const saveSummary = internalMutation({
  args: {
    callId: v.id("calls"),
    model: v.string(),
    fallback: v.boolean(),
    summary: v.string(),
    language: v.string(),
    topics: v.array(v.string()),
    areasMentioned: v.array(areaRef),
    hazards: v.array(hazardType),
    unansweredQuestionIds: v.array(v.string()),
    followUpsRequested: v.array(v.string()),
    safetyFlag: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const call = await ctx.db.get("calls", args.callId);
    if (!call) return null;
    const existing = await ctx.db
      .query("callSummaries")
      .withIndex("by_callId", (q) => q.eq("callId", args.callId))
      .unique();
    if (existing) return null;

    const summaryId = await ctx.db.insert("callSummaries", {
      callId: args.callId,
      callerId: call.callerId,
      accountId: call.accountId,
      summary: args.summary,
      language: args.language,
      topics: args.topics,
      areasMentioned: args.areasMentioned,
      hazards: args.hazards,
      unansweredQuestionIds: args.unansweredQuestionIds
        .map((id) => ctx.db.normalizeId("unansweredQuestions", id))
        .filter((id): id is Id<"unansweredQuestions"> => id !== null),
      followUpsRequested: args.followUpsRequested,
      safetyFlag: args.safetyFlag || call.safetyFlag === true,
      model: args.model,
      fallback: args.fallback || undefined,
      createdAt: Date.now(),
    });
    if (call.callerId) {
      const caller = await ctx.db.get("callers", call.callerId);
      if (caller) await ctx.db.patch("callers", caller._id, { lastCallSummaryId: summaryId });
    }

    // Summary-only mode: the caller declined the transcript, so the turns go once the summary exists.
    if (call.transcriptConsent === "declined") {
      const { done } = await deleteTurns(ctx, call._id, DEFAULTS.purgeBatchSize);
      if (!done) await ctx.scheduler.runAfter(0, internal.memory.deleteCallTurns, { callId: call._id });
    }
    return null;
  },
});

/** Continuation for summary-only deletion of calls with many turns. */
export const deleteCallTurns = internalMutation({
  args: { callId: v.id("calls") },
  returns: v.null(),
  handler: async (ctx, { callId }) => {
    const { done } = await deleteTurns(ctx, callId, DEFAULTS.purgeBatchSize);
    if (!done) await ctx.scheduler.runAfter(0, internal.memory.deleteCallTurns, { callId });
    return null;
  },
});

/** Deletes an anonymous call row with its turns and summary (bounded). Returns rows deleted, or -1 if unfinished. */
async function forgetCall(ctx: MutationCtx, call: Doc<"calls">, budget: number): Promise<number> {
  const { deleted, done } = await deleteTurns(ctx, call._id, budget);
  if (!done) return -1;
  const summary = await ctx.db
    .query("callSummaries")
    .withIndex("by_callId", (q) => q.eq("callId", call._id))
    .unique();
  if (summary && summary.accountId === undefined) await ctx.db.delete("callSummaries", summary._id);
  await ctx.db.delete("calls", call._id);
  return deleted + 2;
}

/**
 * Daily cron, also runnable by hand. Deletes, in batches of DEFAULTS.purgeBatchSize rows:
 * 1. turns of anonymous calls past their transcript deadline (ANON_TRANSCRIPT_TTL_HOURS),
 * 2. anonymous call rows and their summaries past their memory deadline (ANON_MEMORY_TTL_DAYS),
 * 3. anonymous caller rows past expiresAt, unless an active subscription still needs them.
 * Account data has no deadline. Reschedules itself while work remains.
 */
export const purgeExpired = internalMutation({
  args: {},
  returns: v.object({ turnsDeleted: v.number(), callsDeleted: v.number(), callersDeleted: v.number(), more: v.boolean() }),
  handler: async (ctx) => {
    const now = Date.now();
    let budget: number = DEFAULTS.purgeBatchSize;
    let turnsDeleted = 0;
    let callsDeleted = 0;
    let callersDeleted = 0;

    // 1. Transcripts. gte(0) skips calls without a deadline (account calls, unfinished calls).
    const transcriptDue = await ctx.db
      .query("calls")
      .withIndex("by_transcriptExpiresAt", (q) => q.gte("transcriptExpiresAt", 0).lt("transcriptExpiresAt", now))
      .take(budget);
    for (const call of transcriptDue) {
      if (budget <= 0) break;
      const { deleted, done } = await deleteTurns(ctx, call._id, budget);
      turnsDeleted += deleted;
      budget -= deleted;
      if (done) await ctx.db.patch("calls", call._id, { transcriptExpiresAt: undefined });
    }

    // 2. Anonymous call rows and summaries.
    if (budget > 0) {
      const memoryDue = await ctx.db
        .query("calls")
        .withIndex("by_memoryExpiresAt", (q) => q.gte("memoryExpiresAt", 0).lt("memoryExpiresAt", now))
        .take(Math.max(1, Math.floor(budget / 3)));
      for (const call of memoryDue) {
        if (budget <= 0) break;
        const used = await forgetCall(ctx, call, budget);
        if (used < 0) {
          budget = 0;
          break;
        }
        budget -= used;
        callsDeleted++;
      }
    }

    // 3. Anonymous caller memory.
    if (budget > 0) {
      const callersDue = await ctx.db
        .query("callers")
        .withIndex("by_expiresAt", (q) => q.gte("expiresAt", 0).lt("expiresAt", now))
        .take(Math.max(1, Math.floor(budget / 5)));
      for (const caller of callersDue) {
        if (budget <= 0) break;
        if (await hasActiveSubscription(ctx, caller._id)) {
          // Kept while a subscription needs it; checked again on the next run after the subscription ends.
          await ctx.db.patch("callers", caller._id, { expiresAt: now + DEFAULTS.subscriptionMaxTtlMs });
          budget -= 1;
          continue;
        }
        const finished = await forgetCallerRows(ctx, caller, budget);
        budget -= 5;
        if (finished) callersDeleted++;
      }
    }

    const more = budget <= 0;
    if (more) await ctx.scheduler.runAfter(0, internal.memory.purgeExpired, {});
    return { turnsDeleted, callsDeleted, callersDeleted, more };
  },
});
