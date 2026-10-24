// [B] Filter, score and select candidate chunks. Pure and explainable: every score is a sum of named parts.
// Filters here are a second line of defence: the Convex query already skips inactive chunks and
// non-actual bulletins, but trust, expiry and the fixture rule are re-checked on every candidate.
import { ANSWERABLE_TRUST_TIERS, type AreaRef, type RetrievedChunk, type Severity } from "../contracts";
import { DEFAULTS } from "../config/defaults";
import { termOverlap } from "./text";

/** Weights, documented in docs/backend.md. Lexical relevance dominates; the rest break ties. */
export const WEIGHTS = {
  lexical: 1,
  context: 0.3,
  areaFirst: 0.25,
  sameCounty: 0.15,
  sameState: 0.05,
  recencyMax: 0.1,
} as const;

export const SEVERITY_BOOST: Record<Severity, number> = { extreme: 0.3, severe: 0.2, moderate: 0.1, minor: 0.05, unknown: 0 };

export type ScoreBreakdown = { lexical: number; context: number; area: number; severity: number; recency: number; total: number };

export type RankOptions = {
  queryText: string;
  contextText?: string;
  area?: AreaRef;
  now: number;
  serveFixtures: boolean;
  /** Chunk ids found through the caller's area (area-first lookup). */
  areaMatchedChunkIds?: Set<string>;
  maxChunks?: number;
  tokenBudget?: number;
};

export function isServable(chunk: RetrievedChunk, now: number, serveFixtures: boolean): boolean {
  if (!ANSWERABLE_TRUST_TIERS.includes(chunk.trustTier)) return false;
  if (chunk.expiresAt !== undefined && chunk.expiresAt <= now) return false;
  if (chunk.isFixture && !serveFixtures) return false;
  return true;
}

export function scoreChunk(chunk: RetrievedChunk, opts: Pick<RankOptions, "queryText" | "contextText" | "area" | "now" | "areaMatchedChunkIds">): ScoreBreakdown {
  const lexical = WEIGHTS.lexical * termOverlap(opts.queryText, chunk.text);
  const context = opts.contextText ? WEIGHTS.context * termOverlap(opts.contextText, chunk.text) : 0;
  let area = opts.areaMatchedChunkIds?.has(chunk.chunkId) ? WEIGHTS.areaFirst : 0;
  if (opts.area) {
    const sameCounty = !!opts.area.countyFips && chunk.areas.some((a) => a.countyFips === opts.area!.countyFips);
    const sameState = chunk.areas.some((a) => a.state === opts.area!.state);
    area += sameCounty ? WEIGHTS.sameCounty : sameState ? WEIGHTS.sameState : 0;
  }
  const severity = SEVERITY_BOOST[chunk.severity];
  const ageHours = Math.max(0, (opts.now - (chunk.updatedAt ?? chunk.issuedAt)) / 3_600_000);
  const recency = WEIGHTS.recencyMax / (1 + ageHours / 24);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    lexical: round(lexical),
    context: round(context),
    area: round(area),
    severity,
    recency: round(recency),
    total: round(lexical + context + area + severity + recency),
  };
}

/** Rough token estimate for a source block (≈ 4 characters per token plus the tag). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4) + 30;
}

/**
 * Best chunk per bulletin, plus the bulletin's next chunk when it is a candidate and the budget allows,
 * up to `maxChunks` and `tokenBudget`. The first pick is always kept so a long chunk never empties the result.
 */
export function selectWithinBudget(sorted: RetrievedChunk[], maxChunks: number, tokenBudget: number): RetrievedChunk[] {
  const byBulletinIndex = new Map(sorted.map((c) => [`${c.bulletinId}#${c.chunkIndex ?? -1}`, c]));
  const picked: RetrievedChunk[] = [];
  const takenBulletins = new Set<string>();
  let tokens = 0;
  const fits = (c: RetrievedChunk) => picked.length === 0 || tokens + estimateTokens(c.text) <= tokenBudget;
  for (const chunk of sorted) {
    if (picked.length >= maxChunks) break;
    if (takenBulletins.has(chunk.bulletinId) || !fits(chunk)) continue;
    takenBulletins.add(chunk.bulletinId);
    picked.push(chunk);
    tokens += estimateTokens(chunk.text);
    const next = chunk.chunkIndex === undefined ? undefined : byBulletinIndex.get(`${chunk.bulletinId}#${chunk.chunkIndex + 1}`);
    if (next && picked.length < maxChunks && fits(next)) {
      picked.push(next);
      tokens += estimateTokens(next.text);
    }
  }
  return picked;
}

export function rankChunks(candidates: RetrievedChunk[], opts: RankOptions): RetrievedChunk[] {
  const unique = new Map<string, RetrievedChunk>();
  for (const c of candidates) {
    if (!unique.has(c.chunkId) && isServable(c, opts.now, opts.serveFixtures)) unique.set(c.chunkId, c);
  }
  const scored = [...unique.values()]
    .map((c) => ({ ...c, score: scoreChunk(c, opts).total }))
    .sort((a, b) => b.score - a.score || (b.updatedAt ?? b.issuedAt) - (a.updatedAt ?? a.issuedAt) || a.chunkId.localeCompare(b.chunkId));
  return selectWithinBudget(scored, opts.maxChunks ?? DEFAULTS.retrievalMaxChunks, opts.tokenBudget ?? DEFAULTS.retrievalTokenBudget);
}
