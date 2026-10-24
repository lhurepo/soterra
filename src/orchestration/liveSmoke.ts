// [B] Live smoke scenarios against a real model (RUN_LIVE_TESTS=1 or `npx convex run llmCheck:smoke`).
// Each checks the reply kind, that every citation comes from this turn's retrieval, and the reply length.
import type { RetrievedChunk } from "../contracts";
import { DEFAULTS } from "../config/defaults";
import type { LlmClient } from "../providers/llm/types";
import type { RetrievalRequest, RetrievalResult } from "../retrieval/retriever";
import { runTurn, type TurnState } from "./pipeline";

export const LIVE_SCENARIOS = [
  { name: "grounded answer", utterance: "What's going on with the Ridgeview Fire?", language: "en", expect: ["answer"] },
  { name: "unknown fact", utterance: "Is Hillcrest Elementary open as a shelter?", language: "en", expect: ["no_info"] },
  { name: "address in zone (Spanish)", utterance: "¿La dirección 412 Oak Lane está dentro de la zona de evacuación?", language: "es", expect: ["answer", "no_info", "clarify"] },
] as const;

export type LiveScenarioResult = {
  name: string;
  ok: boolean;
  kind: string;
  reply: string;
  words: number;
  citationsValid: boolean;
  llmMs?: number;
  problems: string[];
};

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export async function runLiveSmoke(
  llm: LlmClient,
  model: string,
  retrieve: (request: RetrievalRequest) => Promise<RetrievalResult>,
): Promise<LiveScenarioResult[]> {
  const results: LiveScenarioResult[] = [];
  for (const s of LIVE_SCENARIOS) {
    const state: TurnState = {
      hasCallerPhone: true,
      context: { identity: "caller_id", language: s.language },
      areaCandidates: [],
      history: [],
      recentCallerUtterances: [],
      hasOpenQuestion: false,
    };
    let retrieved: RetrievedChunk[] = [];
    const out = await runTurn({ utterance: s.utterance, language: s.language }, state, {
      now: Date.now,
      llm,
      model,
      retrieve: async (q) => {
        const r = await retrieve(q);
        retrieved = r.chunks;
        return r;
      },
    });
    const urls = new Set(retrieved.map((c) => c.url));
    const citationsValid = out.citations.every((c) => urls.has(c.url)) && (out.kind !== "answer" || out.citations.length > 0);
    const problems: string[] = [];
    if (!(s.expect as readonly string[]).includes(out.kind)) problems.push(`kind ${out.kind}, expected ${s.expect.join("|")}`);
    if (!citationsValid) problems.push("citation not from this turn's retrieval");
    // The attribution sentence adds ~15 words beyond the model's 60-word budget.
    if (words(out.reply) > DEFAULTS.replyMaxWords + 25) problems.push(`reply too long (${words(out.reply)} words)`);
    if (out.degraded) problems.push(`degraded (${out.errorCode ?? "?"})`);
    if (s.name.startsWith("address") && /\b(esta|está|is)\b[^.]{0,30}\bdentro\b/i.test(out.reply) && !/no puedo confirmar/i.test(out.reply)) {
      problems.push("confirmed an address inside a zone");
    }
    results.push({ name: s.name, ok: problems.length === 0, kind: out.kind, reply: out.reply, words: words(out.reply), citationsValid, llmMs: out.timingsMs.llm, problems });
  }
  return results;
}
