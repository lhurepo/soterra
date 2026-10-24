// [B] Notification delivery through the selected Notifier. Rows are created (with dedupeKey) by
// subscriptions.matchEvents before delivery, so a retry never sends twice.
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
      deliveredAt: result.status === "sent" || result.status === "mock" ? Date.now() : undefined,
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
    const notifier = selectNotifier(loadConfig(process.env), n.channel, fetch);
    try {
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
      await ctx.runMutation(internal.notifications.recordResult, {
        notificationId,
        status: err instanceof Error && err.name === "NotConfiguredError" ? "unconfigured" : "failed",
        error: String(err),
      });
    }
    return null;
  },
});
