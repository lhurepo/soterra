// [B] Call sessions and turns: start (idempotent on providerCallId), per-turn persistence
// (idempotent on (call, turnIndex)), end, and the stale-session sweeper.
import { v } from "convex/values";
import { phrase } from "../src/orchestration/phrases";
import { STALE_SESSION_MS } from "../src/memory/retention";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { upsertCallerByPhone, verifiedAccountForPhone } from "./callers";
import { citation, replyKind } from "./validators";

const SUPPORTED_LANGUAGES = ["en", "es"];

function pickLanguage(...candidates: (string | undefined)[]): string {
  for (const c of candidates) {
    const primary = c?.toLowerCase().split("-")[0];
    if (primary && SUPPORTED_LANGUAGES.includes(primary)) return primary;
  }
  return "en";
}

async function greetingFor(ctx: QueryCtx, call: Doc<"calls">): Promise<string> {
  if (call.direction === "outbound" && call.notificationId) {
    const notification = await ctx.db.get("notifications", call.notificationId);
    if (notification) {
      return [phrase("outboundIntro", call.language), notification.message, phrase("outboundOutro", call.language)].join(" ");
    }
  }
  return phrase("greeting", call.language);
}

export const startSession = internalMutation({
  args: {
    providerCallId: v.string(),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    callerPhone: v.optional(v.string()),
    calledPhone: v.optional(v.string()),
    languageHint: v.optional(v.string()),
    notificationId: v.optional(v.string()),
    startedAt: v.number(),
  },
  returns: v.object({ sessionId: v.id("calls"), language: v.string(), greeting: v.string(), created: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("calls")
      .withIndex("by_providerCallId", (q) => q.eq("providerCallId", args.providerCallId))
      .unique();
    if (existing) {
      return { sessionId: existing._id, language: existing.language, greeting: await greetingFor(ctx, existing), created: false };
    }

    const now = Date.now();
    let callerId: Id<"callers"> | undefined;
    let accountId: Id<"accounts"> | undefined;
    let callerLanguage: string | undefined;
    let knownArea: Doc<"callers">["knownArea"];
    if (args.callerPhone) {
      callerId = await upsertCallerByPhone(ctx, args.callerPhone, now);
      const caller = await ctx.db.get("callers", callerId);
      callerLanguage = caller?.language;
      knownArea = caller?.knownArea;
      accountId = await verifiedAccountForPhone(ctx, args.callerPhone);
    }
    const notificationId = args.notificationId ? (ctx.db.normalizeId("notifications", args.notificationId) ?? undefined) : undefined;

    const callId = await ctx.db.insert("calls", {
      provider: "cartesia",
      providerCallId: args.providerCallId,
      direction: args.direction,
      status: "active",
      callerId,
      callerPhone: args.callerPhone,
      calledPhone: args.calledPhone,
      accountId,
      language: pickLanguage(args.languageHint, callerLanguage),
      transcriptConsent: "notice_given",
      knownArea,
      notificationId,
      startedAt: args.startedAt,
      lastActivityAt: now,
    });
    const call = (await ctx.db.get("calls", callId))!;
    return { sessionId: callId, language: call.language, greeting: await greetingFor(ctx, call), created: true };
  },
});

/** Resolves a session from either id. Returns null when unknown (the caller may lazily start one). */
export const resolveSession = internalQuery({
  args: { sessionId: v.optional(v.string()), providerCallId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.sessionId) {
      const id = ctx.db.normalizeId("calls", args.sessionId);
      return id ? await ctx.db.get("calls", id) : null;
    }
    if (args.providerCallId) {
      const providerCallId = args.providerCallId;
      return await ctx.db
        .query("calls")
        .withIndex("by_providerCallId", (q) => q.eq("providerCallId", providerCallId))
        .unique();
    }
    return null;
  },
});

const storedTurnResponse = v.object({
  reply: v.string(),
  kind: replyKind,
  citations: v.array(citation),
  endCall: v.boolean(),
  unansweredQuestionId: v.optional(v.id("unansweredQuestions")),
  subscriptionId: v.optional(v.id("subscriptions")),
  degraded: v.optional(v.boolean()),
  timingsMs: v.optional(v.record(v.string(), v.number())),
});

