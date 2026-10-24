// [B] A pool of Anthropic keys. Hackathon keys carry a tiny budget and run dry mid-demo, so the backend can hold
// several (ANTHROPIC_API_KEY first, then ANTHROPIC_API_KEYS, comma or newline separated) and move to the next one
// when a key is out of credit, unauthorized or rate limited. A spent key is skipped for a while so the next call
// does not waste time on it. Keys are never logged: only the last four characters.
import type { LlmClient, LlmRequest, LlmResponse } from "./types";
import { LlmError, isLlmError } from "./errors";

/** The primary key first, then the extras, trimmed and de-duplicated. */
export function parseKeyPool(primary: string | undefined, extra: string | undefined): string[] {
  const all = [primary, ...(extra ?? "").split(/[\s,;]+/)].map((k) => k?.trim()).filter((k): k is string => !!k);
  return [...new Set(all)];
}

export const keyTail = (key: string) => `…${key.slice(-4)}`;

const CREDIT_MESSAGE = /credit|billing|balance|quota|spend|usage limit|exceeded/i;

/** Should this failure move us to another key? Only account-level problems: never a bad request or a slow reply. */
export function isKeyProblem(err: unknown): { cooldownMs: number; reason: string } | null {
  if (!isLlmError(err)) return null;
  if (err.code === "auth") return { cooldownMs: 60 * 60_000, reason: "unauthorized" };
  if (err.code === "rate_limited") return { cooldownMs: 60_000, reason: "rate limited" };
  if (err.code === "bad_request" && CREDIT_MESSAGE.test(err.message)) return { cooldownMs: 10 * 60_000, reason: "out of credit" };
  return null;
}

// Module-level on purpose: a warm runtime remembers which keys are spent between calls.
const spentUntil = new Map<string, number>();

export function resetKeyPoolState() {
  spentUntil.clear();
}

export function createKeyPoolLlm(
  keys: readonly string[],
  makeClient: (key: string) => LlmClient,
  now: () => number = Date.now,
): LlmClient {
  const clients = keys.map((key) => ({ key, client: makeClient(key) }));
  return {
    name: "anthropic",
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const t = now();
      // Live keys first, in order; if every key is marked spent, try them all again rather than fail outright.
      const live = clients.filter((c) => (spentUntil.get(c.key) ?? 0) <= t);
      const order = live.length > 0 ? live : clients;
      let last: unknown;
      for (const { key, client } of order) {
        try {
          return await client.complete(request);
        } catch (err) {
          const problem = isKeyProblem(err);
          if (!problem) throw err;
          spentUntil.set(key, now() + problem.cooldownMs);
          console.warn(`[llm] key ${keyTail(key)} is ${problem.reason}; trying the next key`);
          last = err;
        }
      }
      throw last instanceof LlmError ? last : new LlmError("provider", "every Anthropic key failed", last);
    },
  };
}
