// [B] Live checks of the Anthropic adapter, run on the DEV deployment so the API key never leaves Convex:
//   npx convex run llmCheck:verify   — model ids, structured output, temperature rule, prompt caching, latency
//   npx convex run llmCheck:smoke    — three call scenarios against real Claude over the seeded fixtures
// Both return only booleans, ids, timings and replies: never the key. They spend a few cents of API usage.
import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { loadConfig } from "../src/config/env";
import { buildTurnRequest, parseDraft } from "../src/orchestration/prompt";
import { runLiveSmoke } from "../src/orchestration/liveSmoke";
import { createAnthropicLlm, toLlmError } from "../src/providers/llm/anthropic";
import { createConvexRetriever } from "../src/retrieval/retriever";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const SAMPLE_CHUNK = {
  chunkId: "sample-1",
  bulletinId: "b-sample",
  text: "Ridgeview Fire incident update. The Ridgeview Fire is burning about 1,200 acres east of Santa Rosa and is 10 percent contained.",
  sourceId: "demo_fire",
  sourceName: "Sonoma County Fire Information (Demo)",
  url: "https://example.org/soterra-demo/fire/ridgeview",
  trustTier: "official" as const,
  issuedAt: Date.UTC(2026, 9, 24, 20, 10),
  areas: [{ state: "CA", countyFips: "06097", label: "East of Santa Rosa, Sonoma County" }],
  hazardType: "wildfire" as const,
  severity: "severe" as const,
  score: 1,
};

function requireKey(): string {
  const key = loadConfig(process.env).ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set on this deployment");
  return key;
}

export const verify = internalAction({
  args: {},
  handler: async () => {
    const cfg = loadConfig(process.env);
    const key = requireKey();
    const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 20_000 });
    const models: Record<string, { exists: boolean; id?: string; error?: string }> = {};
    for (const id of [cfg.CLAUDE_FAST_MODEL, cfg.CLAUDE_SMART_MODEL]) {
      try {
        const m = await client.models.retrieve(id);
        models[id] = { exists: true, id: m.id };
      } catch (err) {
        models[id] = { exists: false, error: toLlmError(err).message };
      }
    }

    // Temperature: documented as rejected (400) on every model since 2026-10-21.
    let temperature: { accepted: boolean; error?: string };
    try {
      // The installed SDK no longer types `temperature`; this deliberate probe sends it anyway.
      const probe = { model: cfg.CLAUDE_FAST_MODEL, max_tokens: 5, temperature: 0.2, messages: [{ role: "user", content: "Say ok." }] };
      await client.messages.create(probe as unknown as Anthropic.MessageCreateParamsNonStreaming);
      temperature = { accepted: true };
    } catch (err) {
      temperature = { accepted: false, error: toLlmError(err).message.slice(0, 200) };
    }

    // Structured output and latency with the real turn prompt, three times (the 2nd/3rd may hit the prompt cache).
    const llm = createAnthropicLlm(key, { timeoutMs: 20_000 });
    const runs: { ms: number; kind?: string; cited?: string[]; valid: boolean; cacheReadInputTokens?: number; inputTokens?: number; error?: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const request = buildTurnRequest(
        {
          utterance: "How big is the Ridgeview Fire?",
          language: "en",
          retrieved: [SAMPLE_CHUNK],
          context: { identity: "caller_id", language: "en" },
          history: [],
          now: Date.UTC(2026, 9, 24, 22, 0),
        },
        cfg.CLAUDE_FAST_MODEL,
      );
      const t0 = Date.now();
      try {
        const res = await llm.complete({ ...request, timeoutMs: 20_000 });
        const draft = parseDraft(res);
        runs.push({ ms: Date.now() - t0, kind: draft.kind, cited: draft.citedChunkIds, valid: true, cacheReadInputTokens: res.usage?.cacheReadInputTokens, inputTokens: res.usage?.inputTokens });
      } catch (err) {
        runs.push({ ms: Date.now() - t0, valid: false, error: toLlmError(err).message.slice(0, 200) });
      }
    }
    return { models, temperature, structuredOutput: runs };
  },
});

export const smoke = internalAction({
  args: { model: v.optional(v.string()) },
  handler: async (ctx, { model }) => {
    const cfg = loadConfig(process.env);
    const llm = createAnthropicLlm(requireKey());
    const retriever = createConvexRetriever((q) =>
      ctx.runQuery(internal.retrieval.search, { text: q.text, contextText: q.contextText, area: q.area, topK: q.topK, now: q.now, serveFixtures: true }),
    );
    return await runLiveSmoke(llm, model ?? cfg.CLAUDE_FAST_MODEL, (q) => retriever.retrieve(q));
  },
});
