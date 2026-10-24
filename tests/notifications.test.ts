// [B] Matcher rules, dedupe keys, rate limits, message templates and the notifiers.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env";
import { NotConfiguredError } from "../src/config/errors";
import { t } from "../src/config/strings";
import { answerDedupeKeyFor, areaOverlaps, dedupeKeyFor, eventMatches, rateLimited, type MatchableEvent, type MatchableSubscription } from "../src/notifications/match";
import { buildAnswerMessage, buildUpdateMessage } from "../src/notifications/message";
import { CartesiaOutboundCallNotifier, MockPhoneNotifier, UnconfiguredSmsNotifier, selectNotifier } from "../src/notifications/notifier";
import { CARTESIA_API_URL, outboundCallBody } from "../src/providers/cartesia/outbound";
import { NOW } from "./helpers";

const sub = (over: Partial<MatchableSubscription> = {}): MatchableSubscription => ({
  target: { kind: "incident", incidentKey: "ridgeview-fire-demo" },
  trigger: "any_update",
  status: "active",
  expiresAt: NOW + 3_600_000,
  ...over,
});
const event = (over: Partial<MatchableEvent> = {}): MatchableEvent => ({
  change: "updated",
  incidentKey: "ridgeview-fire-demo",
  severityBefore: "severe",
  severityAfter: "extreme",
  hazardType: "evacuation",
  areas: [{ state: "CA", countyFips: "06097" }],
  ...over,
});

describe("matcher", () => {
  it("matches incident targets by key", () => {
    expect(eventMatches(sub(), event(), NOW)).toBe(true);
    expect(eventMatches(sub(), event({ incidentKey: "other" }), NOW)).toBe(false);
  });

  it("matches area targets by county, zone or state overlap", () => {
    const area = (a: object) => sub({ target: { kind: "area", area: { state: "CA", label: "x", ...a } } });
    expect(eventMatches(area({ countyFips: "06097" }), event(), NOW)).toBe(true);
    expect(eventMatches(area({ countyFips: "06001" }), event(), NOW)).toBe(false);
    expect(eventMatches(area({}), event(), NOW)).toBe(true);
    expect(areaOverlaps({ state: "CA", nwsZone: "CAZ504" }, [{ state: "CA", nwsZone: "CAZ504" }])).toBe(true);
    expect(areaOverlaps({ state: "OR" }, [{ state: "CA" }])).toBe(false);
  });

  it("applies trigger rules", () => {
    expect(eventMatches(sub({ trigger: "severity_change" }), event(), NOW)).toBe(true);
    expect(eventMatches(sub({ trigger: "severity_change" }), event({ severityAfter: "severe" }), NOW)).toBe(false);
    expect(eventMatches(sub({ trigger: "evacuation_change" }), event(), NOW)).toBe(true);
    expect(eventMatches(sub({ trigger: "evacuation_change" }), event({ hazardType: "wildfire" }), NOW)).toBe(false);
    expect(eventMatches(sub({ trigger: "evacuation_change" }), event({ change: "created" }), NOW)).toBe(false); // incident request
    const area = { kind: "area" as const, area: { state: "CA", label: "California" } };
    expect(eventMatches(sub({ trigger: "evacuation_change", target: area }), event({ change: "created", areas: [{ state: "CA" }] }), NOW)).toBe(true);
    expect(eventMatches(sub({ trigger: "evacuation_change", target: area }), event({ change: "created", hazardType: "flood", areas: [{ state: "CA" }] }), NOW)).toBe(false);
    expect(eventMatches(sub({ trigger: "answer_available" }), event(), NOW)).toBe(false);
  });

  it("never fires for expired, cancelled or question subscriptions", () => {
    expect(eventMatches(sub({ expiresAt: NOW }), event(), NOW)).toBe(false);
    expect(eventMatches(sub({ status: "cancelled" }), event(), NOW)).toBe(false);
    expect(eventMatches(sub({ target: { kind: "question", unansweredQuestionId: "q" } }), event(), NOW)).toBe(false);
  });
});

describe("dedupe keys and rate limits", () => {
  it("one key per subscription and bulletin version", () => {
    expect(dedupeKeyFor("s1", "b1", 2)).toBe("s1:b1:v2");
    expect(dedupeKeyFor("s1", "b1", 3)).not.toBe(dedupeKeyFor("s1", "b1", 2));
    expect(answerDedupeKeyFor("s1", "q1")).toBe("s1:question:q1");
  });

  it("allows one per 15 minutes and four per hour", () => {
    expect(rateLimited([], NOW)).toBe(false);
    expect(rateLimited([NOW - 14 * 60_000], NOW)).toBe("min_interval");
    expect(rateLimited([NOW - 16 * 60_000], NOW)).toBe(false);
    const four = [16, 31, 46, 59].map((m) => NOW - m * 60_000);
    expect(rateLimited(four, NOW)).toBe("hourly_cap");
    expect(rateLimited(four.slice(1), NOW)).toBe(false);
  });
});

