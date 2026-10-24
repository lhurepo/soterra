// [B] Danger check, grounding enforcement and the turn pipeline, without Convex.
import { describe, expect, it } from "vitest";
import type { AnswerDraft, CallerContext, RetrievedChunk } from "../src/contracts";
import { toLlmContext } from "../src/memory/callerContext";
import { detectDanger } from "../src/orchestration/danger";
import { enforceGrounding } from "../src/orchestration/grounding";
import { runTurn, type TurnDeps } from "../src/orchestration/pipeline";
import { createMockLlm } from "../src/providers/llm/mock";
import type { LlmClient } from "../src/providers/llm/types";

const chunk = (over: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
  chunkId: "c1",
  bulletinId: "b1",
  text: "Evacuation Warning for the Ridgeview Fire. An Evacuation Warning is in effect for zones SON-3A and SON-3B.",
  sourceId: "demo_county",
  sourceName: "Sonoma County Emergency Management (Demo)",
  url: "https://example.org/evac",
  trustTier: "official",
  issuedAt: 1792874700000,
  areas: [{ state: "CA", label: "Sonoma County" }],
  hazardType: "evacuation",
  severity: "severe",
  score: 1,
  ...over,
});

const answer = (over: Partial<AnswerDraft> = {}): AnswerDraft => ({
  kind: "answer",
  reply: "Zones SON-3A and SON-3B are under an Evacuation Warning.",
  citedChunkIds: ["c1"],
  endCall: false,
  ...over,
});

describe("danger check", () => {
  it.each([
    "I'm trapped in my house",
    "the fire is in my house",
    "my husband is not breathing",
    "water is coming inside",
    "Estoy atrapado",
    "no puedo respirar",
  ])("flags %s", (u) => expect(detectDanger(u)).toBe(true));

  it.each(["Where is the nearest shelter?", "Is Ridgeview Road closed?", "Can you help me find a shelter for my dog?"])(
    "does not flag %s",
    (u) => expect(detectDanger(u)).toBe(false),
  );
});

describe("grounding enforcement", () => {
  it("keeps a cited answer, builds citations from chunk metadata and adds source and time", () => {
    const g = enforceGrounding({ draft: answer(), retrieved: [chunk()], utterance: "q", language: "en" });
    expect(g.kind).toBe("answer");
    expect(g.citations).toEqual([
      { sourceName: "Sonoma County Emergency Management (Demo)", url: "https://example.org/evac", issuedAt: 1792874700000, updatedAt: undefined },
    ]);
    expect(g.reply).toContain("Sonoma County Emergency Management (Demo)");
    expect(g.reply).toMatch(/October 24 at 1:45\sPM Pacific/);
  });

  it("rewrites an uncited answer to no_info and records the question", () => {
    const g = enforceGrounding({ draft: answer({ citedChunkIds: [] }), retrieved: [chunk()], utterance: "Is the school open?", language: "en" });
    expect(g.kind).toBe("no_info");
    expect(g.reply).toMatch(/I don't know yet/);
    expect(g.unansweredQuestion).toBe("Is the school open?");
    expect(g.citations).toEqual([]);
  });

  it("rejects citations to chunks that were not retrieved in this turn", () => {
    const g = enforceGrounding({ draft: answer({ citedChunkIds: ["made-up"] }), retrieved: [chunk()], utterance: "q", language: "en" });
    expect(g.kind).toBe("no_info");
  });

  it("never answers from unverified content", () => {
    const g = enforceGrounding({ draft: answer(), retrieved: [chunk({ trustTier: "unverified" })], utterance: "q", language: "en" });
    expect(g.kind).toBe("no_info");
  });

  it("replaces model safety wording with the fixed phrase", () => {
    const g = enforceGrounding({ draft: answer({ kind: "safety", reply: "Help is on the way!" }), retrieved: [], utterance: "q", language: "en" });
    expect(g.kind).toBe("safety");
    expect(g.reply).toMatch(/dial 911/);
    expect(g.reply).not.toMatch(/on the way/);
  });
});

function deps(over: Partial<TurnDeps> = {}): TurnDeps & { recorded: string[] } {
  const recorded: string[] = [];
  return {
    recorded,
    now: () => 1792893600000,
    llm: createMockLlm(),
    model: "claude-haiku-5-5",
    loadContext: async () => ({ identity: "anonymous", language: "en" }) satisfies CallerContext,
    loadHistory: async () => [],
    retrieve: async () => [chunk()],
    recordUnanswered: async ({ question }) => {
      recorded.push(question);
      return "u1";
    },
    createSubscription: async () => "s1",
    declineTranscript: async () => undefined,
    ...over,
  };
}

describe("turn pipeline", () => {
  it("answers danger with the 911 line and never calls the LLM", async () => {
    const llm = createMockLlm();
    let retrieved = false;
    const out = await runTurn(
      { utterance: "I'm trapped and the fire is in my house", language: "en" },
      deps({ llm, retrieve: async () => ((retrieved = true), []) }),
    );
    expect(out.kind).toBe("safety");
    expect(out.reply.startsWith("If you are in immediate danger, hang up and dial 911 now.")).toBe(true);
    expect(llm.calls).toHaveLength(0);
    expect(retrieved).toBe(false);
  });

  it("turns an uncited model answer into no_info with an unanswered question", async () => {
    const lying: LlmClient = {
      name: "mock",
      complete: async () => ({ text: "", structured: answer({ citedChunkIds: [] }), model: "fake" }),
    };
    const d = deps({ llm: lying });
    const out = await runTurn({ utterance: "Is Hillcrest Elementary a shelter?", language: "en" }, d);
    expect(out.kind).toBe("no_info");
    expect(out.unansweredQuestionId).toBe("u1");
    expect(d.recorded).toEqual(["Is Hillcrest Elementary a shelter?"]);
  });

  it("falls back to a safe degraded reply with the 911 line when the LLM fails", async () => {
    const broken: LlmClient = { name: "mock", complete: async () => Promise.reject(new Error("timeout")) };
    const out = await runTurn({ utterance: "What's happening?", language: "es" }, deps({ llm: broken }));
    expect(out.degraded).toBe(true);
    expect(out.reply).toMatch(/911/);
  });

  it("says it cannot call back when the number is withheld", async () => {
    const out = await runTurn({ utterance: "Call me if the evacuation changes", language: "en" }, deps({ createSubscription: async () => null }));
    expect(out.kind).toBe("followup");
    expect(out.subscriptionId).toBeUndefined();
    expect(out.reply).toMatch(/number is hidden/);
  });
});

describe("caller memory", () => {
  it("never exposes needs or past summaries on caller ID alone", () => {
    const ctx: CallerContext = {
      identity: "caller_id",
      language: "en",
      callerId: "x",
      needs: ["oxygen"],
      lastCallSummary: "asked about 412 Oak Lane",
      knownArea: { state: "CA", countyFips: "06097", zip: "95404", label: "Sonoma County" },
    };
    const visible = toLlmContext(ctx);
    expect(visible.needs).toBeUndefined();
    expect(visible.lastCallSummary).toBeUndefined();
    expect(visible.knownArea?.zip).toBeUndefined();
    expect(toLlmContext({ ...ctx, identity: "verified_account" }).needs).toEqual(["oxygen"]);
  });
});
