// [B] Accounts for the iOS app (Convex Swift client) and the phone-link rule.
// The app proves a user holds a phone number with a code that Soterra reads out by phone (requestPhoneCode, then
// verifyPhoneCode). That returns a private session token; getMyProfile and saveMyProfile need the token and never
// take a phone number. Nothing here trusts a bare phone number. (Convex Auth for the "my" queries is still TODO(B):
// until convex/auth.config.ts exists, getUserIdentity() is null and those return nothing.)
import { ConvexError, v } from "convex/values";
import { DEFAULTS, isSupportedLanguage } from "../src/config/defaults";
import { normalizeE164 } from "../src/memory/phone";
import { stateForZip } from "../src/orchestration/area";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { queueVerificationCall } from "./calls";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

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

// ── Proving a phone number: a code read out by a call ───────────────────────────────────────────────────────────

const CODE_TTL_MS = 10 * 60_000;
const CODE_MAX_ATTEMPTS = 5;
const CODE_MIN_GAP_MS = 60_000;
const CODE_MAX_PER_HOUR = 5;
const SESSION_TTL_MS = 30 * 24 * 3_600_000;

function randomDigits(count: number): string {
  const bytes = new Uint32Array(count);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => String(n % 10)).join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares without stopping at the first difference. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Step 1 in the app: Soterra phones the number and reads out a 6-digit code (valid 10 minutes). It says nothing about
 * whether the number has an account. At most one request a minute and five an hour per number, so this cannot be
 * used to ring someone over and over.
 */
export const requestPhoneCode = mutation({
  args: { phone: v.string(), language: v.optional(v.string()) },
  returns: v.object({ expiresAt: v.number() }),
  handler: async (ctx, args) => {
    const phone = phoneOrThrow(args.phone);
    const now = Date.now();
    const recent = await ctx.db
      .query("phoneChallenges")
      .withIndex("by_phone_and_createdAt", (q) => q.eq("phone", phone).gt("createdAt", now - 3_600_000))
      .take(10);
    if (recent.some((c) => now - c.createdAt < CODE_MIN_GAP_MS) || recent.length >= CODE_MAX_PER_HOUR) throw new ConvexError("rate_limited");
    const language = args.language && isSupportedLanguage(args.language) ? args.language : "en";
    const notificationId = await ctx.db.insert("notifications", {
      recipientPhone: phone,
      channel: "phone_call",
      language,
      message: "Soterra app code",
      bulletinRefs: [],
      dedupeKey: `appcode:${phone}:${now}`,
      purpose: "app_code",
      status: "queued",
      createdAt: now,
    });
    await ctx.db.insert("phoneChallenges", { phone, code: randomDigits(6), expiresAt: now + CODE_TTL_MS, attempts: 0, createdAt: now, notificationId });
    await ctx.scheduler.runAfter(0, internal.notifications.deliver, { notificationId });
    return { expiresAt: now + CODE_TTL_MS };
  },
});

type SessionResult =
  | { ok: true; token: string; expiresAt: number }
  | { ok: false; reason: "no_code" | "code_expired" | "invalid_code" | "too_many_attempts"; attemptsLeft?: number };

/**
 * Step 2: the user types the code. A wrong code returns a result instead of throwing, because a thrown error would
 * roll back the attempt counter. Five wrong tries burn the code. On success the number is linked to an account
 * (created if needed) and the app gets a private session token.
 */
export const verifyPhoneCode = mutation({
  args: { phone: v.string(), code: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true), token: v.string(), expiresAt: v.number() }),
    v.object({
      ok: v.literal(false),
      reason: v.union(v.literal("no_code"), v.literal("code_expired"), v.literal("invalid_code"), v.literal("too_many_attempts")),
      attemptsLeft: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args): Promise<SessionResult> => {
    const phone = phoneOrThrow(args.phone);
    const now = Date.now();
    const challenge = await ctx.db
      .query("phoneChallenges")
      .withIndex("by_phone_and_createdAt", (q) => q.eq("phone", phone))
      .order("desc")
      .first();
    if (!challenge) return { ok: false, reason: "no_code" };
    if (challenge.expiresAt <= now) return { ok: false, reason: "code_expired" };
    if (challenge.attempts >= CODE_MAX_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };
    if (!sameText(challenge.code, args.code.replace(/\s+/g, ""))) {
      await ctx.db.patch("phoneChallenges", challenge._id, { attempts: challenge.attempts + 1 });
      return { ok: false, reason: "invalid_code", attemptsLeft: CODE_MAX_ATTEMPTS - challenge.attempts - 1 };
    }
    await ctx.db.delete("phoneChallenges", challenge._id);

    // The number is now proven: link it (creating the account on first use) and mark the link verified by this flow.
    const link = await linkForPhone(ctx, phone);
    let accountId = link?.accountId;
    if (!link) {
      accountId = await ctx.db.insert("accounts", { createdAt: now });
      await ctx.db.insert("phoneLinks", { accountId, phone, verifiedAt: now, verifiedBy: "app_code" });
    } else if (link.verifiedBy !== "app_code") {
      await ctx.db.patch("phoneLinks", link._id, { verifiedAt: now, verifiedBy: "app_code" });
    }
    const token = randomToken();
    await ctx.db.insert("appSessions", { token, phone, accountId: accountId!, createdAt: now, expiresAt: now + SESSION_TTL_MS });
    return { ok: true, token, expiresAt: now + SESSION_TTL_MS };
  },
});

