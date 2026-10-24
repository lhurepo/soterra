// [B] Caller context for a turn, call finalization, summaries, and the retention purge.
import { v } from "convex/values";
import { CallSummary, type CallerContext, type HazardType } from "../src/contracts";
import { loadConfig } from "../src/config/env";
import { retentionCutoffs } from "../src/memory/retention";
import { selectLlm } from "../src/providers/llm";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { areaRef, hazardType } from "./validators";

export const loadCallerContext = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }): Promise<CallerContext> => {
    const call = await ctx.db.get("calls", callId);
    if (!call) throw new Error(`call ${callId} not found`);
    const caller = call.callerId ? await ctx.db.get("callers", call.callerId) : null;
    const lastSummary = caller?.lastCallSummaryId ? await ctx.db.get("callSummaries", caller.lastCallSummaryId) : null;
    return {
      callerId: call.callerId,
      accountId: call.accountId,
      identity: call.accountId ? "verified_account" : call.callerId ? "caller_id" : "anonymous",
      language: call.language,
      knownArea: call.knownArea ?? caller?.knownArea,
      needs: caller?.needs,
      lastCallSummary: lastSummary && lastSummary.callId !== callId ? lastSummary.summary : undefined,
    };
  },
});

/** Idempotent. Called by /voice/session/end and by the stale-session sweeper. */
export const finalizeCall = internalMutation({
  args: { callId: v.id("calls") },
  returns: v.null(),
  handler: async (ctx, { callId }) => {
    const call = await ctx.db.get("calls", callId);
    if (!call || call.finalizedAt !== undefined) return null;
    const now = Date.now();
    await ctx.db.patch("calls", callId, { status: "finalized", finalizedAt: now, endedAt: call.endedAt ?? now });
    await ctx.scheduler.runAfter(0, internal.memory.summarizeCall, { callId });
    return null;
  },
});

export const summaryInput = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
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
    const hazards = new Set<HazardType>();
    for (const t of turns) {
      for (const chunkId of t.citedChunkIds ?? []) {
        const chunk = await ctx.db.get("chunks", chunkId);
        if (chunk) hazards.add(chunk.hazardType);
      }
    }
    return {
      language: call.language,
      turns: turns.map((t) => ({ utterance: t.utterance, kind: t.kind, reply: t.reply })),
      unansweredQuestionIds: unanswered.map((u) => u._id as string),
      followUpsRequested: turns.flatMap((t) => (t.subscriptionId ? [t.subscriptionId as string] : [])),
      hazards: [...hazards],
    };
  },
});

export const summarizeCall = internalAction({
  args: { callId: v.id("calls") },
  returns: v.null(),
  handler: async (ctx, { callId }) => {
    const input = await ctx.runQuery(internal.memory.summaryInput, { callId });
    if (!input) return null;
    const config = loadConfig(process.env);
    const llm = selectLlm(config);
    // TODO(B): real summary prompt (≤ 80 words, neutral, no personal details beyond what was volunteered).
    const response = await llm.complete({
      purpose: "summary",
      model: config.CLAUDE_FAST_MODEL,
      system:
        "Summarize this disaster-information phone call in at most 80 neutral words. Return JSON matching the CallSummary schema.",
      messages: [{ role: "user", content: JSON.stringify(input.turns.map((t) => ({ caller: t.utterance, soterra: t.reply }))) }],
      maxTokens: 600,
      structuredInput: input,
    });
    const summary = CallSummary.parse(response.structured ?? JSON.parse(response.text));
    await ctx.runMutation(internal.memory.saveSummary, { callId, model: response.model, ...summary });
    return null;
  },
});

export const saveSummary = internalMutation({
  args: {
    callId: v.id("calls"),
    model: v.string(),
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

    const now = Date.now();
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
      createdAt: now,
    });

    if (call.callerId) {
      await ctx.db.patch("callers", call.callerId, {
        lastCallSummaryId: summaryId,
        lastCallAt: call.startedAt,
        language: call.language,
        knownArea: call.knownArea,
      });
    }

    // Summary-only mode: the caller declined the transcript, so the turns go once the summary exists.
    if (call.transcriptConsent === "declined") {
      const turns = await ctx.db
        .query("callTurns")
        .withIndex("by_callId_and_turnIndex", (q) => q.eq("callId", args.callId))
        .take(500);
      for (const t of turns) await ctx.db.delete("callTurns", t._id);
    }
    return null;
  },
});

/** Daily cron: deletes transcripts of anonymous calls past ANON_TRANSCRIPT_TTL_HOURS. Bounded per run. */
export const purgeExpired = internalMutation({
  args: {},
  returns: v.object({ turnsDeleted: v.number() }),
  handler: async (ctx) => {
    const { anonymousTranscriptsBefore } = retentionCutoffs(loadConfig(process.env), Date.now());
    const anonymousFinalized = new Map<Id<"calls">, boolean>();
    let turnsDeleted = 0;
    let scanned = 0;
    for await (const turn of ctx.db
      .query("callTurns")
      .withIndex("by_receivedAt", (q) => q.lt("receivedAt", anonymousTranscriptsBefore))) {
      if (++scanned > 500) break;
      if (!anonymousFinalized.has(turn.callId)) {
        const call = await ctx.db.get("calls", turn.callId);
        // Account data is kept until the account deletes it.
        anonymousFinalized.set(turn.callId, !!call && call.status === "finalized" && !call.accountId);
      }
      if (anonymousFinalized.get(turn.callId)) {
        await ctx.db.delete("callTurns", turn._id);
        turnsDeleted++;
      }
    }
    // TODO(B): forget anonymous callers past ANON_MEMORY_TTL_DAYS unless an active subscription needs them.
    return { turnsDeleted };
  },
});
