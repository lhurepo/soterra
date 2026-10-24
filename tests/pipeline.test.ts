// [B] The turn pipeline without Convex: order of checks, MockLlm rules, failure modes, side-effect plans.
import { describe, expect, it } from "vitest";
import { t } from "../src/config/strings";
import { completeFollowUp, runTurn, type TurnDeps } from "../src/orchestration/pipeline";
import { createMockLlm } from "../src/providers/llm/mock";
import type { LlmClient } from "../src/providers/llm/types";
import { NOW, answer, chunk, deps, shelterChunk, state } from "./helpers";

const turn = (utterance: string, d: TurnDeps = deps(), s = state(), language = "en") => runTurn({ utterance, language, startedAt: NOW }, s, d);

describe("danger and deterministic intents", () => {
  it("answers danger with the canonical safety string, before retrieval and the LLM", async () => {
    let retrieved = false;
    const d = deps({ retrieve: async (q) => ((retrieved = true), { chunks: [], retriever: "convex", retrievedAt: q.now }) });
    const out = await turn("I'm trapped and the fire is in my house", d);
    expect(out).toMatchObject({ kind: "safety", reply: t("safety", "en"), endCall: false });
    expect(d.llm.calls).toHaveLength(0);
    expect(retrieved).toBe(false);
    expect(out.llmModel).toBeUndefined();
  });

  it("answers Spanish danger in Spanish even in an English session", async () => {
    // The warning is spoken in the language the caller used, whatever the session language.
    const es = await turn("Estoy atrapado, no puedo salir");
    expect(es).toMatchObject({ kind: "safety", reply: t("safety", "es"), language: "es" });
    expect(await turn("I'm trapped and the fire is in my house", deps(), state(), "es")).toMatchObject({ reply: t("safety", "en"), language: "en" });
    expect((await turn("Estoy atrapado, no puedo salir", deps(), state(), "es")).reply).toBe(t("safety", "es"));
  });

  it("stops updates without the model, and declines when the number is hidden", async () => {
    const d = deps();
    const out = await turn("Please stop calling me", d);
    expect(out).toMatchObject({ kind: "followup", reply: t("updatesStopped", "en"), effects: { cancelSubscriptions: true } });
    expect(d.llm.calls).toHaveLength(0);
    expect((await turn("stop updates", deps(), state({ hasCallerPhone: false }))).reply).toBe(t("callbackDeclined", "en"));
  });

  it("honours 'summary only' without the model", async () => {
    const out = await turn("Summary only, please.");
    expect(out).toMatchObject({ kind: "smalltalk", reply: t("consentDeclined", "en"), effects: { declineTranscript: true } });
  });
});

