// [B] Notification delivery through the selected Notifier. Rows are created (with dedupeKey and rate
// limit) by subscriptions.queueNotification before delivery, so a retry never sends twice.
import { v } from "convex/values";
import { loadConfig } from "../src/config/env";
import { selectNotifier } from "../src/notifications/notifier";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { notificationStatus } from "./validators";

export const get = internalQuery({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => await ctx.db.get("notifications", notificationId),
});

export const recordResult = internalMutation({
  args: {
    notificationId: v.id("notifications"),
    status: notificationStatus,
    providerRef: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { notificationId, ...result }) => {
    await ctx.db.patch("notifications", notificationId, {
      ...result,
      deliveredAt: result.status === "sent" || result.status === "mock" || result.status === "queued" ? Date.now() : undefined,
    });
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
      const notifier = selectNotifier(loadConfig(process.env), n.channel, fetch);
      const result = await notifier.send({
        recipientPhone: n.recipientPhone,
        channel: n.channel,
        language: n.language,
        message: n.message,
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
    return rows.map((n) => ({ notificationId: n._id, status: n.status, recipientPhone: n.recipientPhone, message: n.message, createdAt: n.createdAt, error: n.error, dedupeKey: n.dedupeKey }));
  },
});
