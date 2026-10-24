// [B] Caller identity, memory, accounts, call completion and retention, through the HTTP routes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t as str } from "../../src/config/strings";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newTest, setupEnv } from "../test.setup";
import { PHONE, PHONE_2, end, say, seedBulletins, settle, start, useDemoClock } from "./backend.helpers";

beforeEach(() => {
  useDemoClock();
  setupEnv();
});
afterEach(() => vi.useRealTimers());

const DAY = 86_400_000;
const getCall = (t: ReturnType<typeof newTest>, id: string) => t.run(async (ctx) => await ctx.db.get("calls", id as Id<"calls">));

async function runPurge(t: ReturnType<typeof newTest>) {
  await t.mutation(internal.memory.purgeExpired, {});
  await settle(t);
}

describe("caller memory", () => {
  it("a second call from the same number gets the last summary in its context; the purge removes it after the TTL", async () => {
    const t = newTest();
    await seedBulletins(t);
    const first = await start(t, { callerPhone: "(707) 555-0123" }); // normalized to E.164
    expect(first.greeting).not.toContain(str("returningOffer", "en"));
    await say(t, first.sessionId, 0, "What's going on with the Ridgeview Fire?");
    await say(t, first.sessionId, 1, "I'm in Santa Rosa, any shelters that take pets?");
    await end(t, first.sessionId);
    await settle(t);

    const caller = await t.run(async (ctx) => await ctx.db.query("callers").withIndex("by_phone", (q) => q.eq("phone", PHONE)).unique());
    expect(caller?.lastCallSummaryId).toBeDefined();
    expect(caller?.knownArea?.label).toBe("Santa Rosa");
    expect(caller?.lastIncidentKeys).toEqual(["ridgeview-fire-demo"]);
    expect(caller?.expiresAt).toBe(Date.now() + 30 * DAY);

    vi.advanceTimersByTime(DAY);
    const second = await start(t);
    expect(second.greeting).toContain(str("returningOffer", "en"));
    const call = await getCall(t, second.sessionId);
    expect(call?.callerContext).toMatchObject({ identity: "caller_id", lastCallSummary: expect.stringContaining("Ridgeview"), recentIncidentKeys: ["ridgeview-fire-demo"] });
    expect(call?.callerContext?.knownArea?.label).toBe("Santa Rosa");
    // The model never sees the summary text on caller ID alone, and it is never read back.
    const r = await say(t, second.sessionId, 0, "Any updates?");
    expect(r.reply).not.toContain("starting with");
    await end(t, second.sessionId);
    await settle(t);

    // Transcripts go after 7 days; memory (caller, summaries, calls) after 30 days without calls.
    vi.advanceTimersByTime(8 * DAY);
    await runPurge(t);
    expect(await t.run(async (ctx) => (await ctx.db.query("callTurns").collect()).length)).toBe(0);
    expect(await t.run(async (ctx) => (await ctx.db.query("callSummaries").collect()).length)).toBe(2);

    vi.advanceTimersByTime(23 * DAY);
    await runPurge(t);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("callSummaries").collect()).toHaveLength(0);
      expect(await ctx.db.query("callers").collect()).toHaveLength(0);
      expect(await ctx.db.query("calls").collect()).toHaveLength(0);
    });
  });

  it("keeps a caller an active subscription still needs", async () => {
    const t = newTest();
    await seedBulletins(t);
    const s = await start(t);
    await say(t, s.sessionId, 0, "What's going on with the Ridgeview Fire?");
    await say(t, s.sessionId, 1, "Please call me if the evacuation changes.");
    await end(t, s.sessionId);
    await settle(t);
    await t.run(async (ctx) => {
      // Simulate a long-lived subscription (e.g. created from the app) that outlives the caller's memory TTL.
      const sub = (await ctx.db.query("subscriptions").first())!;
      await ctx.db.patch("subscriptions", sub._id, { expiresAt: Date.now() + 40 * DAY });
    });
    vi.advanceTimersByTime(31 * DAY);
    await runPurge(t);
    expect(await t.run(async (ctx) => (await ctx.db.query("callers").collect()).length)).toBe(1);
  });
});

describe("accounts", () => {
  it("a verified phone link puts accountId on the call and the summary, and account needs in context", async () => {
    const t = newTest();
    await seedBulletins(t);
    const { accountId } = await t.mutation(internal.accounts.createTestAccount, { phone: PHONE, verified: true, needs: ["uses a wheelchair"] });
    const s = await start(t);
    const call = await getCall(t, s.sessionId);
    expect(call?.accountId).toBe(accountId);
    expect(call?.callerContext).toMatchObject({ identity: "verified_account", needs: ["uses a wheelchair"] });
    await say(t, s.sessionId, 0, "What's going on with the Ridgeview Fire?");
    await end(t, s.sessionId);
    await settle(t);
    await t.run(async (ctx) => {
      const summary = await ctx.db.query("callSummaries").first();
      expect(summary?.accountId).toBe(accountId);
      const finalized = await ctx.db.get("calls", s.sessionId as Id<"calls">);
      expect(finalized?.transcriptExpiresAt).toBeUndefined(); // account data is kept
      const caller = await ctx.db.query("callers").first();
      expect(caller?.expiresAt).toBeUndefined();
    });
  });

  it("an unverified link gives neither accountId nor needs", async () => {
    const t = newTest();
    await t.mutation(internal.accounts.createTestAccount, { phone: PHONE_2, verified: false, needs: ["oxygen"] });
    const s = await start(t, { callerPhone: PHONE_2 });
    const call = await getCall(t, s.sessionId);
    expect(call?.accountId).toBeUndefined();
    expect(call?.callerContext?.identity).toBe("caller_id");
    expect(call?.callerContext?.needs).toBeUndefined();
    await end(t, s.sessionId);
    await settle(t);
    expect((await t.run(async (ctx) => await ctx.db.query("callSummaries").first()))?.accountId).toBeUndefined();
  });

  it("a link verified during the call is picked up at finalize", async () => {
    const t = newTest();
    const s = await start(t, { callerPhone: PHONE_2 });
    const { accountId } = await t.mutation(internal.accounts.createTestAccount, { phone: PHONE_2, verified: true });
    await end(t, s.sessionId);
    await settle(t);
    expect((await getCall(t, s.sessionId))?.accountId).toBe(accountId);
  });
});

