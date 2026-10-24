// [B] Call sessions and turns. A turn costs two mutations: beginTurn (resolve or lazily start the session,
// idempotency check, persist the user turn, mark the previous reply interrupted, return everything the
// pipeline needs) and completeTurn (apply the pipeline's side effects and store the reply, atomically).
import { v } from "convex/values";
import type { AreaRef, CallerContext } from "../src/contracts";
import { DEFAULTS, isSupportedLanguage, supportedLanguage } from "../src/config/defaults";
import { buildCallerContext } from "../src/memory/callerContext";
import { STALE_SESSION_MS } from "../src/memory/retention";
import { stateForZip, type AreaCandidate } from "../src/orchestration/area";
import { appCodeGreeting, inboundGreeting, outboundGreeting, verificationGreeting } from "../src/orchestration/greeting";
import type { LlmMessage } from "../src/providers/llm/types";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { addNeed } from "../src/memory/profile";
import { forgetCallerMemory, getOrCreateCaller, verifiedAccountForPhone } from "./callers";
import { cancelSubscriptionsForPhone, createSubscriptionForCall } from "./subscriptions";
import { recordUnansweredForCall } from "./unanswered";
import { areaRef, citation, endReason, followUpRequest, hazardType, replyKind } from "./validators";

type StartArgs = {
  providerCallId: string;
  direction: "inbound" | "outbound";
  callerPhone?: string;
  calledPhone?: string;
  languageHint?: string;
  notificationId?: string;
  providerAgentCallId?: string;
  startedAt: number;
};

async function callByProviderId(ctx: QueryCtx, providerCallId: string): Promise<Doc<"calls"> | null> {
  return await ctx.db
    .query("calls")
    .withIndex("by_providerCallId", (q) => q.eq("providerCallId", providerCallId))
    .unique();
}

/** The account's home ZIP as an area, used when the caller has no remembered area. */
function homeArea(zip: string | undefined): AreaRef | undefined {
  const state = zip ? stateForZip(zip) : undefined;
  return zip && state ? { state, zip, label: `ZIP code ${zip}` } : undefined;
}

function firstSupported(...candidates: (string | undefined)[]): string {
  return supportedLanguage(candidates.find((c) => isSupportedLanguage(c)));
}

