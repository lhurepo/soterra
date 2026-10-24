// [B] Config parsing, health status and provider selection.
import { describe, expect, it } from "vitest";
import { checkBearer } from "../src/config/auth";
import { loadConfig } from "../src/config/env";
import { NotConfiguredError } from "../src/config/errors";
import { integrationStatus } from "../src/config/health";
import { loadIngestionSettings } from "../src/ingestion/config";
import { requireMoss } from "../src/providers/moss";
import { selectLlm } from "../src/providers/llm";

describe("config", () => {
  it("defaults to mock providers and the agreed model names", () => {
    const c = loadConfig({});
    expect(c.LLM_PROVIDER).toBe("mock");
    expect(c.CLAUDE_FAST_MODEL).toBe("claude-haiku-5-5");
    expect(c.CLAUDE_SMART_MODEL).toBe("claude-sonnet-5-5");
    expect(c.SERVE_FIXTURES).toBe(false);
    expect(c.INGEST_STATES).toEqual(["CA"]);
    expect(selectLlm(c).name).toBe("mock");
  });

  it("reports live, mock and unconfigured integrations", () => {
    const status = integrationStatus(loadConfig({ LLM_PROVIDER: "anthropic", VOICE_API_SECRET: "s" }));
    expect(status.llm).toBe("unconfigured");
    expect(status.voiceAuth).toBe("live");
    expect(status.phoneNotifier).toBe("mock");
    expect(status.sms).toBe("unconfigured");
  });

  it("unconfigured live adapters throw NotConfiguredError naming the env vars", () => {
    expect(() => selectLlm(loadConfig({ LLM_PROVIDER: "anthropic" }))).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => requireMoss(loadConfig({ RETRIEVER: "moss" }))).toThrow(NotConfiguredError);
  });

  it("checks bearer tokens and fails closed", () => {
    expect(checkBearer("Bearer abc", "abc")).toBe(true);
    expect(checkBearer("Bearer abd", "abc")).toBe(false);
    expect(checkBearer(null, "abc")).toBe(false);
    expect(checkBearer("Bearer abc", undefined)).toBe(false);
  });
});

describe("env that only answers direct reads (Convex's process.env)", () => {
  const values: Record<string, string> = {
    X_ALLOWLIST: "CAL_FIRE:CAL FIRE:CA,NWSBayArea:NWS Bay Area:CA",
    APIFY_TOKEN: "tok",
    INGEST_STATES: "CA,OR",
  };
  // `in` and Object.keys see nothing, exactly like the deployed runtime; property reads work.
  const env = new Proxy({} as Record<string, string | undefined>, { get: (_t, k) => values[String(k)], has: () => false, ownKeys: () => [] });

  it("loadIngestionSettings reads X_ALLOWLIST instead of falling back to the demo handle", () => {
    expect(loadIngestionSettings(env).xAllowlist.map((e) => e.handle)).toEqual(["cal_fire", "nwsbayarea"]);
  });

  it("loadConfig still sees every variable", () => {
    const c = loadConfig(env);
    expect(c.APIFY_TOKEN).toBe("tok");
    expect(c.INGEST_STATES).toEqual(["CA", "OR"]);
  });
});
