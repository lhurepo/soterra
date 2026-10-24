// [B] Follow-ups: "call me if it changes" creates a subscription; bulletin events are matched to them.
// The hot path only calls createFromCall. Matching and delivery run asynchronously.
import { v } from "convex/values";
import { dedupeKeyFor, eventMatches } from "../src/notifications/match";
import { buildUpdateMessage } from "../src/notifications/message";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { areaRef, subscriptionTrigger } from "./validators";

const SUBSCRIPTION_TTL_MS = 7 * 86_400_000;

/** Returns null when the caller's number is withheld: there is nobody to call back. */
export const createFromCall = internalMutation({
  args: {
    callId: v.id("calls"),
    language: v.string(),
    request: v.object({
      targetKind: v.union(v.literal("incident"), v.literal("area"), v.literal("question")),
      incidentKey: v.optional(v.string()),
      area: v.optional(areaRef),
      trigger: subscriptionTrigger,
    }),
  },
  returns: v.union(v.id("subscriptions"), v.null()),
  handler: async (ctx, { callId, language, request }) => {
    const call = await ctx.db.get("calls", callId);
    if (!call?.callerPhone) return null;
    const phone = call.callerPhone;

    if (request.incidentKey) {
      const incidentKey = request.incidentKey;
      const existing = await ctx.db
        .query("subscriptions")
        .withIndex("by_status_and_targetIncidentKey", (q) => q.eq("status", "active").eq("target.incidentKey", incidentKey))
        .take(200);
      const mine = existing.find((s) => s.recipient.phone === phone);
      if (mine) return mine._id;
    }

    const now = Date.now();
    return await ctx.db.insert("subscriptions", {
      recipient: { callerId: call.callerId, accountId: call.accountId, phone },
      target: { kind: request.targetKind, incidentKey: request.incidentKey, area: request.area ?? call.knownArea },
      trigger: request.trigger,
      channels: ["phone_call"],
      language,
      status: "active",
      consentAt: now,
      createdVia: "call",
      expiresAt: now + SUBSCRIPTION_TTL_MS,
      createdFromCallId: callId,
    });
  },
});

/** Scheduled by upsertBulletins whenever it writes bulletin events. */
export const matchEvents = internalMutation({
  args: { eventIds: v.array(v.id("bulletinEvents")) },
  returns: v.number(),
  handler: async (ctx, { eventIds }) => {
    const now = Date.now();
    let created = 0;
    for (const eventId of eventIds) {
      const event = await ctx.db.get("bulletinEvents", eventId);
      if (!event || event.matchedAt !== undefined) continue;
      const bulletin = await ctx.db.get("bulletins", event.bulletinId);
      if (!bulletin || bulletin.trustTier === "unverified") continue;
      const areas = await ctx.db
        .query("bulletinAreas")
        .withIndex("by_bulletinId", (q) => q.eq("bulletinId", bulletin._id))
        .take(50);

      const candidates: Doc<"subscriptions">[] = [];
      if (event.incidentKey) {
        const incidentKey = event.incidentKey;
        candidates.push(
          ...(await ctx.db
            .query("subscriptions")
            .withIndex("by_status_and_targetIncidentKey", (q) => q.eq("status", "active").eq("target.incidentKey", incidentKey))
            .take(200)),
        );
      }
      // Area subscriptions have no incident key. TODO(B): index area targets if this grows.
      candidates.push(
        ...(
          await ctx.db
            .query("subscriptions")
            .withIndex("by_status_and_targetIncidentKey", (q) => q.eq("status", "active").eq("target.incidentKey", undefined))
            .take(200)
        ).filter((s) => s.target.kind === "area"),
      );

      for (const sub of candidates) {
        if (sub.expiresAt <= now) continue;
        const matches = eventMatches(sub, {
          change: event.change,
          incidentKey: event.incidentKey,
          severityBefore: event.severityBefore,
          severityAfter: event.severityAfter,
          hazardType: bulletin.hazardType,
          areaStates: areas.map((a) => a.state),
          areaCountyFips: areas.flatMap((a) => (a.countyFips ? [a.countyFips] : [])),
        });
        if (!matches) continue;
        const dedupeKey = dedupeKeyFor(sub._id, bulletin._id, event.versionNumber);
        const dup = await ctx.db
          .query("notifications")
          .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
          .unique();
        if (dup) continue;
        const notificationId = await ctx.db.insert("notifications", {
          subscriptionId: sub._id,
          recipientPhone: sub.recipient.phone,
          channel: sub.channels[0],
          language: sub.language,
          message: buildUpdateMessage(bulletin, sub.language),
          bulletinRefs: [bulletin._id],
          dedupeKey,
          status: "queued",
          createdAt: now,
        });
        await ctx.db.patch("subscriptions", sub._id, { lastNotifiedAt: now });
        await ctx.scheduler.runAfter(0, internal.notifications.deliver, { notificationId });
        created++;
      }
      await ctx.db.patch("bulletinEvents", eventId, { matchedAt: now });
    }
    return created;
  },
});
