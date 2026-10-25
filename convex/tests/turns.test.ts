// [B] Turn flows through the HTTP routes with fixtures seeded via upsertBulletins and MockLlm.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION, TurnResponse } from "../../src/contracts";
import { t as str } from "../../src/config/strings";
import { finalizeBulletin } from "../../src/ingestion/normalize";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newTest, setupEnv, voicePost } from "../test.setup";
import { initialDrafts, say, seedBulletins, start, useDemoClock } from "./backend.helpers";

beforeEach(() => {
  useDemoClock();
  setupEnv();
});
afterEach(() => vi.useRealTimers());

const turnRow = (t: ReturnType<typeof newTest>, sessionId: string, turnIndex: number) =>
  t.run(async (ctx) =>
    await ctx.db
      .query("callTurns")
      .withIndex("by_callId_and_turnIndex", (q) => q.eq("callId", sessionId as Id<"calls">).eq("turnIndex", turnIndex))
      .unique(),
  );

describe("grounded answers", () => {
  it("answers with a valid citation built from stored metadata, and records timings", async () => {
    const t = newTest();
    await seedBulletins(t);
    const { sessionId } = await start(t);
    const r = await say(t, sessionId, 0, "What's going on with the Ridgeview Fire?");
    expect(r.kind).toBe("answer");
    expect(r.citations.length).toBeGreaterThan(0);
    expect(r.reply).toMatch(/Sonoma County Fire, (as of )?(\d+:\d\d (AM|PM)|yesterday|October 24)\./);
    expect(Object.keys(r.timingsMs ?? {})).toEqual(expect.arrayContaining(["context", "retrieval", "preLlm", "llm", "total"]));

    const row = await turnRow(t, sessionId, 0);
    expect(row).toMatchObject({ status: "complete", kind: "answer", retriever: "convex" });
    expect(row?.citedChunkIds?.length).toBeGreaterThan(0);
    expect(row?.timingsMs?.retrieval).toBeTypeOf("number");
    const cited = await t.run(async (ctx) => await ctx.db.get("chunks", row!.citedChunkIds![0]));
    expect(r.citations.map((c) => c.url)).toContain(cited?.url);
    expect(r.citations.map((c) => c.sourceName)).toContain(cited?.sourceName);
  });

  it("an unknown fact gives no_info and an unanswered-question row (deduped within the call)", async () => {
    const t = newTest();
    await seedBulletins(t);
    const { sessionId } = await start(t);
    const r = await say(t, sessionId, 0, "Is Hillcrest Elementary open as a shelter?");
    expect(r).toMatchObject({ kind: "no_info", reply: str("noInfo", "en") });
    expect(r.unansweredQuestionId).toBeDefined();
    const again = await say(t, sessionId, 1, "Is Hillcrest Elementary open as a shelter?");
    expect(again.unansweredQuestionId).toBe(r.unansweredQuestionId);
    const rows = await t.run(async (ctx) => await ctx.db.query("unansweredQuestions").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: "Is Hillcrest Elementary open as a shelter?", status: "open", language: "en", callId: sessionId });
    expect(rows[0].callerId).toBeDefined();
  });

  it("a Spanish turn gets a Spanish reply with citations intact", async () => {
    const t = newTest();
    await seedBulletins(t);
    const { sessionId, language } = await start(t, { languageHint: "es-US" });
    expect(language).toBe("es");
    const r = await say(t, sessionId, 0, "¿Qué está pasando con el incendio Ridgeview?", { language: "es" });
    expect(r.language).toBe("es");
    expect(r.kind).toBe("answer");
    expect(r.reply).toMatch(/Fuente: Sonoma County Fire, /);
    expect(r.citations.length).toBeGreaterThan(0);
    // Any other language is answered in English.
    const fr = await say(t, sessionId, 1, "Ridgeview Fire evacuation?", { language: "fr" });
    expect(fr.language).toBe("en");
  });

  it("a city name sets the call's area for later turns", async () => {
    const t = newTest();
    await seedBulletins(t);
    const { sessionId } = await start(t, { callerPhone: undefined });
    await say(t, sessionId, 0, "I'm in Santa Rosa. Are there shelters that take pets?");
    const call = await t.run(async (ctx) => await ctx.db.get("calls", sessionId as Id<"calls">));
    expect(call?.knownArea).toMatchObject({ state: "CA", countyFips: "06097", label: "Santa Rosa" });
    const near = await say(t, sessionId, 1, "Are there shelters near me?");
    expect(near.kind).not.toBe("clarify");
  });

  it("asks for an area when a 'near me' question has none", async () => {
    const t = newTest();
    await seedBulletins(t);
    const { sessionId } = await start(t, { callerPhone: undefined });
    expect((await say(t, sessionId, 0, "Are there shelters near me?")).kind).toBe("clarify");
  });
});

