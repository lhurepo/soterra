// [B] Mac Messages relay (SMS_NOTIFIER=mac_relay; docs/mac-relay.md). A Mac signed into the same Apple ID as a
// teammate's iPhone (Text Message Forwarding on) runs `npm run relay:mac`, which polls over HTTPS:
// - deliver (convex/notifications.ts) marks each text "pending" instead of calling a Notifier;
// - POST /relay/claim hands out up to RELAY_MAX_PER_CLAIM pending texts with a claim token, fails texts that waited
//   too long (relay_stale) or whose subscription ended, and fails claimed texts with no result (relay_lost);
// - POST /relay/result records what Messages.app did ("sent" = handed to Messages, not delivered), through the same
//   applyResult as every other notifier. A late "sent" for a relay_lost text corrects it.
// Both routes need `Authorization: Bearer <SMS_RELAY_SECRET>`. Nothing here reads replies: STOP texts reach the phone.
import { v } from "convex/values";
import { E164 } from "../src/contracts/common";
import {
  ClaimRequest,
  RELAY_LOST_MS,
  RELAY_MAX_PER_CLAIM,
  RELAY_ONLINE_MS,
  RELAY_STALE_MS,
  ResultRequest,
} from "../src/notifications/relay";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, internalMutation, internalQuery } from "./_generated/server";
import { loadConfig } from "../src/config/env";
import { normalizeE164 } from "../src/memory/phone";
import { config, errorResponse, json, parseBody, requireBearer } from "./lib/http";
import { applyResult, queueText, smsBody, subscriptionActive } from "./notifications";

/** A heartbeat is rewritten at most this often, so a relay polling every 2 s does not write on every claim. */
const HEARTBEAT_WRITE_MS = 30_000;
const SCAN = 20;

const completeOutcome = v.union(v.literal("ok"), v.literal("not_found"), v.literal("token_mismatch"), v.literal("already_done"));

/** Called by deliver: the text waits for the relay. Only a queued text the relay has never seen. */
export const enqueue = internalMutation({
  args: { notificationId: v.id("notifications") },
  returns: v.null(),
  handler: async (ctx, { notificationId }) => {
    const n = await ctx.db.get("notifications", notificationId);
    if (n && n.status === "queued" && n.relayState === undefined) {
      await ctx.db.patch("notifications", notificationId, { relayState: "pending" });
    }
    return null;
  },
});

export const claim = internalMutation({
  args: { relayId: v.string() },
  returns: v.array(v.object({ notificationId: v.id("notifications"), to: v.string(), body: v.string(), claimToken: v.string() })),
  handler: async (ctx, { relayId }) => {
    const now = Date.now();

    // (a) Claimed with no result for too long: the relay crashed or lost the response.
    const lost = await ctx.db
      .query("notifications")
      .withIndex("by_relayState_and_relayClaimedAt", (q) => q.eq("relayState", "claimed").lt("relayClaimedAt", now - RELAY_LOST_MS))
      .take(SCAN);
    for (const n of lost) {
      await ctx.db.patch("notifications", n._id, { relayState: "done" });
      await applyResult(ctx, n._id, { status: "failed", error: "relay_lost" }, now);
    }

    // (b) Oldest pending first.
    const pending = await ctx.db
      .query("notifications")
      .withIndex("by_relayState_and_createdAt", (q) => q.eq("relayState", "pending"))
      .take(SCAN);
    const items: { notificationId: Id<"notifications">; to: string; body: string; claimToken: string }[] = [];
    const claimToken = crypto.randomUUID();
    for (const n of pending) {
      if (items.length >= RELAY_MAX_PER_CLAIM) break;
      const failure =
        n.status !== "queued"
          ? "not_queued"
          : n.createdAt < now - RELAY_STALE_MS
            ? "relay_stale"
            : !(await subscriptionActive(ctx, n.subscriptionId, now))
              ? "subscription_inactive"
              : !E164.safeParse(n.recipientPhone).success
                ? "invalid_phone"
                : null;
      if (failure === null) {
        await ctx.db.patch("notifications", n._id, { relayState: "claimed", relayClaimToken: claimToken, relayClaimedAt: now });
        items.push({ notificationId: n._id, to: n.recipientPhone, body: smsBody(n), claimToken });
        continue;
      }
      await ctx.db.patch("notifications", n._id, { relayState: "done" });
      // A row that is no longer queued already has its result: it only leaves the relay queue.
      if (failure !== "not_queued") await applyResult(ctx, n._id, { status: "failed", error: failure }, now);
    }

    // (c) Heartbeat for /health.
    const beat = await ctx.db
      .query("smsRelayHeartbeats")
      .withIndex("by_relayId", (q) => q.eq("relayId", relayId))
      .first();
    if (!beat) await ctx.db.insert("smsRelayHeartbeats", { relayId, lastSeenAt: now });
    else if (beat.lastSeenAt < now - HEARTBEAT_WRITE_MS) await ctx.db.patch("smsRelayHeartbeats", beat._id, { lastSeenAt: now });

    return items;
  },
});

