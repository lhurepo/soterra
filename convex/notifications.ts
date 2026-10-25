// [B] Notification delivery through the selected Notifier. Rows are created (with dedupeKey and rate
// limit) by subscriptions.queueNotification before delivery, so a retry never sends twice.
// Texts around update calls (docs/backend.md, "Calls and texts"):
// - an update call nobody answered (no session within callOutcomeCheckMs, only voicemail, or the call could not be
//   placed) → the update by text ("missed_call_text");
// - an answered update call → the update by text when it ends ("call_recap"; nothing said on the call is texted);
// - a call that set up updates → one confirmation text when it ends ("subscription_confirmation");
// - a text the number can't receive (a landline) → the subscription switches to calls, and an update is called instead.
// With SMS_NOTIFIER=mac_relay, deliver queues texts for the Mac relay instead (convex/smsRelay.ts).
import { v } from "convex/values";
import { DEFAULTS } from "../src/config/defaults";
import { loadConfig } from "../src/config/env";
import { selectNotifier } from "../src/notifications/notifier";
import { buildConfirmationText, fitText, smsFooter, stopKeyword, stopTopicMatches, withMissedCallLead } from "../src/notifications/sms";
import { looksLikeVoicemail } from "../src/orchestration/intents";
import { formatSpokenTime } from "../src/orchestration/time";
import { LANDLINE_ERROR_CODES } from "../src/providers/twilio/sms";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { cancelSubscriptionsForPhone, subscriptionTopic } from "./subscriptions";
import { notificationStatus } from "./validators";

/** An update (on change or scheduled), as opposed to the callback check or a text about a call. */
export function isUpdateNotification(n: Pick<Doc<"notifications">, "purpose">): boolean {
  return n.purpose === undefined || n.purpose === "update" || n.purpose === "scheduled_update";
}

/** "HTTP 400 code 21614: …" or "code 30006: undelivered" → whether the number can't receive texts. */
export function isLandlineError(error: string | undefined): boolean {
  const code = error?.match(/\bcode (\d+)/)?.[1];
  return code !== undefined && LANDLINE_ERROR_CODES.has(code);
}

function hotline(): string | undefined {
  return loadConfig(process.env).HOTLINE_NUMBER;
}

/** The text version of an update (rows from before texts had their own format: the spoken message with a footer). */
export function smsBody(n: Doc<"notifications">): string {
  return n.text ?? fitText(n.message, smsFooter(n.language, hotline()));
}

export async function subscriptionActive(ctx: MutationCtx, subscriptionId: Id<"subscriptions"> | undefined, now: number): Promise<boolean> {
  if (!subscriptionId) return true;
  const sub = await ctx.db.get("subscriptions", subscriptionId);
  return sub?.status === "active" && sub.expiresAt > now;
}

/** Stores a text and schedules its delivery. Not rate-limited: it belongs to an update or a call already counted. */
export async function queueText(
  ctx: MutationCtx,
  args: {
    phone: string;
    language: string;
    message: string;
    purpose: NonNullable<Doc<"notifications">["purpose"]>;
    dedupeKey: string;
    subscriptionId?: Id<"subscriptions">;
    parentNotificationId?: Id<"notifications">;
    bulletinRefs?: Id<"bulletins">[];
    now: number;
  },
): Promise<Id<"notifications"> | null> {
  const dup = await ctx.db
    .query("notifications")
    .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", args.dedupeKey))
    .first();
  if (dup) return null;
  const notificationId = await ctx.db.insert("notifications", {
    subscriptionId: args.subscriptionId,
    recipientPhone: args.phone,
    channel: "sms",
    language: args.language,
    message: args.message,
    // Already a finished text (footer included): smsBody must not add another footer.
    text: args.message,
    bulletinRefs: args.bulletinRefs ?? [],
    dedupeKey: args.dedupeKey,
    purpose: args.purpose,
    parentNotificationId: args.parentNotificationId,
    status: "queued",
    createdAt: args.now,
  });
  await ctx.scheduler.runAfter(0, internal.notifications.deliver, { notificationId });
  return notificationId;
}

