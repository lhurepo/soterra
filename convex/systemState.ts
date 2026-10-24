// [I] Crisis mode: one `systemState` row. Crisis shortens polling intervals, is extended while its
// triggering bulletin stays active, and reverts on its own at expiresAt. Every change is logged.
import { v } from "convex/values";
import { CRISIS_DURATION_MS, crisisExpired, enterOrExtendCrisis, type CrisisState } from "../src/ingestion/crisis";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";

export async function getSystemState(ctx: QueryCtx): Promise<Doc<"systemState"> | null> {
  return await ctx.db
    .query("systemState")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();
}

function asCrisisState(row: Doc<"systemState"> | null): CrisisState | null {
  if (!row) return null;
  return { mode: row.mode, since: row.since, expiresAt: row.expiresAt, reason: row.reason, triggeredBy: row.triggeredByBulletinId };
}

async function writeState(
  ctx: MutationCtx,
  current: Doc<"systemState"> | null,
  next: { mode: "normal" | "crisis"; reason: string; since: number; expiresAt?: number; triggeredByBulletinId?: Id<"bulletins"> },
): Promise<void> {
  const row = { key: "global" as const, ...next, lastSignalPollAt: current?.lastSignalPollAt };
  if (current) await ctx.db.replace("systemState", current._id, row);
  else await ctx.db.insert("systemState", row);
  if (current?.mode !== next.mode) {
    console.info(`[systemState] mode ${current?.mode ?? "normal"} → ${next.mode}: ${next.reason}`);
    await ctx.db.insert("systemModeLog", {
      mode: next.mode,
      reason: next.reason,
      triggeredByBulletinId: next.triggeredByBulletinId,
      expiresAt: next.expiresAt,
      at: Date.now(),
    });
  }
}

/** Enter crisis mode, or extend the current crisis. Called after every upsert that has a triggering bulletin. */
export async function enterOrExtend(ctx: MutationCtx, reason: string, bulletinId: Id<"bulletins">, now: number): Promise<void> {
  const current = await getSystemState(ctx);
  const next = enterOrExtendCrisis(asCrisisState(current), reason, bulletinId, now);
  if (current?.mode === "crisis" && current.expiresAt === next.expiresAt) return;
  await writeState(ctx, current, {
    mode: "crisis",
    reason: next.reason,
    since: next.since,
    expiresAt: next.expiresAt,
    triggeredByBulletinId: (next.triggeredBy as Id<"bulletins"> | undefined) ?? bulletinId,
  });
}

/** Tick housekeeping: extend while the trigger is still active and triggering, else revert once expired. */
export async function maintainCrisis(
  ctx: MutationCtx,
  now: number,
  stillTriggering: (bulletinId: Id<"bulletins">) => Promise<boolean>,
): Promise<"normal" | "crisis"> {
  const current = await getSystemState(ctx);
  if (!current || current.mode !== "crisis") return "normal";
  if (current.triggeredByBulletinId && (await stillTriggering(current.triggeredByBulletinId))) {
    // Extend when less than half of the window is left, to avoid a write every minute.
    if (current.expiresAt === undefined || current.expiresAt - now < CRISIS_DURATION_MS / 2) {
      await ctx.db.patch("systemState", current._id, { expiresAt: now + CRISIS_DURATION_MS });
    }
    return "crisis";
  }
  if (crisisExpired(asCrisisState(current), now)) {
    await writeState(ctx, current, { mode: "normal", reason: "crisis mode expired", since: now });
    return "normal";
  }
  return "crisis";
}

/** Current mode without writing (an expired crisis counts as normal). */
export function effectiveMode(state: Doc<"systemState"> | null, now: number): "normal" | "crisis" {
  if (!state || state.mode !== "crisis") return "normal";
  return state.expiresAt !== undefined && state.expiresAt <= now ? "normal" : "crisis";
}

export async function markSignalPoll(ctx: MutationCtx, now: number): Promise<void> {
  const current = await getSystemState(ctx);
  if (current) await ctx.db.patch("systemState", current._id, { lastSignalPollAt: now });
  else await ctx.db.insert("systemState", { key: "global", mode: "normal", reason: "initial", since: now, lastSignalPollAt: now });
}

export const get = internalQuery({
  args: {},
  handler: async (ctx) => await getSystemState(ctx),
});

/** Manual override: npx convex run systemState:setMode '{"mode":"crisis","reason":"drill","durationMin":60}' */
export const setMode = internalMutation({
  args: { mode: v.union(v.literal("normal"), v.literal("crisis")), reason: v.string(), durationMin: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { mode, reason, durationMin }) => {
    const now = Date.now();
    await writeState(ctx, await getSystemState(ctx), {
      mode,
      reason,
      since: now,
      expiresAt: mode === "crisis" ? now + (durationMin ?? CRISIS_DURATION_MS / 60_000) * 60_000 : undefined,
    });
    return null;
  },
});

export const recentModeChanges = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => await ctx.db.query("systemModeLog").order("desc").take(Math.min(limit ?? 20, 100)),
});
