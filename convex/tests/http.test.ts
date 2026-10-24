// [B] HTTP surface: auth on every /voice route, body validation, contract version, /health, mock sites.
import { afterEach, describe, expect, it } from "vitest";
import { CONTRACT_VERSION, HealthResponse } from "../../src/contracts";
import { newTest, seed, setupEnv, voicePost } from "../test.setup";

const start = { contractVersion: CONTRACT_VERSION, provider: "cartesia", providerCallId: "c1", direction: "inbound", startedAt: 1 };
const turn = { contractVersion: CONTRACT_VERSION, providerCallId: "c1", turnIndex: 0, utterance: "hi", language: "en", receivedAt: 1 };
const end = { contractVersion: CONTRACT_VERSION, providerCallId: "c1", endedAt: 2, reason: "caller_hangup" };

describe("voice auth", () => {
  afterEach(() => setupEnv());

  it.each([
    ["/voice/session/start", start],
    ["/voice/turn", turn],
    ["/voice/session/end", end],
  ])("%s returns 401 without the secret", async (path, body) => {
    setupEnv();
    const t = newTest();
    const res = await voicePost(t, path, body, null);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
    expect((await voicePost(t, path, body, "wrong-secret")).status).toBe(401);
  });

  it("fails closed when VOICE_API_SECRET is not configured", async () => {
    setupEnv({ VOICE_API_SECRET: "" });
    const res = await voicePost(newTest(), "/voice/session/start", start, "");
    expect(res.status).toBe(401);
  });
});

describe("request validation", () => {
  it("rejects malformed bodies and other contract versions with 400", async () => {
    setupEnv();
    const t = newTest();
    const bad = await voicePost(t, "/voice/turn", { ...turn, providerCallId: undefined });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("bad_request");
    const version = await voicePost(t, "/voice/session/start", { ...start, contractVersion: "2" });
    expect(version.status).toBe(400);
    expect((await version.json()).error.code).toBe("contract_version_mismatch");
  });

  it("returns 404 when ending an unknown session", async () => {
    setupEnv();
    expect((await voicePost(newTest(), "/voice/session/end", end)).status).toBe(404);
  });
});

describe("health", () => {
  it("reports each integration without secrets", async () => {
    setupEnv({ LLM_PROVIDER: "anthropic" });
    const res = await newTest().fetch("/health", { method: "GET" });
    const body = HealthResponse.parse(await res.json());
    expect(body.integrations.llm).toBe("unconfigured");
    expect(body.integrations.voiceAuth).toBe("live");
    expect(JSON.stringify(body)).not.toContain("test-voice-secret");
  });
});

describe("mock sites", () => {
  it("are served only when ENABLE_MOCK_SITES=true", async () => {
    setupEnv();
    const t = newTest();
    await seed(t);
    expect((await t.fetch("/mock-sites/county-emergency.html", { method: "GET" })).status).toBe(404);
    setupEnv({ ENABLE_MOCK_SITES: "true" });
    const res = await t.fetch("/mock-sites/county-emergency.html", { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Ridgeview Fire");
  });
});

describe("app state feed", () => {
  it("is public and returns normal mode with no alerts on an empty deployment", async () => {
    setupEnv();
    const res = await newTest().fetch("/app/state", { method: "GET" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contractVersion).toBe(CONTRACT_VERSION);
    expect(body.mode).toBe("normal");
    expect(body.alerts).toEqual([]);
  });

  it("lists active official bulletins with their areas, newest first, and no secrets", async () => {
    setupEnv();
    const t = newTest();
    await seed(t);
    const body = await (await t.fetch("/app/state", { method: "GET" })).json();
    expect(body.alerts.length).toBeGreaterThan(0);
    for (const a of body.alerts) {
      expect(a.title).toBeTruthy();
      expect(a.sourceName).toBeTruthy();
      expect(Array.isArray(a.areaLabels)).toBe(true);
    }
    const times = body.alerts.map((a: { updatedAt?: number; issuedAt: number }) => a.updatedAt ?? a.issuedAt);
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    expect(JSON.stringify(body)).not.toContain("test-voice-secret");
  });
});