/** The update call was missed: record it and text the update (unless the caller has stopped updates since). */
async function markCallMissed(ctx: MutationCtx, n: Doc<"notifications">, now: number): Promise<void> {
  await ctx.db.patch("notifications", n._id, { outcome: "missed" });
  if (!(await subscriptionActive(ctx, n.subscriptionId, now))) return;
  await queueText(ctx, {
    phone: n.recipientPhone,
    language: n.language,
    message: withMissedCallLead(smsBody(n), n.language),
    purpose: "missed_call_text",
    dedupeKey: `${n._id}:missed`,
    subscriptionId: n.subscriptionId,
    parentNotificationId: n._id,
    bulletinRefs: n.bulletinRefs,
    now,
  });
}

/** A text the number can't receive: its subscription switches to calls, and an update is called instead. */
async function textUndeliverable(ctx: MutationCtx, n: Doc<"notifications">, now: number): Promise<void> {
  if (!n.subscriptionId) return;
  const sub = await ctx.db.get("subscriptions", n.subscriptionId);
  if (!sub || sub.status !== "active") return;
  if (sub.channels.includes("sms")) await ctx.db.patch("subscriptions", sub._id, { channels: ["phone_call"] });
  if (sub.recipient.callerId) await ctx.db.patch("callers", sub.recipient.callerId, { preferredChannel: "phone_call" });
  if (!isUpdateNotification(n)) return;
  const dedupeKey = `${n._id}:landline`;
  const dup = await ctx.db
    .query("notifications")
    .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
    .first();
  if (dup) return;
  const notificationId = await ctx.db.insert("notifications", {
    subscriptionId: n.subscriptionId,
    recipientPhone: n.recipientPhone,
    channel: "phone_call",
    language: n.language,
    message: n.message,
    text: n.text,
    bulletinRefs: n.bulletinRefs,
    dedupeKey,
    purpose: n.purpose ?? "update",
    parentNotificationId: n._id,
    status: "queued",
    createdAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.notifications.deliver, { notificationId });
}

/**
 * Called by memory.finalizeCall. On an update callback: answered (the caller said something that is not an answering
 * machine) → the update by text, so they have it in writing; otherwise → missed, the update with "We tried to call you." On any call that set up updates → one confirmation text.
 */
export async function sendAfterCallTexts(ctx: MutationCtx, call: Doc<"calls">, now: number): Promise<void> {
  const turns = await ctx.db
    .query("callTurns")
    .withIndex("by_callId_and_turnIndex", (q) => q.eq("callId", call._id))
    .take(100);

  if (call.direction === "outbound" && call.notificationId) {
    const n = await ctx.db.get("notifications", call.notificationId);
    if (n && n.channel === "phone_call" && isUpdateNotification(n) && n.outcome === undefined) {
      if (!turns.some((t) => !looksLikeVoicemail(t.utterance))) {
        await markCallMissed(ctx, n, now);
      } else {
        await ctx.db.patch("notifications", n._id, { outcome: "answered" });
        if (await subscriptionActive(ctx, n.subscriptionId, now)) {
          await queueText(ctx, {
            phone: n.recipientPhone,
            language: n.language,
            message: smsBody(n),
            purpose: "call_recap",
            dedupeKey: `${n._id}:recap`,
            subscriptionId: n.subscriptionId,
            parentNotificationId: n._id,
            bulletinRefs: n.bulletinRefs,
            now,
          });
        }
      }
    }
  }

  if (!call.callerPhone) return;
  const subs = (
    await ctx.db
      .query("subscriptions")
      .withIndex("by_createdFromCallId", (q) => q.eq("createdFromCallId", call._id))
      .take(10)
  ).filter((s) => s.status === "active" && s.expiresAt > now);
  if (subs.length === 0) return;
  const language = subs[subs.length - 1].language;
  const items = subs.map((s) => ({
    channel: s.channels[0] ?? "phone_call",
    intervalMs: s.mode === "scheduled" ? s.intervalMs : undefined,
    topic: subscriptionTopic({ ...s, language }),
  }));
  const until = formatSpokenTime(Math.max(...subs.map((s) => s.expiresAt)), subs[0].target.area?.state ?? call.knownArea?.state, language);
  await queueText(ctx, {
    phone: call.callerPhone,
    language,
    message: buildConfirmationText(items, until, language, hotline()),
    purpose: "subscription_confirmation",
    dedupeKey: `${call._id}:confirm`,
    subscriptionId: subs[0]._id,
    now,
  });
}

export const get = internalQuery({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => await ctx.db.get("notifications", notificationId),
});

/** Stores a delivery result, then what follows from it (see the top of this file). Shared with convex/smsRelay.ts. */
export async function applyResult(
  ctx: MutationCtx,
  notificationId: Id<"notifications">,
  result: { status: Doc<"notifications">["status"]; providerRef?: string; error?: string; providerStatus?: string },
  now: number,
): Promise<void> {
  await ctx.db.patch("notifications", notificationId, {
    ...result,
    deliveredAt: result.status === "sent" || result.status === "mock" || result.status === "queued" ? now : undefined,
  });
  const n = await ctx.db.get("notifications", notificationId);
  if (!n || result.error === "subscription_inactive") return;
  if (n.channel === "phone_call" && isUpdateNotification(n)) {
    if (result.status === "failed" || result.status === "unconfigured") {
      // The call could not even be placed: text the update now.
      await markCallMissed(ctx, n, now);
    } else {
      await ctx.scheduler.runAfter(DEFAULTS.callOutcomeCheckMs, internal.notifications.checkCallOutcome, { notificationId });
    }
  } else if (n.channel === "sms" && result.status === "failed" && isLandlineError(result.error)) {
    await textUndeliverable(ctx, n, now);
  }
}

/** Stores the notifier's result, then what follows from it (see the top of this file). */
export const recordResult = internalMutation({
  args: {
    notificationId: v.id("notifications"),
    status: notificationStatus,
    providerRef: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { notificationId, ...result }) => {
    await applyResult(ctx, notificationId, result, Date.now());
    return null;
  },
});

export const deliver = internalAction({
  args: { notificationId: v.id("notifications") },
  returns: v.null(),
  handler: async (ctx, { notificationId }) => {
    const n = await ctx.runQuery(internal.notifications.get, { notificationId });
    if (!n || n.status !== "queued" || n.providerRef) return null;
    // Expired or cancelled subscriptions never fire, even if the row was queued just before.
    if (n.subscriptionId) {
      const active = await ctx.runQuery(internal.notifications.subscriptionIsActive, { subscriptionId: n.subscriptionId, now: Date.now() });
      if (!active) {
        await ctx.runMutation(internal.notifications.recordResult, { notificationId, status: "failed", error: "subscription_inactive" });
        return null;
      }
    }
    try {
      const cfg = loadConfig(process.env);
      if (n.channel === "sms" && cfg.SMS_NOTIFIER === "mac_relay") {
        // The Mac relay pulls it (convex/smsRelay.ts) and reports the result; nothing is sent from here.
        await ctx.runMutation(internal.smsRelay.enqueue, { notificationId });
        return null;
      }
      const siteUrl = process.env.CONVEX_SITE_URL;
      const notifier = selectNotifier(cfg, n.channel, fetch, {
        smsStatusCallbackUrl: siteUrl ? `${siteUrl.replace(/\/$/, "")}/twilio/status` : undefined,
      });
      const result = await notifier.send({
        recipientPhone: n.recipientPhone,
        channel: n.channel,
        language: n.language,
        message: n.channel === "sms" ? smsBody(n) : n.message,
        bulletinRefs: n.bulletinRefs,
        dedupeKey: n.dedupeKey,
        subscriptionId: n.subscriptionId,
        notificationId,
      });
      await ctx.runMutation(internal.notifications.recordResult, { notificationId, ...result });
    } catch (err) {
      console.error(`[notifications] delivery of ${notificationId} failed:`, err);
      await ctx.runMutation(internal.notifications.recordResult, {
        notificationId,
        status: err instanceof Error && err.name === "NotConfiguredError" ? "unconfigured" : "failed",
        error: String(err).slice(0, 500),
      });
    }
    return null;
  },
});

/**
 * Scheduled callOutcomeCheckMs after an update call is placed. No session for it by then: nobody picked up, so the
 * update is texted. A session exists: memory.finalizeCall decides (answered → recap, voicemail only → missed).
 */
export const checkCallOutcome = internalMutation({
  args: { notificationId: v.id("notifications") },
  returns: v.null(),
  handler: async (ctx, { notificationId }) => {
    const n = await ctx.db.get("notifications", notificationId);
    if (!n || n.outcome !== undefined || n.channel !== "phone_call" || !isUpdateNotification(n)) return null;
    const call = await ctx.db
      .query("calls")
      .withIndex("by_notificationId", (q) => q.eq("notificationId", notificationId))
      .first();
    if (!call) await markCallMissed(ctx, n, Date.now());
    return null;
  },
});

/** Twilio status callback (POST /twilio/status): delivered, or failed with an error code. */
export const recordTextStatus = internalMutation({
  args: { sid: v.string(), status: v.string(), errorCode: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { sid, status, errorCode }) => {
    const n = await ctx.db
      .query("notifications")
      .withIndex("by_providerRef", (q) => q.eq("providerRef", sid))
      .first();
    if (!n || n.channel !== "sms") return null;
    const now = Date.now();
    if (status === "delivered" || status === "sent") {
      // A late "sent" never overwrites a failure.
      if (n.status !== "failed") await ctx.db.patch("notifications", n._id, { status: "sent", providerStatus: status, deliveredAt: n.deliveredAt ?? now });
    } else if (status === "failed" || status === "undelivered") {
      const error = `code ${errorCode ?? "unknown"}: ${status}`;
      await ctx.db.patch("notifications", n._id, { status: "failed", providerStatus: status, error });
      if (isLandlineError(error)) await textUndeliverable(ctx, { ...n, error }, now);
    } else {
      await ctx.db.patch("notifications", n._id, { providerStatus: status });
    }
    return null;
  },
});

/** A text reply of STOP (POST /twilio/inbound): the same as saying "stop updates" on a call. */
export const stopByText = internalMutation({
  args: { phone: v.string() },
  returns: v.number(),
  handler: async (ctx, { phone }) => await cancelSubscriptionsForPhone(ctx, phone, Date.now()),
});

/**
 * A text reply of "STOP COOLEY FIRE" (POST /twilio/inbound): cancels the subscriptions of this number whose topic or
 * keyword it names, and leaves the others. Returns the topics cancelled and the language to reply in.
 */
export const stopTopicByText = internalMutation({
  args: { phone: v.string(), requested: v.string() },
  returns: v.object({ topics: v.array(v.string()), language: v.string() }),
  handler: async (ctx, { phone, requested }) => {
    const now = Date.now();
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_recipientPhone_and_status", (q) => q.eq("recipient.phone", phone).eq("status", "active"))
      .take(100);
    const topics: string[] = [];
    for (const s of subs) {
      const topic = subscriptionTopic(s);
      if (!stopTopicMatches(requested, [topic, stopKeyword(s.target, topic, s.language).replace(/^STOP /, "")])) continue;
      await ctx.db.patch("subscriptions", s._id, { status: "cancelled", cancelledAt: now });
      if (!topics.includes(topic)) topics.push(topic);
    }
    return { topics, language: subs[0]?.language ?? "en" };
  },
});

export const subscriptionIsActive = internalQuery({
  args: { subscriptionId: v.id("subscriptions"), now: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { subscriptionId, now }) => {
    const sub = await ctx.db.get("subscriptions", subscriptionId);
    return sub?.status === "active" && sub.expiresAt > now;
  },
});

/** Most recent notification attempts, newest first (used by `npm run inject:update` and for demo troubleshooting). */
export const recent = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db.query("notifications").order("desc").take(Math.min(limit ?? 10, 50));
    return rows.map((n) => ({
      notificationId: n._id,
      status: n.status,
      channel: n.channel,
      purpose: n.purpose ?? "update",
      outcome: n.outcome,
      recipientPhone: n.recipientPhone,
      message: n.channel === "sms" ? (n.text ?? n.message) : n.message,
      createdAt: n.createdAt,
      error: n.error,
      dedupeKey: n.dedupeKey,
    }));
  },
});
