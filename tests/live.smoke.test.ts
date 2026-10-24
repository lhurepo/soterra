// [B] Optional live smoke test: three call scenarios against real Claude. Skipped unless RUN_LIVE_TESTS=1.
// With ANTHROPIC_API_KEY in the shell it runs locally over fixture chunks; otherwise it runs on the dev
// deployment (`npx convex run llmCheck:smoke`, fixtures must be seeded) so the key never leaves Convex.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import initial from "../fixtures/normalized/ridgeview-initial.json";
import type { NormalizedBulletinDraft, RetrievedChunk } from "../src/contracts";
import { chunkBulletin } from "../src/ingestion/chunk";
import { LIVE_SCENARIOS, runLiveSmoke, type LiveScenarioResult } from "../src/orchestration/liveSmoke";
import { createAnthropicLlm } from "../src/providers/llm/anthropic";
import { rankChunks } from "../src/retrieval/rank";

const live = process.env.RUN_LIVE_TESTS === "1";

function fixtureChunks(): RetrievedChunk[] {
  return (initial as NormalizedBulletinDraft[]).flatMap((b, bi) =>
    chunkBulletin(b).map((text, ci) => ({
      chunkId: `fx-${bi}-${ci}`,
      bulletinId: `fx-${bi}`,
      text,
      sourceId: b.sourceId,
      sourceName: b.sourceName,
      url: b.url,
      trustTier: b.trustTier,
      issuedAt: b.issuedAt,
      updatedAt: b.updatedAt,
      expiresAt: b.expiresAt,
      areas: b.areas,
      hazardType: b.hazardType,
      severity: b.severity,
      incidentKey: b.incidentKey,
      isFixture: true,
      chunkIndex: ci,
      score: 0,
    })),
  );
}

describe.skipIf(!live)("live smoke (real Claude)", () => {
  it(`runs ${LIVE_SCENARIOS.length} scenarios with valid kinds, citations and lengths`, async () => {
    let results: LiveScenarioResult[];
    if (process.env.ANTHROPIC_API_KEY) {
      const chunks = fixtureChunks();
      results = await runLiveSmoke(createAnthropicLlm(process.env.ANTHROPIC_API_KEY, { timeoutMs: 15_000 }), process.env.CLAUDE_FAST_MODEL ?? "claude-haiku-5-5", async (q) => ({
        chunks: rankChunks(chunks, { queryText: q.text, now: q.now, serveFixtures: true }),
        retriever: "convex",
        retrievedAt: q.now,
      }));
    } else {
      const out = execFileSync("npx", ["convex", "run", "llmCheck:smoke", "{}"], { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8" });
      results = JSON.parse(out) as LiveScenarioResult[];
    }
    for (const r of results) console.log(`[live] ${r.name}: ${r.kind} (${r.words} words, llm ${r.llmMs ?? "?"} ms) ${r.ok ? "ok" : r.problems.join("; ")}\n        ${r.reply}`);
    expect(results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.problems.join("; ")}`)).toEqual([]);
  }, 120_000);
});
