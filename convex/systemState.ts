// [I] Crisis mode: one `systemState` row. Crisis shortens polling intervals and reverts at expiresAt.
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";

export async function getSystemState(ctx: QueryCtx): Promise<Doc<"systemState"> | null> {
  return await ctx.db
    .query("systemState")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();
}

export async function setSystemMode(
  ctx: MutationCtx,
  next: { mode: "normal" | "crisis"; reason: string; triggeredByBulletinId?: Id<"bulletins">; expiresAt?: number },
): Promise<void> {
  const current = await getSystemState(ctx);
  const row = { key: "global" as const, ...next, since: Date.now() };
  if (current) await ctx.db.replace("systemState", current._id, row);
  else await ctx.db.insert("systemState", row);
}

/** Current mode, treating an expired crisis as normal (the tick also reverts it). */
export function effectiveMode(state: Doc<"systemState"> | null, now: number): "normal" | "crisis" {
  if (!state || state.mode !== "crisis") return "normal";
  return state.expiresAt !== undefined && state.expiresAt <= now ? "normal" : "crisis";
}

export const get = internalQuery({
  args: {},
  handler: async (ctx) => await getSystemState(ctx),
});

/** Manual override from the CLI: npx convex run systemState:setMode '{"mode":"crisis","reason":"drill","durationMin":60}' */
export const setMode = internalMutation({
  args: { mode: v.union(v.literal("normal"), v.literal("crisis")), reason: v.string(), durationMin: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { mode, reason, durationMin }) => {
    await setSystemMode(ctx, {
      mode,
      reason,
      expiresAt: mode === "crisis" ? Date.now() + (durationMin ?? 360) * 60_000 : undefined,
    });
    return null;
  },
});