/** Idempotent on providerCallId. Builds and caches the caller context and the greeting. */
async function startSessionImpl(ctx: MutationCtx, args: StartArgs): Promise<{ call: Doc<"calls">; created: boolean }> {
  const existing = await callByProviderId(ctx, args.providerCallId);
  if (existing) return { call: existing, created: false };

  const now = Date.now();
  const notificationId = args.notificationId ? (ctx.db.normalizeId("notifications", args.notificationId) ?? undefined) : undefined;
  // Outbound callbacks: Cartesia's agent_call_id is stored as the notification's providerRef when the call is placed.
  const notification =
    (notificationId ? await ctx.db.get("notifications", notificationId) : null) ??
    (args.direction === "outbound" && args.providerAgentCallId
      ? await ctx.db
          .query("notifications")
          .withIndex("by_providerRef", (q) => q.eq("providerRef", args.providerAgentCallId))
          .first()
      : null);
  // Outbound callbacks may not carry the dialed number; the notification knows who we called.
  const callerPhone = args.callerPhone ?? (args.direction === "outbound" ? notification?.recipientPhone : undefined);
  // The callback check: a recent verification notification of ours, answered at the number we dialed. Valid for this call only.
  const verifiedPhone =
    args.direction === "outbound" &&
    notification?.purpose === "verification" &&
    callerPhone !== undefined &&
    callerPhone === notification.recipientPhone &&
    now - notification.createdAt <= DEFAULTS.verificationValidMs;

  let caller: Doc<"callers"> | null = null;
  if (callerPhone) {
    const found = await getOrCreateCaller(ctx, callerPhone, now);
    caller = found.caller;
  }
  const accountId = callerPhone ? await verifiedAccountForPhone(ctx, callerPhone) : undefined;
  const account = accountId ? await ctx.db.get("accounts", accountId) : null;
  const lastSummary = caller?.lastCallSummaryId ? await ctx.db.get("callSummaries", caller.lastCallSummaryId) : null;
  const activeSubs = callerPhone
    ? (
        await ctx.db
          .query("subscriptions")
          .withIndex("by_recipientPhone_and_status", (q) => q.eq("recipient.phone", callerPhone).eq("status", "active"))
          .take(5)
      ).filter((s) => s.expiresAt > now)
    : [];

  const language = firstSupported(args.languageHint, account?.preferredLanguage, caller?.language);
  const callerContext = buildCallerContext({
    callerId: caller?._id,
    accountId: account?._id,
    language,
    knownArea: caller?.knownArea ?? homeArea(account?.homeZip),
    accountNeeds: account?.needs,
    accountPersonalContext: account?.personalContext,
    verifiedPhone,
    profileNeeds: caller?.profileNeeds,
    lastSummary: lastSummary ? { text: lastSummary.summary, createdAt: lastSummary.createdAt } : undefined,
    lastCallAt: caller?.lastCallAt,
    lastIncidentKeys: caller?.lastIncidentKeys,
    activeSubscriptions: activeSubs.map((s) => ({
      kind: s.target.kind,
      incidentKey: s.target.incidentKey,
      areaLabel: s.target.area?.label,
      trigger: s.trigger,
    })),
    now,
  });
  // The call that reads the app its sign-in code: the code comes from the challenge this notification belongs to.
  let appCode: string | null | undefined;
  if (args.direction === "outbound" && notification?.purpose === "app_code") {
    const challenge = await ctx.db
      .query("phoneChallenges")
      .withIndex("by_notificationId", (q) => q.eq("notificationId", notification._id))
      .unique();
    appCode = challenge && challenge.expiresAt > now ? challenge.code : null;
  }
  const greeting =
    appCode !== undefined
      ? appCodeGreeting(language, appCode)
      : verifiedPhone
        ? verificationGreeting(language)
        : args.direction === "outbound" && notification
          ? outboundGreeting(language, notification.message)
          : inboundGreeting(language);

  const callId = await ctx.db.insert("calls", {
    provider: "cartesia",
    providerCallId: args.providerCallId,
    direction: args.direction,
    status: "active",
    callerId: caller?._id,
    callerPhone,
    calledPhone: args.calledPhone,
    accountId,
    language,
    transcriptConsent: "notice_given",
    notificationId: notification?._id,
    verifiedPhone: verifiedPhone || undefined,
    callerContext,
    greeting,
    startedAt: args.startedAt,
    lastActivityAt: now,
  });
  return { call: (await ctx.db.get("calls", callId))!, created: true };
}

const startArgs = {
  providerCallId: v.string(),
  direction: v.union(v.literal("inbound"), v.literal("outbound")),
  callerPhone: v.optional(v.string()),
  calledPhone: v.optional(v.string()),
  languageHint: v.optional(v.string()),
  notificationId: v.optional(v.string()),
  providerAgentCallId: v.optional(v.string()),
  startedAt: v.number(),
};

export const startSession = internalMutation({
  args: startArgs,
  returns: v.object({ sessionId: v.id("calls"), language: v.string(), greeting: v.string(), created: v.boolean() }),
  handler: async (ctx, args) => {
    const { call, created } = await startSessionImpl(ctx, args);
    return { sessionId: call._id, language: call.language, greeting: call.greeting ?? inboundGreeting(call.language, { returning: false }), created };
  },
});

/** Resolves a session from either id. Returns null when unknown. */
async function resolveCall(ctx: QueryCtx, ref: { sessionId?: string; providerCallId?: string }): Promise<Doc<"calls"> | null> {
  if (ref.sessionId) {
    const id = ctx.db.normalizeId("calls", ref.sessionId);
    return id ? await ctx.db.get("calls", id) : null;
  }
  return ref.providerCallId ? await callByProviderId(ctx, ref.providerCallId) : null;
}

export const resolveSession = internalQuery({
  args: { sessionId: v.optional(v.string()), providerCallId: v.optional(v.string()) },
  handler: async (ctx, args) => await resolveCall(ctx, args),
});

async function loadAreaCandidates(ctx: QueryCtx): Promise<AreaCandidate[]> {
  const rows = await ctx.db
    .query("bulletinAreas")
    .withIndex("by_isActive_and_state", (q) => q.eq("isActive", true))
    .take(300);
  const seen = new Map<string, AreaCandidate>();
  for (const r of rows) {
    const key = `${r.state}|${r.label}`;
    if (!seen.has(key)) seen.set(key, { label: r.label, state: r.state, countyFips: r.countyFips, nwsZone: r.nwsZone });
  }
  return [...seen.values()].slice(0, 150);
}

