// [B] Ranking: filters, explainable score parts, per-bulletin dedupe, chunk and token budgets.
import { describe, expect, it } from "vitest";
import { SEVERITY_BOOST, WEIGHTS, estimateTokens, isServable, rankChunks, scoreChunk, selectWithinBudget } from "../src/retrieval/rank";
import { NOW, chunk, shelterChunk } from "./helpers";

describe("filters", () => {
  it("drops unverified, expired and (unless allowed) fixture chunks", () => {
    expect(isServable(chunk(), NOW, true)).toBe(true);
    expect(isServable(chunk({ trustTier: "unverified" }), NOW, true)).toBe(false);
    expect(isServable(chunk({ expiresAt: NOW - 1 }), NOW, true)).toBe(false);
    expect(isServable(chunk({ expiresAt: NOW + 1 }), NOW, true)).toBe(true);
    expect(isServable(chunk({ isFixture: true }), NOW, false)).toBe(false);
    expect(isServable(chunk({ isFixture: false }), NOW, false)).toBe(true);
    expect(isServable(chunk({ trustTier: "official_social" }), NOW, true)).toBe(true);
  });
});

describe("scoring", () => {
  it("is a sum of named parts", () => {
    const s = scoreChunk(shelterChunk(), { queryText: "shelters that take pets", now: NOW });
    expect(s.lexical).toBeCloseTo(WEIGHTS.lexical * (2 / 3), 2); // "shelters", "pets" of shelters/take/pets
    expect(s.severity).toBe(SEVERITY_BOOST.moderate);
    expect(s.area).toBe(0);
    expect(s.total).toBeCloseTo(s.lexical + s.context + s.area + s.severity + s.recency, 2);
  });

  it("rewards area-first matches and the caller's county", () => {
    const base = { queryText: "fire", now: NOW };
    const area = { state: "CA", countyFips: "06097", label: "Sonoma County" };
    expect(scoreChunk(chunk(), { ...base, area }).area).toBe(WEIGHTS.sameCounty);
    expect(scoreChunk(chunk(), { ...base, area: { state: "CA", label: "California" } }).area).toBe(WEIGHTS.sameState);
    expect(scoreChunk(chunk(), { ...base, area, areaMatchedChunkIds: new Set(["c1"]) }).area).toBe(WEIGHTS.areaFirst + WEIGHTS.sameCounty);
  });

  it("decays recency over days", () => {
    const fresh = scoreChunk(chunk({ issuedAt: NOW }), { queryText: "x", now: NOW }).recency;
    const old = scoreChunk(chunk({ issuedAt: NOW - 7 * 86_400_000 }), { queryText: "x", now: NOW }).recency;
    expect(fresh).toBe(WEIGHTS.recencyMax);
    expect(old).toBeLessThan(fresh / 5);
  });
});

describe("selection", () => {
  it("keeps the best chunk per bulletin plus its next chunk, within the chunk budget", () => {
    const a0 = chunk({ chunkId: "a0", bulletinId: "A", chunkIndex: 0, score: 3 });
    const a1 = chunk({ chunkId: "a1", bulletinId: "A", chunkIndex: 1, score: 0.1 });
    const a2 = chunk({ chunkId: "a2", bulletinId: "A", chunkIndex: 2, score: 2.9 });
    const b0 = chunk({ chunkId: "b0", bulletinId: "B", chunkIndex: 0, score: 2 });
    const picked = selectWithinBudget([a0, a2, b0, a1], 6, 10_000);
    expect(picked.map((c) => c.chunkId)).toEqual(["a0", "a1", "b0"]);
    expect(selectWithinBudget([a0, a2, b0, a1], 1, 10_000).map((c) => c.chunkId)).toEqual(["a0"]);
  });

  it("respects the token budget but always keeps the first pick", () => {
    const long = chunk({ chunkId: "long", bulletinId: "L", text: "x".repeat(4_000) });
    const short = chunk({ chunkId: "short", bulletinId: "S", text: "short text" });
    expect(estimateTokens("x".repeat(400))).toBe(130);
    expect(selectWithinBudget([long, short], 6, 200).map((c) => c.chunkId)).toEqual(["long"]);
    expect(selectWithinBudget([short, long], 6, 200).map((c) => c.chunkId)).toEqual(["short"]);
  });

  it("rankChunks filters, dedupes ids, scores and orders", () => {
    const ranked = rankChunks([chunk(), chunk(), shelterChunk(), chunk({ chunkId: "bad", bulletinId: "x", trustTier: "unverified" })], {
      queryText: "shelters that take pets",
      now: NOW,
      serveFixtures: true,
    });
    expect(ranked.map((c) => c.chunkId)).toEqual(["c2", "c1"]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});
