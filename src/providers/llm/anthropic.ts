// [B] AnthropicLlm. Runs in Convex's default runtime: the SDK only needs fetch.
// Verified against the live API from the dev deployment (convex/llmCheck.ts, docs/DECISIONS.md):
// structured output via output_config.format, no temperature (rejected since 2026-10-21),
// thinking disabled + low effort for Haiku turns, a cacheable static system prompt.
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULTS } from "../../config/defaults";
import { NotConfiguredError } from "../../config/errors";
import { LlmError } from "./errors";
import type { LlmClient, LlmRequest, LlmResponse } from "./types";

/**
 * Phone turns need speed. Haiku accepts thinking "disabled" at low effort; other current models reject
 * "disabled", so they keep adaptive thinking at low effort. Summaries and extraction think more.
 */
export function requestTuning(model: string, purpose: LlmRequest["purpose"]): {
  effort: "low" | "medium";
  thinking?: Anthropic.ThinkingConfigParam;
} {
  if (purpose !== "turn") return { effort: "medium" };
  return model.startsWith("claude-haiku") ? { effort: "low", thinking: { type: "disabled" } } : { effort: "low" };
}

export function toLlmError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new LlmError("timeout", "Anthropic request timed out", err);
  if (err instanceof Anthropic.APIConnectionError) return new LlmError("network", "Could not reach the Anthropic API", err);
  if (err instanceof Anthropic.RateLimitError) return new LlmError("rate_limited", "Anthropic rate limit", err);
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new LlmError("auth", "Anthropic rejected the API key", err);
  }
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError) {
    return new LlmError("bad_request", `Anthropic rejected the request: ${err.message}`, err);
  }
  if (err instanceof Anthropic.APIError) return new LlmError("provider", `Anthropic API error ${err.status ?? ""}`.trim(), err);
  return new LlmError("provider", err instanceof Error ? err.message : "unknown Anthropic error", err);
}

export function createAnthropicLlm(apiKey: string | undefined, options: { timeoutMs?: number } = {}): LlmClient {
  if (!apiKey) throw new NotConfiguredError("Anthropic LLM", ["ANTHROPIC_API_KEY"]);
  // Calls are latency-bound: fail fast and let the pipeline fall back instead of retrying.
  const client = new Anthropic({ apiKey, timeout: options.timeoutMs ?? DEFAULTS.llmTimeoutMs, maxRetries: 0 });

  return {
    name: "anthropic",
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const { effort, thinking } = requestTuning(request.model, request.purpose);
      let response: Anthropic.Message;
      try {
        response = await client.messages.create(
          {
            model: request.model,
            max_tokens: request.maxTokens,
            // The system prompt is static per purpose, so it can be served from the prompt cache.
            system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
            messages: request.messages,
            ...(thinking ? { thinking } : {}),
            output_config: {
              effort,
              ...(request.jsonSchema ? { format: { type: "json_schema" as const, schema: request.jsonSchema } } : {}),
            },
          },
          request.timeoutMs ? { timeout: request.timeoutMs } : undefined,
        );
      } catch (err) {
        throw toLlmError(err);
      }
      if (response.stop_reason === "refusal") throw new LlmError("refusal", "Anthropic declined the request");
      if (response.stop_reason === "max_tokens") throw new LlmError("invalid_output", "reply was cut off at max_tokens");
      const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      return {
        text,
        model: response.model,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadInputTokens: response.usage.cache_read_input_tokens ?? undefined,
        },
      };
    },
  };
}