/** Persists the user turn. A replay of a completed turn returns the stored reply instead. */
export const beginTurn = internalMutation({
  args: {
    callId: v.id("calls"),
    turnIndex: v.number(),
    utterance: v.string(),
    language: v.string(),
    receivedAt: v.number(),
    interruptedPrevious: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({ status: v.literal("new"), turnId: v.id("callTurns") }),
    v.object({ status: v.literal("replay"), turnId: v.id("callTurns"), response: storedTurnResponse }),
  ),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("callTurns")
      .withIndex("by_callId_and_turnIndex", (q) => q.eq("callId", args.callId).eq("turnIndex", args.turnIndex))
      .unique();
    await ctx.db.patch("calls", args.callId, { lastActivityAt: Date.now() });
    if (existing?.status === "complete" && existing.reply && existing.kind) {
      return {
        status: "replay" as const,
        turnId: existing._id,
        response: {
          reply: existing.reply,
          kind: existing.kind,
          citations: existing.citations ?? [],
          endCall: existing.endCall ?? false,
          unansweredQuestionId: existing.unansweredQuestionId,
          subscriptionId: existing.subscriptionId,
          degraded: existing.degraded,
          timingsMs: existing.timingsMs,
        },
      };
    }
    // A pending replay (the first attempt was cut off) simply runs the pipeline again.
    if (existing) return { status: "new" as const, turnId: existing._id };
    const turnId = await ctx.db.insert("callTurns", { ...args, status: "pending" });
    return { status: "new" as const, turnId };
  },
});

/** Persists the assistant reply on the turn row. Ids arrive as strings from the Convex-free pipeline. */
export const completeTurn = internalMutation({
  args: {
    turnId: v.id("callTurns"),
    response: v.object({
      ...storedTurnResponse.fields,
      unansweredQuestionId: v.optional(v.string()),
      subscriptionId: v.optional(v.string()),
    }),
    retrievedChunkIds: v.array(v.string()),
    citedChunkIds: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { turnId, response, retrievedChunkIds, citedChunkIds }) => {
    const toChunkIds = (ids: string[]) =>
      ids.map((id) => ctx.db.normalizeId("chunks", id)).filter((id): id is Id<"chunks"> => id !== null);
    await ctx.db.patch("callTurns", turnId, {
      ...response,
      unansweredQuestionId: response.unansweredQuestionId
        ? (ctx.db.normalizeId("unansweredQuestions", response.unansweredQuestionId) ?? undefined)
        : undefined,
      subscriptionId: response.subscriptionId ? (ctx.db.normalizeId("subscriptions", response.subscriptionId) ?? undefined) : undefined,
      status: "complete",
      retrievedChunkIds: toChunkIds(retrievedChunkIds),
      citedChunkIds: toChunkIds(citedChunkIds),
    });
    const turn = await ctx.db.get("callTurns", turnId);
    if (turn && response.kind === "safety") await ctx.db.patch("calls", turn.callId, { safetyFlag: true });
    return null;
  },
});

/** Last few completed turns as model history (text only, never citations or ids). */
export const recentHistory = internalQuery({
  args: { callId: v.id("calls"), beforeTurnIndex: v.number(), limit: v.number() },
  handler: async (ctx, { callId, beforeTurnIndex, limit }) => {
    const turns = await ctx.db
      .query("callTurns")
      .withIndex("by_callId_and_turnIndex", (q) => q.eq("callId", callId).lt("turnIndex", beforeTurnIndex))
      .order("desc")
      .take(limit);
    return turns
      .reverse()
      .filter((t) => t.status === "complete" && t.reply)
      .flatMap((t) => [
        { role: "user" as const, content: t.utterance },
        { role: "assistant" as const, content: t.reply! },
      ]);
  },
});

export const declineTranscript = internalMutation({
  args: { callId: v.id("calls") },
  returns: v.null(),
  handler: async (ctx, { callId }) => {
    await ctx.db.patch("calls", callId, { transcriptConsent: "declined" });
    return null;
  },
});

async function endCall(ctx: MutationCtx, call: Doc<"calls">, endedAt: number, reason: NonNullable<Doc<"calls">["endReason"]>) {
  if (call.status === "active") {
    await ctx.db.patch("calls", call._id, { status: "ended", endedAt, endReason: reason });
  }
  // finalizeCall is idempotent, so scheduling it again on a repeated end is harmless.
  await ctx.scheduler.runAfter(0, internal.memory.finalizeCall, { callId: call._id });
}

export const endSession = internalMutation({
  args: {
    callId: v.id("calls"),
    endedAt: v.number(),
    reason: v.union(v.literal("caller_hangup"), v.literal("agent_end"), v.literal("transfer"), v.literal("error"), v.literal("timeout")),
  },
  returns: v.null(),
  handler: async (ctx, { callId, endedAt, reason }) => {
    const call = await ctx.db.get("calls", callId);
    if (call) await endCall(ctx, call, endedAt, reason);
    return null;
  },
});

/** Cron: finalizes sessions that never sent /voice/session/end. */
export const sweepStaleSessions = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db
      .query("calls")
      .withIndex("by_status_and_lastActivityAt", (q) => q.eq("status", "active").lt("lastActivityAt", now - STALE_SESSION_MS))
      .take(50);
    for (const call of stale) await endCall(ctx, call, now, "timeout");
    return stale.length;
  },
});
