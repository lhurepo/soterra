// [S] The one working mock path: seed fixtures → sim call → session start → turns (danger check, Convex
// search, MockLlm, grounding, unanswered questions) → session end → summary stored.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runConversation, type Conversation } from "../../scripts/lib/simCall";
import basic from "../../fixtures/conversations/ridgeview-basic.json";
import danger from "../../fixtures/conversations/danger.json";
import noFixtures from "../../fixtures/conversations/no-fixtures.json";
import { CONTRACT_VERSION, TurnResponse } from "../../src/contracts";
import { internal } from "../_generated/api";
import { SECRET, fetchPath, newTest, seed, setupEnv, voicePost, type TestConvex } from "../test.setup";

beforeEach(() => {
  vi.useFakeTimers();
  setupEnv();
});
afterEach(() => vi.useRealTimers());

const run = (t: TestConvex, conversation: unknown, providerCallId = "sim-1") =>
  runConversation({ fetchPath: fetchPath(t), secret: SECRET, conversation: conversation as Conversation, providerCallId });

describe("mock end-to-end call", () => {
  it("runs the Ridgeview demo call with the expected reply kinds and writes a summary", async () => {
    const t = newTest();
    await seed(t);
    const result = await run(t, basic);

    expect(result.failures).toEqual([]);
    expect(result.greeting.greeting).toMatch(/dial 911/);
    expect(result.greeting.greeting).toMatch(/transcribed/);
    const first = result.turns[0].response;
    expect(first.citations.length).toBeGreaterThan(0);
    expect(first.reply).toMatch(/Sonoma County Fire, (as of )?(\d+:\d\d (AM|PM)|yesterday|October 24)\./);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run(async (ctx) => {
      const summaries = await ctx.db.query("callSummaries").collect();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].unansweredQuestionIds).toHaveLength(1);
      expect(summaries[0].followUpsRequested).toHaveLength(1);
      const call = await ctx.db.get("calls", summaries[0].callId);
      expect(call?.status).toBe("finalized");
      const caller = await ctx.db.query("callers").first();
      expect(caller?.lastCallSummaryId).toBe(summaries[0]._id);
      const questions = await ctx.db.query("unansweredQuestions").collect();
      expect(questions.map((q) => q.text)).toEqual(["Is Hillcrest Elementary open as a shelter?"]);
    });
  });

  it("answers danger with the 911 line first", async () => {
    const t = newTest();
    const result = await run(t, danger);
    expect(result.failures).toEqual([]);
    for (const turn of result.turns) expect(turn.response.reply).toMatch(/^(If you are in immediate danger, hang up and dial 911 now|Si está en peligro inmediato, cuelgue y marque 911 ahora)/);
  });

  it("never serves fixtures unless SERVE_FIXTURES=true", async () => {
    setupEnv({ SERVE_FIXTURES: "false" });
    const t = newTest();
    await seed(t);
    const result = await run(t, noFixtures);
    expect(result.failures).toEqual([]);
  });
});

describe("session and turn idempotency", () => {
  it("returns the same session for a repeated start and the stored reply for a replayed turn", async () => {
    const t = newTest();
    await seed(t);
    const start = { contractVersion: CONTRACT_VERSION, provider: "cartesia", providerCallId: "dup", direction: "inbound", startedAt: 1 };
    const a = await (await voicePost(t, "/voice/session/start", start)).json();
    const b = await (await voicePost(t, "/voice/session/start", start)).json();
    expect(a.sessionId).toBe(b.sessionId);

    const turn = { contractVersion: CONTRACT_VERSION, sessionId: a.sessionId, turnIndex: 0, utterance: "Is Ridgeview Road closed?", language: "en", receivedAt: 2 };
    const first = TurnResponse.parse(await (await voicePost(t, "/voice/turn", turn)).json());
    const replay = TurnResponse.parse(await (await voicePost(t, "/voice/turn", { ...turn, utterance: "something else" })).json());
    expect(replay.reply).toBe(first.reply);
    expect(replay.kind).toBe("answer");
  });

  it("lazily starts a session for a turn with an unknown providerCallId", async () => {
    const t = newTest();
    const res = await voicePost(t, "/voice/turn", {
      contractVersion: CONTRACT_VERSION,
      providerCallId: "never-started",
      turnIndex: 0,
      utterance: "hello?",
      language: "es",
      receivedAt: 1,
    });
    expect(res.status).toBe(200);
    const body = TurnResponse.parse(await res.json());
    expect(body.language).toBe("es");
  });
});

describe("summary-only mode", () => {
  it("keeps the summary and deletes the turns when the caller declines the transcript", async () => {
    const t = newTest();
    await seed(t);
    const result = await run(t, {
      name: "summary-only",
      session: { direction: "inbound", callerPhone: "+17075550199" },
      turns: [{ utterance: "Summary only, please.", expectKind: "smalltalk" }, { utterance: "Is Ridgeview Road closed?", expectKind: "answer" }],
    });
    expect(result.failures).toEqual([]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("callSummaries").collect()).toHaveLength(1);
      expect(await ctx.db.query("callTurns").collect()).toHaveLength(0);
    });
  });
});

describe("stale sessions", () => {
  it("are finalized by the sweeper", async () => {
    const t = newTest();
    await voicePost(t, "/voice/session/start", { contractVersion: CONTRACT_VERSION, provider: "cartesia", providerCallId: "stale", direction: "inbound", startedAt: 1 });
    vi.advanceTimersByTime(20 * 60_000);
    expect(await t.mutation(internal.calls.sweepStaleSessions, {})).toBe(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run(async (ctx) => {
      const call = await ctx.db.query("calls").first();
      expect(call?.status).toBe("finalized");
      expect(call?.endReason).toBe("timeout");
    });
  });
});
