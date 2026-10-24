// [B] Text alerts end to end: "text me" subscriptions, the confirmation text, a missed update call texted, an answered
// one recapped, voicemail, a call that can't be placed, landlines switched to calls, Twilio webhooks (signatures, STOP)
// and time-based updates. Only the mock notifiers run (no Twilio or Cartesia request is made).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS } from "../../src/config/defaults";
import { t as str } from "../../src/config/strings";
import { twilioSignature } from "../../src/providers/twilio/sms";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newTest, setupEnv, type TestConvex } from "../test.setup";
import { PHONE, callTexts, end, say, seedBulletins, settle, start, updateDrafts, updateNotifications, useDemoClock } from "./backend.helpers";

const SITE = "https://example-test.convex.site";
const TOKEN = "twilio-test-token";

beforeEach(() => {
  useDemoClock();
  setupEnv({ CONVEX_SITE_URL: SITE, TWILIO_AUTH_TOKEN: TOKEN, HOTLINE_NUMBER: "+18046066867" });
});
afterEach(() => vi.useRealTimers());

/** Runs scheduled work due in the next few seconds, leaving later timers (the call outcome check) pending. */
async function runSoon(t: TestConvex, seconds = 8) {
  for (let i = 0; i < seconds; i++) {
    vi.advanceTimersByTime(1_000);
    await t.finishInProgressScheduledFunctions();
  }
}

/** An inbound call that asks for updates, then hangs up. */
async function ask(t: TestConvex, request: string) {
  const s = await start(t);
  await say(t, s.sessionId, 0, "What's going on with the Ridgeview Fire?");
  const r = await say(t, s.sessionId, 1, request);
  await end(t, s.sessionId);
  await runSoon(t);
  return r;
}

const subscription = (t: TestConvex, id: string | undefined) => t.run(async (ctx) => await ctx.db.get("subscriptions", id as Id<"subscriptions">));

async function twilioPost(t: TestConvex, path: string, params: Record<string, string>, signature?: string) {
  const sig = signature ?? (await twilioSignature(TOKEN, `${SITE}${path}`, params));
  return await t.fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": sig },
    body: new URLSearchParams(params).toString(),
  });
}

describe("choosing texts", () => {
  it("'text me' creates a text subscription, confirms it by text after the call, and texts the update", async () => {
    const t = newTest();
    await seedBulletins(t);
    const r = await ask(t, "Can you text me if the evacuation changes?");
    expect(r.kind).toBe("followup");
    expect(r.reply).toContain(str("stopTexts", "en"));
    expect(await subscription(t, r.subscriptionId)).toMatchObject({ channels: ["sms"], mode: "on_change", trigger: "evacuation_change" });

    const [confirmation] = await callTexts(t);
    expect(confirmation).toMatchObject({ channel: "sms", purpose: "subscription_confirmation", status: "mock", recipientPhone: PHONE, subscriptionId: r.subscriptionId });
    expect(confirmation.message).toBe(
      "Soterra: you'll get texts about Ridgeview Fire when officials post updates, until October 25 at 3:00 PM Pacific. Questions? Call (804) 606-6867. Reply STOP to stop texts. In danger? Call 911.",
    );

    await seedBulletins(t, updateDrafts);
    await settle(t);
    const updates = await updateNotifications(t);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ channel: "sms", purpose: "update", status: "mock" });
    expect(updates[0].message).toMatch(/Evacuation Order for zone SON-3A/);
    // A text is not a call: no outcome check, no missed-call text.
    expect((await callTexts(t)).map((n) => n.purpose)).toEqual(["subscription_confirmation"]);
  });

  it("remembers the choice: a later 'keep me updated' is by text too", async () => {
    const t = newTest();
    await seedBulletins(t);
    await ask(t, "Text me if the evacuation changes");
    const r = await ask(t, "Keep me updated about the Ridgeview Fire");
    expect(await subscription(t, r.subscriptionId)).toMatchObject({ channels: ["sms"], trigger: "any_update" });
  });

  it("asking again for the same thing by call switches the channel instead of adding a second subscription", async () => {
    const t = newTest();
    await seedBulletins(t);
    const first = await ask(t, "Text me if the evacuation changes");
    const second = await ask(t, "Actually, call me if the evacuation changes");
    expect(second.subscriptionId).toBe(first.subscriptionId);
    expect(await subscription(t, first.subscriptionId)).toMatchObject({ channels: ["phone_call"] });
  });
});

