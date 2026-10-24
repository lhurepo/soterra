// [B] Default retriever: Convex full-text search over chunks merged with an area-first lookup, then
// filtering and ranking in src/retrieval/rank.ts. `now` is an argument because queries must not read the clock.
// `search` keeps the contract signature (docs/contracts/ingestion-retrieval.md) and returns RetrievedChunk[].
import { v } from "convex/values";
import type { AreaRef, RetrievedChunk } from "../src/contracts";
import { DEFAULTS } from "../src/config/defaults";
import { rankChunks } from "../src/retrieval/rank";
import { searchText } from "../src/retrieval/text";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { areaRef } from "./validators";

const SEARCH_CANDIDATES = 25;
const AREA_BULLETINS = 15;
const CHUNKS_PER_AREA_BULLETIN = 4;

async function areaBulletinIds(ctx: QueryCtx, area: AreaRef): Promise<Id<"bulletins">[]> {
  let rows: Doc<"bulletinAreas">[];
  if (area.countyFips) {
    const fips = area.countyFips;
    rows = await ctx.db
      .query("bulletinAreas")
      .withIndex("by_isActive_and_countyFips", (q) => q.eq("isActive", true).eq("countyFips", fips))
      .take(AREA_BULLETINS);
  } else if (area.nwsZone) {
    const zone = area.nwsZone;
    rows = await ctx.db
      .query("bulletinAreas")
      .withIndex("by_isActive_and_nwsZone", (q) => q.eq("isActive", true).eq("nwsZone", zone))
      .take(AREA_BULLETINS);
  } else {
    rows = await ctx.db
      .query("bulletinAreas")
      .withIndex("by_isActive_and_state", (q) => q.eq("isActive", true).eq("state", area.state))
      .take(AREA_BULLETINS);
  }
  return [...new Set(rows.map((r) => r.bulletinId))];
}

/** Hydrates candidate chunk rows into RetrievedChunk, dropping chunks whose bulletin is not active and "actual". */
async function hydrate(ctx: QueryCtx, candidates: Doc<"chunks">[]): Promise<RetrievedChunk[]> {
  const bulletinIds = [...new Set(candidates.map((c) => c.bulletinId))];
  const servable = new Set<Id<"bulletins">>();
  const areasByBulletin = new Map<Id<"bulletins">, AreaRef[]>();
  for (const bulletinId of bulletinIds) {
    const bulletin = await ctx.db.get("bulletins", bulletinId);
    if (!bulletin || !bulletin.isActive || bulletin.status !== "actual") continue;
    servable.add(bulletinId);
    const rows = await ctx.db
      .query("bulletinAreas")
      .withIndex("by_bulletinId", (q) => q.eq("bulletinId", bulletinId))
      .take(20);
    areasByBulletin.set(
      bulletinId,
      rows.map((r) => ({ state: r.state, countyFips: r.countyFips, nwsZone: r.nwsZone, label: r.label })),
    );
  }
  return candidates
    .filter((c) => c.isActive && servable.has(c.bulletinId))
    .map((c) => ({
      chunkId: c._id,
      bulletinId: c.bulletinId,
      text: c.text,
      sourceId: c.sourceId,
      sourceName: c.sourceName,
      url: c.url,
      trustTier: c.trustTier,
      issuedAt: c.issuedAt,
      updatedAt: c.updatedAt,
      expiresAt: c.expiresAt,
      areas: areasByBulletin.get(c.bulletinId) ?? [],
      hazardType: c.hazardType,
      severity: c.severity,
      incidentKey: c.incidentKey,
      isFixture: c.isFixture,
      chunkIndex: c.chunkIndex,
      score: 0,
    }));
}

export const search = internalQuery({
  args: {
    text: v.string(),
    contextText: v.optional(v.string()),
    area: v.optional(areaRef),
    topK: v.number(),
    now: v.number(),
    serveFixtures: v.boolean(),
  },
  handler: async (ctx, args): Promise<RetrievedChunk[]> => {
    const candidates: Doc<"chunks">[] = [];

    // 1. Full-text search over the utterance plus recent caller turns (≤ 16 terms).
    const terms = searchText([args.text, args.contextText].filter(Boolean).join(" "));
    if (terms) {
      candidates.push(
        ...(await ctx.db
          .query("chunks")
          .withSearchIndex("search_text", (q) => {
            let s = q.search("text", terms).eq("isActive", true);
            if (args.area && args.area.state !== "US") s = s.eq("primaryState", args.area.state);
            if (!args.serveFixtures) s = s.eq("isFixture", false);
            return s;
          })
          .take(SEARCH_CANDIDATES)),
      );
    }

    // 2. Area-first: active bulletins for the caller's area, whatever the wording (works for Spanish callers too).
    const areaMatchedChunkIds = new Set<string>();
    if (args.area) {
      for (const bulletinId of await areaBulletinIds(ctx, args.area)) {
        const chunks = await ctx.db
          .query("chunks")
          .withIndex("by_bulletinId", (q) => q.eq("bulletinId", bulletinId))
          .take(CHUNKS_PER_AREA_BULLETIN);
        for (const c of chunks) {
          if (!c.isActive) continue;
          areaMatchedChunkIds.add(c._id);
          candidates.push(c);
        }
      }
    }

    return rankChunks(await hydrate(ctx, candidates), {
      queryText: args.text,
      contextText: args.contextText,
      area: args.area,
      now: args.now,
      serveFixtures: args.serveFixtures,
      areaMatchedChunkIds,
      maxChunks: Math.min(args.topK, DEFAULTS.retrievalMaxChunks),
      tokenBudget: DEFAULTS.retrievalTokenBudget,
    });
  },
});

/** Moss path: hydrate Moss hits by id, then the same filters and ranking as `search`. */
export const hydrateChunks = internalQuery({
  args: {
    chunkIds: v.array(v.string()),
    text: v.string(),
    contextText: v.optional(v.string()),
    area: v.optional(areaRef),
    topK: v.number(),
    now: v.number(),
    serveFixtures: v.boolean(),
  },
  handler: async (ctx, args): Promise<RetrievedChunk[]> => {
    const rows: Doc<"chunks">[] = [];
    for (const raw of args.chunkIds.slice(0, 50)) {
      const id = ctx.db.normalizeId("chunks", raw);
      const chunk = id ? await ctx.db.get("chunks", id) : null;
      if (chunk) rows.push(chunk);
    }
    return rankChunks(await hydrate(ctx, rows), {
      queryText: args.text,
      contextText: args.contextText,
      area: args.area,
      now: args.now,
      serveFixtures: args.serveFixtures,
      maxChunks: Math.min(args.topK, DEFAULTS.retrievalMaxChunks),
      tokenBudget: DEFAULTS.retrievalTokenBudget,
    });
  },
});

/** Active chunks as Moss documents, for a full index sync (paginated by the caller). */
export const chunksForMoss = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const page = await ctx.db.query("chunks").paginate({ cursor, numItems: Math.min(numItems, 200) });
    return {
      docs: page.page
        .filter((c) => c.isActive && c.trustTier !== "unverified")
        .map((c) => ({
          chunkId: c._id as string,
          bulletinId: c.bulletinId as string,
          text: c.text,
          sourceName: c.sourceName,
          trustTier: c.trustTier,
          hazardType: c.hazardType,
          severity: c.severity,
          issuedAt: c.issuedAt,
          expiresAt: c.expiresAt,
          isFixture: c.isFixture,
        })),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
