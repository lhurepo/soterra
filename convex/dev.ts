// [S] Dev only: fixture seeding. Internal functions are callable only from the CLI/dashboard
// (npx convex run), never from clients. Fixtures are served to callers only when SERVE_FIXTURES=true.
// Mock-site serving lives in convex/mockSites.ts.
import { v } from "convex/values";
import { finalizeBulletin } from "../src/ingestion/normalize";
import { internalMutation } from "./_generated/server";
import { upsertBulletinsImpl } from "./ingestion";
import { normalizedBulletin } from "./validators";

/** Used by `npm run seed:fixtures` and `npm run inject:update`. Only accepts items flagged isFixture. */
export const seedFixtures = internalMutation({
  args: {
    bulletins: v.array(normalizedBulletin.omit("contentHash")),
    mockSites: v.optional(
      v.array(
        v.object({
          path: v.string(),
          variant: v.optional(v.union(v.literal("v1"), v.literal("v2"))),
          contentType: v.string(),
          body: v.string(),
        }),
      ),
    ),
  },
  handler: async (ctx, { bulletins, mockSites }) => {
    const notFixture = bulletins.find((b) => !b.isFixture);
    if (notFixture) throw new Error(`refusing to seed non-fixture item ${notFixture.sourceId}/${notFixture.externalId}`);
    const results = (await upsertBulletinsImpl(ctx, bulletins.map(finalizeBulletin))).results;

    for (const site of mockSites ?? []) {
      const variant = site.variant ?? "v1";
      const existing = await ctx.db
        .query("mockSites")
        .withIndex("by_path_and_variant", (q) => q.eq("path", site.path).eq("variant", variant))
        .unique();
      const row = { path: site.path, variant, contentType: site.contentType, body: site.body, updatedAt: Date.now() };
      if (existing) await ctx.db.replace("mockSites", existing._id, row);
      else await ctx.db.insert("mockSites", row);
    }
    return results;
  },
});
