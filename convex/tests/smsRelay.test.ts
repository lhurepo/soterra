// [B] Mac Messages relay (SMS_NOTIFIER=mac_relay): texts wait as "pending", POST /relay/claim hands them out with a
// claim token, POST /relay/result records the outcome. No notifier runs (no Twilio request), and nothing is sent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS } from "../../src/config/defaults";
import { HealthResponse } from "../../src/contracts";
import { ClaimResponse, RELAY_LOST_MS, RELAY_MAX_PER_CLAIM, RELAY_ONLINE_MS, RELAY_STALE_MS } from "../../src/notifications/relay";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { smsBody } from "../notifications";
import { newTest, setupEnv, type TestConvex } from "../test.setup";
import { PHONE, callTexts, end, say, seedBulletins, settle, start, updateDrafts, updateNotifications, useDemoClock } from "./backend.helpers";

const SITE = "https://example-test.convex.site";
const RELAY_SECRET = "test-relay-secret";
const RELAY_ENV = { CONVEX_SITE_URL: SITE, HOTLINE_NUMBER: "+17126003362", SMS_NOTIFIER: "mac_relay", SMS_RELAY_SECRET: RELAY_SECRET };

beforeEach(() => {
  useDemoClock();
  setupEnv(RELAY_ENV);
});
afterEach(() => vi.useRealTimers());

async function runSoon(t: TestConvex, seconds = 8) {
  for (let i = 0; i < seconds; i++) {
    vi.advanceTimersByTime(1_000);
    await t.finishInProgressScheduledFunctions();
  }
}

/** An inbound call that asks for updates, then hangs up. */
async function ask(t: TestConvex, request: string) {
  const s = await start(t);
  await say(t, s.sessionId, 0, "What's going on with the Ridgeview Fire?");
  const r = await say(t, s.sessionId, 1, request);
  await end(t, s.sessionId);
  await runSoon(t);
  return r;
}

