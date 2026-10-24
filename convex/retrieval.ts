// [B] Default retriever: Convex full-text search over chunks plus an area-first lookup, then ranking.
// `now` is an argument because queries must not read the wall clock.
import { v } from "convex/values";
import type { AreaRef, RetrievedChunk } from "../src/contracts";
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

export const search = internalQuery({
  args: {
    text: v.string(),
    area: v.optional(areaRef),
    topK: v.number(),
    now: v.number(),
    serveFixtures: v.boolean(),
  },
  handler: async (ctx, args): Promise<RetrievedChunk[]> => {
    const candidates: Doc<"chunks">[] = [];

    const terms = searchText(args.text);
    if (terms) {
      const hits = await ctx.db
        .query("chunks")
        .withSearchIndex("search_text", (q) => {
          let s = q.search("text", terms).eq("isActive", true);
          if (args.area) s = s.eq("primaryState", args.area.state);
          if (!args.serveFixtures) s = s.eq("isFixture", false);
          return s;
        })
        .take(SEARCH_CANDIDATES);
      candidates.push(...hits);
    }

    const areaMatchedChunkIds = new Set<string>();
    if (args.area) {
      for (const bulletinId of await areaBulletinIds(ctx, args.area)) {
        const chunks = await ctx.db
          .query("chunks")
          .withIndex("by_bulletinId", (q) => q.eq("bulletinId", bulletinId))
          .take(CHUNKS_PER_AREA_BULLETIN);
        for (const c of chunks.filter((c) => c.isActive)) {
          areaMatchedChunkIds.add(c._id);
          candidates.push(c);
        }
      }
    }

    // Hydrate areas once per bulletin for citations and time zones.
    const areasByBulletin = new Map<Id<"bulletins">, AreaRef[]>();
    for (const bulletinId of new Set(candidates.map((c) => c.bulletinId))) {
      const rows = await ctx.db
        .query("bulletinAreas")
        .withIndex("by_bulletinId", (q) => q.eq("bulletinId", bulletinId))
        .take(20);
      areasByBulletin.set(
        bulletinId,
        rows.map((r) => ({ state: r.state, countyFips: r.countyFips, nwsZone: r.nwsZone, label: r.label })),
      );
    }

    const retrieved: RetrievedChunk[] = candidates.map((c) => ({
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
      score: 0,
    }));

    return rankChunks(retrieved, {
      queryText: args.text,
      area: args.area,
      now: args.now,
      topK: args.topK,
      serveFixtures: args.serveFixtures,
      areaMatchedChunkIds,
    });
  },
});
