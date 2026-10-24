// [B] Text alerts, pure parts: "text me" / "every 2 hours" / voicemail intents, schedule rules, text templates,
// the Twilio adapter (request shape, errors, signatures) and notifier selection. Convex flows: convex/tests/textAlerts.test.ts.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../src/config/defaults";
import { loadConfig } from "../src/config/env";
import { t } from "../src/config/strings";
import { buildScheduledMessage } from "../src/notifications/message";
import { MockSmsNotifier, TwilioSmsNotifier, UnconfiguredSmsNotifier, selectNotifier } from "../src/notifications/notifier";
import { clampIntervalMs, formatInterval, nextRunAfter, subscriptionLifetimeMs } from "../src/notifications/schedule";
import {
  answerWithoutAttribution,
  buildConfirmationText,
  buildMissedCallText,
  buildRecapText,
  fitText,
  formatPhoneForText,
  incidentLabel,
  textTopic,
} from "../src/notifications/sms";
import { asksForFollowUp, looksLikeVoicemail, requestedChannel, requestedIntervalMinutes } from "../src/orchestration/intents";
import { isOptOutText, messagesUrl, sendSms, smsRequestBody, twilioSignature, verifyTwilioSignature } from "../src/providers/twilio/sms";

const HOUR = 3_600_000;
const UPDATE =
  "Update from Sonoma County Emergency Management (Demo), October 24 at 6:20 PM Pacific: Evacuation Order for zone SON-3A, Ridgeview Fire. An Evacuation Order is now in effect for zone SON-3A near the Ridgeview Fire.";

describe("intents: channel, interval, voicemail", () => {
  it("reads 'text me' as texts and 'call me' as calls, in English and Spanish", () => {
    for (const u of ["Text me if the evacuation changes", "Can you send me a text when it changes?", "Updates by text please", "Send me an SMS", "Mándame un mensaje si cambia", "Envíeme un mensaje de texto", "Avíseme por mensaje"]) {
      expect(requestedChannel(u), u).toBe("sms");
    }
    for (const u of ["Call me if it changes", "Llámeme si cambia", "Call me or text me, either is fine"]) expect(requestedChannel(u), u).toBe("phone_call");
    expect(requestedChannel("Keep me updated")).toBeUndefined();
  });

  it("recognises update requests that only say 'text' or 'update me'", () => {
    for (const u of ["Send me updates", "Update me every two hours", "Text me", "Mándame actualizaciones", "Envíame un mensaje"]) expect(asksForFollowUp(u), u).toBe(true);
    expect(asksForFollowUp("What's the latest update on the fire?")).toBe(false);
  });

  it("reads intervals: digits, words, hourly, daily, Spanish", () => {
    const cases: [string, number | undefined][] = [
      ["every 2 hours", 120],
      ["every two hours please", 120],
      ["every couple of hours", 120],
      ["every hour", 60],
      ["hourly", 60],
      ["every 30 minutes", 30],
      ["every half hour", 30],
      ["twice a day", 720],
      ["daily", 1440],
      ["every morning", 1440],
      ["cada hora", 60],
      ["cada 3 horas", 180],
      ["cada dos horas", 120],
      ["cada media hora", 30],
      ["todos los días", 1440],
      ["if the evacuation changes", undefined],
      ["every few hours", undefined],
    ];
    for (const [u, minutes] of cases) expect(requestedIntervalMinutes(u), u).toBe(minutes);
  });

  it("tells an answering machine from a person", () => {
    for (const u of ["Hi, you've reached Sam. Please leave a message after the tone.", "The person you are calling is not available", "Deje su mensaje después del tono"]) {
      expect(looksLikeVoicemail(u), u).toBe(true);
    }
    for (const u of ["Hello?", "Yes, what's the update?", "Is my zone included?"]) expect(looksLikeVoicemail(u), u).toBe(false);
  });
});