describe("danger", () => {
  it("answers with the canonical safety reply, never calls the LLM, flags the call, and later turns proceed", async () => {
    const t = newTest();
    await seedBulletins(t);
    const { sessionId } = await start(t);
    const r = await say(t, sessionId, 0, "Help, I'm trapped in my house and the fire is outside");
    expect(r).toMatchObject({ kind: "safety", reply: str("safety", "en"), endCall: false });
    const row = await turnRow(t, sessionId, 0);
    expect(row?.llmModel).toBeUndefined();
    expect(row?.timingsMs?.llm).toBeUndefined();
    expect(row?.retrievedChunkIds).toEqual([]);
    const call = await t.run(async (ctx) => await ctx.db.get("calls", sessionId as Id<"calls">));
    expect(call?.safetyFlag).toBe(true);
    expect((await say(t, sessionId, 1, "What's going on with the Ridgeview Fire?")).kind).toBe("answer");
  });
});

describe("idempotency and barge-in", () => {
  it("a replayed turn returns the identical stored response", async () => {
    const t = newTest();
    await seedBulletins(t);
    const { sessionId } = await start(t);
    const first = await say(t, sessionId, 0, "Is Ridgeview Road closed?");
    vi.advanceTimersByTime(5_000);
    const replay = await say(t, sessionId, 0, "something else entirely");
    expect(replay).toEqual(first);
    expect(await t.run(async (ctx) => (await ctx.db.query("callTurns").collect()).length)).toBe(1);
  });

  it("interruptedPrevious marks the prior reply as interrupted (it is never assumed heard)", async () => {
    const t = newTest();
    await seedBulletins(t);
    const { sessionId } = await start(t);
    await say(t, sessionId, 0, "What's going on with the Ridgeview Fire?");
    await say(t, sessionId, 1, "Wait, are there shelters that take pets?", { interruptedPrevious: true });
    expect((await turnRow(t, sessionId, 0))?.interrupted).toBe(true);
    expect((await turnRow(t, sessionId, 1))?.interruptedPrevious).toBe(true);
    expect((await turnRow(t, sessionId, 1))?.interrupted).toBeUndefined();
  });

  it("a turn for an unknown providerCallId lazily starts an inbound session", async () => {
    const t = newTest();
    const res = await voicePost(t, "/voice/turn", { contractVersion: CONTRACT_VERSION, providerCallId: "lazy-1", turnIndex: 0, utterance: "hola", language: "es", receivedAt: Date.now() });
    expect(res.status).toBe(200);
    expect(TurnResponse.parse(await res.json()).language).toBe("es");
    const call = await t.run(async (ctx) => await ctx.db.query("calls").first());
    expect(call).toMatchObject({ providerCallId: "lazy-1", direction: "inbound", language: "es" });
  });

  it("an unknown sessionId is a 404", async () => {
    const t = newTest();
    const res = await voicePost(t, "/voice/turn", { contractVersion: CONTRACT_VERSION, sessionId: "not-a-session", turnIndex: 0, utterance: "hi", language: "en", receivedAt: 1 });
    expect(res.status).toBe(404);
  });
});

