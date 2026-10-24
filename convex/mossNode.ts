"use node";
// [B] Moss actions (Node runtime: the SDK ships native binaries). Optional: nothing in the hotline needs them.
// - query: used by the turn when RETRIEVER=moss (with Convex search as the fallback).
// - syncChunks: the index-sync entry point ingestion calls after upserts ([I] wires the calls).
// - syncAll: full re-sync of active chunks (npx convex run mossNode:syncAll).
// Requires "@moss-dev/moss" in convex.json node.externalPackages.
// The SDK is imported lazily: Convex analyzes every module at push time, and loading Moss's native binding
// there fails ("Cannot find native binding", verified 2026-10-24), which would block every deploy.
import { v, type Infer } from "convex/values";
import { loadConfig } from "../src/config/env";
import { chunkToMossDoc, requireMoss, syncChunksToMoss, type MossIndex } from "../src/providers/moss";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { hazardType, severity, trustTier } from "./validators";

let cached: MossIndex | undefined;
async function liveIndex(): Promise<MossIndex> {
  if (!cached) {
    const config = requireMoss(loadConfig(process.env));
    const { LiveMossIndex } = await import("../src/providers/moss/live");
    cached = new LiveMossIndex(config);
  }
  return cached;
}

export const query = internalAction({
  args: { text: v.string(), topK: v.number() },
  returns: v.object({ hits: v.array(v.object({ id: v.string(), score: v.number() })), elapsedMs: v.number() }),
  handler: async (_ctx, { text, topK }) => {
    const t0 = Date.now();
    const hits = await (await liveIndex()).query(text, topK);
    return { hits, elapsedMs: Date.now() - t0 };
  },
});

const mossChunk = v.object({
  chunkId: v.string(),
  bulletinId: v.string(),
  text: v.string(),
  sourceName: v.string(),
  trustTier,
  hazardType,
  severity,
  issuedAt: v.number(),
  expiresAt: v.optional(v.number()),
  isFixture: v.boolean(),
});

const syncResult = v.object({ ok: v.boolean(), upserted: v.number(), removed: v.number(), error: v.optional(v.string()) });

async function sync(upserts: Infer<typeof mossChunk>[], removedChunkIds: string[]): Promise<Infer<typeof syncResult>> {
  let index: MossIndex;
  try {
    index = await liveIndex();
  } catch (err) {
    return { ok: false, upserted: 0, removed: 0, error: err instanceof Error ? err.message : String(err) };
  }
  const docs = upserts.filter((c) => c.trustTier !== "unverified").map(chunkToMossDoc);
  const result = await syncChunksToMoss(index, docs, removedChunkIds);
  return result.ok ? { ok: true, upserted: result.upserted, removed: result.removed } : { ok: false, upserted: 0, removed: 0, error: result.error };
}

/** Best effort: returns the outcome instead of throwing, so ingestion never fails because of Moss. */
export const syncChunks = internalAction({
  args: { upserts: v.array(mossChunk), removedChunkIds: v.array(v.string()) },
  returns: syncResult,
  handler: async (_ctx, { upserts, removedChunkIds }) => await sync(upserts, removedChunkIds),
});

export const syncAll = internalAction({
  args: {},
  returns: syncResult,
  handler: async (ctx) => {
    let cursor: string | null = null;
    let upserted = 0;
    for (let page = 0; page < 50; page++) {
      const batch: { docs: Infer<typeof mossChunk>[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(
        internal.retrieval.chunksForMoss,
        { cursor, numItems: 200 },
      );
      const result = await sync(batch.docs, []);
      if (!result.ok) return { ...result, upserted };
      upserted += result.upserted;
      if (batch.isDone) break;
      cursor = batch.continueCursor;
    }
    return { ok: true, upserted, removed: 0 };
  },
});
