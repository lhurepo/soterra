// [I] The ingestion pipeline in Convex (no network): source runs, NWS lineage, cancellations, the Apify
// webhook, mock-site escalation, X routing and signal bursts, crisis mode, isolation of failures,
// expiry, raw payload retention, and the handoff to the backend's retrieval.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CRISIS_DURATION_MS } from "../../src/ingestion/crisis";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newTest, setupEnv, type TestConvex } from "../test.setup";

const SECRET = "test-apify-secret";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T02:00:00Z"));
  setupEnv({ APIFY_WEBHOOK_SECRET: SECRET, SERVE_FIXTURES: "true" });
});
afterEach(() => vi.useRealTimers());

async function setup(): Promise<TestConvex> {
  const t = newTest();
  await t.mutation(internal.sources.syncRegistry, {});
  return t;
}

async function run(t: TestConvex, sourceId: string, mode?: "fixture" | "live") {
  const result = await t.action(internal.ingestion.runSource, { sourceId, trigger: "manual", modeOverride: mode });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return result;
}

const bulletins = (t: TestConvex) => t.run(async (ctx) => await ctx.db.query("bulletins").collect());
const events = (t: TestConvex) => t.run(async (ctx) => await ctx.db.query("bulletinEvents").collect());

describe("direct sources in fixture mode", () => {
  it.each(["nws_alerts", "usgs_earthquakes", "openfema_declarations", "nhc_storms", "tsunami_ntwc", "inciweb", "nifc_wfigs"])(
    "%s runs end to end and records its outcome",
    async (sourceId) => {
      const t = await setup();
      const result = await run(t, sourceId);
      expect(result.status).toBe("succeeded");
      const [runRow] = await t.query(internal.ingestionRuns.recentRuns, { sourceId });
      expect(runRow).toMatchObject({ status: "succeeded", mode: "fixture" });
      const stored = await bulletins(t);
      expect(stored.length).toBeGreaterThan(0);
      expect(stored.every((b) => b.isFixture && b.sourceName.endsWith("(Demo)"))).toBe(true);
      const source = await t.query(internal.sources.getBySourceId, { sourceId });
      expect(source).toMatchObject({ lastOutcome: "succeeded", consecutiveFailures: 0 });
      expect(source?.nextDueAt).toBeGreaterThan(Date.now());
    },
  );

  it("NWS: an Update stays one bulletin with versions; a Cancel deactivates and emits cancelled; Test is stored inactive", async () => {
    const t = await setup();
    const result = await run(t, "nws_alerts");
    expect(result.counts).toMatchObject({ fetched: 1, created: 3, updated: 1, cancelled: 1 });
    const stored = await bulletins(t);
    expect(stored).toHaveLength(3);
    const rfw = stored.find((b) => b.hazardType === "wildfire")!;
    expect(rfw).toMatchObject({ latestVersion: 2, severity: "extreme", isActive: true, externalId: "urn:oid:2.49.0.1.840.0.demo-rfw-a.001.1" });
    const flood = stored.find((b) => b.hazardType === "flood")!;
    expect(flood).toMatchObject({ status: "cancelled", isActive: false });
    const test = stored.find((b) => b.status === "test")!;
    expect(test.isActive).toBe(false);

    const all = await events(t);
    expect(all.filter((e) => e.bulletinId === rfw._id).map((e) => [e.change, e.severityBefore, e.severityAfter])).toEqual([
      ["created", undefined, "severe"],
      ["updated", "severe", "extreme"],
    ]);
    expect(all.filter((e) => e.bulletinId === flood._id).map((e) => e.change)).toEqual(["created", "cancelled"]);
    await t.run(async (ctx) => {
      for (const id of [flood._id, test._id]) {
        expect(await ctx.db.query("chunks").withIndex("by_bulletinId", (q) => q.eq("bulletinId", id)).collect()).toEqual([]);
      }
      const chunks = await ctx.db.query("chunks").withIndex("by_bulletinId", (q) => q.eq("bulletinId", rfw._id)).collect();
      expect(chunks.every((c) => c.versionNumber === 2)).toBe(true);
      expect(chunks[0].text).toMatch(/^Red Flag Warning issued October 24 .* — National Weather Service \(NWS San Francisco CA\) \(Demo\) — /);
      const areas = await ctx.db.query("bulletinAreas").withIndex("by_bulletinId", (q) => q.eq("bulletinId", rfw._id)).collect();
      expect(areas.map((a) => a.nwsZone ?? a.countyFips)).toEqual(["CAZ504", "CAZ505", "06097", "06055"]);
    });
  });

  it("re-ingesting identical content is unchanged and emits no event", async () => {
    const t = await setup();
    await run(t, "usgs_earthquakes");
    const before = (await events(t)).length;
    const again = await run(t, "usgs_earthquakes");
    expect(again.counts).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect((await events(t)).length).toBe(before);
  });

  it("stores the raw payload with a TTL and purges it later", async () => {
    const t = await setup();
    await run(t, "nhc_storms");
    const payloads = await t.run(async (ctx) => await ctx.db.query("rawPayloads").collect());
    expect(payloads).toHaveLength(1);
    vi.setSystemTime(Date.now() + 25 * 3_600_000);
    expect(await t.mutation(internal.ingestion.purgeRawPayloads, {})).toBe(1);
    expect(await t.run(async (ctx) => await ctx.db.query("rawPayloads").collect())).toEqual([]);
  });
});