describe("withheld caller ID", () => {
  it("gets an ephemeral caller with no memory, and callbacks are declined politely", async () => {
    const t = newTest();
    await seedBulletins(t);
    const s = await start(t, { callerPhone: "anonymous" });
    const call = await getCall(t, s.sessionId);
    expect(call?.callerId).toBeUndefined();
    expect(call?.callerPhone).toBeUndefined();
    expect(call?.callerContext).toEqual({ identity: "anonymous", language: "en" });
    await say(t, s.sessionId, 0, "What's going on with the Ridgeview Fire?");
    const r = await say(t, s.sessionId, 1, "Call me if the evacuation changes.");
    expect(r).toMatchObject({ kind: "followup", reply: str("callbackDeclined", "en") });
    expect(r.subscriptionId).toBeUndefined();
    await end(t, s.sessionId);
    await settle(t);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("callers").collect()).toHaveLength(0);
      expect(await ctx.db.query("subscriptions").collect()).toHaveLength(0);
      expect(await ctx.db.query("callSummaries").collect()).toHaveLength(1);
    });
  });
});

describe("call completion", () => {
  it("finalize is idempotent and the summary is written once", async () => {
    const t = newTest();
    const s = await start(t);
    await end(t, s.sessionId);
    await end(t, s.sessionId);
    await t.mutation(internal.memory.finalizeCall, { callId: s.sessionId as Id<"calls"> });
    await settle(t);
    expect(await t.run(async (ctx) => (await ctx.db.query("callSummaries").collect()).length)).toBe(1);
  });

  it("the stale-session sweeper finalizes an abandoned call", async () => {
    const t = newTest();
    await seedBulletins(t);
    const s = await start(t);
    await say(t, s.sessionId, 0, "Is Ridgeview Road closed?");
    vi.advanceTimersByTime(10 * 60_000);
    expect(await t.mutation(internal.calls.sweepStaleSessions, {})).toBe(0); // contract: 15 minutes of silence
    vi.advanceTimersByTime(6 * 60_000);
    expect(await t.mutation(internal.calls.sweepStaleSessions, {})).toBe(1);
    await settle(t);
    const call = await getCall(t, s.sessionId);
    expect(call).toMatchObject({ status: "finalized", endReason: "timeout" });
    expect(await t.run(async (ctx) => (await ctx.db.query("callSummaries").collect()).length)).toBe(1);
  });

  it("summary-only mode deletes the turns and keeps the summary", async () => {
    const t = newTest();
    await seedBulletins(t);
    const s = await start(t);
    expect((await say(t, s.sessionId, 0, "Summary only, please.")).reply).toBe(str("consentDeclined", "en"));
    await say(t, s.sessionId, 1, "Is Ridgeview Road closed?");
    await end(t, s.sessionId);
    await settle(t);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("callSummaries").collect()).toHaveLength(1);
      expect(await ctx.db.query("callTurns").collect()).toHaveLength(0);
    });
  });

  it("stores a deterministic summary when the summary LLM fails", async () => {
    setupEnv({ MOCK_LLM_MODE: "error" });
    const t = newTest();
    const s = await start(t);
    await say(t, s.sessionId, 0, "Is Ridgeview Road closed?");
    await end(t, s.sessionId);
    await settle(t);
    const summary = await t.run(async (ctx) => await ctx.db.query("callSummaries").first());
    expect(summary).toMatchObject({ fallback: true, model: "fallback" });
    expect(summary?.summary).toMatch(/asked 1 question/);
  });

  it("debugCall returns turns, chunk ids, kinds and timings", async () => {
    const t = newTest();
    await seedBulletins(t);
    const s = await start(t);
    await say(t, s.sessionId, 0, "Are there shelters that take pets?");
    const debug = await t.query(internal.calls.debugCall, { callId: s.sessionId });
    expect(debug?.turns[0]).toMatchObject({ kind: "answer", retriever: "convex" });
    expect(debug?.turns[0].retrievedChunkIds.length).toBeGreaterThan(0);
    expect(debug?.turns[0].citedChunkIds.length).toBeGreaterThan(0);
    expect(debug?.turns[0].timingsMs.total).toBeTypeOf("number");
  });
});
