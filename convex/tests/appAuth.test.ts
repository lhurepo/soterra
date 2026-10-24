// [B] Signing in to the app with a code read out by phone, the token-gated profile, and what a linked number may and may
// not do on a call. There is no way to read or change a profile with only a phone number.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t as str } from "../../src/config/strings";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newTest, setupEnv, type TestConvex } from "../test.setup";
import { PHONE, PHONE_2, end, say, settle, start, useDemoClock } from "./backend.helpers";

beforeEach(() => {
  useDemoClock();
  setupEnv();
});
afterEach(() => vi.useRealTimers());

const challengeFor = (t: TestConvex, phone: string) =>
  t.run(async (ctx) => await ctx.db.query("phoneChallenges").withIndex("by_phone_and_createdAt", (q) => q.eq("phone", phone)).order("desc").first());
const getCall = (t: TestConvex, id: string) => t.run(async (ctx) => await ctx.db.get("calls", id as Id<"calls">));
const profile = { displayName: "Ana", preferredLanguage: "es", personalContext: "Wheelchair user; insulin in the fridge.", homeZip: "95404" };

/** The app asks for a code, Soterra's call reads it out, the user types it: returns the session token. */
async function signIn(t: TestConvex, phone = PHONE_2) {
  await t.mutation(api.accounts.requestPhoneCode, { phone });
  const code = (await challengeFor(t, phone))!.code;
  const result = await t.mutation(api.accounts.verifyPhoneCode, { phone, code });
  if (!result.ok) throw new Error(`sign-in failed: ${result.reason}`);
  return result.token;
}

describe("the code call", () => {
  it("is a phone call to that number that reads the digits one by one, and is not kept afterwards", async () => {
    const t = newTest();
    await t.mutation(api.accounts.requestPhoneCode, { phone: "(707) 555-0145" });
    await settle(t); // the mock notifier places the call
    const [n] = await t.run(async (ctx) => await ctx.db.query("notifications").collect());
    expect(n).toMatchObject({ purpose: "app_code", channel: "phone_call", recipientPhone: PHONE_2, status: "mock" });
    expect(n.message).not.toMatch(/\d{6}/); // the code never sits in the notification

    const code = (await challengeFor(t, PHONE_2))!.code;
    const call = await start(t, { direction: "outbound", callerPhone: undefined, notificationId: n._id });
    expect(call.greeting).toContain(code.split("").join(" "));
    expect(call.greeting).toContain(str("transcriptionNotice", "en"));
    expect(await getCall(t, call.sessionId)).toMatchObject({ direction: "outbound", callerPhone: PHONE_2 });
    expect((await getCall(t, call.sessionId))?.verifiedPhone).toBeUndefined(); // reading a code is not the callback check

    await end(t, call.sessionId);
    await settle(t);
    expect((await getCall(t, call.sessionId))?.greeting).toBeUndefined(); // the code is scrubbed from the call record
  });

  it("says the code has expired if the call connects too late", async () => {
    const t = newTest();
    await t.mutation(api.accounts.requestPhoneCode, { phone: PHONE_2 });
    const [n] = await t.run(async (ctx) => await ctx.db.query("notifications").collect());
    vi.advanceTimersByTime(11 * 60_000);
    const call = await start(t, { direction: "outbound", callerPhone: undefined, notificationId: n._id });
    expect(call.greeting).toContain(str("appCodeExpired", "en"));
    expect(call.greeting).not.toMatch(/\d \d \d \d \d \d/);
  });

  it("limits how often a number can be rung: one a minute, five an hour", async () => {
    const t = newTest();
    await t.mutation(api.accounts.requestPhoneCode, { phone: PHONE_2 });
    await expect(t.mutation(api.accounts.requestPhoneCode, { phone: PHONE_2 })).rejects.toThrow("rate_limited");
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(61_000);
      await t.mutation(api.accounts.requestPhoneCode, { phone: PHONE_2 });
    }
    vi.advanceTimersByTime(61_000);
    await expect(t.mutation(api.accounts.requestPhoneCode, { phone: PHONE_2 })).rejects.toThrow("rate_limited");
    await expect(t.mutation(api.accounts.requestPhoneCode, { phone: "12" })).rejects.toThrow("invalid_phone");
  });
});

