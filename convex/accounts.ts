// [B] Accounts for the future iOS app (Convex Swift client) and the phone-link rule.
// TODO(B): auth. Until convex/auth.config.ts exists (Convex Auth), getUserIdentity() is always null and
// the public queries below return nothing. The phone-link VERIFICATION flow (e.g. a one-time code by call)
// is also TODO(B): today links are created verified only by the internal test/dev helper.
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, query, type QueryCtx } from "./_generated/server";

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
    const summary = await ctx.db
      .query("callSummaries")
      .withIndex("by_callId", (q) => q.eq("callId", callId))
      .unique();
    return summary && { summary: summary.summary, language: summary.language, topics: summary.topics, hazards: summary.hazards, createdAt: summary.createdAt };
  },
});

export const listMySubscriptions = query({
  args: {},
  handler: async (ctx) => {
    const account = await currentAccount(ctx);
    if (!account) return [];
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_recipientAccountId", (q) => q.eq("recipient.accountId", account._id))
      .take(50);
    return subs.map((s) => ({ subscriptionId: s._id, target: s.target, trigger: s.trigger, status: s.status, expiresAt: s.expiresAt }));
  },
});

/**
 * Dev and test helper standing in for the future sign-up and phone verification flow: creates an
 * account and links a phone number, verified or not. Internal only.
 */
export const createTestAccount = internalMutation({
  args: {
    phone: v.string(),
    verified: v.boolean(),
    displayName: v.optional(v.string()),
    needs: v.optional(v.array(v.string())),
    preferredLanguage: v.optional(v.string()),
  },
  returns: v.object({ accountId: v.id("accounts"), phoneLinkId: v.id("phoneLinks") }),
  handler: async (ctx, { phone, verified, displayName, needs, preferredLanguage }) => {
    const now = Date.now();
    const accountId = await ctx.db.insert("accounts", { displayName, needs, preferredLanguage, createdAt: now });
    const phoneLinkId = await ctx.db.insert("phoneLinks", { accountId, phone, verifiedAt: verified ? now : undefined });
    return { accountId, phoneLinkId };
  },
});
