// [B] Caller memory policy, context building, TTL math, phone normalization and summaries.
import { describe, expect, it } from "vitest";
import type { CallerContext } from "../src/contracts";
import { DEFAULTS, subscriptionTtl, supportedLanguage } from "../src/config/defaults";
import { loadConfig } from "../src/config/env";
import { approxTokens, buildCallerContext, toLlmContext } from "../src/memory/callerContext";
import { normalizeE164 } from "../src/memory/phone";
import { callerMemoryExpiresAt, retentionCutoffs } from "../src/memory/retention";
import { fallbackSummary, parseSummary, type SummaryInput } from "../src/memory/summary";
import { NOW } from "./helpers";

const DAY = 86_400_000;

describe("caller context", () => {
  const base = { callerId: "c1", language: "en", now: NOW };

  it("includes the last summary only within its TTL and needs only from a verified account", () => {
    const recent = buildCallerContext({ ...base, lastSummary: { text: "asked about the fire", createdAt: NOW - DAY }, accountNeeds: ["oxygen"] });
    expect(recent.identity).toBe("caller_id");
    expect(recent.lastCallSummary).toBe("asked about the fire");
    expect(recent.needs).toBeUndefined();
    const old = buildCallerContext({ ...base, lastSummary: { text: "x", createdAt: NOW - DEFAULTS.lastSummaryTtlMs - 1 } });
    expect(old.lastCallSummary).toBeUndefined();
    const account = buildCallerContext({ ...base, accountId: "a1", accountNeeds: ["oxygen"] });
    expect(account).toMatchObject({ identity: "verified_account", needs: ["oxygen"] });
    expect(buildCallerContext({ language: "es", now: NOW }).identity).toBe("anonymous");
  });

  it("stays around 300 tokens even with long inputs", () => {
    const ctx = buildCallerContext({
      ...base,
      accountId: "a1",
      accountNeeds: Array.from({ length: 20 }, (_, i) => `need number ${i} with a long description`),
      lastSummary: { text: "word ".repeat(1_000), createdAt: NOW },
      activeSubscriptions: Array.from({ length: 10 }, () => ({ kind: "incident" as const, incidentKey: "k".repeat(100), trigger: "any_update" })),
      lastIncidentKeys: ["a", "b", "c", "d", "e"],
      lastCallAt: NOW,
    });
    expect(approxTokens(ctx)).toBeLessThanOrEqual(DEFAULTS.callerContextTokenCap + 60);
  });

  it("never exposes needs, summaries or exact location to the model on caller ID alone", () => {
    const ctx: CallerContext = {
      identity: "caller_id",
      language: "en",
      callerId: "x",
      needs: ["oxygen"],
      lastCallSummary: "asked about 412 Oak Lane",
      knownArea: { state: "CA", countyFips: "06097", zip: "95404", city: "Santa Rosa", label: "Sonoma County" },
      recentIncidentKeys: ["ridgeview-fire-demo"],
    };
    const visible = toLlmContext(ctx);
    expect(visible.needs).toBeUndefined();
    expect(visible.lastCallSummary).toBeUndefined();
    expect(visible.knownArea?.zip).toBeUndefined();
    expect(visible.knownArea?.city).toBeUndefined();
    expect(visible.recentIncidentKeys).toEqual(["ridgeview-fire-demo"]);
    expect(toLlmContext({ ...ctx, identity: "verified_account" }).needs).toEqual(["oxygen"]);
  });
});

describe("TTL math", () => {
  const cfg = loadConfig({});

  it("defaults to 7-day transcripts and 30-day anonymous memory", () => {
    expect(cfg.ANON_TRANSCRIPT_TTL_HOURS).toBe(168);
    expect(cfg.ANON_MEMORY_TTL_DAYS).toBe(30);
    expect(retentionCutoffs(cfg, NOW)).toEqual({ anonymousTranscriptsBefore: NOW - 7 * DAY, anonymousMemoryBefore: NOW - 30 * DAY });
    expect(retentionCutoffs(loadConfig({ ANON_TRANSCRIPT_TTL_HOURS: "1" }), NOW).anonymousTranscriptsBefore).toBe(NOW - 3_600_000);
  });

  it("never expires memory linked to a verified account", () => {
    expect(callerMemoryExpiresAt(cfg, NOW, false)).toBe(NOW + 30 * DAY);
    expect(callerMemoryExpiresAt(cfg, NOW, true)).toBeUndefined();
  });

  it("clamps subscription lifetimes to 24 h by default and 72 h at most", () => {
    expect(subscriptionTtl()).toBe(24 * 3_600_000);
    expect(subscriptionTtl(10 * DAY)).toBe(72 * 3_600_000);
    expect(subscriptionTtl(3_600_000)).toBe(3_600_000);
  });

  it("supports English and Spanish only", () => {
    expect(supportedLanguage("es-US")).toBe("es");
    expect(supportedLanguage("fr")).toBe("en");
    expect(supportedLanguage(undefined)).toBe("en");
  });
});

describe("phone normalization", () => {
  it.each([
    ["+17075550123", "+17075550123"],
    ["(707) 555-0123", "+17075550123"],
    ["1-707-555-0123", "+17075550123"],
    ["anonymous", undefined],
    ["Restricted", undefined],
    ["", undefined],
    ["12345", undefined],
  ])("%s → %s", (raw, expected) => expect(normalizeE164(raw)).toBe(expected));
});

describe("summaries", () => {
  const input: SummaryInput = {
    language: "en",
    turns: [{ utterance: "What's going on with the Ridgeview Fire?", kind: "answer", reply: "…" }],
    unansweredQuestionIds: ["q1"],
    followUpsRequested: [],
    hazards: ["wildfire"],
    safetyFlag: false,
  };

  it("has a deterministic fallback built from the turns", () => {
    const s = fallbackSummary(input);
    expect(s.summary).toMatch(/asked 1 question/);
    expect(s.summary).toMatch(/could not be answered/);
    expect(s.unansweredQuestionIds).toEqual(["q1"]);
  });

  it("takes ids and the safety flag from our records, not the model", () => {
    const parsed = parseSummary(
      { summary: "ok", language: "en", topics: [], areasMentioned: [{ state: "California", label: "x" }], hazards: [], unansweredQuestionIds: ["made-up"], followUpsRequested: ["x"], safetyFlag: false },
      { ...input, safetyFlag: true },
    );
    expect(parsed.unansweredQuestionIds).toEqual(["q1"]);
    expect(parsed.followUpsRequested).toEqual([]);
    expect(parsed.safetyFlag).toBe(true);
    expect(parsed.areasMentioned).toEqual([]);
  });
});