type StoredResponse = {
  reply: string;
  language: string;
  kind: NonNullable<Doc<"callTurns">["kind"]>;
  citations: NonNullable<Doc<"callTurns">["citations"]>;
  endCall: boolean;
  unansweredQuestionId?: Id<"unansweredQuestions">;
  subscriptionId?: Id<"subscriptions">;
  degraded?: boolean;
  timingsMs?: Record<string, number>;
};

function storedResponse(turn: Doc<"callTurns">): StoredResponse | null {
  if (turn.status !== "complete" || turn.reply === undefined || turn.kind === undefined) return null;
  return {
    reply: turn.reply,
    language: turn.replyLanguage ?? supportedLanguage(turn.language),
    kind: turn.kind,
    citations: turn.citations ?? [],
    endCall: turn.endCall ?? false,
    unansweredQuestionId: turn.unansweredQuestionId,
    subscriptionId: turn.subscriptionId,
    degraded: turn.degraded,
    timingsMs: turn.timingsMs,
  };
}

export type BeginTurnResult =
  | { status: "not_found" }
  | { status: "replay"; callId: Id<"calls">; response: StoredResponse }
  | {
      status: "new";
      callId: Id<"calls">;
      turnId: Id<"callTurns">;
      hasCallerPhone: boolean;
      callArea?: AreaRef;
      context: CallerContext;
      areaCandidates: AreaCandidate[];
      history: LlmMessage[];
      recentCallerUtterances: string[];
      hasOpenQuestion: boolean;
      callIncidentKeys: string[];
      pendingAction?: "forget";
      verificationsLastHour: number;
      /** For an update callback: the update we phoned about, so the model knows why it called. */
      callReason?: string;
      /** Chunks of the bulletin(s) behind that update; always included in the sources for this call. */
      pinnedChunkIds?: string[];
    };

/**
 * Everything before the pipeline in one transaction: resolve (or lazily start) the session, return the
 * stored reply for a replayed (call, turnIndex), mark the previous reply interrupted, persist the user turn,
 * and load the cached context, area labels and recent history.
 */
