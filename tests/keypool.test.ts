// [B] The Anthropic key pool: move to the next key only for account-level problems, remember spent keys, never log keys.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnthropicFromConfig } from "../src/providers/llm";
import { LlmError } from "../src/providers/llm/errors";
import { createKeyPoolLlm, isKeyProblem, keyTail, parseKeyPool, resetKeyPoolState } from "../src/providers/llm/pool";
import type { LlmClient, LlmRequest, LlmResponse } from "../src/providers/llm/types";
import { loadConfig } from "../src/config/env";

const request = { model: "m", system: "s", messages: [], maxTokens: 10, purpose: "turn" } as unknown as LlmRequest;
const ok = (model: string): LlmResponse => ({ text: "{}", model, usage: { inputTokens: 1, outputTokens: 1 } }) as LlmResponse;

/** A fake client per key: `behaviour[key]` is a response or an error to throw. */
function pool(behaviour: Record<string, LlmResponse | LlmError>, clock = { t: 1_000 }) {
  const calls: string[] = [];
  const llm = createKeyPoolLlm(
    Object.keys(behaviour),
    (key): LlmClient => ({
      name: "anthropic",
      async complete() {
        calls.push(key);
        const b = behaviour[key];
        if (b instanceof LlmError) throw b;
        return b;
      },
    }),
    () => clock.t,
  );
  return { llm, calls, clock };
}

const noCredit = () => new LlmError("bad_request", "Anthropic rejected the request: Your credit balance is too low to access the Anthropic API.");

beforeEach(() => {
  resetKeyPoolState();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("key pool", () => {
  it("parses the primary key and the extras, trimmed and without duplicates", () => {
    expect(parseKeyPool("k1", "k2, k3\nk1;k4 ")).toEqual(["k1", "k2", "k3", "k4"]);
    expect(parseKeyPool(undefined, undefined)).toEqual([]);
    expect(parseKeyPool(undefined, "a")).toEqual(["a"]);
  });

  it("moves to the next key when one is out of credit, and skips it on the next call", async () => {
    const { llm, calls } = pool({ spent: noCredit(), fresh: ok("fresh") });
    expect((await llm.complete(request)).model).toBe("fresh");
    expect(calls).toEqual(["spent", "fresh"]);
    calls.length = 0;
    expect((await llm.complete(request)).model).toBe("fresh");
    expect(calls).toEqual(["fresh"]); // the spent key is not retried
  });

  it("tries a spent key again after its cooldown", async () => {
    const { llm, calls, clock } = pool({ spent: noCredit(), fresh: ok("fresh") });
    await llm.complete(request);
    calls.length = 0;
    clock.t += 11 * 60_000;
    await llm.complete(request);
    expect(calls).toEqual(["spent", "fresh"]);
  });

  it("treats unauthorized and rate limited keys as problems too", async () => {
    expect(isKeyProblem(new LlmError("auth", "bad key"))).toMatchObject({ reason: "unauthorized" });
    expect(isKeyProblem(new LlmError("rate_limited", "slow down"))).toMatchObject({ reason: "rate limited" });
    expect(isKeyProblem(noCredit())).toMatchObject({ reason: "out of credit" });
  });

  it("does NOT switch keys for errors that are not about the key", async () => {
    for (const err of [new LlmError("timeout", "slow"), new LlmError("invalid_output", "cut off"), new LlmError("bad_request", "bad schema"), new LlmError("provider", "500")]) {
      resetKeyPoolState();
      const { llm, calls } = pool({ first: err, second: ok("second") });
      await expect(llm.complete(request)).rejects.toBe(err);
      expect(calls).toEqual(["first"]);
    }
  });

  it("fails with the last error when every key is spent, and tries them all again later", async () => {
    const { llm, calls } = pool({ a: noCredit(), b: noCredit() });
    await expect(llm.complete(request)).rejects.toThrow(/credit balance/);
    expect(calls).toEqual(["a", "b"]);
    calls.length = 0;
    await expect(llm.complete(request)).rejects.toThrow(/credit balance/); // all spent: tried again rather than refused
    expect(calls).toEqual(["a", "b"]);
  });

  it("never logs a whole key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { llm } = pool({ "sk-ant-secret-key-1234": noCredit(), other: ok("other") });
    await llm.complete(request);
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain(keyTail("sk-ant-secret-key-1234"));
    expect(logged).not.toContain("sk-ant-secret");
  });
});

describe("configuration", () => {
  it("one key gives a plain client; several give a pool; none is a clear error", () => {
    const base = { LLM_PROVIDER: "anthropic" } as Record<string, string>;
    expect(createAnthropicFromConfig(loadConfig({ ...base, ANTHROPIC_API_KEY: "sk-one" })).name).toBe("anthropic");
    expect(createAnthropicFromConfig(loadConfig({ ...base, ANTHROPIC_API_KEY: "sk-one", ANTHROPIC_API_KEYS: "sk-two,sk-three" })).name).toBe("anthropic");
    expect(createAnthropicFromConfig(loadConfig({ ...base, ANTHROPIC_API_KEYS: "sk-two" })).name).toBe("anthropic");
    expect(() => createAnthropicFromConfig(loadConfig(base))).toThrow(/ANTHROPIC_API_KEY/);
  });
});
