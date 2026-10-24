// [I] FLAGGED MOCK: deterministic extraction LlmClient used when LLM_PROVIDER=mock. The backend's MockLlm
// returns no items for purpose "extraction", so ingestion ships its own. It reads `structuredInput.sourceText`
// and, line by line, picks quotes with simple rules. It never paraphrases, so every quote passes the
// evidence check. Instructions inside the text are just more lines of text to it.
import type { ExtractionOutput } from "./extract";
import type { LlmClient, LlmRequest, LlmResponse } from "../providers/llm/types";

const DISCLAIMER = /fictional demo|not a real|not affiliated/i;
const INSTRUCTION = /^(leave|if you|go to|pack|be ready|turn around|avoid|stay)\b/i;
const TOPIC = /fire|evacuat|assistance|flood|shelter|earthquake|tsunami|storm/i;

export function mockExtract(sourceText: string): ExtractionOutput {
  const lines = sourceText
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const content = lines.filter((l) => !DISCLAIMER.test(l));
  const title =
    content.find((l) => l.length < 120 && !/[.]$/.test(l) && !/last updated|checked/i.test(l) && TOPIC.test(l) && !/^zone /i.test(l)) ??
    content[0];
  if (!title) return { items: [] };

  const instructions = content.filter((l) => INSTRUCTION.test(l));
  const zones = content.filter((l) => /^zone\s/i.test(l));
  const sentences = content.filter((l) => /[.!?]$/.test(l) && !INSTRUCTION.test(l) && !/last updated|checked by/i.test(l));
  const body = [...sentences, ...zones];
  if (body.length === 0) return { items: [] };

  const unconditional = (re: RegExp) => content.find((l) => re.test(l) && !/\bif\b/i.test(l));
  const severityEvidence = unconditional(/evacuation order/i) ?? unconditional(/evacuation warning|warning|advisory/i);
  const hazardEvidence = body.find((l) => TOPIC.test(l));
  const pageUpdated = content.find((l) => /last updated|checked (by|at)/i.test(l));

  return {
    items: [
      {
        title: { quote: title },
        body: { quotes: body },
        instructions: instructions.length > 0 ? { quotes: instructions } : undefined,
        hazardEvidence,
        severityEvidence,
        areas: zones.length > 0 ? zones.map((quote) => ({ quote })) : undefined,
        pageUpdated: pageUpdated ? { quote: pageUpdated } : undefined,
      },
    ],
  };
}

export function createDeterministicExtractionLlm(): LlmClient {
  return {
    name: "mock",
    async complete(request: LlmRequest): Promise<LlmResponse> {
      if (request.purpose !== "extraction") throw new Error("deterministic extraction mock only handles purpose 'extraction'");
      const input = request.structuredInput as { sourceText?: unknown } | undefined;
      const structured = mockExtract(typeof input?.sourceText === "string" ? input.sourceText : "");
      return { text: JSON.stringify(structured), structured, model: `mock-extraction:${request.model}` };
    },
  };
}