async function sessionFor(ctx: QueryCtx, token: string): Promise<Doc<"appSessions"> | null> {
  if (token.length < 32) return null;
  const session = await ctx.db
    .query("appSessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  return session && session.expiresAt > Date.now() ? session : null;
}

/** The profile behind a session token, or null for an unknown or expired token. */
export const getMyProfile = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await sessionFor(ctx, token);
    const account = session && (await ctx.db.get("accounts", session.accountId));
    if (!session || !account) return null;
    const { displayName, preferredLanguage, personalContext, homeZip, emergencyContact } = account;
    return { phone: session.phone, displayName, preferredLanguage, personalContext, homeZip, emergencyContact };
  },
});

/** Replaces the profile behind a session token. Omitted fields are cleared. */
export const saveMyProfile = mutation({
  args: { token: v.string(), ...profileFields },
  returns: v.boolean(),
  handler: async (ctx, { token, ...profile }) => {
    const session = await sessionFor(ctx, token);
    if (!session) throw new ConvexError("not_signed_in");
    if (profile.preferredLanguage !== undefined && !isSupportedLanguage(profile.preferredLanguage)) throw new ConvexError("invalid_language");
    if (profile.homeZip !== undefined && !stateForZip(profile.homeZip)) throw new ConvexError("invalid_zip");
    if ((profile.personalContext?.length ?? 0) > 2000) throw new ConvexError("personal_context_too_long");
    if (profile.emergencyContact) profile.emergencyContact.phone = phoneOrThrow(profile.emergencyContact.phone);
    // Every field listed, so an omitted one is patched to undefined (removed).
    const { displayName, preferredLanguage, personalContext, homeZip, emergencyContact } = profile;
    await ctx.db.patch("accounts", session.accountId, { displayName, preferredLanguage, personalContext, homeZip, emergencyContact });
    return true;
  },
});

/**
 * "Call me" in the app: the signed-in app asks Soterra to ring the linked number now. The call it places is the callback
 * check (verified for that call only), authorized by the session token, so the user gets personal commands ("what do you
 * know about me", "forget me") without calling in and waiting. Whoever answers must hold the phone. Limits are the same
 * as for the spoken callback: three an hour per number, one a minute.
 */
export const requestVerifiedCall = mutation({
  args: { token: v.string() },
  returns: v.union(v.object({ ok: v.literal(true) }), v.object({ ok: v.literal(false), reason: v.literal("rate_limited") })),
  handler: async (ctx, { token }) => {
    const session = await sessionFor(ctx, token);
    if (!session) throw new ConvexError("not_signed_in");
    const account = await ctx.db.get("accounts", session.accountId);
    const language = account?.preferredLanguage && isSupportedLanguage(account.preferredLanguage) ? account.preferredLanguage : "en";
    const queued = await queueVerificationCall(ctx, session.phone, language, Date.now(), 0);
    return queued ? ({ ok: true } as const) : ({ ok: false, reason: "rate_limited" } as const);
  },
});

/**
 * "Call Soterra" in the app: call this right before opening the dialer. The next inbound call from the linked number in
 * the next two minutes is verified (once), because the app, which holds the session token, asked for it. A spoofer would
 * have to fake the caller ID inside that window; for stronger proof use requestVerifiedCall ("Call me").
 */
export const armAppCall = mutation({
  args: { token: v.string() },
  returns: v.object({ expiresAt: v.number() }),
  handler: async (ctx, { token }) => {
    const session = await sessionFor(ctx, token);
    if (!session) throw new ConvexError("not_signed_in");
    const now = Date.now();
    // One armed call at a time per number: older unused arms are dropped.
    for (const old of await ctx.db.query("appCallArms").withIndex("by_phone", (q) => q.eq("phone", session.phone)).take(10)) {
      if (old.usedAt === undefined) await ctx.db.delete("appCallArms", old._id);
    }
    const expiresAt = now + DEFAULTS.appCallArmMs;
    await ctx.db.insert("appCallArms", { phone: session.phone, accountId: session.accountId, createdAt: now, expiresAt });
    return { expiresAt };
  },
});

export const signOut = mutation({
  args: { token: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { token }) => {
    const session = await sessionFor(ctx, token);
    if (!session) return false;
    await ctx.db.delete("appSessions", session._id);
    return true;
  },
});

/** Hourly: deletes expired codes and sessions. */
export const purgeAuth = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    let removed = 0;
    for (const c of await ctx.db.query("phoneChallenges").withIndex("by_phone_and_createdAt").take(200)) {
      if (c.expiresAt < now - 3_600_000) {
        await ctx.db.delete("phoneChallenges", c._id);
        removed++;
      }
    }
    for (const a of await ctx.db.query("appCallArms").take(200)) {
      if (a.expiresAt < now - 3_600_000) {
        await ctx.db.delete("appCallArms", a._id);
        removed++;
      }
    }
    for (const s of await ctx.db.query("appSessions").take(200)) {
      if (s.expiresAt < now) {
        await ctx.db.delete("appSessions", s._id);
        removed++;
      }
    }
    return removed;
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
    const phoneLinkId = await ctx.db.insert("phoneLinks", { accountId, phone, verifiedAt: verified ? now : undefined, verifiedBy: verified ? "test" : undefined });
    return { accountId, phoneLinkId };
  },
});