describe("entering the code", () => {
  it("rejects a wrong code and counts the attempt; five wrong tries burn the code, even for the right one", async () => {
    const t = newTest();
    await t.mutation(api.accounts.requestPhoneCode, { phone: PHONE_2 });
    const code = (await challengeFor(t, PHONE_2))!.code;
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await t.mutation(api.accounts.verifyPhoneCode, { phone: PHONE_2, code: wrong })).toEqual({ ok: false, reason: "invalid_code", attemptsLeft: 4 });
    for (let i = 0; i < 4; i++) await t.mutation(api.accounts.verifyPhoneCode, { phone: PHONE_2, code: wrong });
    expect(await t.mutation(api.accounts.verifyPhoneCode, { phone: PHONE_2, code })).toEqual({ ok: false, reason: "too_many_attempts" });
    expect(await t.run(async (ctx) => (await ctx.db.query("appSessions").collect()).length)).toBe(0);
  });

  it("rejects an expired code and a number that never asked", async () => {
    const t = newTest();
    expect(await t.mutation(api.accounts.verifyPhoneCode, { phone: PHONE_2, code: "123456" })).toEqual({ ok: false, reason: "no_code" });
    await t.mutation(api.accounts.requestPhoneCode, { phone: PHONE_2 });
    const code = (await challengeFor(t, PHONE_2))!.code;
    vi.advanceTimersByTime(11 * 60_000);
    expect(await t.mutation(api.accounts.verifyPhoneCode, { phone: PHONE_2, code })).toEqual({ ok: false, reason: "code_expired" });
  });

  it("a code only works for the number it was sent to, and only once", async () => {
    const t = newTest();
    await t.mutation(api.accounts.requestPhoneCode, { phone: PHONE_2 });
    const code = (await challengeFor(t, PHONE_2))!.code;
    expect(await t.mutation(api.accounts.verifyPhoneCode, { phone: PHONE, code })).toMatchObject({ ok: false, reason: "no_code" });
    expect(await t.mutation(api.accounts.verifyPhoneCode, { phone: PHONE_2, code: ` ${code.slice(0, 3)} ${code.slice(3)} ` })).toMatchObject({ ok: true });
    expect(await t.mutation(api.accounts.verifyPhoneCode, { phone: PHONE_2, code })).toMatchObject({ ok: false, reason: "no_code" });
  });
});

