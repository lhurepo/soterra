// [B] Deterministic MockLlm. Reads `structuredInput` (never prompt text) so tests are stable.
// Turn behaviour: answer from the top retrieved chunk when it plausibly covers the question, else no_info.
import type { AnswerDraft, CallSummary, HazardType } from "../../contracts";
import { asksAboutExactAddress, asksForFollowUp, isGoodbye } from "../../orchestration/intents";
import { TurnLlmInput } from "../../orchestration/prompt";
import { properNouns, termOverlap, tokenize } from "../../retrieval/text";
import type { LlmClient, LlmRequest, LlmResponse } from "./types";

/** Up to `n` sentences of the chunk that best match the question, in their original order. */
function bestSentences(text: string, question: string, n: number): string {
  const sentences = (text.match(/[^.!?]+[.!?]+/g) ?? [text]).map((s) => s.trim());
  const body = sentences.length > 1 ? sentences.slice(1) : sentences; // chunks start with the bulletin title
  const ranked = body
    .map((s, i) => ({ s, i, score: termOverlap(question, s) - (/fictional demo data/i.test(s) ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, n)
    .sort((a, b) => a.i - b.i);
  return ranked.map((r) => r.s).join(" ");
}

function mockTurn(input: TurnLlmInput): AnswerDraft {
  const { utterance, retrieved } = input;
  const base = { citedChunkIds: [] as string[], endCall: false };

  if (isGoodbye(utterance)) return { ...base, kind: "goodbye", reply: "Goodbye.", endCall: true };

  if (asksForFollowUp(utterance)) {
    const incidentKey = retrieved.find((c) => c.incidentKey)?.incidentKey;
    return {
      ...base,
      kind: "followup",
      reply: "",
      followUpRequest: {
        targetKind: incidentKey ? "incident" : "area",
        incidentKey,
        area: incidentKey ? undefined : input.context.knownArea,
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
      reply: `I can't confirm whether a specific address is inside a zone. ${bestSentences(zoneChunk.text, "zone covers", 2)}`,
      citedChunkIds: [zoneChunk.chunkId],
    };
  }

  // A chunk only "covers" the question if it mentions every proper noun the caller used
  // (so "Hillcrest Elementary" never gets answered from a generic shelter list).
  const nouns = properNouns(utterance);
  const top = retrieved.find((c) => {
    const words = new Set(tokenize(c.text));
    return nouns.every((n) => words.has(n));
  });
  if (!top) return { ...base, kind: "no_info", reply: "", unansweredQuestion: utterance };
  return { ...base, kind: "answer", reply: bestSentences(top.text, utterance, 2), citedChunkIds: [top.chunkId] };
}

type SummaryInput = {
  language: string;
  turns: { utterance: string; kind?: string }[];
  unansweredQuestionIds: string[];
  followUpsRequested: string[];
  hazards: HazardType[];
};

function mockSummary(input: SummaryInput): CallSummary {
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
    safetyFlag: input.turns.some((t) => t.kind === "safety"),
  };
}

export function createMockLlm(): LlmClient & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    name: "mock",
    calls,
    async complete(request: LlmRequest): Promise<LlmResponse> {
      calls.push(request);
      let structured: unknown;
      switch (request.purpose) {
        case "turn":
          structured = mockTurn(TurnLlmInput.parse(request.structuredInput));
          break;
        case "summary":
          structured = mockSummary(request.structuredInput as SummaryInput);
          break;
        case "extraction":
          structured = { items: [] };
          break;
      }
      return { text: JSON.stringify(structured), structured, model: `mock:${request.model}` };
    },
  };
}
