// [B] Callers (keyed by E.164 phone) and the verified-link rule for accounts.
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";

export async function upsertCallerByPhone(ctx: MutationCtx, phone: string, now: number): Promise<Id<"callers">> {
  const existing = await ctx.db
    .query("callers")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .unique();
  if (existing) return existing._id;
  return await ctx.db.insert("callers", { phone, lastCallAt: now });
}

/** A call gets an accountId only through a VERIFIED phone link. Caller ID alone is never enough. */
export async function verifiedAccountForPhone(ctx: QueryCtx, phone: string): Promise<Id<"accounts"> | undefined> {
  const links = await ctx.db
    .query("phoneLinks")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .take(10);
  return links.find((l) => l.verifiedAt !== undefined)?.accountId;
}

/** Deletes a caller's memory on request. TODO(B): cascade to subscriptions and unanswered questions. */
export const forgetCaller = internalMutation({
  args: { phone: v.string() },
  handler: async (ctx, { phone }) => {
    const caller = await ctx.db
      .query("callers")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .unique();
    if (caller) await ctx.db.delete("callers", caller._id);
    return null;
  },
});
