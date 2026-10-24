// [I] Source rows: synced from src/ingestion/registry.ts. `enabled` is preserved once a row exists,
// so a source can be switched on from the dashboard or CLI without a deploy.
import { v } from "convex/values";
import { SOURCE_REGISTRY } from "../src/ingestion/registry";
import { internalMutation, internalQuery } from "./_generated/server";

/** npx convex run sources:syncRegistry */
export const syncRegistry = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    for (const def of SOURCE_REGISTRY) {
      const existing = await ctx.db
        .query("sources")
        .withIndex("by_sourceId", (q) => q.eq("sourceId", def.sourceId))
        .unique();
      if (existing) await ctx.db.patch("sources", existing._id, { ...def, enabled: existing.enabled });
      else await ctx.db.insert("sources", def);
    }
    return SOURCE_REGISTRY.length;
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

export const getBySourceId = internalQuery({
  args: { sourceId: v.string() },
  handler: async (ctx, { sourceId }) =>
    await ctx.db
      .query("sources")
      .withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId))
      .unique(),
});

export const recordFetch = internalMutation({
  args: { sourceId: v.string(), ok: v.boolean(), error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { sourceId, ok, error }) => {
    const row = await ctx.db
      .query("sources")
      .withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId))
      .unique();
    if (!row) return null;
    await ctx.db.patch("sources", row._id, ok ? { lastSuccessAt: Date.now(), lastError: undefined } : { lastError: error });
    return null;
  },
});
