// [B] Follow-ups end to end: subscription → bulletin update → notification → outbound greeting; stop
// updates, rate limits, expiry, and answered questions. Only the mock phone notifier runs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t as str } from "../../src/config/strings";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newTest, setupEnv } from "../test.setup";
import { PHONE, callTexts, end, say, seedBulletins, settle, start, updateDrafts, updateNotifications, useDemoClock } from "./backend.helpers";

beforeEach(() => {
  useDemoClock();
  setupEnv();
});
afterEach(() => vi.useRealTimers());

async function subscribe(t: ReturnType<typeof newTest>) {
  const s = await start(t);
  await say(t, s.sessionId, 0, "What's going on with the Ridgeview Fire?");
  const r = await say(t, s.sessionId, 1, "Please call me if the evacuation changes.");
  await end(t, s.sessionId);
  await settle(t);
  return r;
}

describe("subscription → update → notification → outbound call", () => {
  it("delivers the escalation to a caller who asked, and the outbound greeting carries it", async () => {
    const t = newTest();
    await seedBulletins(t);
    const r = await subscribe(t);
    expect(r.kind).toBe("followup");
    expect(r.subscriptionId).toBeDefined();
    expect(r.reply).toContain(str("stopUpdates", "en"));
    const sub = await t.run(async (ctx) => await ctx.db.get("subscriptions", r.subscriptionId as Id<"subscriptions">));
    expect(sub).toMatchObject({ status: "active", trigger: "evacuation_change", target: { kind: "incident", incidentKey: "ridgeview-fire-demo" }, recipient: { phone: PHONE } });
    expect(sub!.expiresAt - sub!.consentAt).toBe(24 * 3_600_000);

    // inject:update — the escalation fixture through the ingestion contract emits a real bulletinEvent.
    const [updated] = await seedBulletins(t, updateDrafts);
    expect(updated.change).toBe("updated");
    await settle(t);

    const notifications = await updateNotifications(t);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ status: "mock", recipientPhone: PHONE, channel: "phone_call", subscriptionId: r.subscriptionId, purpose: "update" });
    expect(notifications[0].message).toMatch(/Evacuation Order for zone SON-3A/);
    expect(notifications[0].dedupeKey).toBe(`${r.subscriptionId}:${updated.bulletinId}:v2`);

    const outbound = await start(t, { direction: "outbound", callerPhone: undefined, notificationId: notifications[0]._id });
    expect(outbound.greeting).toContain(str("outboundIntro", "en"));
    expect(outbound.greeting).toContain(notifications[0].message);
    expect(outbound.greeting).toContain(str("stopUpdates", "en"));
    expect(outbound.greeting).toMatch(/911/);
    // The outbound call knows who it called, so "stop updates" works on it.
    const stop = await say(t, outbound.sessionId, 0, "Stop updates");
    expect(stop.reply).toBe(str("updatesStopped", "en"));
    expect((await t.run(async (ctx) => await ctx.db.get("subscriptions", r.subscriptionId as Id<"subscriptions">)))?.status).toBe("cancelled");
  });

  it("an update callback knows what it called about: that bulletin is always among the sources", async () => {
    const t = newTest();
    await seedBulletins(t);
    const r = await subscribe(t);
    await seedBulletins(t, updateDrafts);
    await settle(t);
    const [n] = await updateNotifications(t);
    const outbound = await start(t, { direction: "outbound", callerPhone: undefined, notificationId: n._id });
    // A vague question that retrieval alone would not tie to the update.
    await say(t, outbound.sessionId, 0, "Why did you call me?");
    const expected = await t.run(async (ctx) =>
      (await ctx.db.query("chunks").withIndex("by_bulletinId", (q) => q.eq("bulletinId", n.bulletinRefs[0])).take(3)).map((c) => c._id as string),
    );
    const turn = await t.run(async (ctx) =>
      (await ctx.db.query("callTurns").withIndex("by_callId_and_turnIndex", (q) => q.eq("callId", outbound.sessionId as Id<"calls">)).collect())[0],
    );
    expect(expected.length).toBeGreaterThan(0);
    for (const id of expected) expect(turn.retrievedChunkIds?.map(String)).toContain(id);
    expect(r.subscriptionId).toBeDefined();
  });

  it("ties an outbound call to its notification by Cartesia's agent_call_id when notificationId is missing", async () => {
    const t = newTest();
    await seedBulletins(t);
    await subscribe(t);
    await seedBulletins(t, updateDrafts);
    await settle(t);
    const [n] = await updateNotifications(t);
    // What CartesiaOutboundCallNotifier records: the agent_call_id returned by POST /agents/calls.
    await t.run(async (ctx) => await ctx.db.patch("notifications", n._id, { providerRef: "ac_live_123" }));
    const outbound = await start(t, { direction: "outbound", callerPhone: undefined, providerAgentCallId: "ac_live_123" });
    expect(outbound.greeting).toContain(n.message);
    const call = await t.run(async (ctx) => await ctx.db.get("calls", outbound.sessionId as Id<"calls">));
    expect(call).toMatchObject({ notificationId: n._id, callerPhone: PHONE, direction: "outbound" });
    // An unknown id falls back to the ordinary greeting rather than another caller's update.
    const other = await start(t, { direction: "outbound", callerPhone: undefined, providerAgentCallId: "ac_unknown", providerCallId: "other-call" });
    expect(other.greeting).not.toContain(n.message);
  });

  it("re-applying the same update never notifies twice", async () => {
    const t = newTest();
    await seedBulletins(t);
    await subscribe(t);
    await seedBulletins(t, updateDrafts);
    await settle(t);
    await seedBulletins(t, updateDrafts); // unchanged: no new event
    await settle(t);
    expect(await updateNotifications(t)).toHaveLength(1);
  });

  it("rate-limits a subscription to one notification per 15 minutes, storing the attempt", async () => {
    const t = newTest();
    await seedBulletins(t);
    await subscribe(t);
    await seedBulletins(t, updateDrafts);
    await settle(t);
    vi.advanceTimersByTime(5 * 60_000);
    await seedBulletins(t, [{ ...updateDrafts[0], body: `${updateDrafts[0].body} Zone SON-3B is now also under an Evacuation Order.` }]);
    await settle(t);
    const rows = await updateNotifications(t);
    expect(rows.map((n) => n.status)).toEqual(["mock", "failed"]);
    expect(rows[1].error).toMatch(/^rate_limited/);
  });

  it("expired subscriptions never fire", async () => {
    const t = newTest();
    await seedBulletins(t);
    await subscribe(t);
    vi.advanceTimersByTime(25 * 3_600_000);
    expect(await t.mutation(internal.subscriptions.expireSubscriptions, {})).toBe(1);
    await seedBulletins(t, updateDrafts);
    await settle(t);
    expect(await updateNotifications(t)).toHaveLength(0);
  });

  it("a caller can stop updates on a later call", async () => {
    const t = newTest();
    await seedBulletins(t);
    await subscribe(t);
    const s = await start(t);
    const r = await say(t, s.sessionId, 0, "Please stop calling me");
    expect(r).toMatchObject({ kind: "followup", reply: str("updatesStopped", "en") });
    await seedBulletins(t, updateDrafts);
    await settle(t);
    expect(await updateNotifications(t)).toHaveLength(0);
    // Only the confirmation from the first call was ever texted.
    expect((await callTexts(t)).map((n) => n.purpose)).toEqual(["subscription_confirmation"]);
  });
});

