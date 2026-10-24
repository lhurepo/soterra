// [S] Dev only: fixture seeding and mock-site serving. Internal functions are callable only from the
// CLI/dashboard (npx convex run), never from clients. Fixtures are served to callers only when SERVE_FIXTURES=true.
import { v } from "convex/values";
import { finalizeBulletin } from "../src/ingestion/normalize";
import { internal } from "./_generated/api";
import { httpAction, internalMutation, internalQuery } from "./_generated/server";
import { upsertBulletinsImpl } from "./ingestion";
import { config, errorResponse } from "./lib/http";
import { normalizedBulletin } from "./validators";

/** Used by `npm run seed:fixtures` and `npm run inject:update`. Only accepts items flagged isFixture. */
export const seedFixtures = internalMutation({
  args: {
    bulletins: v.array(normalizedBulletin.omit("contentHash")),
    mockSites: v.optional(v.array(v.object({ path: v.string(), contentType: v.string(), body: v.string() }))),
  },
  handler: async (ctx, { bulletins, mockSites }) => {
    const notFixture = bulletins.find((b) => !b.isFixture);
    if (notFixture) throw new Error(`refusing to seed non-fixture item ${notFixture.sourceId}/${notFixture.externalId}`);
    const results = await upsertBulletinsImpl(ctx, bulletins.map(finalizeBulletin));

    for (const site of mockSites ?? []) {
      const existing = await ctx.db
        .query("mockSites")
        .withIndex("by_path", (q) => q.eq("path", site.path))
        .unique();
      const row = { ...site, updatedAt: Date.now() };
      if (existing) await ctx.db.replace("mockSites", existing._id, row);
      else await ctx.db.insert("mockSites", row);
    }
    return results;
  },
});

/** GET /mock-sites/<path> — serves seeded mock HTML when ENABLE_MOCK_SITES=true (so Apify can scrape it). */
export const mockSite = httpAction(async (ctx, req) => {
  if (!config().ENABLE_MOCK_SITES) return errorResponse(404, "not_found", "mock sites are disabled");
  const path = new URL(req.url).pathname.replace(/^\/mock-sites\//, "");
  const site = await ctx.runQuery(internal.dev.getMockSite, { path });
  if (!site) return errorResponse(404, "not_found", `no mock site at ${path}`);
  return new Response(site.body, { status: 200, headers: { "Content-Type": site.contentType } });
});

export const getMockSite = internalQuery({
  args: { path: v.string() },
  handler: async (ctx, { path }) =>
    await ctx.db
      .query("mockSites")
      .withIndex("by_path", (q) => q.eq("path", path))
      .unique(),
});