export const complete = internalMutation({
  args: {
    notificationId: v.string(),
    claimToken: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  returns: completeOutcome,
  handler: async (ctx, { notificationId, claimToken, status, error }) => {
    const id = ctx.db.normalizeId("notifications", notificationId);
    const n = id ? await ctx.db.get("notifications", id) : null;
    if (!id || !n || n.relayState === undefined) return "not_found";
    if (n.relayClaimToken !== claimToken) return "token_mismatch";
    const now = Date.now();
    const providerRef = `mac-relay:${id}`;
    if (n.relayState === "claimed") {
      await ctx.db.patch("notifications", id, { relayState: "done" });
      await applyResult(
        ctx,
        id,
        status === "sent"
          ? { status: "sent", providerRef, providerStatus: "handed_to_messages" }
          : { status: "failed", providerRef, error: error ?? "relay_failed" },
        now,
      );
      return "ok";
    }
    if (n.relayState === "done" && n.error === "relay_lost" && status === "sent") {
      // The relay sent it after all, past RELAY_LOST_MS. Nothing follows from relay_lost, so nothing to undo.
      await ctx.db.patch("notifications", id, { status: "sent", deliveredAt: now, error: undefined, providerRef, providerStatus: "handed_to_messages" });
      return "ok";
    }
    return "already_done";
  },
});

/**
 * One test text through the relay: `npx convex run smsRelay:queueTest '{"phone":"+1…"}'`. Only in mac_relay mode, so it
 * can never go out through Twilio. Only to numbers whose owners agreed (the relay also checks RELAY_ALLOWLIST).
 */
export const queueTest = internalMutation({
  args: { phone: v.string() },
  returns: v.id("notifications"),
  handler: async (ctx, { phone }) => {
    if (loadConfig(process.env).SMS_NOTIFIER !== "mac_relay") throw new Error('queueTest needs SMS_NOTIFIER=mac_relay');
    const to = normalizeE164(phone);
    if (!to) throw new Error(`not a phone number: ${phone}`);
    const now = Date.now();
    const id = await queueText(ctx, {
      phone: to,
      language: "en",
      message: "Soterra test: this text came through the Mac relay. No action needed.",
      purpose: "subscription_confirmation",
      dedupeKey: `relay-test:${to}:${now}`,
      now,
    });
    return id!;
  },
});

/** Most recent heartbeat of any relay, or null. */
export const lastSeen = internalQuery({
  args: {},
  returns: v.union(v.number(), v.null()),
  handler: async (ctx) => {
    const beats = await ctx.db.query("smsRelayHeartbeats").take(10);
    return beats.length === 0 ? null : Math.max(...beats.map((b) => b.lastSeenAt));
  },
});

/** For /health: a relay claimed within RELAY_ONLINE_MS. */
export function relayOnline(lastSeenAt: number | null, now: number): boolean {
  return lastSeenAt !== null && now - lastSeenAt <= RELAY_ONLINE_MS;
}

/** Auth first, then the mode: a relay pointed at a deployment that is not in mac_relay mode should stop, not idle. */
function guard(req: Request): Response | null {
  const cfg = config();
  const denied = requireBearer(req, cfg.SMS_RELAY_SECRET, "SMS_RELAY_SECRET");
  if (denied) return denied;
  if (cfg.SMS_NOTIFIER !== "mac_relay") return errorResponse(409, "bad_request", `SMS_NOTIFIER is "${cfg.SMS_NOTIFIER}", not "mac_relay"`);
  return null;
}

export const relayClaim = httpAction(async (ctx, req) => {
  const denied = guard(req);
  if (denied) return denied;
  const body = await parseBody(req, ClaimRequest);
  if (!body.ok) return body.response;
  const items = await ctx.runMutation(internal.smsRelay.claim, { relayId: body.data.relayId });
  return json({ items });
});

export const relayResult = httpAction(async (ctx, req) => {
  const denied = guard(req);
  if (denied) return denied;
  const body = await parseBody(req, ResultRequest);
  if (!body.ok) return body.response;
  const outcome = await ctx.runMutation(internal.smsRelay.complete, body.data);
  if (outcome === "ok") return json({ ok: true });
  if (outcome === "not_found") return errorResponse(404, "not_found", "no relay text with this notificationId");
  return errorResponse(409, "bad_request", outcome);
});