export const beginTurn = internalMutation({
  args: {
    sessionId: v.optional(v.string()),
    providerCallId: v.optional(v.string()),
    turnIndex: v.number(),
    utterance: v.string(),
    language: v.string(),
    receivedAt: v.number(),
    interruptedPrevious: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<BeginTurnResult> => {
    let call = await resolveCall(ctx, args);
    if (!call && !args.sessionId && args.providerCallId) {
      // A turn for an unknown providerCallId lazily starts an inbound session (the caller spoke before start finished).
      call = (await startSessionImpl(ctx, { providerCallId: args.providerCallId, direction: "inbound", languageHint: args.language, startedAt: args.receivedAt })).call;
    }
    if (!call) return { status: "not_found" };
    const callId = call._id;

    const existing = await ctx.db
      .query("callTurns")
      .withIndex("by_callId_and_turnIndex", (q) => q.eq("callId", callId).eq("turnIndex", args.turnIndex))
      .unique();
    const replay = existing ? storedResponse(existing) : null;
    if (replay) return { status: "replay", callId, response: replay };

    const now = Date.now();
    const callPatch: Partial<Doc<"calls">> = { lastActivityAt: now };
    let areaCandidates = call.areaCandidates;
    if (!areaCandidates || call.areaCandidatesAt === undefined || now - call.areaCandidatesAt > DEFAULTS.areaLabelCacheMs) {
      areaCandidates = await loadAreaCandidates(ctx);
      callPatch.areaCandidates = areaCandidates;
      callPatch.areaCandidatesAt = now;
    }
    await ctx.db.patch("calls", callId, callPatch);

    // Barge-in: the caller did not hear (all of) the previous reply. Never assume they did.
    if (args.interruptedPrevious && args.turnIndex > 0) {
      const previous = await ctx.db
        .query("callTurns")
        .withIndex("by_callId_and_turnIndex", (q) => q.eq("callId", callId).lt("turnIndex", args.turnIndex))
        .order("desc")
        .first();
      if (previous) await ctx.db.patch("callTurns", previous._id, { interrupted: true });
    }

    // A pending replay (the first attempt was cut off) runs the pipeline again on the same row.
    const { sessionId: _s, providerCallId: _p, ...turnFields } = args;
    const turnId = existing?._id ?? (await ctx.db.insert("callTurns", { ...turnFields, callId, status: "pending" }));

    const prior = await ctx.db
      .query("callTurns")
      .withIndex("by_callId_and_turnIndex", (q) => q.eq("callId", callId).lt("turnIndex", args.turnIndex))
      .order("desc")
      .take(DEFAULTS.historyTurns);
    const completed = prior.reverse().filter((t) => t.status === "complete" && t.reply !== undefined);
    const history: LlmMessage[] = completed.flatMap((t) => [
      { role: "user" as const, content: t.utterance },
      // A reply the caller barged into is marked so the model does not assume it was heard.
      { role: "assistant" as const, content: t.interrupted ? `${t.reply!} [the caller interrupted this reply]` : t.reply! },
    ]);
    const openQuestion = await ctx.db
      .query("unansweredQuestions")
      .withIndex("by_callId_and_turnIndex", (q) => q.eq("callId", callId))
      .take(20);

    const verificationsLastHour = call.callerPhone
      ? (
          await ctx.db
            .query("notifications")
            .withIndex("by_recipientPhone_and_createdAt", (q) => q.eq("recipientPhone", call.callerPhone!).gt("createdAt", now - 3_600_000))
            .take(20)
        ).filter((n) => n.purpose === "verification").length
      : 0;

    // An update callback: remember what we called about, and keep that bulletin in the sources so the caller can ask about it.
    let callReason: string | undefined;
    const pinnedChunkIds: string[] = [];
    if (call.direction === "outbound" && call.notificationId && !call.verifiedPhone) {
      const notification = await ctx.db.get("notifications", call.notificationId);
      if (notification && (notification.purpose === undefined || notification.purpose === "update")) {
        callReason = notification.message;
        for (const bulletinId of notification.bulletinRefs.slice(0, 3)) {
          const chunks = await ctx.db
            .query("chunks")
            .withIndex("by_bulletinId", (q) => q.eq("bulletinId", bulletinId))
            .take(3);
          pinnedChunkIds.push(...chunks.map((c) => c._id as string));
        }
      }
    }

    return {
      status: "new",
      callId,
      turnId,
      callReason,
      pinnedChunkIds: pinnedChunkIds.length > 0 ? pinnedChunkIds : undefined,
      pendingAction: call.pendingAction,
      verificationsLastHour,
      hasCallerPhone: call.callerPhone !== undefined,
      callArea: call.knownArea,
      context: call.callerContext ?? { identity: "anonymous", language: call.language },
      areaCandidates,
      history,
      recentCallerUtterances: completed.map((t) => t.utterance),
      hasOpenQuestion: openQuestion.some((q) => q.status === "open"),
      callIncidentKeys: [...new Set([...completed].reverse().flatMap((t) => t.citedIncidentKeys ?? []))],
    };
  },
});

/** Applies the pipeline's side effects and stores the reply. Idempotent: a completed turn is left as is. */
export const completeTurn = internalMutation({
  args: {
    turnId: v.id("callTurns"),
    reply: v.string(),
    replyLanguage: v.string(),
    kind: replyKind,
    citations: v.array(citation),
    endCall: v.boolean(),
    degraded: v.optional(v.boolean()),
    errorCode: v.optional(v.string()),
    retriever: v.optional(v.string()),
    retrievedAt: v.optional(v.number()),
    llmModel: v.optional(v.string()),
    areaSource: v.optional(v.string()),
    retrievedChunkIds: v.array(v.string()),
    citedChunkIds: v.array(v.string()),
    citedIncidentKeys: v.array(v.string()),
    citedHazards: v.array(hazardType),
    timingsMs: v.record(v.string(), v.number()),
    effects: v.object({
      recordUnanswered: v.optional(v.object({ text: v.string(), area: v.optional(areaRef) })),
      createSubscription: v.optional(followUpRequest),
      cancelSubscriptions: v.optional(v.boolean()),
      setKnownArea: v.optional(areaRef),
      declineTranscript: v.optional(v.boolean()),
      requestVerification: v.optional(v.boolean()),
      saveProfileNeed: v.optional(v.string()),
      forgetCaller: v.optional(v.boolean()),
      setPendingAction: v.optional(v.literal("forget")),
      clearPendingAction: v.optional(v.boolean()),
    }),
  },
  returns: v.object({
    unansweredQuestionId: v.optional(v.id("unansweredQuestions")),
    subscriptionId: v.optional(v.id("subscriptions")),
    subscriptionsCancelled: v.number(),
  }),
  handler: async (ctx, { turnId, effects, retrievedChunkIds, citedChunkIds, ...reply }) => {
    const turn = await ctx.db.get("callTurns", turnId);
    if (!turn) throw new Error(`turn ${turnId} not found`);
    if (turn.status === "complete") {
      return { unansweredQuestionId: turn.unansweredQuestionId, subscriptionId: turn.subscriptionId, subscriptionsCancelled: 0 };
    }
    const call = (await ctx.db.get("calls", turn.callId))!;
    const now = Date.now();

    let unansweredQuestionId: Id<"unansweredQuestions"> | undefined;
    if (effects.recordUnanswered) {
      unansweredQuestionId = await recordUnansweredForCall(ctx, call, {
        turnIndex: turn.turnIndex,
        text: effects.recordUnanswered.text,
        language: reply.replyLanguage,
        area: effects.recordUnanswered.area,
      });
    }
    let subscriptionId: Id<"subscriptions"> | undefined;
    if (effects.createSubscription && call.callerPhone) {
      subscriptionId = (await createSubscriptionForCall(ctx, call, effects.createSubscription, reply.replyLanguage, now)) ?? undefined;
    }
    let subscriptionsCancelled = 0;
    if (effects.cancelSubscriptions && call.callerPhone) {
      subscriptionsCancelled = await cancelSubscriptionsForPhone(ctx, call.callerPhone, now);
    }

    const callPatch: Partial<Doc<"calls">> = {};
    // Personal commands (the pipeline only plans these on a verified call, except the callback request itself).
    if (effects.requestVerification && call.callerPhone) {
      await queueVerificationCall(ctx, call.callerPhone, reply.replyLanguage, now);
    }
    if (effects.saveProfileNeed && call.callerId) {
      const caller = await ctx.db.get("callers", call.callerId);
      const added = caller ? addNeed(caller.profileNeeds, effects.saveProfileNeed) : null;
      if (caller && added?.status === "ok") {
        await ctx.db.patch("callers", caller._id, { profileNeeds: added.needs, profileUpdatedAt: now });
        // The call's cached context was built at its start: keep it current so later turns of this call see the new need.
        if (call.callerContext) callPatch.callerContext = { ...call.callerContext, needs: added.needs };
      }
    }
    if (effects.forgetCaller) {
      if (call.callerPhone) await cancelSubscriptionsForPhone(ctx, call.callerPhone, now);
      if (call.callerId) {
        const caller = await ctx.db.get("callers", call.callerId);
        if (caller) await forgetCallerMemory(ctx, caller);
      }
      callPatch.forgotten = true;
      callPatch.transcriptConsent = "declined";
      // Nothing deleted may be read back for the rest of this call.
      if (call.callerContext) {
        const { needs: _n, lastCallSummary: _s, recentIncidentKeys: _r, activeSubscriptions: _a, knownArea: _k, ...kept } = call.callerContext;
        callPatch.callerContext = kept;
      }
    }
    if (effects.setPendingAction) callPatch.pendingAction = effects.setPendingAction;
    else if (effects.clearPendingAction || call.pendingAction) callPatch.pendingAction = undefined;
    if (effects.setKnownArea) callPatch.knownArea = effects.setKnownArea;
    if (effects.declineTranscript) callPatch.transcriptConsent = "declined";
    if (reply.kind === "safety") callPatch.safetyFlag = true;
    // Follow the caller into Spanish (or back to English) for later greetings and summaries.
    if (isSupportedLanguage(turn.language) && supportedLanguage(turn.language) !== call.language) {
      callPatch.language = supportedLanguage(turn.language);
    }
    if (Object.keys(callPatch).length > 0) await ctx.db.patch("calls", call._id, callPatch);

    const toChunkIds = (ids: string[]) => ids.map((id) => ctx.db.normalizeId("chunks", id)).filter((id): id is Id<"chunks"> => id !== null);
    await ctx.db.patch("callTurns", turnId, {
      ...reply,
      status: "complete",
      unansweredQuestionId,
      subscriptionId,
      retrievedChunkIds: toChunkIds(retrievedChunkIds),
      citedChunkIds: toChunkIds(citedChunkIds),
    });
    return { unansweredQuestionId, subscriptionId, subscriptionsCancelled };
  },
});

/**
 * Queues the callback check: a phone notification to the caller's own number, delivered after a short pause so
 * they can hang up first (the app asks for no pause: it has just authorized the call with its token). Rate limited per
 * number; dedupe per minute. The call it creates is verified, once. Returns false when it was limited or a duplicate.
 */
export async function queueVerificationCall(
  ctx: MutationCtx,
  phone: string,
  language: string,
  now: number,
  delayMs: number = DEFAULTS.verificationDelayMs,
): Promise<boolean> {
  const recent = await ctx.db
    .query("notifications")
    .withIndex("by_recipientPhone_and_createdAt", (q) => q.eq("recipientPhone", phone).gt("createdAt", now - 3_600_000))
    .take(20);
  if (recent.filter((n) => n.purpose === "verification").length >= DEFAULTS.verificationsPerHour) return false;
  const dedupeKey = `verify:${phone}:${Math.floor(now / 60_000)}`;
  const dup = await ctx.db
    .query("notifications")
    .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
    .first();
  if (dup) return false;
  const notificationId = await ctx.db.insert("notifications", {
    recipientPhone: phone,
    channel: "phone_call",
    language,
    message: "Soterra verification callback",
    bulletinRefs: [],
    dedupeKey,
    purpose: "verification",
    status: "queued",
    createdAt: now,
  });
  await ctx.scheduler.runAfter(delayMs, internal.notifications.deliver, { notificationId });
  return true;
}

async function endCall(ctx: MutationCtx, call: Doc<"calls">, endedAt: number, reason: NonNullable<Doc<"calls">["endReason"]>) {
  if (call.status === "active") {
    await ctx.db.patch("calls", call._id, { status: "ended", endedAt, endReason: reason });
  }
  // finalizeCall is idempotent, so scheduling it again on a repeated end is harmless.
  await ctx.scheduler.runAfter(0, internal.memory.finalizeCall, { callId: call._id });
}

export const endSession = internalMutation({
  args: { sessionId: v.optional(v.string()), providerCallId: v.optional(v.string()), endedAt: v.number(), reason: endReason },
  returns: v.union(v.id("calls"), v.null()),
  handler: async (ctx, { endedAt, reason, ...ref }) => {
    const call = await resolveCall(ctx, ref);
    if (!call) return null;
    await endCall(ctx, call, endedAt, reason);
    return call._id;
  },
});

/** Cron: finalizes sessions that never sent /voice/session/end (silent for the sweep window). */
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

/**
 * Demo troubleshooting (dashboard or `npx convex run calls:debugCall '{"callId":"…"}'`): turns with
 * retrieved and cited chunk ids, kinds, timings and error codes. Internal only.
 */
export const debugCall = internalQuery({
  args: { callId: v.string() },
  handler: async (ctx, { callId }) => {
    const call = await resolveCall(ctx, { sessionId: callId }) ?? (await resolveCall(ctx, { providerCallId: callId }));
    if (!call) return null;
    const turns = await ctx.db
      .query("callTurns")
      .withIndex("by_callId_and_turnIndex", (q) => q.eq("callId", call._id))
      .take(100);
    const summary = await ctx.db
      .query("callSummaries")
      .withIndex("by_callId", (q) => q.eq("callId", call._id))
      .unique();
    return {
      callId: call._id,
      providerCallId: call.providerCallId,
      direction: call.direction,
      status: call.status,
      language: call.language,
      identity: call.callerContext?.identity ?? "anonymous",
      knownArea: call.knownArea?.label,
      transcriptConsent: call.transcriptConsent,
      safetyFlag: call.safetyFlag ?? false,
      summary: summary?.summary,
      turns: turns.map((t) => ({
        turnIndex: t.turnIndex,
        utterance: t.utterance,
        kind: t.kind,
        reply: t.reply,
        degraded: t.degraded ?? false,
        errorCode: t.errorCode,
        interrupted: t.interrupted ?? false,
        retriever: t.retriever,
        areaSource: t.areaSource,
        llmModel: t.llmModel,
        retrievedChunkIds: t.retrievedChunkIds ?? [],
        citedChunkIds: t.citedChunkIds ?? [],
        timingsMs: t.timingsMs ?? {},
      })),
    };
  },
});
