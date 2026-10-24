// [B] Account-scoped reads for the future SwiftUI app (Convex Swift client). Auth is TODO(B):
// until convex/auth.config.ts exists, getUserIdentity() is always null and these return nothing.
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";

async function currentAccount(ctx: QueryCtx): Promise<Doc<"accounts"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("accounts")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

export const listMyCalls = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const account = await currentAccount(ctx);
    if (!account) return [];
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_accountId_and_startedAt", (q) => q.eq("accountId", account._id))
      .order("desc")
      .take(Math.min(limit ?? 20, 50));
    return calls.map((c) => ({ callId: c._id, startedAt: c.startedAt, endedAt: c.endedAt, language: c.language, status: c.status }));
  },
});

export const getCallSummary = query({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    const account = await currentAccount(ctx);
    if (!account) return null;
    const call = await ctx.db.get("calls", callId);
    if (!call || call.accountId !== account._id) return null;
    return await ctx.db
      .query("callSummaries")
      .withIndex("by_callId", (q) => q.eq("callId", callId))
      .unique();
  },
});

export const listMySubscriptions = query({
  args: {},
  handler: async (ctx) => {
    const account = await currentAccount(ctx);
    if (!account) return [];
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_recipientAccountId", (q) => q.eq("recipient.accountId", account._id))
      .take(50);
  },
});
