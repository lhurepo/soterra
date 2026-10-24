// [B] LlmClient interface used by the turn pipeline, call summaries and ingestion extraction.
// Kept general on purpose: ingestion ([I]) calls the same adapter for extraction.

export type LlmPurpose = "turn" | "summary" | "extraction";

export type LlmMessage = { role: "user" | "assistant"; content: string };

export type LlmRequest = {
  purpose: LlmPurpose;
  model: string;
  /** Static instructions. Live adapters mark it cacheable, so keep per-request data out of it. */
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  /** The same data the prompt was built from, so mocks never parse prompt text. */
  structuredInput?: unknown;
  /** JSON Schema the reply must follow (sent as structured output when the provider supports it). */
  jsonSchema?: Record<string, unknown>;
  /** Per-request timeout; adapters fall back to their own default. */
  timeoutMs?: number;
};

export type LlmResponse = {
  /** Raw model text. For "turn", "summary" and "extraction" this is expected to be JSON. */
  text: string;
  /** Mocks return parsed output directly; live adapters leave it undefined. */
  structured?: unknown;
  model: string;
  usage?: { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number };
};

export interface LlmClient {
  readonly name: "mock" | "anthropic";
  complete(request: LlmRequest): Promise<LlmResponse>;
}
