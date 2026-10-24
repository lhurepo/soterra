// [I] Dev-only mock websites, served at /mock-sites/<file> when ENABLE_MOCK_SITES=true so a real (cloud)
// Apify actor can scrape a reachable URL. Two states: v1 (initial) and v2 (escalated: zone SON-3A warning →
// order, shelter capacity changed). `escalate` switches to v2 and scrapes the mock-site sources now.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { httpAction, internalMutation, internalQuery } from "./_generated/server";
import { config, errorResponse } from "./lib/http";

export const MOCK_SITE_SOURCES = ["mock_county_emergency", "mock_shelters", "mock_disaster_assistance"] as const;
const VARIANT_KEY = "mockSitesVariant";
const variant = v.union(v.literal("v1"), v.literal("v2"));

export async function activeVariant(ctx: QueryCtx): Promise<"v1" | "v2"> {
  const row = await ctx.db
    .query("devSettings")
    .withIndex("by_key", (q) => q.eq("key", VARIANT_KEY))
    .unique();
  return row?.value === "v2" ? "v2" : "v1";
}

export const getActiveVariant = internalQuery({
  args: {},
  returns: variant,
  handler: async (ctx) => await activeVariant(ctx),
});

export const getPage = internalQuery({
  args: { path: v.string() },
  handler: async (ctx, { path }) => {
    const current = await activeVariant(ctx);
    // v2 falls back to v1; rows seeded before variants existed have no variant and count as v1.
    const order = current === "v2" ? (["v2", "v1", undefined] as const) : (["v1", undefined] as const);
    for (const which of order) {
      const page = await ctx.db
        .query("mockSites")
        .withIndex("by_path_and_variant", (q) => q.eq("path", path).eq("variant", which))
        .first();
      if (page) return page;
    }
    return null;
  },
});

async function writeVariant(ctx: MutationCtx, value: "v1" | "v2"): Promise<void> {
  const row = await ctx.db
    .query("devSettings")
    .withIndex("by_key", (q) => q.eq("key", VARIANT_KEY))
    .unique();
  if (row) await ctx.db.patch("devSettings", row._id, { value });
  else await ctx.db.insert("devSettings", { key: VARIANT_KEY, value });
}

/** npx convex run mockSites:setVariant '{"variant":"v1"}' */
export const setVariant = internalMutation({
  args: { variant },
  returns: v.null(),
  handler: async (ctx, args) => {
    await writeVariant(ctx, args.variant);
    return null;
  },
});

/** `npm run ingest:escalate`: switch the mock sites to v2 and scrape them now through the real pipeline. */
export const escalate = internalMutation({
  args: { mode: v.optional(v.union(v.literal("fixture"), v.literal("live"))) },
  returns: v.array(v.string()),
  handler: async (ctx, { mode }) => {
    await writeVariant(ctx, "v2");
    for (const sourceId of MOCK_SITE_SOURCES) {
      await ctx.scheduler.runAfter(0, internal.ingestion.runSource, { sourceId, trigger: "escalation", modeOverride: mode });
    }
    return [...MOCK_SITE_SOURCES];
  },
});

/** GET /mock-sites/<path> */
export const mockSite = httpAction(async (ctx, req) => {
  if (!config().ENABLE_MOCK_SITES) return errorResponse(404, "not_found", "mock sites are disabled");
  const path = new URL(req.url).pathname.replace(/^\/mock-sites\//, "");
  const page = await ctx.runQuery(internal.mockSites.getPage, { path });
  if (!page) return errorResponse(404, "not_found", `no mock site at ${path}`);
  return new Response(page.body, { status: 200, headers: { "Content-Type": page.contentType, "Cache-Control": "no-store" } });
});