describe("answered questions", () => {
  it("answering an unanswered question notifies the caller who asked to hear back", async () => {
    const t = newTest();
    await seedBulletins(t);
    const s = await start(t);
    const q = await say(t, s.sessionId, 0, "Is Hillcrest Elementary open as a shelter?");
    const f = await say(t, s.sessionId, 1, "Call me when you know.");
    expect(f.reply).toContain(str("topicQuestion", "en"));
    const sub = await t.run(async (ctx) => await ctx.db.get("subscriptions", f.subscriptionId as Id<"subscriptions">));
    expect(sub?.target).toMatchObject({ kind: "question", unansweredQuestionId: q.unansweredQuestionId });

    const result = await t.mutation(internal.unanswered.answerUnansweredQuestion, {
      id: q.unansweredQuestionId as Id<"unansweredQuestions">,
      answer: "Hillcrest Elementary opened as a shelter at 5 PM",
      sourceUrl: "https://example.org/soterra-demo/sonoma/shelters",
      sourceName: "Sonoma County Emergency Management (Demo)",
    });
    expect(result.notificationsCreated).toBe(1);
    await settle(t);
    const [n] = await updateNotifications(t);
    expect(n).toMatchObject({ status: "mock", recipientPhone: PHONE });
    expect(n?.message).toMatch(/Hillcrest Elementary opened as a shelter at 5 PM\. That's from Sonoma County Emergency Management \(Demo\)/);
    expect((await t.run(async (ctx) => await ctx.db.get("unansweredQuestions", q.unansweredQuestionId as Id<"unansweredQuestions">)))?.status).toBe("answered");
  });
});
