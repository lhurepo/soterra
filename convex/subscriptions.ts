// [B] Follow-ups: "call me if it changes" creates a subscription; bulletin events are matched to them.
// The hot path only creates or cancels subscriptions (inside calls.completeTurn). Matching and delivery
// run asynchronously. Every notification attempt is stored, including rate-limited ones.
import { v } from "convex/values";
import type { FollowUpRequest } from "../src/contracts";
import { clampIntervalMs, subscriptionLifetimeMs } from "../src/notifications/schedule";
import { RATE_LIMITED_ERROR, dedupeKeyFor, eventMatches, rateLimited } from "../src/notifications/match";
import { buildUpdateMessage } from "../src/notifications/message";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";

function sameTarget(a: Doc<"subscriptions">["target"], b: Doc<"subscriptions">["target"]): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "incident") return a.incidentKey === b.incidentKey;
  if (a.kind === "question") return a.unansweredQuestionId === b.unansweredQuestionId;
  return (a.area?.countyFips ?? a.area?.label) === (b.area?.countyFips ?? b.area?.label) && a.area?.state === b.area?.state;
}

/**
 * Creates (or refreshes) a subscription for the call's caller. Returns null when there is no number to
 * call back or nothing to watch. Lifetime: DEFAULTS.subscriptionTtlMs, never more than the maximum.
 */
export async function createSubscriptionForCall(
  ctx: MutationCtx,
  call: Doc<"calls">,
  request: FollowUpRequest,
  language: string,
  now: number,
): Promise<Id<"subscriptions"> | null> {
  const phone = call.callerPhone;
  if (!phone) return null;

  let target: Doc<"subscriptions">["target"];
  if (request.targetKind === "question") {
    const questions = await ctx.db
      .query("unansweredQuestions")
      .withIndex("by_callId_and_turnIndex", (q) => q.eq("callId", call._id))
      .order("desc")
      .take(20);
    const open = questions.find((q) => q.status === "open");
    if (!open) return null;
    target = { kind: "question", unansweredQuestionId: open._id };
  } else if (request.targetKind === "incident") {
    if (!request.incidentKey) return null;
    target = { kind: "incident", incidentKey: request.incidentKey };
  } else {
    const area = request.area ?? call.knownArea;
    if (!area) return null;
    target = { kind: "area", area };
  }
  const trigger = target.kind === "question" ? "answer_available" : request.trigger === "answer_available" ? "any_update" : request.trigger;
  const channel = request.channel ?? "phone_call";
  // Time-based updates ("every 2 hours"); a question is answered once, never on a schedule.
  const intervalMs = request.intervalMinutes === undefined || target.kind === "question" ? undefined : clampIntervalMs(request.intervalMinutes);
  const mode = intervalMs === undefined ? "on_change" : "scheduled";
  const expiresAt = now + subscriptionLifetimeMs(intervalMs);
  const schedule = intervalMs === undefined ? {} : { intervalMs, nextRunAt: now + intervalMs };

  if (call.callerId) await ctx.db.patch("callers", call.callerId, { preferredChannel: channel });

  const mine = await ctx.db
    .query("subscriptions")
    .withIndex("by_recipientPhone_and_status", (q) => q.eq("recipient.phone", phone).eq("status", "active"))
    .take(50);
  const same = mine.find((s) => sameTarget(s.target, target) && s.trigger === trigger && (s.mode ?? "on_change") === mode);
  if (same) {
    // Asking again refreshes it, and the newest request decides the channel and interval.
    await ctx.db.patch("subscriptions", same._id, { expiresAt, consentAt: now, language, channels: [channel], createdFromCallId: call._id, ...schedule });
    return same._id;
  }
  return await ctx.db.insert("subscriptions", {
    recipient: { callerId: call.callerId, accountId: call.accountId, phone },
    target,
    trigger,
    channels: [channel],
    language,
    status: "active",
    consentAt: now,
    createdVia: "call",
    expiresAt,
    createdFromCallId: call._id,
    mode,
    ...schedule,
  });
}

/** "Stop updates": cancels every active subscription for this number. Returns how many were cancelled. */
export async function cancelSubscriptionsForPhone(ctx: MutationCtx, phone: string, now: number): Promise<number> {
  const subs = await ctx.db
    .query("subscriptions")
    .withIndex("by_recipientPhone_and_status", (q) => q.eq("recipient.phone", phone).eq("status", "active"))
    .take(100);
  for (const s of subs) await ctx.db.patch("subscriptions", s._id, { status: "cancelled", cancelledAt: now });
  return subs.length;
}

/**
 * Stores one notification attempt and schedules delivery, unless the dedupe key was already used or
 * the subscription is rate-limited (then the attempt is stored as failed/"rate_limited" and not sent).
 */
/** Matches of different requests for the same number inside this window collapse into one call. */
const PHONE_BURST_MS = 2 * 60_000;