describe("LLM failure modes", () => {
  it.each(["invalid_json", "uncited_answer", "unknown_chunk", "timeout", "error"])("%s gives a safe 200 reply with degraded: true", async (mode) => {
    setupEnv({ MOCK_LLM_MODE: mode });
    const t = newTest();
    await seedBulletins(t);
    const { sessionId } = await start(t);
    const r = await say(t, sessionId, 0, "What's going on with the Ridgeview Fire?");
    expect(r.kind).toBe("no_info");
    expect(r.degraded).toBe(true);
    expect(r.citations).toEqual([]);
    expect([str("noInfo", "en"), str("fallback", "en")]).toContain(r.reply);
    expect(r.reply).toMatch(/911/);
    expect((await turnRow(t, sessionId, 0))?.errorCode).toBeTruthy();
  });

  it("an unconfigured live LLM still answers 200 with the fallback, never a 5xx", async () => {
    setupEnv({ LLM_PROVIDER: "anthropic" });
    const t = newTest();
    await seedBulletins(t);
    const { sessionId } = await start(t);
    const r = await say(t, sessionId, 0, "What's going on with the Ridgeview Fire?", { language: "es" });
    expect(r).toMatchObject({ kind: "no_info", reply: str("fallback", "es"), degraded: true });
  });
});

describe("what may be cited", () => {
  const evac = initialDrafts[1];

  it("never cites expired, test-status, cancelled or unverified bulletins", async () => {
    const t = newTest();
    const soon = Date.now() + 60_000;
    await seedBulletins(t, [
      { ...evac, externalId: "expiring", title: "Zebra Canyon closure notice", body: "Zebra Canyon is closed.", expiresAt: soon, incidentKey: "zebra" },
      { ...evac, externalId: "test-msg", title: "Quokka Ridge test alert", body: "Quokka Ridge test message.", status: "test", incidentKey: "quokka" },
      { ...evac, externalId: "cancelled", title: "Wombat Flats warning", body: "Wombat Flats warning.", status: "cancelled", incidentKey: "wombat" },
      { ...evac, sourceId: "x_rumor", externalId: "rumor", title: "Narwhal Point evacuation", body: "Narwhal Point must evacuate.", trustTier: "unverified", isFixture: false, incidentKey: "narwhal" },
    ]);
    // Defence in depth: even a chunk row that slipped through with an untrusted tier is never served.
    await t.run(async (ctx) => {
      const bulletin = (await ctx.db.query("bulletins").collect()).find((b) => b.externalId === "rumor")!;
      await ctx.db.insert("chunks", {
        bulletinId: bulletin._id, versionNumber: 1, chunkIndex: 0, text: "Narwhal Point must evacuate.", sourceId: "x_rumor", sourceName: "Rumor", url: "https://example.org/rumor",
        trustTier: "unverified", hazardType: "evacuation", severity: "severe", issuedAt: Date.now() - 1, isActive: true, isFixture: false, primaryState: "CA",
      });
    });
    vi.advanceTimersByTime(120_000); // the "expiring" bulletin is now past expiresAt (the expiry cron has not run)
    const { sessionId } = await start(t);
    for (const [i, q] of ["Is Zebra Canyon closed?", "Quokka Ridge test alert?", "Wombat Flats warning?", "Does Narwhal Point need to evacuate?"].entries()) {
      const r = await say(t, sessionId, i, q);
      expect(r.kind, q).toBe("no_info");
      expect(r.citations, q).toEqual([]);
    }
  });

  it("never cites fixture bulletins when SERVE_FIXTURES=false", async () => {
    setupEnv({ SERVE_FIXTURES: "false" });
    const t = newTest();
    await seedBulletins(t);
    const { sessionId } = await start(t);
    const r = await say(t, sessionId, 0, "What's going on with the Ridgeview Fire?");
    expect(r.kind).toBe("no_info");
    // The same content as a live (non-fixture) bulletin is citable.
    await t.mutation(internal.ingestion.upsertBulletins, { items: [finalizeBulletin({ ...initialDrafts[2], sourceId: "live_fire", isFixture: false })] });
    expect((await say(t, sessionId, 1, "What's going on with the Ridgeview Fire?")).kind).toBe("answer");
  });
});