describe("schedule rules", () => {
  it("clamps intervals to 1–24 hours", () => {
    expect(clampIntervalMs(10)).toBe(HOUR);
    expect(clampIntervalMs(120)).toBe(2 * HOUR);
    expect(clampIntervalMs(7 * 1440)).toBe(24 * HOUR);
  });

  it("keeps change alerts at 24 h and gives scheduled ones at least three updates, at most 72 h", () => {
    expect(subscriptionLifetimeMs()).toBe(DEFAULTS.subscriptionTtlMs);
    expect(subscriptionLifetimeMs(HOUR)).toBe(24 * HOUR);
    expect(subscriptionLifetimeMs(12 * HOUR)).toBe(36 * HOUR);
    expect(subscriptionLifetimeMs(24 * HOUR)).toBe(72 * HOUR);
  });

  it("words the interval, and never sends a burst after a late cron", () => {
    expect([formatInterval(HOUR, "en"), formatInterval(2 * HOUR, "en"), formatInterval(24 * HOUR, "en")]).toEqual(["hour", "2 hours", "day"]);
    expect([formatInterval(HOUR, "es"), formatInterval(3 * HOUR, "es"), formatInterval(24 * HOUR, "es")]).toEqual(["hora", "3 horas", "día"]);
    expect(nextRunAfter(1_000, HOUR, 1_000)).toBe(1_000 + HOUR);
    expect(nextRunAfter(1_000, HOUR, 1_000 + 5 * HOUR)).toBe(1_000 + 6 * HOUR);
  });
});

