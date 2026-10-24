// [B] Callers (keyed by E.164 phone), the verified-link rule for accounts, and forgetting a caller.
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";

export async function callerByPhone(ctx: QueryCtx, phone: string): Promise<Doc<"callers"> | null> {
  return await ctx.db
    .query("callers")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .unique();
}

/** Returns the caller row for a phone number, creating it on first contact. */
export async function getOrCreateCaller(ctx: MutationCtx, phone: string, now: number): Promise<{ caller: Doc<"callers">; created: boolean }> {
  const existing = await callerByPhone(ctx, phone);
  if (existing) return { caller: existing, created: false };
  const id = await ctx.db.insert("callers", { phone, lastCallAt: now });
  return { caller: (await ctx.db.get("callers", id))!, created: true };
}

/** A call gets an accountId only through a VERIFIED phone link. Caller ID alone is never enough. */
export async function verifiedAccountForPhone(ctx: QueryCtx, phone: string): Promise<Id<"accounts"> | undefined> {
  const links = await ctx.db
    .query("phoneLinks")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .take(10);
  return links.find((l) => l.verifiedAt !== undefined)?.accountId;
}

/** True while an active subscription still needs this caller (its callbacks reference the row). */
export async function hasActiveSubscription(ctx: QueryCtx, callerId: Id<"callers">): Promise<boolean> {
  const sub = await ctx.db
    .query("subscriptions")
    .withIndex("by_recipientCallerId_and_status", (q) => q.eq("recipient.callerId", callerId).eq("status", "active"))
    .first();
  return sub !== null;
}

/**
 * Deletes a caller's memory row and summaries (bounded batch). Calls and turns age out through the
 * retention purge. Returns false if more summaries remain (call again).
 */
export async function forgetCallerRows(ctx: MutationCtx, caller: Doc<"callers">, batch: number): Promise<boolean> {
  const summaries = await ctx.db
    .query("callSummaries")
    .withIndex("by_callerId", (q) => q.eq("callerId", caller._id))
    .take(batch);
  for (const s of summaries) if (s.accountId === undefined) await ctx.db.delete("callSummaries", s._id);
  if (summaries.length === batch) return false;
  await ctx.db.delete("callers", caller._id);
  return true;
}

/** Forgets a caller on request (run from the dashboard): cancels their updates and deletes their memory. */
export const forgetCaller = internalMutation({
  args: { phone: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { phone }) => {
    const caller = await callerByPhone(ctx, phone);
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_recipientPhone_and_status", (q) => q.eq("recipient.phone", phone).eq("status", "active"))
      .take(100);
    const now = Date.now();
    for (const s of subs) await ctx.db.patch("subscriptions", s._id, { status: "cancelled", cancelledAt: now });
    if (!caller) return true;
    return await forgetCallerRows(ctx, caller, 100);
  },
});
