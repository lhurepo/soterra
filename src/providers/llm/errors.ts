// [B] Typed LLM errors. The pipeline maps every one of them to a safe spoken reply.

export type LlmErrorCode =
  | "timeout"
  | "rate_limited"
  | "auth"
  | "bad_request"
  | "refusal"
  | "invalid_output"
  | "provider"
  | "network";

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export function isLlmError(err: unknown): err is LlmError {
  return err instanceof Error && err.name === "LlmError" && "code" in err;
}

/** Rejects with LlmError("timeout") if `promise` does not settle within `ms`. Always clears its timer. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label = "LLM call"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LlmError("timeout", `${label} timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