describe("Apify", () => {
  it("MockApify runs: start → simulated webhook → dataset → bulletins", async () => {
    const t = await setup();
    const started = await run(t, "mock_shelters");
    expect(started.status).toBe("awaiting_apify");
    const [runRow] = await t.query(internal.ingestionRuns.recentRuns, { sourceId: "mock_shelters" });
    expect(runRow).toMatchObject({ status: "succeeded", apifyEventType: "ACTOR.RUN.SUCCEEDED", apifyDatasetId: "mock:mock_shelters:v1" });
    const shelters = (await bulletins(t)).filter((b) => b.hazardType === "shelter");
    expect(shelters.map((b) => b.title)).toEqual(["Shelter: Ridgeview Community Center (Open)", "Shelter: Santa Rosa Veterans Building (Open)"]);
    expect(shelters.every((b) => b.isFixture && b.trustTier === "official" && b.timeBasis === "page_updated")).toBe(true);
  });

  async function pendingRun(t: TestConvex): Promise<Id<"ingestionRuns">> {
    const runId = await t.mutation(internal.ingestionRuns.createRun, { sourceId: "mock_shelters", trigger: "manual", mode: "fixture" });
    await t.mutation(internal.ingestionRuns.markAwaitingApify, { runId, apifyRunId: "apify-run-1", apifyDatasetId: "mock:mock_shelters:v1" });
    return runId;
  }

  const webhook = (t: TestConvex, body: unknown, secret: string | null) =>
    t.fetch("/ingest/apify", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(secret ? { "X-Soterra-Webhook-Secret": secret } : {}) },
      body: JSON.stringify(body),
    });

  const payload = (runId: string, eventType = "ACTOR.RUN.SUCCEEDED") => ({
    eventType,
    eventData: { actorId: "apify~cheerio-scraper", actorRunId: "apify-run-1" },
    resource: { id: "apify-run-1", defaultDatasetId: "mock:mock_shelters:v1", status: "SUCCEEDED" },
    soterra: { sourceId: "mock_shelters", runRecordId: runId },
  });

  it("rejects a wrong or missing secret with 401", async () => {
    const t = await setup();
    const runId = await pendingRun(t);
    expect((await webhook(t, payload(runId), "wrong")).status).toBe(401);
    expect((await webhook(t, payload(runId), null)).status).toBe(401);
  });

  it("a valid webhook returns 200 at once, schedules processing once, and ignores duplicates", async () => {
    const t = await setup();
    const runId = await pendingRun(t);
    const res = await webhook(t, payload(runId), SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: "scheduled" });
    expect(await bulletins(t)).toEqual([]); // nothing processed inside the request
    expect(await (await webhook(t, payload(runId), SECRET)).json()).toEqual({ ok: true, result: "duplicate" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await bulletins(t)).length).toBe(2);
    expect(await t.query(internal.ingestionRuns.getRun, { runId })).toMatchObject({ status: "succeeded" });
  });

  it("a failed run records a failed outcome and backs off", async () => {
    const t = await setup();
    const runId = await pendingRun(t);
    expect((await webhook(t, payload(runId, "ACTOR.RUN.TIMED_OUT"), SECRET)).status).toBe(200);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(internal.ingestionRuns.getRun, { runId })).toMatchObject({ status: "failed", error: expect.stringMatching(/TIMED_OUT/) });
    const source = await t.query(internal.sources.getBySourceId, { sourceId: "mock_shelters" });
    expect(source).toMatchObject({ lastOutcome: "failed", consecutiveFailures: 1 });
    expect(source!.nextDueAt! - source!.lastRunAt!).toBe(60 * 60_000); // 30 min × 2, capped at 60
  });

  it("live mode without APIFY_TOKEN fails clearly and records the outcome", async () => {
    setupEnv({ APIFY_WEBHOOK_SECRET: SECRET, ENABLE_MOCK_SITES: "true", CONVEX_SITE_URL: "https://example.convex.site" });
    const t = await setup();
    const result = await run(t, "mock_county_emergency", "live");
    expect(result).toMatchObject({ status: "failed", error: expect.stringMatching(/APIFY_TOKEN/) });
  });
});

