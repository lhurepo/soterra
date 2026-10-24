// [B] Picks the LlmClient from config (LLM_PROVIDER=mock|anthropic).
import type { Config } from "../../config/env";
import { createAnthropicLlm } from "./anthropic";
import { createMockLlm } from "./mock";
import { createKeyPoolLlm, parseKeyPool } from "./pool";
import type { LlmClient } from "./types";

export type { LlmClient, LlmRequest, LlmResponse, LlmPurpose, LlmMessage } from "./types";
export { LlmError, isLlmError } from "./errors";

/** The Anthropic client for this deployment: one key, or a pool that moves on when a key runs out of credit. */
export function createAnthropicFromConfig(config: Config, options: { timeoutMs?: number } = {}): LlmClient {
  const keys = parseKeyPool(config.ANTHROPIC_API_KEY, config.ANTHROPIC_API_KEYS);
  if (keys.length <= 1) return createAnthropicLlm(keys[0], options);
  return createKeyPoolLlm(keys, (key) => createAnthropicLlm(key, options));
}

export function selectLlm(config: Config): LlmClient {
  return config.LLM_PROVIDER === "anthropic" ? createAnthropicFromConfig(config) : createMockLlm({ mode: config.MOCK_LLM_MODE });
}
