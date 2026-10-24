// [B] Moss retrieval (optional, RETRIEVER=moss) and index sync. Convex search stays the default.
// The SDK (`@moss-dev/moss`, native binaries) only runs in a "use node" action: src/providers/moss/live.ts
// wraps it and convex/mossNode.ts calls it. This file is SDK-free so InMemoryMoss can stand in for tests.
// Moss results are only chunk ids: they are hydrated through Convex and re-filtered and re-ranked by
// src/retrieval/rank.ts, so Moss can never surface an expired, unverified or (unless allowed) fixture chunk.
import type { Config } from "../../config/env";
import { NotConfiguredError } from "../../config/errors";
import type { RetrievedChunk } from "../../contracts";
import type { RetrievalRequest, Retriever } from "../../retrieval/retriever";
import { termOverlap } from "../../retrieval/text";

export const MOSS_ENV = ["MOSS_PROJECT_ID", "MOSS_PROJECT_KEY", "MOSS_INDEX_NAME"] as const;

export type MossConfig = { projectId: string; projectKey: string; indexName: string };

export function requireMoss(config: Config): MossConfig {
  const missing = MOSS_ENV.filter((k) => !config[k]);
  if (missing.length > 0) throw new NotConfiguredError("Moss", [...missing]);
  return { projectId: config.MOSS_PROJECT_ID!, projectKey: config.MOSS_PROJECT_KEY!, indexName: config.MOSS_INDEX_NAME! };
}

export type MossDoc = { id: string; text: string; metadata: Record<string, string> };
export type MossHit = { id: string; score: number };

/** The slice of Moss we use. The live SDK wrapper and InMemoryMoss both implement it. */
export interface MossIndex {
  upsert(docs: MossDoc[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  query(text: string, topK: number): Promise<MossHit[]>;
}

/** Chunk → Moss document. Metadata is informational; filters are re-applied after hydration. */
export function chunkToMossDoc(c: Pick<RetrievedChunk, "chunkId" | "bulletinId" | "text" | "sourceName" | "trustTier" | "hazardType" | "severity" | "issuedAt" | "expiresAt" | "isFixture">): MossDoc {
  return {
    id: c.chunkId,
    text: c.text,
    metadata: {
      bulletinId: c.bulletinId,
      sourceName: c.sourceName,
      trustTier: c.trustTier,
      hazardType: c.hazardType,
      severity: c.severity,
      issuedAt: String(c.issuedAt),
      expiresAt: c.expiresAt === undefined ? "" : String(c.expiresAt),
      isFixture: String(c.isFixture ?? false),
    },
  };
}

/** Same interface as Moss, simple lexical scoring. Used by tests and as a local stand-in. */
export class InMemoryMoss implements MossIndex {
  readonly docs = new Map<string, MossDoc>();
  async upsert(docs: MossDoc[]): Promise<void> {
    for (const d of docs) this.docs.set(d.id, d);
  }
  async remove(ids: string[]): Promise<void> {
    for (const id of ids) this.docs.delete(id);
  }
  async query(text: string, topK: number): Promise<MossHit[]> {
    return [...this.docs.values()]
      .map((d) => ({ id: d.id, score: termOverlap(text, d.text) }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, topK);
  }
}

/** How many Moss hits to hydrate before filtering and ranking down to the turn's chunk budget. */
export const MOSS_CANDIDATES = 20;

/**
 * Moss retriever: query Moss for candidate ids, then hydrate them through Convex (which filters and ranks).
 * Wrap it with withFallback(…, convexRetriever) so any Moss failure falls back to Convex search.
 */
export function createMossRetriever(deps: {
  query: (text: string, topK: number) => Promise<MossHit[]>;
  hydrate: (chunkIds: string[], request: RetrievalRequest) => Promise<RetrievedChunk[]>;
}): Retriever {
  return {
    name: "moss",
    async retrieve(request) {
      const text = [request.text, request.contextText].filter(Boolean).join(" ");
      const hits = await deps.query(text, MOSS_CANDIDATES);
      return { chunks: await deps.hydrate(hits.map((h) => h.id), request), retriever: "moss", retrievedAt: request.now };
    },
  };
}

/** Mirror changed chunks into Moss. Best effort: failures are returned, never thrown to the caller. */
export async function syncChunksToMoss(
  index: MossIndex,
  upserts: MossDoc[],
  removedIds: string[],
): Promise<{ ok: true; upserted: number; removed: number } | { ok: false; error: string }> {
  try {
    if (removedIds.length > 0) await index.remove(removedIds);
    if (upserts.length > 0) await index.upsert(upserts);
    return { ok: true, upserted: upserts.length, removed: removedIds.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
