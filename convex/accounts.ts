// [B] Accounts for the iOS app (Convex Swift client) and the phone-link rule.
// TODO(B): auth. Until convex/auth.config.ts exists (Convex Auth), getUserIdentity() is always null and
// the "my" queries below return nothing.
// DEMO ONLY, INSECURE: saveProfile and getProfileByPhone take a bare phone number, with no login and no proof the
// caller holds that phone, and saveProfile marks the link verified. Anyone who knows a number can read or replace
// its profile (including medical details), and calls from it get the profile. Replace with auth plus a phone
// verification flow (e.g. a one-time code by call) before real users.
import { ConvexError, v } from "convex/values";
import { isSupportedLanguage } from "../src/config/defaults";
import { normalizeE164 } from "../src/memory/phone";
import { stateForZip } from "../src/orchestration/area";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";

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

const profileFields = {
  displayName: v.optional(v.string()),
  preferredLanguage: v.optional(v.string()),
  personalContext: v.optional(v.string()),
  homeZip: v.optional(v.string()),
  emergencyContact: v.optional(v.object({ name: v.string(), phone: v.string() })),
};

function phoneOrThrow(raw: string): string {
  const phone = normalizeE164(raw);
  if (!phone) throw new ConvexError("invalid_phone");
  return phone;
}

async function linkForPhone(ctx: QueryCtx, phone: string) {
  return await ctx.db
    .query("phoneLinks")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .first();
}

/** DEMO ONLY (see top). The profile linked to a phone number, or null. */
export const getProfileByPhone = query({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const phone = phoneOrThrow(args.phone);
    const link = await linkForPhone(ctx, phone);
    const account = link && (await ctx.db.get("accounts", link.accountId));
    if (!account) return null;
    const { displayName, preferredLanguage, personalContext, homeZip, emergencyContact } = account;
    return { accountId: account._id, phone, displayName, preferredLanguage, personalContext, homeZip, emergencyContact };
  },
});

/**
 * DEMO ONLY (see top). Creates or replaces the profile for a phone number and links it, verified, so calls from
 * that number get it. Omitted fields are cleared.
 */
export const saveProfile = mutation({
  args: { phone: v.string(), ...profileFields },
  returns: v.id("accounts"),
  handler: async (ctx, { phone: rawPhone, ...profile }) => {
    const phone = phoneOrThrow(rawPhone);
    if (profile.preferredLanguage !== undefined && !isSupportedLanguage(profile.preferredLanguage)) throw new ConvexError("invalid_language");
    if (profile.homeZip !== undefined && !stateForZip(profile.homeZip)) throw new ConvexError("invalid_zip");
    if ((profile.personalContext?.length ?? 0) > 2000) throw new ConvexError("personal_context_too_long");
    if (profile.emergencyContact) profile.emergencyContact.phone = phoneOrThrow(profile.emergencyContact.phone);
    const now = Date.now();
    const link = await linkForPhone(ctx, phone);
    if (!link) {
      const accountId = await ctx.db.insert("accounts", { ...profile, createdAt: now });
      await ctx.db.insert("phoneLinks", { accountId, phone, verifiedAt: now });
      return accountId;
    }
    // Every field listed, so an omitted one is patched to undefined (removed).
    const { displayName, preferredLanguage, personalContext, homeZip, emergencyContact } = profile;
    await ctx.db.patch("accounts", link.accountId, { displayName, preferredLanguage, personalContext, homeZip, emergencyContact });
    if (link.verifiedAt === undefined) await ctx.db.patch("phoneLinks", link._id, { verifiedAt: now });
    return link.accountId;
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