describe("update calls: missed → text, answered → recap", () => {
  async function subscribedAndUpdated(t: TestConvex) {
    await seedBulletins(t);
    const r = await ask(t, "Please call me if the evacuation changes.");
    await seedBulletins(t, updateDrafts);
    await runSoon(t);
    const [update] = await updateNotifications(t);
    expect(update).toMatchObject({ channel: "phone_call", status: "mock" });
    expect(update.outcome).toBeUndefined();
    return { r, update };
  }

  it("confirms a call subscription by text, mentioning the text if a call is missed", async () => {
    const t = newTest();
    await seedBulletins(t);
    await ask(t, "Please call me if the evacuation changes.");
    const [confirmation] = await callTexts(t);
    expect(confirmation.message).toMatch(/^Soterra: you'll get calls about Ridgeview Fire when officials post updates \(a text if you miss one\), until/);
  });

  it("texts the update when nobody picks up", async () => {
    const t = newTest();
    const { update } = await subscribedAndUpdated(t);
    vi.advanceTimersByTime(DEFAULTS.callOutcomeCheckMs);
    await settle(t);
    const missed = (await callTexts(t)).filter((n) => n.purpose === "missed_call_text");
    expect(missed).toHaveLength(1);
    expect(missed[0]).toMatchObject({ channel: "sms", status: "mock", parentNotificationId: update._id, recipientPhone: PHONE });
    expect(missed[0].message).toMatch(/^Soterra: we called with the update you asked for\. Update from Sonoma County Emergency Management \(Demo\)/);
    expect(missed[0].message).toMatch(/Reply STOP to stop texts\. In danger\? Call 911\.$/);
    expect(missed[0].message.length).toBeLessThanOrEqual(DEFAULTS.smsMaxChars);
    expect((await t.run(async (ctx) => await ctx.db.get("notifications", update._id)))?.outcome).toBe("missed");
  });

  it("recaps an answered call by text, with the answers but without their sources", async () => {
    const t = newTest();
    const { update } = await subscribedAndUpdated(t);
    const outbound = await start(t, { direction: "outbound", callerPhone: undefined, notificationId: update._id });
    expect(outbound.greeting).toContain(update.message);
    const a = await say(t, outbound.sessionId, 0, "Are there shelters that take pets?");
    expect(a.kind).toBe("answer");
    await end(t, outbound.sessionId);
    vi.advanceTimersByTime(DEFAULTS.callOutcomeCheckMs);
    await settle(t);

    const texts = await callTexts(t);
    expect(texts.filter((n) => n.purpose === "missed_call_text")).toHaveLength(0);
    const [recap] = texts.filter((n) => n.purpose === "call_recap");
    expect(recap).toMatchObject({ channel: "sms", status: "mock", parentNotificationId: update._id });
    expect(recap.message).toMatch(/^Soterra recap: Update from Sonoma County Emergency Management \(Demo\)/);
    expect(recap.message).toMatch(/Reply STOP to stop texts\. In danger\? Call 911\.$/);
    expect(recap.message.length).toBeLessThanOrEqual(DEFAULTS.smsMaxChars);
    expect((await t.run(async (ctx) => await ctx.db.get("notifications", update._id)))?.outcome).toBe("answered");
  });

  it("puts a short answer in the recap when there is room", async () => {
    const t = newTest();
    await seedBulletins(t);
    await ask(t, "Please call me if the evacuation changes.");
    // A short update leaves room for the answer.
    const [sub] = await t.run(async (ctx) => await ctx.db.query("subscriptions").collect());
    const notificationId = await t.run(async (ctx) =>
      ctx.db.insert("notifications", {
        subscriptionId: sub._id,
        recipientPhone: PHONE,
        channel: "phone_call",
        language: "en",
        message: "Evacuation Order for zone SON-3A.",
        bulletinRefs: [],
        dedupeKey: "short-update",
        purpose: "update",
        status: "mock",
        createdAt: Date.now(),
      }),
    );
    const outbound = await start(t, { direction: "outbound", callerPhone: undefined, notificationId });
    await say(t, outbound.sessionId, 0, "Are there shelters that take pets?");
    await end(t, outbound.sessionId);
    await settle(t);
    const [recap] = (await callTexts(t)).filter((n) => n.purpose === "call_recap");
    // The mock model's answer is long: it is cut at a word so the footer (STOP, 911) always fits.
    expect(recap.message).toMatch(/^Soterra recap: Evacuation Order for zone SON-3A\. On the call: Two evacuation shelters are open, .*… Questions\? Call/);
    expect(recap.message.length).toBeLessThanOrEqual(DEFAULTS.smsMaxChars);
  });

  it("treats a call that only reached voicemail as missed", async () => {
    const t = newTest();
    const { update } = await subscribedAndUpdated(t);
    const outbound = await start(t, { direction: "outbound", callerPhone: undefined, notificationId: update._id });
    await say(t, outbound.sessionId, 0, "Hi, you've reached Sam. Please leave a message after the tone.");
    await end(t, outbound.sessionId);
    await settle(t);
    const texts = await callTexts(t);
    expect(texts.filter((n) => n.purpose === "missed_call_text")).toHaveLength(1);
    expect(texts.filter((n) => n.purpose === "call_recap")).toHaveLength(0);
  });

  it("texts at once when the call can't be placed", async () => {
    const t = newTest();
    setupEnv({ CONVEX_SITE_URL: SITE, PHONE_NOTIFIER: "cartesia" }); // no CARTESIA_* keys: NotConfiguredError
    await seedBulletins(t);
    await ask(t, "Please call me if the evacuation changes.");
    await seedBulletins(t, updateDrafts);
    await runSoon(t);
    const [update] = await updateNotifications(t);
    expect(update).toMatchObject({ channel: "phone_call", status: "unconfigured", outcome: "missed" });
    expect((await callTexts(t)).filter((n) => n.purpose === "missed_call_text")).toHaveLength(1);
  });

  it("sends nothing more once the caller said stop updates on the callback", async () => {
    const t = newTest();
    const { update } = await subscribedAndUpdated(t);
    const outbound = await start(t, { direction: "outbound", callerPhone: undefined, notificationId: update._id });
    await say(t, outbound.sessionId, 0, "Stop updates");
    await end(t, outbound.sessionId);
    vi.advanceTimersByTime(DEFAULTS.callOutcomeCheckMs);
    await settle(t);
    expect((await callTexts(t)).map((n) => n.purpose)).toEqual(["subscription_confirmation"]);
  });
});

describe("landlines", () => {
  it("a text the number can't receive switches the subscription to calls and calls the update", async () => {
    const t = newTest();
    await seedBulletins(t);
    const r = await ask(t, "Text me if the evacuation changes");
    await seedBulletins(t, updateDrafts);
    await settle(t);
    const [text] = await updateNotifications(t);
    expect(text.channel).toBe("sms");

    const res = await twilioPost(t, "/twilio/status", { MessageSid: text.providerRef!, MessageStatus: "undelivered", ErrorCode: "30006" });
    expect(res.status).toBe(204);
    await runSoon(t);
    expect(await subscription(t, r.subscriptionId)).toMatchObject({ channels: ["phone_call"] });
    const rows = await updateNotifications(t);
    expect(rows.map((n) => [n.channel, n.status])).toEqual([
      ["sms", "failed"],
      ["phone_call", "mock"],
    ]);
    expect(rows[0]).toMatchObject({ providerStatus: "undelivered", error: "code 30006: undelivered" });
    expect(rows[1]).toMatchObject({ message: text.message, parentNotificationId: text._id });
    // The caller's choice is updated too, so the next request defaults to calls.
    const caller = await t.run(async (ctx) => await ctx.db.query("callers").first());
    expect(caller?.preferredChannel).toBe("phone_call");
    // A repeated callback does not call twice.
    await twilioPost(t, "/twilio/status", { MessageSid: text.providerRef!, MessageStatus: "undelivered", ErrorCode: "30006" });
    await runSoon(t);
    expect(await updateNotifications(t)).toHaveLength(2);
  });

  it("records delivery, and other failures do not switch channels", async () => {
    const t = newTest();
    await seedBulletins(t);
    const r = await ask(t, "Text me if the evacuation changes");
    const [confirmation] = await callTexts(t);
    expect((await twilioPost(t, "/twilio/status", { MessageSid: confirmation.providerRef!, MessageStatus: "delivered" })).status).toBe(204);
    expect((await t.run(async (ctx) => await ctx.db.get("notifications", confirmation._id)))).toMatchObject({ status: "sent", providerStatus: "delivered" });
    expect((await twilioPost(t, "/twilio/status", { MessageSid: confirmation.providerRef!, MessageStatus: "failed", ErrorCode: "30007" })).status).toBe(204);
    expect(await subscription(t, r.subscriptionId)).toMatchObject({ channels: ["sms"] });
  });
});

describe("Twilio webhooks", () => {
  it("reject unsigned or wrongly signed requests, and fail closed without TWILIO_AUTH_TOKEN", async () => {
    const t = newTest();
    expect((await twilioPost(t, "/twilio/status", { MessageSid: "SM1", MessageStatus: "delivered" }, "bad")).status).toBe(403);
    expect((await twilioPost(t, "/twilio/inbound", { From: PHONE, Body: "STOP" }, "")).status).toBe(403);
    setupEnv({ CONVEX_SITE_URL: SITE });
    expect((await twilioPost(t, "/twilio/status", { MessageSid: "SM1", MessageStatus: "delivered" })).status).toBe(403);
  });

  it("STOP by text cancels every update for the number", async () => {
    const t = newTest();
    await seedBulletins(t);
    const r = await ask(t, "Text me if the evacuation changes");
    const res = await twilioPost(t, "/twilio/inbound", { From: PHONE, To: "+18045550100", Body: "STOP" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/xml");
    expect(await res.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    expect((await subscription(t, r.subscriptionId))?.status).toBe("cancelled");
    await seedBulletins(t, updateDrafts);
    await settle(t);
    expect(await updateNotifications(t)).toHaveLength(0);
  });

  it("other texts change nothing", async () => {
    const t = newTest();
    await seedBulletins(t);
    const r = await ask(t, "Text me if the evacuation changes");
    expect((await twilioPost(t, "/twilio/inbound", { From: PHONE, Body: "thanks!" })).status).toBe(200);
    expect((await subscription(t, r.subscriptionId))?.status).toBe("active");
  });
});

describe("time-based updates", () => {
  it("'text me every 2 hours' sends on schedule, with or without news, and never on events", async () => {
    const t = newTest();
    await seedBulletins(t);
    const r = await ask(t, "Text me updates about the Ridgeview Fire every 2 hours");
    expect(r.reply).toMatch(/every 2 hours/);
    const sub = await subscription(t, r.subscriptionId);
    expect(sub).toMatchObject({ channels: ["sms"], mode: "scheduled", intervalMs: 2 * 3_600_000 });
    expect(sub!.nextRunAt! - sub!.consentAt).toBe(2 * 3_600_000);
    expect(sub!.expiresAt - sub!.consentAt).toBe(24 * 3_600_000);
    expect((await callTexts(t))[0].message).toMatch(/^Soterra: you'll get a text every 2 hours about Ridgeview Fire, until/);

    // Not due yet.
    expect(await t.mutation(internal.subscriptions.runScheduled, {})).toBe(0);

    // Due, nothing new since the request.
    vi.advanceTimersByTime(2 * 3_600_000);
    expect(await t.mutation(internal.subscriptions.runScheduled, {})).toBe(1);
    await settle(t);
    let rows = await updateNotifications(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: "sms", purpose: "scheduled_update", status: "mock" });
    expect(rows[0].message).toMatch(/^No new official updates about Ridgeview Fire since October 24 at 3:00 PM Pacific\. Latest from /);

    // An event does not fire a scheduled subscription; the next slot reports it.
    await seedBulletins(t, updateDrafts);
    await settle(t);
    expect(await updateNotifications(t)).toHaveLength(1);
    expect(await t.mutation(internal.subscriptions.runScheduled, {})).toBe(0); // the same slot never runs twice
    vi.advanceTimersByTime(2 * 3_600_000);
    expect(await t.mutation(internal.subscriptions.runScheduled, {})).toBe(1);
    await settle(t);
    rows = await updateNotifications(t);
    expect(rows).toHaveLength(2);
    expect(rows[1].message).toMatch(/Evacuation Order for zone SON-3A/);
  });

  it("a scheduled call that is missed is texted too", async () => {
    const t = newTest();
    await seedBulletins(t);
    await ask(t, "Call me every hour about the Ridgeview Fire");
    vi.advanceTimersByTime(3_600_000);
    expect(await t.mutation(internal.subscriptions.runScheduled, {})).toBe(1);
    vi.advanceTimersByTime(DEFAULTS.callOutcomeCheckMs);
    await settle(t);
    const [call] = await updateNotifications(t);
    expect(call).toMatchObject({ channel: "phone_call", purpose: "scheduled_update", outcome: "missed" });
    expect((await callTexts(t)).filter((n) => n.purpose === "missed_call_text")).toHaveLength(1);
  });

  it("stops after the subscription expires", async () => {
    const t = newTest();
    await seedBulletins(t);
    const r = await ask(t, "Text me every 12 hours about the Ridgeview Fire");
    const sub = await subscription(t, r.subscriptionId);
    expect(sub!.expiresAt - sub!.consentAt).toBe(36 * 3_600_000);
    let sent = 0;
    for (let h = 0; h < 48; h++) {
      vi.advanceTimersByTime(3_600_000);
      sent += await t.mutation(internal.subscriptions.runScheduled, {});
    }
    expect(sent).toBe(2); // at 12 h and 24 h; the 36 h slot is the expiry
    expect((await subscription(t, r.subscriptionId))?.status).toBe("expired");
  });
});
