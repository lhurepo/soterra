// [I] Source rows, synced from src/ingestion/sources.ts. `enabled`, `mode` and run bookkeeping are
// preserved once a row exists, so a source can be switched on or to live from the CLI without a deploy.
import { v } from "convex/values";
import { SOURCES } from "../src/ingestion/sources";
import { internalMutation, internalQuery } from "./_generated/server";

/** npx convex run sources:syncRegistry */
export const syncRegistry = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    for (const def of SOURCES) {
      const { contentIsFixture: _f, jurisdiction: _j, apify: _a, ...row } = def;
      const existing = await ctx.db
        .query("sources")
        .withIndex("by_sourceId", (q) => q.eq("sourceId", def.sourceId))
        .unique();
      if (existing) await ctx.db.patch("sources", existing._id, { ...row, enabled: existing.enabled, mode: existing.mode ?? def.mode });
      else await ctx.db.insert("sources", row);
    }
    return SOURCES.length;
  },
});

/** npx convex run sources:setEnabled '{"sourceId":"nws_alerts","enabled":true}' */
export const setEnabled = internalMutation({
  args: { sourceId: v.string(), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { sourceId, enabled }) => {
    const row = await ctx.db
      .query("sources")
      .withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId))
      .unique();
    if (!row) throw new Error(`unknown source ${sourceId}; run sources:syncRegistry first`);
    await ctx.db.patch("sources", row._id, { enabled });
    return null;
  },
});

/** npx convex run sources:setMode '{"sourceId":"nws_alerts","mode":"live"}' */
export const setMode = internalMutation({
  args: { sourceId: v.string(), mode: v.union(v.literal("fixture"), v.literal("live")) },
  returns: v.null(),
  handler: async (ctx, { sourceId, mode }) => {
    const row = await ctx.db
      .query("sources")
      .withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId))
      .unique();
    if (!row) throw new Error(`unknown source ${sourceId}; run sources:syncRegistry first`);
    await ctx.db.patch("sources", row._id, { mode, consecutiveFailures: 0, lastError: undefined });
    return null;
  },
});

export const getBySourceId = internalQuery({
  args: { sourceId: v.string() },
  handler: async (ctx, { sourceId }) =>
    await ctx.db
      .query("sources")
      .withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId))
      .unique(),
});
