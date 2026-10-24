// [B] Anthropic LlmClient (placeholder). Runs in Convex's default runtime: the SDK only needs fetch.
// TODO(B): structured output for AnswerDraft (output_config.format), effort/latency tuning, prompt caching.
import Anthropic from "@anthropic-ai/sdk";
import { NotConfiguredError } from "../../config/errors";
import type { LlmClient, LlmRequest, LlmResponse } from "./types";

export function createAnthropicLlm(apiKey: string | undefined, options: { timeoutMs?: number } = {}): LlmClient {
  if (!apiKey) throw new NotConfiguredError("Anthropic LLM", ["ANTHROPIC_API_KEY"]);
  // Calls are latency-bound: fail fast and let the pipeline fall back instead of retrying.
  const client = new Anthropic({ apiKey, timeout: options.timeoutMs ?? 6_000, maxRetries: 0 });

  return {
    name: "anthropic",
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const response = await client.messages.create({
        model: request.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages,
        // Phone turns need speed; extraction and summaries can think more. Do not send temperature:
        // it is rejected on current models.
        output_config: { effort: request.purpose === "turn" ? "low" : "medium" },
      });
      if (response.stop_reason === "refusal") {
        throw new Error("Anthropic refused the request");
      }
      const text = response.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("");
      return {
        text,
        model: response.model,
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };
    },
  };
}