function relayPost(t: TestConvex, path: "/relay/claim" | "/relay/result", body: unknown, secret: string | null = RELAY_SECRET) {
  return t.fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function claim(t: TestConvex) {
  const res = await relayPost(t, "/relay/claim", { relayId: "test-mac" });
  expect(res.status).toBe(200);
  return ClaimResponse.parse(await res.json()).items;
}

const result = (t: TestConvex, notificationId: string, claimToken: string, status: "sent" | "failed", error?: string) =>
  relayPost(t, "/relay/result", { notificationId, claimToken, status, error });

const row = (t: TestConvex, id: string) => t.run(async (ctx) => (await ctx.db.get("notifications", id as Id<"notifications">))!);
const allRows = (t: TestConvex) => t.run(async (ctx) => await ctx.db.query("notifications").collect());

/** A text waiting for the relay, with no subscription, inserted directly. */
async function pendingText(t: TestConvex, over: Partial<Doc<"notifications">> = {}) {
  return await t.run(async (ctx) =>
    ctx.db.insert("notifications", {
      recipientPhone: PHONE,
      channel: "sms",
      language: "en",
      message: "Test text",
      bulletinRefs: [],
      dedupeKey: `test:${Math.random()}`,
      purpose: "update",
      status: "queued",
      createdAt: Date.now(),
      relayState: "pending",
      ...over,
    }),
  );
}

/** A text subscription with its confirmation text and one update text, both waiting for the relay. */
async function subscribedAndUpdated(t: TestConvex) {
  await seedBulletins(t);
  const r = await ask(t, "Text me if the evacuation changes");
  await seedBulletins(t, updateDrafts);
  await settle(t);
  const [update] = await updateNotifications(t);
  const [confirmation] = await callTexts(t);
  return { r, update, confirmation };
}

describe("queueing", () => {
  it("a text subscription's update waits for the relay: no notifier, no providerRef, no deliveredAt", async () => {
    const t = newTest();
    const { update, confirmation } = await subscribedAndUpdated(t);
    for (const n of [update, confirmation]) {
      expect(n).toMatchObject({ channel: "sms", status: "queued", relayState: "pending" });
      expect(n.providerRef).toBeUndefined();
      expect(n.deliveredAt).toBeUndefined();
    }
  });

  it("claim hands each text out once, with the body deliver would send", async () => {
    const t = newTest();
    const { update, confirmation } = await subscribedAndUpdated(t);
    const items = await claim(t);
    expect(items.map((i) => i.notificationId).sort()).toEqual([update._id, confirmation._id].sort());
    const byId = new Map(items.map((i) => [i.notificationId, i]));
    expect(byId.get(update._id)!.body).toBe(update.text);
    expect(byId.get(update._id)!.body).toBe(smsBody(update));
    expect(byId.get(confirmation._id)!.body).toBe(smsBody(confirmation));
    expect(items.every((i) => i.to === PHONE && i.claimToken.length > 0)).toBe(true);
    expect(await row(t, update._id)).toMatchObject({ relayState: "claimed", relayClaimToken: byId.get(update._id)!.claimToken, status: "queued" });
    expect(await claim(t)).toEqual([]);
  });

  it(`hands out at most ${RELAY_MAX_PER_CLAIM} per claim, oldest first`, async () => {
    const t = newTest();
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push(await pendingText(t, { createdAt: Date.now() - (7 - i) * 1_000 }));
    expect((await claim(t)).map((i) => i.notificationId)).toEqual(ids.slice(0, 5));
    expect((await claim(t)).map((i) => i.notificationId)).toEqual(ids.slice(5));
    expect(await claim(t)).toEqual([]);
  });

  it("missed-call texts go through the relay too", async () => {
    const t = newTest();
    await seedBulletins(t);
    await ask(t, "Please call me if the evacuation changes.");
    await seedBulletins(t, updateDrafts);
    await runSoon(t);
    vi.advanceTimersByTime(DEFAULTS.callOutcomeCheckMs);
    await settle(t);
    const texts = await callTexts(t);
    expect(texts.map((n) => [n.purpose, n.relayState, n.status]).sort()).toEqual([
      ["missed_call_text", "pending", "queued"],
      ["subscription_confirmation", "pending", "queued"],
    ]);
    const items = await claim(t);
    expect(items).toHaveLength(2);
    const missed = texts.find((n) => n.purpose === "missed_call_text")!;
    expect(items.find((i) => i.notificationId === missed._id)!.body).toMatch(/We tried to call you\./);
    // The update call itself is a call, not a relay text.
    const [call] = await updateNotifications(t);
    expect(call).toMatchObject({ channel: "phone_call", status: "mock" });
    expect(call.relayState).toBeUndefined();
  });
});

describe("results", () => {
  it("rejects a wrong token (409); the right one marks the text sent", async () => {
    const t = newTest();
    const id = await pendingText(t);
    const [item] = await claim(t);
    expect((await result(t, id, "not-the-token", "sent")).status).toBe(409);
    expect(await row(t, id)).toMatchObject({ status: "queued", relayState: "claimed" });

    const ok = await result(t, id, item.claimToken, "sent");
    expect(ok.status).toBe(200);
    const n = await row(t, id);
    expect(n).toMatchObject({ status: "sent", relayState: "done", providerRef: `mac-relay:${id}`, providerStatus: "handed_to_messages", deliveredAt: expect.any(Number) });
    expect(n.error).toBeUndefined();
    // Reported twice: already done.
    expect((await result(t, id, item.claimToken, "sent")).status).toBe(409);
  });

  it("404 for an unknown or malformed id, 400 for a bad body", async () => {
    const t = newTest();
    const id = await pendingText(t);
    await claim(t);
    await t.run(async (ctx) => ctx.db.delete("notifications", id));
    expect((await result(t, id, "x", "sent")).status).toBe(404);
    expect((await result(t, "not-an-id", "x", "sent")).status).toBe(404);
    expect((await relayPost(t, "/relay/result", { notificationId: id, claimToken: "x", status: "delivered" })).status).toBe(400);
    expect((await relayPost(t, "/relay/claim", { relayId: "" })).status).toBe(400);
  });

  it("a failed text is recorded as failed, with nothing following from it", async () => {
    const t = newTest();
    const { r, update } = await subscribedAndUpdated(t);
    const items = await claim(t);
    const item = items.find((i) => i.notificationId === update._id)!;
    const before = (await allRows(t)).length;
    expect((await result(t, update._id, item.claimToken, "failed", "osascript: execution error (-1743)")).status).toBe(200);
    await settle(t);
    expect(await row(t, update._id)).toMatchObject({ status: "failed", relayState: "done", error: "osascript: execution error (-1743)" });
    expect((await row(t, update._id)).deliveredAt).toBeUndefined();
    expect(await allRows(t)).toHaveLength(before);
    const sub = await t.run(async (ctx) => ctx.db.get("subscriptions", r.subscriptionId as Id<"subscriptions">));
    expect(sub).toMatchObject({ status: "active", channels: ["sms"] });
  });
});

describe("expiry", () => {
  it(`a text waiting more than ${RELAY_STALE_MS / 60_000} min is failed relay_stale, never sent late`, async () => {
    const t = newTest();
    const old = await pendingText(t, { createdAt: Date.now() - RELAY_STALE_MS - 1 });
    const fresh = await pendingText(t);
    expect((await claim(t)).map((i) => i.notificationId)).toEqual([fresh]);
    expect(await row(t, old)).toMatchObject({ status: "failed", error: "relay_stale", relayState: "done" });
  });

  it("a text whose subscription ended is failed subscription_inactive", async () => {
    const t = newTest();
    const { r, update } = await subscribedAndUpdated(t);
    await t.run(async (ctx) => ctx.db.patch("subscriptions", r.subscriptionId as Id<"subscriptions">, { status: "cancelled", cancelledAt: Date.now() }));
    expect(await claim(t)).toEqual([]);
    expect(await row(t, update._id)).toMatchObject({ status: "failed", error: "subscription_inactive", relayState: "done" });
  });

  it(`a claimed text with no result after ${RELAY_LOST_MS / 60_000} min is failed relay_lost; a late "sent" corrects it`, async () => {
    const t = newTest();
    const id = await pendingText(t);
    const [item] = await claim(t);
    vi.advanceTimersByTime(RELAY_LOST_MS - 1_000);
    await claim(t);
    expect((await row(t, id)).relayState).toBe("claimed");
    vi.advanceTimersByTime(2_000);
    await claim(t);
    expect(await row(t, id)).toMatchObject({ status: "failed", error: "relay_lost", relayState: "done", relayClaimToken: item.claimToken });

    expect((await result(t, id, "wrong", "sent")).status).toBe(409);
    expect((await result(t, id, item.claimToken, "sent")).status).toBe(200);
    const n = await row(t, id);
    expect(n).toMatchObject({ status: "sent", relayState: "done", deliveredAt: expect.any(Number) });
    expect(n.error).toBeUndefined();
    // A late "failed" changes nothing.
    expect((await result(t, id, item.claimToken, "failed", "x")).status).toBe(409);
  });
});

describe("auth and mode", () => {
  it("401 without SMS_RELAY_SECRET configured, and with a missing or wrong bearer", async () => {
    const t = newTest();
    setupEnv({ ...RELAY_ENV, SMS_RELAY_SECRET: "" });
    const res = await relayPost(t, "/relay/claim", { relayId: "m" });
    expect(res.status).toBe(401);
    expect((await res.json()).error.message).toMatch(/SMS_RELAY_SECRET is not configured/);
    setupEnv(RELAY_ENV);
    expect((await relayPost(t, "/relay/claim", { relayId: "m" }, "wrong")).status).toBe(401);
    expect((await relayPost(t, "/relay/claim", { relayId: "m" }, null)).status).toBe(401);
    expect((await relayPost(t, "/relay/result", { notificationId: "x", claimToken: "x", status: "sent" }, "wrong")).status).toBe(401);
  });

  it("409 when SMS_NOTIFIER is not mac_relay", async () => {
    const t = newTest();
    setupEnv({ ...RELAY_ENV, SMS_NOTIFIER: "mock" });
    const res = await relayPost(t, "/relay/claim", { relayId: "m" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/mac_relay/);
    expect((await relayPost(t, "/relay/result", { notificationId: "x", claimToken: "x", status: "sent" })).status).toBe(409);
  });

  it("with SMS_NOTIFIER=mock texts never enter the relay queue", async () => {
    const t = newTest();
    setupEnv({ ...RELAY_ENV, SMS_NOTIFIER: "mock" });
    await seedBulletins(t);
    await ask(t, "Text me if the evacuation changes");
    const [confirmation] = await callTexts(t);
    expect(confirmation.status).toBe("mock");
    expect(confirmation.relayState).toBeUndefined();
  });
});

describe("queueTest", () => {
  it("queues one relay text to a normalized number, and refuses outside mac_relay mode", async () => {
    const t = newTest();
    const id = await t.mutation(internal.smsRelay.queueTest, { phone: "(707) 555-0123" });
    await settle(t);
    const [item] = await claim(t);
    expect(item).toMatchObject({ notificationId: id, to: PHONE });
    expect(item.body).toMatch(/^Soterra test: this text came through the Mac relay\. No action needed\./);
    setupEnv({ ...RELAY_ENV, SMS_NOTIFIER: "twilio" });
    await expect(t.mutation(internal.smsRelay.queueTest, { phone: PHONE })).rejects.toThrow(/mac_relay/);
  });
});

describe("/health", () => {
  it("shows sms live and smsRelayOnline after a claim, until the relay goes quiet", async () => {
    const t = newTest();
    const health = async () => HealthResponse.parse(await (await t.fetch("/health", { method: "GET" })).json());
    let body = await health();
    expect(body.integrations.sms).toBe("live");
    expect(body.flags?.smsRelayOnline).toBe(false);
    await claim(t);
    body = await health();
    expect(body.flags?.smsRelayOnline).toBe(true);
    expect(JSON.stringify(body)).not.toContain(RELAY_SECRET);
    vi.advanceTimersByTime(RELAY_ONLINE_MS + 1_000);
    expect((await health()).flags?.smsRelayOnline).toBe(false);
  });
});