describe("messages", () => {
  const bulletin = {
    sourceName: "Sonoma County Emergency Management (Demo)",
    title: "Evacuation Order for zone SON-3A, Ridgeview Fire",
    body: "An Evacuation Order is now in effect for zone SON-3A near the Ridgeview Fire. People in zone SON-3A must leave now.",
    issuedAt: 1792874700000,
    updatedAt: 1792891200000,
    primaryState: "CA",
  };

  it("builds a speakable update from bulletin fields in English and Spanish", () => {
    expect(buildUpdateMessage(bulletin, "en")).toBe(
      "Update from Sonoma County Emergency Management (Demo), October 24 at 6:20 PM Pacific: Evacuation Order for zone SON-3A, Ridgeview Fire. An Evacuation Order is now in effect for zone SON-3A near the Ridgeview Fire.",
    );
    expect(buildUpdateMessage(bulletin, "es")).toMatch(/^Actualización de Sonoma County Emergency Management \(Demo\), 24 de octubre/);
  });

  it("skips a disclaimer-only first sentence", () => {
    expect(buildUpdateMessage({ ...bulletin, body: "This is fictional demo data. Zone SON-3A must leave." }, "en")).toMatch(/Zone SON-3A must leave\.$/);
  });

  it("builds an answer message with source and time", () => {
    const m = buildAnswerMessage({ question: "Is Hillcrest Elementary a shelter?", answer: "Hillcrest Elementary opened as a shelter at 5 PM", sourceName: "County (Demo)", answeredAt: 1792891200000, state: "CA" }, "en");
    expect(m).toBe('Update on your question, "Is Hillcrest Elementary a shelter?": Hillcrest Elementary opened as a shelter at 5 PM. That\'s from County (Demo), October 24 at 6:20 PM Pacific.');
  });
});

describe("notifiers", () => {
  const request = { recipientPhone: "+17075550123", channel: "phone_call" as const, language: "en", message: "m", bulletinRefs: [], dedupeKey: "k", notificationId: "n1" };

  it("selects mock by default, Cartesia only when asked, SMS always unconfigured", async () => {
    expect(selectNotifier(loadConfig({}), "phone_call", fetch)).toBeInstanceOf(MockPhoneNotifier);
    expect(selectNotifier(loadConfig({ PHONE_NOTIFIER: "cartesia" }), "phone_call", fetch)).toBeInstanceOf(CartesiaOutboundCallNotifier);
    expect(await new UnconfiguredSmsNotifier().send()).toEqual({ status: "unconfigured", error: "No SMS provider is configured" });
    expect(await new MockPhoneNotifier().send(request)).toEqual({ status: "mock", providerRef: "mock:k" });
  });

  it("Cartesia: request shape verified against the live API, notification_id in dynamic_variables and metadata", async () => {
    const cfg = loadConfig({ PHONE_NOTIFIER: "cartesia", CARTESIA_API_KEY: "test-key", CARTESIA_AGENT_ID: "agent_1", CARTESIA_FROM_NUMBER_ID: "num_1" });
    expect(outboundCallBody(cfg, { toNumber: "+17075550123", notificationId: "n1", language: "es" })).toMatchObject({
      from_number_id: "num_1",
      agent_id: "agent_1",
      outbound_calls: [{ to_number: "+17075550123", dynamic_variables: { notification_id: "n1", language: "es" } }],
    });
    const seen: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ calls: [{ number: "+17075550123", agent_call_id: "ac_1" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await new CartesiaOutboundCallNotifier(cfg, fakeFetch).send(request)).toEqual({ status: "queued", providerRef: "ac_1" });
    expect(seen[0].url).toBe(CARTESIA_API_URL);
    expect((seen[0].init.headers as Record<string, string>)["Cartesia-Version"]).toBe("2026-08-14");
    const failing = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    expect((await new CartesiaOutboundCallNotifier(cfg, failing).send(request)).status).toBe("failed");
  });

  it("Cartesia: missing credentials are a typed NotConfiguredError, and a call needs a notificationId", async () => {
    const notifier = new CartesiaOutboundCallNotifier(loadConfig({ PHONE_NOTIFIER: "cartesia" }), fetch);
    await expect(notifier.send(request)).rejects.toBeInstanceOf(NotConfiguredError);
    expect((await notifier.send({ ...request, notificationId: undefined })).status).toBe("failed");
  });

  it("the outbound greeting's stop instruction is canonical", () => {
    expect(t("stopUpdates", "en")).toMatch(/stop updates/);
  });
});