export async function queueNotification(
  ctx: MutationCtx,
  sub: Doc<"subscriptions">,
  n: { dedupeKey: string; message: string; bulletinRefs: Id<"bulletins">[]; now: number },
): Promise<"queued" | "duplicate" | "rate_limited"> {
  const dup = await ctx.db
    .query("notifications")
    .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", n.dedupeKey))
    .first();
  if (dup) return "duplicate";

  const recent = await ctx.db
    .query("notifications")
    .withIndex("by_subscriptionId_and_createdAt", (q) => q.eq("subscriptionId", sub._id).gt("createdAt", n.now - 3_600_000))
    .take(20);
  // One phone gets one update call per burst: several requests ("California", "San Francisco") can match the same
  // alert, and ringing the same number three times at once is a busy signal and a nuisance.
  const sameNumber = await ctx.db
    .query("notifications")
    .withIndex("by_recipientPhone_and_createdAt", (q) => q.eq("recipientPhone", sub.recipient.phone).gt("createdAt", n.now - PHONE_BURST_MS))
    .take(10);
  const burst = sameNumber.some((r) => r.purpose !== "verification" && r.status !== "failed");
  const limited = burst
    ? ("phone_burst" as const)
    : rateLimited(
        recent.filter((r) => !r.error?.startsWith(RATE_LIMITED_ERROR)).map((r) => r.createdAt),
        n.now,
      );
  const notificationId = await ctx.db.insert("notifications", {
    subscriptionId: sub._id,
    recipientPhone: sub.recipient.phone,
    channel: sub.channels[0],
    language: sub.language,
    message: n.message,
    bulletinRefs: n.bulletinRefs,
    dedupeKey: n.dedupeKey,
    status: limited ? "failed" : "queued",
    error: limited ? `${RATE_LIMITED_ERROR}: ${limited}` : undefined,
    createdAt: n.now,
  });
  if (limited) return "rate_limited";
  await ctx.db.patch("subscriptions", sub._id, { lastNotifiedAt: n.now });
  await ctx.scheduler.runAfter(0, internal.notifications.deliver, { notificationId });
  return "queued";
}

/** Scheduled by upsertBulletins whenever it writes bulletin events. */
export const matchEvents = internalMutation({
  args: { eventIds: v.array(v.id("bulletinEvents")) },
  returns: v.number(),
  handler: async (ctx, { eventIds }) => {
    const now = Date.now();
    let queued = 0;
    // The most important event first: when several land together, a phone gets one call per burst, and it should be
    // about the evacuation, not a shelter capacity change.
    const SEVERITY_POINTS: Record<string, number> = { extreme: 4, severe: 3, moderate: 2, minor: 1 };
    const priority = new Map<Id<"bulletinEvents">, number>();
    for (const id of eventIds) {
      const e = await ctx.db.get("bulletinEvents", id);
      const b = e ? await ctx.db.get("bulletins", e.bulletinId) : null;
      priority.set(id, (b?.hazardType === "evacuation" ? 10 : 0) + (SEVERITY_POINTS[e?.severityAfter ?? ""] ?? 0));
    }
    const ordered = [...eventIds].sort((a, b) => (priority.get(b) ?? 0) - (priority.get(a) ?? 0));
    for (const eventId of ordered) {
      const event = await ctx.db.get("bulletinEvents", eventId);
      if (!event || event.matchedAt !== undefined) continue;
      const bulletin = await ctx.db.get("bulletins", event.bulletinId);
      // Only official content that may be served triggers callbacks.
      if (!bulletin || bulletin.trustTier === "unverified" || (bulletin.status !== "actual" && bulletin.status !== "cancelled")) {
        await ctx.db.patch("bulletinEvents", eventId, { matchedAt: now });
        continue;
      }
      const areas = await ctx.db
        .query("bulletinAreas")
        .withIndex("by_bulletinId", (q) => q.eq("bulletinId", bulletin._id))
        .take(50);

      const candidates = new Map<Id<"subscriptions">, Doc<"subscriptions">>();
      if (event.incidentKey) {
        const incidentKey = event.incidentKey;
        for (const s of await ctx.db
          .query("subscriptions")
          .withIndex("by_status_and_targetIncidentKey", (q) => q.eq("status", "active").eq("target.incidentKey", incidentKey))
          .take(200)) {
          candidates.set(s._id, s);
        }
      }
      for (const s of await ctx.db
        .query("subscriptions")
        .withIndex("by_status_and_targetKind", (q) => q.eq("status", "active").eq("target.kind", "area"))
        .take(200)) {
        candidates.set(s._id, s);
      }

      for (const sub of candidates.values()) {
        const matches = eventMatches(
          sub,
          {
            change: event.change,
            incidentKey: event.incidentKey,
            severityBefore: event.severityBefore,
            severityAfter: event.severityAfter,
            hazardType: bulletin.hazardType,
            areas: areas.map((a) => ({ state: a.state, countyFips: a.countyFips, nwsZone: a.nwsZone })),
          },
          now,
        );
        if (!matches) continue;
        const result = await queueNotification(ctx, sub, {
          dedupeKey: dedupeKeyFor(sub._id, bulletin._id, event.versionNumber),
          message: buildUpdateMessage(bulletin, sub.language),
          bulletinRefs: [bulletin._id],
          now,
        });
        if (result === "queued") queued++;
      }
      await ctx.db.patch("bulletinEvents", eventId, { matchedAt: now });
    }
    return queued;
  },
});

/** Cron: marks subscriptions past expiresAt as expired (the matcher already ignores them). */
export const expireSubscriptions = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("subscriptions")
      .withIndex("by_status_and_expiresAt", (q) => q.eq("status", "active").lt("expiresAt", now))
      .take(100);
    for (const s of expired) await ctx.db.patch("subscriptions", s._id, { status: "expired" });
    return expired.length;
  },
});