describe("mock-site escalation", () => {
  it("v1 → v2 emits an updated event (warning → order) through the full pipeline, and callbacks fire", async () => {
    const t = await setup();
    await run(t, "mock_county_emergency");
    const [county] = (await bulletins(t)).filter((b) => b.sourceId === "mock_county_emergency");
    expect(county).toMatchObject({ severity: "severe", incidentKey: "ridgeview-fire", hazardType: "evacuation" });

    // A caller who asked for a callback on this incident (as convex/subscriptions.ts would create it).
    await t.run(async (ctx) => {
      await ctx.db.insert("subscriptions", {
        recipient: { phone: "+17075550123" },
        target: { kind: "incident", incidentKey: "ridgeview-fire" },
        trigger: "evacuation_change",
        channels: ["phone_call"],
        language: "en",
        status: "active",
        consentAt: Date.now(),
        createdVia: "call",
        expiresAt: Date.now() + 86_400_000,
      });
    });

    expect(await t.mutation(internal.mockSites.escalate, {})).toEqual(["mock_county_emergency", "mock_shelters", "mock_disaster_assistance"]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const updated = (await events(t)).filter((e) => e.bulletinId === county._id);
    expect(updated.map((e) => [e.change, e.severityBefore, e.severityAfter])).toEqual([
      ["created", undefined, "severe"],
      ["updated", "severe", "extreme"],
    ]);
    const after = (await bulletins(t)).find((b) => b._id === county._id)!;
    expect(after.body).toMatch(/An Evacuation Order is now in effect for zone SON-3A/);
    const notifications = await t.run(async (ctx) => await ctx.db.query("notifications").collect());
    expect(notifications).toHaveLength(1);
    expect(notifications[0].status).toBe("mock");
    // Shelter capacity changed too.
    const shelter = (await bulletins(t)).find((b) => b.title.startsWith("Shelter: Ridgeview"))!;
    expect(shelter.body).toContain("Spaces available: 35.");
    expect(shelter.latestVersion).toBe(1); // first ingested in v2 here; never scraped in v1 in this test
  });

  it("serves the active variant at /mock-sites/*", async () => {
    setupEnv({ ENABLE_MOCK_SITES: "true" });
    const t = await setup();
    await t.mutation(internal.dev.seedFixtures, {
      bulletins: [],
      mockSites: [
        { path: "county-emergency.html", variant: "v1", contentType: "text/html", body: "<p>Evacuation Warning</p>" },
        { path: "county-emergency.html", variant: "v2", contentType: "text/html", body: "<p>Evacuation Order</p>" },
      ],
    });
    expect(await (await t.fetch("/mock-sites/county-emergency.html", { method: "GET" })).text()).toContain("Warning");
    await t.mutation(internal.mockSites.setVariant, { variant: "v2" });
    expect(await (await t.fetch("/mock-sites/county-emergency.html", { method: "GET" })).text()).toContain("Order");
  });
});

describe("X and signals", () => {
  it("allowlisted posts become official_social bulletins; others only signals; a burst polls official sources but never enters crisis", async () => {
    setupEnv({ APIFY_WEBHOOK_SECRET: SECRET, SERVE_FIXTURES: "false" });
    vi.setSystemTime(new Date("2026-10-24T21:15:00Z")); // within 30 minutes of the fixture posts
    const t = await setup();
    await t.mutation(internal.sources.setEnabled, { sourceId: "nws_alerts", enabled: true });
    await run(t, "x_posts");

    const stored = await bulletins(t);
    const social = stored.filter((b) => b.sourceId === "x_posts");
    expect(social).toHaveLength(1);
    expect(social[0]).toMatchObject({ trustTier: "official_social", sourceName: "Sonoma County OES (Demo)" });
    const signals = await t.query(internal.signals.recent, {});
    expect(signals).toHaveLength(3);
    await t.run(async (ctx) => {
      const chunks = await ctx.db.query("chunks").collect();
      expect(chunks.some((c) => /IGNORE ALL PREVIOUS/.test(c.text))).toBe(false);
    });
    // The burst scheduled an early NWS poll, and only official data was stored by it.
    const nwsRuns = await t.query(internal.ingestionRuns.recentRuns, { sourceId: "nws_alerts" });
    expect(nwsRuns.map((r) => r.trigger)).toEqual(["signal_burst"]);
    expect(stored.filter((b) => b.sourceId === "nws_alerts").length).toBeGreaterThan(0);
    const state = await t.query(internal.systemState.get, {});
    expect(state?.mode ?? "normal").toBe("normal");
    expect(Math.abs((state?.lastSignalPollAt ?? 0) - Date.now())).toBeLessThan(1_000);
  });
});

describe("crisis mode and the tick", () => {
  const liveSevere = (externalId: string, overrides: Record<string, unknown> = {}) => ({
    sourceId: "nws_alerts",
    sourceName: "National Weather Service",
    externalId,
    url: `https://api.weather.gov/alerts/${externalId}`,
    title: "Extreme Red Flag Warning",
    body: "Critical fire weather.",
    hazardType: "wildfire" as const,
    severity: "extreme" as const,
    status: "actual" as const,
    issuedAt: Date.now() - 60_000,
    areas: [{ state: "CA", label: "Sonoma County" }],
    trustTier: "official" as const,
    language: "en",
    contentHash: externalId,
    isFixture: false,
    ...overrides,
  });

  it("triggers, extends while the trigger is active, reverts after it ends, and the tick uses crisis intervals", async () => {
    const t = await setup();
    await t.mutation(internal.sources.setEnabled, { sourceId: "nws_alerts", enabled: true });
    await t.mutation(internal.ingestion.upsertBulletins, { items: [liveSevere("live-1", { expiresAt: Date.now() + 9 * 3_600_000 })] });
    const entered = (await t.query(internal.systemState.get, {}))!;
    expect(entered.mode).toBe("crisis");
    expect(entered.expiresAt! - entered.since).toBe(CRISIS_DURATION_MS);

    // Tick at crisis interval: NWS (1 min in crisis) runs again 2 minutes later.
    expect(await t.mutation(internal.ingestion.tick, {})).toEqual(["nws_alerts"]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.setSystemTime(Date.now() + 2 * 60_000);
    expect(await t.mutation(internal.ingestion.tick, {})).toEqual(["nws_alerts"]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Still active 5 hours later: the tick extends the window.
    vi.setSystemTime(entered.since + 5 * 3_600_000);
    await t.mutation(internal.ingestion.tick, {});
    const extended = (await t.query(internal.systemState.get, {}))!;
    expect(extended.since).toBe(entered.since);
    expect(Math.abs(extended.expiresAt! - (Date.now() + CRISIS_DURATION_MS))).toBeLessThan(1_000);

    // The trigger expires (no event); after the crisis window it reverts on its own.
    vi.setSystemTime(entered.since + 9.5 * 3_600_000);
    await t.mutation(internal.ingestion.expireBulletins, {});
    await t.mutation(internal.ingestion.tick, {});
    expect((await t.query(internal.systemState.get, {}))!.mode).toBe("crisis");
    vi.setSystemTime(entered.since + 12 * 3_600_000);
    await t.mutation(internal.ingestion.tick, {});
    expect((await t.query(internal.systemState.get, {}))!.mode).toBe("normal");
    const log = await t.query(internal.systemState.recentModeChanges, {});
    expect(log.map((l) => l.mode)).toEqual(["normal", "crisis"]);
  });

  it("one failing source does not stop the others in the same tick", async () => {
    const t = await setup();
    for (const sourceId of ["nws_alerts", "usgs_earthquakes"]) await t.mutation(internal.sources.setEnabled, { sourceId, enabled: true });
    await t.mutation(internal.sources.setMode, { sourceId: "nws_alerts", mode: "live" }); // fails: NWS_USER_AGENT has no contact
    expect((await t.mutation(internal.ingestion.tick, {})).sort()).toEqual(["nws_alerts", "usgs_earthquakes"]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const status = await t.query(internal.ingestionRuns.sourceStatus, {});
    expect(status.find((s) => s.sourceId === "nws_alerts")).toMatchObject({ lastOutcome: "failed", consecutiveFailures: 1 });
    expect(status.find((s) => s.sourceId === "usgs_earthquakes")).toMatchObject({ lastOutcome: "succeeded" });
    // Not due again until the backoff passes.
    expect(await t.mutation(internal.ingestion.tick, {})).toEqual([]);
  });

  it("expiry flips isActive at expiresAt without an event", async () => {
    const t = await setup();
    await t.mutation(internal.ingestion.upsertBulletins, { items: [liveSevere("exp-1", { severity: "minor", title: "Wind Advisory", expiresAt: Date.now() + 60_000 })] });
    const before = (await events(t)).length;
    vi.setSystemTime(Date.now() + 2 * 60_000);
    expect(await t.mutation(internal.ingestion.expireBulletins, {})).toBe(1);
    expect((await bulletins(t))[0].isActive).toBe(false);
    expect((await events(t)).length).toBe(before);
  });
});

describe("handoff to the backend's retrieval", () => {
  it("finds the ingested shelter chunk by area and by text, and honours isFixture filtering", async () => {
    const t = await setup();
    await run(t, "mock_shelters");
    const sonoma = { state: "CA", county: "Sonoma", countyFips: "06097", label: "Sonoma County" };
    const byArea = await t.query(internal.retrieval.search, { text: "where can I go", area: sonoma, topK: 5, now: Date.now(), serveFixtures: true });
    expect(byArea.some((c) => c.text.includes("Ridgeview Community Center"))).toBe(true);
    const byText = await t.query(internal.retrieval.search, { text: "shelter that takes pets", topK: 5, now: Date.now(), serveFixtures: true });
    const ridgeview = byText.find((c) => /Pets: Pets in crates/.test(c.text));
    expect(ridgeview?.sourceName).toBe("Sonoma County Emergency Management (Demo)");
    const hidden = await t.query(internal.retrieval.search, { text: "shelter that takes pets", area: sonoma, topK: 5, now: Date.now(), serveFixtures: false });
    expect(hidden).toEqual([]);
  });
});
