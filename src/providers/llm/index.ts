// [B] Picks the LlmClient from config (LLM_PROVIDER=mock|anthropic).
import type { Config } from "../../config/env";
import { createAnthropicLlm } from "./anthropic";
import { createMockLlm } from "./mock";
import type { LlmClient } from "./types";

export type { LlmClient, LlmRequest, LlmResponse, LlmPurpose } from "./types";

export function selectLlm(config: Config): LlmClient {
  return config.LLM_PROVIDER === "anthropic" ? createAnthropicLlm(config.ANTHROPIC_API_KEY) : createMockLlm();
}
