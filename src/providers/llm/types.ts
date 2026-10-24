// [B] LlmClient interface used by the turn pipeline, call summaries and ingestion extraction.

export type LlmPurpose = "turn" | "summary" | "extraction";

export type LlmMessage = { role: "user" | "assistant"; content: string };

export type LlmRequest = {
  purpose: LlmPurpose;
  model: string;
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  /** The same data the prompt was built from, so mocks never parse prompt text. */
  structuredInput?: unknown;
};

export type LlmResponse = {
  /** Raw model text. For "turn", "summary" and "extraction" this is expected to be JSON. */
  text: string;
  /** Mocks return parsed output directly; live adapters leave it undefined. */
  structured?: unknown;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
};

export interface LlmClient {
  readonly name: "mock" | "anthropic";
  complete(request: LlmRequest): Promise<LlmResponse>;
}
