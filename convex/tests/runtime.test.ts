// [B] The Anthropic SDK loads and constructs in an edge-like runtime (Convex's default runtime has no Node APIs).
import { describe, expect, it } from "vitest";
import { createAnthropicLlm } from "../../src/providers/llm/anthropic";

describe("anthropic adapter", () => {
  it("constructs without Node built-ins", () => {
    expect(createAnthropicLlm("sk-test-not-real").name).toBe("anthropic");
  });
});
