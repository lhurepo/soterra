// [B] Deterministic MockLlm. Reads `structuredInput` (never prompt text) so tests are stable.
// Turn rules, in order: goodbye phrase → goodbye; follow-up phrase → followup; exact address → zone
// refusal from the evacuation chunk; no area known and a "near me" question → clarify; a retrieved chunk
// with meaningful word overlap that mentions every proper noun the caller used → answer citing it;
// otherwise no_info. Summary: built from the turn texts.
// Failure modes (MOCK_LLM_MODE or createMockLlm({ mode })) exercise the pipeline's safety nets.
import type { AnswerDraft, CallSummary } from "../../contracts";
import type { SummaryInput } from "../../memory/summary";
import { t } from "../../config/strings";
import {
  asksAboutExactAddress,
  asksForFollowUp,
  isGoodbye,
  isLocationDependent,
  wantsAnswerWhenKnown,
} from "../../orchestration/intents";
import { TurnLlmInput } from "../../orchestration/prompt";
import { properNouns, termOverlap, tokenize } from "../../retrieval/text";
import { LlmError } from "./errors";
import type { LlmClient, LlmRequest, LlmResponse } from "./types";

export type MockLlmMode = "normal" | "invalid_json" | "uncited_answer" | "unknown_chunk" | "timeout" | "error";

/** Below this overlap a chunk does not "answer" the question. */
const MIN_OVERLAP = 0.34;

/** Up to `n` sentences of the chunk that best match the question, in their original order. */
function bestSentences(text: string, question: string, n: number): string {
  const sentences = (text.match(/[^.!?]+[.!?]+/g) ?? [text]).map((s) => s.trim());
  const body = sentences.length > 1 ? sentences.slice(1) : sentences; // chunks start with the bulletin title
  return body
    .map((s, i) => ({ s, i, score: termOverlap(question, s) - (/fictional demo data/i.test(s) ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, n)
    .sort((a, b) => a.i - b.i)
    .map((r) => r.s)
    .join(" ");
}

/** The model "translates" by prefixing; good enough to check the Spanish path end to end. */
function inLanguage(reply: string, language: string): string {
  return language === "es" ? `Según la fuente oficial: ${reply}` : reply;
}

export function mockTurn(input: TurnLlmInput): AnswerDraft {
  const { utterance, retrieved, language } = input;
  const base = { citedChunkIds: [] as string[], endCall: false };
  const area = input.area ?? input.context.knownArea;

  if (isGoodbye(utterance)) return { ...base, kind: "goodbye", reply: "Goodbye.", endCall: true };

  if (asksForFollowUp(utterance)) {
    if (wantsAnswerWhenKnown(utterance)) {
      return { ...base, kind: "followup", reply: "", followUpRequest: { targetKind: "question", trigger: "answer_available" } };
    }
    const incidentKey = retrieved.find((c) => c.incidentKey)?.incidentKey;
    return {
      ...base,
      kind: "followup",
      reply: "",
      followUpRequest: {
        targetKind: incidentKey ? "incident" : "area",
        incidentKey,
        area: incidentKey ? undefined : area,
        trigger: /evacuat|evacuaci/i.test(utterance) ? "evacuation_change" : "any_update",
      },
    };
  }

  if (asksAboutExactAddress(utterance)) {
    const zoneChunk = retrieved
      .filter((c) => c.hazardType === "evacuation")
      .sort((a, b) => termOverlap("zone covers", b.text) - termOverlap("zone covers", a.text))[0];
    if (!zoneChunk) return { ...base, kind: "no_info", reply: "", unansweredQuestion: utterance };
    return {
      ...base,
      kind: "answer",
      reply: inLanguage(`${t("addressRefusal", "en").split(". ")[0]}. ${bestSentences(zoneChunk.text, "zone covers", 2)}`, language),
      citedChunkIds: [zoneChunk.chunkId],
    };
  }

  if (!area && isLocationDependent(utterance)) return { ...base, kind: "clarify", reply: t("clarifyArea", language) };

  // A chunk only "covers" the question if it overlaps meaningfully and mentions every proper noun the
  // caller used (so "Hillcrest Elementary" never gets answered from a generic shelter list).
  const nouns = properNouns(utterance);
  const top = [...retrieved]
    .map((c) => ({ c, overlap: termOverlap(utterance, c.text) }))
    .filter(({ c, overlap }) => {
      const words = new Set(tokenize(c.text));
      return overlap >= MIN_OVERLAP && nouns.every((n) => words.has(n));
    })
    .sort((a, b) => b.overlap - a.overlap || b.c.score - a.c.score)[0]?.c;
  if (!top) return { ...base, kind: "no_info", reply: "", unansweredQuestion: utterance };
  return { ...base, kind: "answer", reply: inLanguage(bestSentences(top.text, utterance, 2), language), citedChunkIds: [top.chunkId] };
}

export function mockSummary(input: SummaryInput): CallSummary {
  const asked = input.turns.map((t) => t.utterance).filter(Boolean);
  const summary =
    asked.length === 0
      ? "The caller did not ask a question."
      : `The caller asked ${asked.length} question${asked.length === 1 ? "" : "s"}, starting with: "${asked[0].slice(0, 120)}".`;
  return {
    summary,
    language: input.language,
    topics: [...new Set(input.turns.map((t) => t.kind).filter((k): k is string => !!k))],
    areasMentioned: [],
    hazards: input.hazards,
    unansweredQuestionIds: input.unansweredQuestionIds,
    followUpsRequested: input.followUpsRequested,
    safetyFlag: input.safetyFlag || input.turns.some((t) => t.kind === "safety"),
  };
}

function failingTurn(mode: MockLlmMode, input: TurnLlmInput): LlmResponse | AnswerDraft {
  switch (mode) {
    case "invalid_json":
      return { text: "Sure! The fire is 10% contained.", model: "mock" };
    case "uncited_answer":
      return { kind: "answer", reply: "The fire is fully contained and everyone can go home.", citedChunkIds: [], endCall: false };
    case "unknown_chunk":
      return {
        kind: "answer",
        reply: "The fire is fully contained.",
        citedChunkIds: [...input.retrieved.slice(0, 1).map((c) => c.chunkId), "not-a-retrieved-chunk"],
        endCall: false,
      };
    case "timeout":
      throw new LlmError("timeout", "mock LLM timed out");
    case "error":
      throw new LlmError("provider", "mock LLM failed");
    case "normal":
      return mockTurn(input);
  }
}

export function createMockLlm(options: { mode?: MockLlmMode } = {}): LlmClient & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  const mode = options.mode ?? "normal";
  return {
    name: "mock",
    calls,
    async complete(request: LlmRequest): Promise<LlmResponse> {
      calls.push(request);
      const model = `mock:${request.model}`;
      if (request.purpose === "turn") {
        const out = failingTurn(mode, TurnLlmInput.parse(request.structuredInput));
        if ("text" in out) return { ...out, model };
        return { text: JSON.stringify(out), structured: out, model };
      }
      if (mode === "timeout" || mode === "error") throw new LlmError(mode === "timeout" ? "timeout" : "provider", `mock LLM ${mode}`);
      if (mode === "invalid_json") return { text: "not json", model };
      const structured = request.purpose === "summary" ? mockSummary(request.structuredInput as SummaryInput) : { items: [] };
      return { text: JSON.stringify(structured), structured, model };
    },
  };
}