describe("the profile", () => {
  it("is readable and writable only with the session token, never with a phone number", async () => {
    const t = newTest();
    const token = await signIn(t);
    expect(await t.query(api.accounts.getMyProfile, { token })).toMatchObject({ phone: PHONE_2 });
    expect(await t.mutation(api.accounts.saveMyProfile, { token, ...profile })).toBe(true);
    expect(await t.query(api.accounts.getMyProfile, { token })).toMatchObject({ phone: PHONE_2, ...profile });

    // Saving again replaces it: omitted fields are cleared.
    await t.mutation(api.accounts.saveMyProfile, { token, displayName: "Ana R." });
    const saved = await t.query(api.accounts.getMyProfile, { token });
    expect(saved).toMatchObject({ displayName: "Ana R." });
    expect(saved?.personalContext).toBeUndefined();

    // Nothing works without a real token, and the old bare-phone functions no longer exist.
    expect(await t.query(api.accounts.getMyProfile, { token: "x".repeat(64) })).toBeNull();
    expect(await t.query(api.accounts.getMyProfile, { token: "short" })).toBeNull();
    await expect(t.mutation(api.accounts.saveMyProfile, { token: "x".repeat(64), displayName: "Mallory" })).rejects.toThrow("not_signed_in");
    // The old unauthenticated functions are gone: calling them fails.
    const old = api.accounts as unknown as Record<string, unknown>;
    const loose = t as unknown as { mutation: (f: unknown, a: unknown) => Promise<unknown>; query: (f: unknown, a: unknown) => Promise<unknown> };
    await expect(loose.mutation(old.saveProfile, { phone: PHONE_2, displayName: "Mallory" })).rejects.toThrow(/no such export/);
    await expect(loose.query(old.getProfileByPhone, { phone: PHONE_2 })).rejects.toThrow(/no such export/);
  });

  it("validates what is saved, and one number's token cannot touch another number's profile", async () => {
    const t = newTest();
    const mine = await signIn(t, PHONE_2);
    const other = await signIn(t, PHONE);
    await t.mutation(api.accounts.saveMyProfile, { token: other, displayName: "Other", personalContext: "private" });
    await expect(t.mutation(api.accounts.saveMyProfile, { token: mine, homeZip: "00000" })).rejects.toThrow("invalid_zip");
    await expect(t.mutation(api.accounts.saveMyProfile, { token: mine, preferredLanguage: "xx" })).rejects.toThrow("invalid_language");
    await expect(t.mutation(api.accounts.saveMyProfile, { token: mine, personalContext: "x".repeat(2001) })).rejects.toThrow("personal_context_too_long");
    await t.mutation(api.accounts.saveMyProfile, { token: mine, displayName: "Mine" });
    expect(await t.query(api.accounts.getMyProfile, { token: other })).toMatchObject({ displayName: "Other", personalContext: "private" });
  });

  it("signing out and expiry end the session", async () => {
    const t = newTest();
    const token = await signIn(t);
    expect(await t.mutation(api.accounts.signOut, { token })).toBe(true);
    expect(await t.query(api.accounts.getMyProfile, { token })).toBeNull();
    const second = await signIn(t); // a new code is allowed after the minute passes
    vi.advanceTimersByTime(31 * 24 * 3_600_000);
    expect(await t.query(api.accounts.getMyProfile, { token: second })).toBeNull();
  });

  it("the sign-in link is marked as proven by the code", async () => {
    const t = newTest();
    await signIn(t);
    const link = await t.run(async (ctx) => await ctx.db.query("phoneLinks").withIndex("by_phone", (q) => q.eq("phone", PHONE_2)).unique());
    expect(link).toMatchObject({ verifiedBy: "app_code" });
    expect(link?.verifiedAt).toBeDefined();
  });
});

describe("a linked number on a call", () => {
  it("the profile shapes the call, but caller ID alone still cannot read back or change anything", async () => {
    const t = newTest();
    const token = await signIn(t);
    await t.mutation(api.accounts.saveMyProfile, { token, ...profile });
    const plain = await start(t, { callerPhone: PHONE_2, languageHint: undefined });
    expect((await getCall(t, plain.sessionId))?.callerContext).toMatchObject({
      identity: "verified_account",
      language: "es",
      personalContext: profile.personalContext,
      knownArea: { state: "CA", zip: "95404" },
    });
    // A spoofed caller ID gets the callback check, not the stored details.
    for (const [i, utterance] of ["What do you know about me?", "Forget me", "What updates do I have?"].entries()) {
      const r = await say(t, plain.sessionId, i, utterance, { language: "es" });
      expect(r.reply).toBe(str("verifyAnnounce", "es"));
      expect(r.reply).not.toContain("insulin");
    }
  });

  it("the callback check works for a linked number too, and then the details can be read back", async () => {
    const t = newTest();
    const token = await signIn(t);
    await t.mutation(api.accounts.saveMyProfile, { token, ...profile });
    const plain = await start(t, { callerPhone: PHONE_2 });
    await say(t, plain.sessionId, 0, "What do you know about me?");
    await end(t, plain.sessionId, "agent_end");
    await settle(t);
    const [n] = (await t.run(async (ctx) => await ctx.db.query("notifications").collect())).filter((x) => x.purpose === "verification");
    const cb = await start(t, { direction: "outbound", callerPhone: undefined, notificationId: n._id });
    expect((await getCall(t, cb.sessionId))?.callerContext).toMatchObject({ identity: "verified_phone", personalContext: profile.personalContext });
    const r = await say(t, cb.sessionId, 0, "Remember I have two dogs");
    expect(r.reply).toBe(str("profileSaved", "en").replace("{need}", "I have two dogs"));
  });
});