describe("text templates", () => {
  it("keeps every text within two segments, always ending with STOP and 911", () => {
    const missed = buildMissedCallText(UPDATE, "en", "+18046066867");
    expect(missed.length).toBeLessThanOrEqual(DEFAULTS.smsMaxChars);
    expect(missed).toMatch(/^Soterra: we called with the update you asked for\. Update from Sonoma County/);
    expect(missed).toMatch(/Questions\? Call \(804\) 606-6867\. Reply STOP to stop texts\. In danger\? Call 911\.$/);
    const long = fitText(`${"A very long sentence about the fire. ".repeat(20)}`, t("smsFooter", "en"));
    expect(long.length).toBeLessThanOrEqual(DEFAULTS.smsMaxChars);
    expect(long.endsWith(t("smsFooter", "en"))).toBe(true);
    // A single sentence that does not fit is cut at a word, not dropped.
    const cut = fitText(`Intro. ${"word ".repeat(100)}end.`, t("smsFooter", "en"));
    expect(cut).toMatch(/^Intro\. word word .*…/);
    expect(cut.length).toBeLessThanOrEqual(DEFAULTS.smsMaxChars);
  });

  it("recaps the update and the answers without their attributions", () => {
    expect(answerWithoutAttribution("Ridgeview Community Center takes pets in crates. Sonoma County Fire, 2:10 PM.")).toBe("Ridgeview Community Center takes pets in crates.");
    expect(answerWithoutAttribution("The fire is 10% contained. Also reported by CAL FIRE. Sonoma County Fire, yesterday.")).toBe("The fire is 10% contained.");
    expect(answerWithoutAttribution("Zones SON-3A and SON-3B. Fuente: Bomberos de Sonoma, 2:10 p. m.")).toBe("Zones SON-3A and SON-3B.");
    // A one-sentence reply is kept, whatever it says.
    expect(answerWithoutAttribution("Evacuation is ordered as of 6:20 PM.")).toBe("Evacuation is ordered as of 6:20 PM.");

    const recap = buildRecapText("Evacuation Order for zone SON-3A.", ["Ridgeview Community Center takes pets in crates. Sonoma County Fire, 2:10 PM."], "en");
    expect(recap).toBe(`Soterra recap: Evacuation Order for zone SON-3A. On the call: Ridgeview Community Center takes pets in crates. ${t("smsFooter", "en")}`);
    const crowded = buildRecapText(UPDATE, ["One answer that is fairly long and goes on. Source, 2:10 PM.", "Another answer that is also long and detailed. Source, 2:15 PM."], "en", "+18046066867");
    expect(crowded.length).toBeLessThanOrEqual(DEFAULTS.smsMaxChars);
    expect(crowded).toMatch(/^Soterra recap: Update from/);
  });

  it("confirms what was set up, in the caller's language", () => {
    const en = buildConfirmationText(
      [{ channel: "sms", topic: "Ridgeview Fire" }, { channel: "phone_call", intervalMs: 2 * HOUR, topic: "Sonoma County" }],
      "October 25 at 3:00 PM Pacific",
      "en",
    );
    expect(en).toBe(
      `Soterra: you'll get texts about Ridgeview Fire when officials post updates; and a call every 2 hours about Sonoma County, until October 25 at 3:00 PM Pacific. ${t("smsFooter", "en")}`,
    );
    expect(buildConfirmationText([{ channel: "phone_call", topic: "Ridgeview Fire" }], "x", "en")).toMatch(/a text if you miss one/);
    expect(buildConfirmationText([{ channel: "sms", intervalMs: HOUR, topic: "Ridgeview Fire" }], "25 de octubre", "es")).toMatch(/^Soterra: recibirá un mensaje cada hora sobre Ridgeview Fire, hasta 25 de octubre\. Responda STOP/);
  });

  it("names topics for texts", () => {
    expect(incidentLabel("ridgeview-fire-demo")).toBe("Ridgeview Fire");
    expect(incidentLabel("2026-ca-quake")).toBe("2026 Ca Quake");
    expect(textTopic({ kind: "area", area: { label: "Sonoma County" } }, "en")).toBe("Sonoma County");
    expect(textTopic({ kind: "question" }, "es")).toBe("su pregunta");
    expect(formatPhoneForText("+447700900000")).toBe("+447700900000");
  });

  it("builds scheduled updates: something new, nothing new, nothing at all", () => {
    const latest = { sourceName: "Sonoma County Fire (Demo)", title: "Ridgeview Fire grows to 1,200 acres.", body: "The fire is 10% contained.", issuedAt: Date.UTC(2026, 9, 24, 21, 10), primaryState: "CA" };
    const before = Date.UTC(2026, 9, 24, 20, 0);
    const after = Date.UTC(2026, 9, 24, 22, 0);
    expect(buildScheduledMessage({ topic: "Ridgeview Fire", latest, since: before, intervalMs: 2 * HOUR }, "en")).toMatch(/^Update from Sonoma County Fire \(Demo\), October 24 at 2:10 PM Pacific: Ridgeview Fire grows to 1,200 acres\. The fire is 10% contained\.$/);
    expect(buildScheduledMessage({ topic: "Ridgeview Fire", latest, since: after, intervalMs: 2 * HOUR }, "en")).toBe(
      "No new official updates about Ridgeview Fire since October 24 at 3:00 PM Pacific. Latest from Sonoma County Fire (Demo), October 24 at 2:10 PM Pacific: Ridgeview Fire grows to 1,200 acres.",
    );
    expect(buildScheduledMessage({ topic: "Sonoma County", since: after, intervalMs: HOUR }, "en")).toBe("There are no official updates about Sonoma County right now. I'll check again in an hour.");
    expect(buildScheduledMessage({ topic: "Sonoma", since: after, intervalMs: 3 * HOUR }, "es")).toBe("No hay actualizaciones oficiales sobre Sonoma en este momento. Volveré a revisar en 3 horas.");
  });
});