describe("answers", () => {
  it("answers from a retrieved chunk with citations, timings and the retriever recorded", async () => {
    const out = await turn("Are there shelters that take pets?");
    expect(out.kind).toBe("answer");
    expect(out.citedChunkIds).toEqual(["c2"]);
    expect(out.citations[0].url).toBe("https://example.org/shelters");
    expect(out.retriever).toBe("convex");
    expect(out.citedIncidentKeys).toEqual(["ridgeview-fire-demo"]);
    expect(out.citedHazards).toEqual(["shelter"]);
    expect(Object.keys(out.timingsMs)).toEqual(expect.arrayContaining(["retrieval", "preLlm", "llm", "total"]));
  });

  it("says I don't know yet for an unknown fact and plans an unanswered question", async () => {
    const out = await turn("Is Hillcrest Elementary open as a shelter?");
    expect(out).toMatchObject({ kind: "no_info", reply: t("noInfo", "en"), effects: { recordUnanswered: { text: "Is Hillcrest Elementary open as a shelter?" } } });
    expect(out.degraded).toBeUndefined();
  });

  it("replies in Spanish with citations intact; other languages get English", async () => {
    const es = await turn("¿Qué está pasando con el incendio Ridgeview?", deps(), state(), "es");
    expect(es.language).toBe("es");
    expect(es.kind).toBe("answer");
    expect(es.reply).toMatch(/Fuente: Sonoma County, /);
    expect(es.citations.length).toBeGreaterThan(0);
    const fr = await turn("Ridgeview Fire evacuation zones?", deps(), state(), "fr");
    expect(fr.language).toBe("en");
  });

  it("asks for the area when a 'near me' question has no area", async () => {
    const out = await turn("Are there shelters near me?", deps(), state({ areaCandidates: [] }));
    expect(out).toMatchObject({ kind: "clarify", reply: t("clarifyArea", "en") });
  });

  it("refuses address-in-zone with the zones the source lists", async () => {
    const out = await turn("Is 412 Oak Lane inside the evacuation zone?");
    expect(out.kind).toBe("answer");
    expect(out.reply).toMatch(/can't confirm whether a specific address is inside a zone/);
    expect(out.reply).toMatch(/SON-3A/);
  });

  it("plans a known-area update when the caller names a ZIP or a place", async () => {
    expect((await turn("Any shelters in 95404?")).effects.setKnownArea).toMatchObject({ zip: "95404", state: "CA" });
    expect((await turn("What about Santa Rosa?")).effects.setKnownArea).toMatchObject({ label: "Santa Rosa", countyFips: "06097" });
    expect((await turn("Any shelters?")).effects.setKnownArea).toBeUndefined();
  });

  it("passes only policy-filtered context to the model", async () => {
    const d = deps();
    await turn("Are there shelters that take pets?", d, state({ context: { identity: "caller_id", language: "en", lastCallSummary: "secret summary", needs: ["oxygen"] } }));
    const sent = JSON.stringify(d.llm.calls[0].messages);
    expect(sent).not.toContain("secret summary");
    expect(sent).not.toContain("oxygen");
  });
});

describe("follow-ups and goodbye", () => {
  it("creates an incident subscription and confirms what and how to stop", async () => {
    const out = await turn("Please call me if the evacuation changes.");
    expect(out.effects.createSubscription).toEqual({ targetKind: "incident", incidentKey: "ridgeview-fire-demo", trigger: "evacuation_change" });
    expect(out.reply).toContain(t("topicEvacuation", "en"));
    expect(out.reply).toContain(t("stopUpdates", "en"));
    expect(out.reply).toMatch(/next 24 hours/);
  });

  it("declines a callback politely when the number is withheld", async () => {
    const out = await turn("Keep me updated", deps(), state({ hasCallerPhone: false }));
    expect(out).toMatchObject({ kind: "followup", reply: t("callbackDeclined", "en") });
    expect(out.effects.createSubscription).toBeUndefined();
  });

  it("targets the open question for 'call me when you know'", async () => {
    const out = await turn("Call me when you know", deps(), state({ hasOpenQuestion: true }));
    expect(out.effects.createSubscription).toEqual({ targetKind: "question", trigger: "answer_available" });
  });

  it("asks for an area when there is nothing to watch", async () => {
    expect(completeFollowUp(undefined, { retrieved: [], hasOpenQuestion: false })).toBeNull();
    const out = await turn("Keep me posted", deps({ chunks: [] }), state());
    expect(out).toMatchObject({ kind: "clarify", reply: t("clarifyArea", "en") });
  });

  it("ends the call on goodbye with the canonical goodbye", async () => {
    expect(await turn("Thanks, goodbye.")).toMatchObject({ kind: "goodbye", reply: t("goodbye", "en"), endCall: true });
  });
});

describe("failure modes", () => {
  const withMode = (mode: Parameters<typeof createMockLlm>[0] extends infer O ? (O extends { mode?: infer M } ? M : never) : never) => deps({ llm: createMockLlm({ mode }) });

  it.each([
    ["invalid_json", "no_info", "llm_invalid_output"],
    ["timeout", "no_info", "llm_timeout"],
    ["error", "no_info", "llm_provider"],
  ] as const)("%s → safe fallback with the 911 line, degraded", async (mode, kind, code) => {
    const out = await turn("What's going on with the Ridgeview Fire?", withMode(mode));
    expect(out).toMatchObject({ kind, reply: t("fallback", "en"), degraded: true, errorCode: code });
  });

  it("retries once when the model's output is invalid, then answers normally", async () => {
    const good = createMockLlm();
    const bad = createMockLlm({ mode: "invalid_json" });
    let n = 0;
    const llm = Object.assign(createMockLlm(), { complete: (req: Parameters<typeof good.complete>[0]) => (n++ === 0 ? bad.complete(req) : good.complete(req)) });
    const out = await turn("What's going on with the Ridgeview Fire?", deps({ llm }));
    expect(n).toBe(2);
    expect(out.kind).toBe("answer");
    expect(out.degraded).toBeUndefined();
  });

  it.each([
    ["uncited_answer", "uncited_answer"],
    ["unknown_chunk", "unknown_chunk"],
  ] as const)("%s → no_info with the question saved, degraded", async (mode, issue) => {
    const out = await turn("What's going on with the Ridgeview Fire?", withMode(mode));
    expect(out).toMatchObject({ kind: "no_info", reply: t("noInfo", "en"), degraded: true, errorCode: issue });
    expect(out.effects.recordUnanswered).toBeDefined();
    expect(out.citations).toEqual([]);
  });

  it("a hung LLM is cut off by the pipeline timeout", async () => {
    const hung: LlmClient = { name: "mock", complete: () => new Promise(() => undefined) };
    const out = await runTurn({ utterance: "Ridgeview Fire?", language: "es", startedAt: NOW }, state(), { ...deps(), llm: hung, timeoutMs: 5 });
    expect(out).toMatchObject({ reply: t("fallback", "es"), degraded: true, errorCode: "llm_timeout" });
  });

  it("a retrieval failure is spoken as the fallback, never an error", async () => {
    const out = await turn("Ridgeview Fire?", deps({ retrieve: async () => Promise.reject(new Error("db down")) }));
    expect(out).toMatchObject({ kind: "no_info", reply: t("fallback", "en"), degraded: true, errorCode: "retrieval_failed" });
  });

  it("a model that drafts an answer citing nothing it was given is rewritten", async () => {
    const lying: LlmClient = { name: "mock", complete: async () => ({ text: "", structured: answer({ citedChunkIds: ["zzz"] }), model: "fake" }) };
    const out = await turn("Ridgeview Fire?", { ...deps({ chunks: [chunk(), shelterChunk()] }), llm: lying });
    expect(out.kind).toBe("no_info");
  });
});
