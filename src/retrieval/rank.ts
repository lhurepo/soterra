// [B] Merge, filter and rank candidate chunks. Filters here are a second line of defence:
// the Convex query already excludes inactive chunks, but expiry, trust and fixture rules are re-checked.
import { ANSWERABLE_TRUST_TIERS, type AreaRef, type RetrievedChunk, type Severity } from "../contracts";
import { termOverlap } from "./text";

const SEVERITY_BOOST: Record<Severity, number> = {
  extreme: 0.3,
  severe: 0.2,
  moderate: 0.1,
  minor: 0.05,
  unknown: 0,
};

export type RankOptions = {
  queryText: string;
  area?: AreaRef;
  now: number;
  topK: number;
  serveFixtures: boolean;
  /** Chunk ids found through the caller's area (area-first lookup). */
  areaMatchedChunkIds?: Set<string>;
};

export function isServable(chunk: RetrievedChunk, now: number, serveFixtures: boolean): boolean {
  if (!ANSWERABLE_TRUST_TIERS.includes(chunk.trustTier)) return false;
  if (chunk.expiresAt !== undefined && chunk.expiresAt <= now) return false;
  if (chunk.isFixture && !serveFixtures) return false;
  return true;
}

export function rankChunks(candidates: RetrievedChunk[], opts: RankOptions): RetrievedChunk[] {
  const byId = new Map<string, RetrievedChunk>();
  for (const c of candidates) {
    if (!byId.has(c.chunkId) && isServable(c, opts.now, opts.serveFixtures)) byId.set(c.chunkId, c);
  }
  const scored = [...byId.values()].map((c) => {
    const lexical = termOverlap(opts.queryText, c.text);
    const area = opts.areaMatchedChunkIds?.has(c.chunkId) ? 0.25 : 0;
    const ageHours = Math.max(0, (opts.now - (c.updatedAt ?? c.issuedAt)) / 3_600_000);
    const freshness = 0.1 / (1 + ageHours / 24);
    return { ...c, score: lexical + area + SEVERITY_BOOST[c.severity] + freshness };
  });
  // TODO(B): tune weights once real queries and the real model are in place.
  return scored
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || b.issuedAt - a.issuedAt)
    .slice(0, opts.topK);
}