describe("Twilio adapter", () => {
  const cfg = loadConfig({ SMS_NOTIFIER: "twilio", TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "secret", TWILIO_FROM_NUMBER: "+18045550100" });

  it("builds the documented form body: To, From or MessagingServiceSid, Body, StatusCallback", () => {
    expect(messagesUrl("AC123")).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect(Object.fromEntries(smsRequestBody(cfg, { to: "+17075550123", body: "hi", statusCallback: "https://x.convex.site/twilio/status" }))).toEqual({
      To: "+17075550123",
      Body: "hi",
      From: "+18045550100",
      StatusCallback: "https://x.convex.site/twilio/status",
    });
    const viaService = loadConfig({ SMS_NOTIFIER: "twilio", TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "secret", TWILIO_FROM_NUMBER: "+18045550100", TWILIO_MESSAGING_SERVICE_SID: "MG1" });
    expect(Object.fromEntries(smsRequestBody(viaService, { to: "+1", body: "b" }))).toEqual({ To: "+1", Body: "b", MessagingServiceSid: "MG1" });
  });

  it("sends with Basic auth and returns the message sid; errors carry Twilio's code", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const ok = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ sid: "SM1", status: "queued" }), { status: 201 });
    }) as unknown as typeof fetch;
    expect(await sendSms(cfg, ok, { to: "+17075550123", body: "hello" })).toEqual({ sid: "SM1" });
    expect(seen[0].url).toBe(messagesUrl("AC123"));
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa("AC123:secret")}`);
    expect(seen[0].init.body).toBe("To=%2B17075550123&Body=hello&From=%2B18045550100");

    const landline = (async () => new Response(JSON.stringify({ code: 21614, message: "'To' number is not a valid mobile number" }), { status: 400 })) as unknown as typeof fetch;
    expect(await sendSms(cfg, landline, { to: "+17075550123", body: "x" })).toEqual({ error: "HTTP 400 code 21614: 'To' number is not a valid mobile number", code: "21614" });
    expect(await new TwilioSmsNotifier(cfg, landline).send({ recipientPhone: "+17075550123", channel: "sms", language: "en", message: "x", bulletinRefs: [], dedupeKey: "k" })).toEqual({
      status: "failed",
      error: "HTTP 400 code 21614: 'To' number is not a valid mobile number",
    });
    await expect(sendSms(loadConfig({ SMS_NOTIFIER: "twilio" }), ok, { to: "+1", body: "x" })).rejects.toThrow(/TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER/);
  });

  it("computes X-Twilio-Signature like Twilio (HMAC-SHA1 of URL + sorted params) and rejects tampering", async () => {
    const url = "https://example.convex.site/twilio/status";
    const params = { MessageStatus: "delivered", MessageSid: "SM1", AccountSid: "AC123" };
    const reference = createHmac("sha1", "secret").update(`${url}AccountSidAC123MessageSidSM1MessageStatusdelivered`).digest("base64");
    expect(await twilioSignature("secret", url, params)).toBe(reference);
    expect(await verifyTwilioSignature("secret", reference, ["http://internal/twilio/status", url], params)).toBe(true);
    expect(await verifyTwilioSignature("secret", reference, [url], { ...params, MessageStatus: "failed" })).toBe(false);
    expect(await verifyTwilioSignature("other", reference, [url], params)).toBe(false);
    expect(await verifyTwilioSignature("secret", null, [url], params)).toBe(false);
  });

  it("recognises opt-out replies", () => {
    for (const b of ["STOP", "stop", " Unsubscribe ", "PARAR", "cancel."]) expect(isOptOutText(b), b).toBe(true);
    for (const b of ["stop sending me fire updates please", "thanks", "START"]) expect(isOptOutText(b), b).toBe(false);
  });

  it("selects mock texts by default, Twilio only when asked, nothing when unconfigured", async () => {
    expect(selectNotifier(loadConfig({}), "sms", fetch)).toBeInstanceOf(MockSmsNotifier);
    expect(selectNotifier(cfg, "sms", fetch)).toBeInstanceOf(TwilioSmsNotifier);
    expect(selectNotifier(loadConfig({ SMS_NOTIFIER: "unconfigured" }), "sms", fetch)).toBeInstanceOf(UnconfiguredSmsNotifier);
    expect(await new MockSmsNotifier().send({ recipientPhone: "+1", channel: "sms", language: "en", message: "m", bulletinRefs: [], dedupeKey: "k" })).toEqual({ status: "mock", providerRef: "mock-sms:k" });
  });
});
