// [S] The demo switch: start serves calm pages and turns real sources off, escalate switches to the earthquake,
// stop resets fictional data only, and a second start begins from the beginning. (The live Apify crawls are not run.)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeBulletin } from "../../src/ingestion/normalize";
import type { NormalizedBulletinDraft } from "../../src/contracts";
import { internal } from "../_generated/api";
import { newTest, setupEnv, type TestConvex } from "../test.setup";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-24T22:40:00Z"));
  setupEnv({ ENABLE_MOCK_SITES: "true" });
});
afterEach(() => vi.useRealTimers());

const draft = (over: Partial<NormalizedBulletinDraft>): NormalizedBulletinDraft => ({
  sourceId: "nws_alerts",
  sourceName: "National Weather Service",
  externalId: "real-1",
  url: "https://api.weather.gov/alerts/real-1",
  title: "Dense Fog Advisory",
  body: "Dense fog expected along the coast.",
  hazardType: "other",
  severity: "minor",
  status: "actual",
  issuedAt: Date.parse("2026-10-24T21:00:00Z"),
  areas: [{ state: "CA", label: "Coastal California" }],
  trustTier: "official",
  language: "en",
  isFixture: false,
  timeBasis: "issued",
  ...over,
});

const page = async (t: TestConvex, path: string) => (await t.fetch(`/mock-sites/${path}`, { method: "GET" })).text();

describe("demo button (HTTP)", () => {
  it("needs DEMO_SECRET, then starts, reports and stops", async () => {
    setupEnv({ ENABLE_MOCK_SITES: "true", DEMO_SECRET: "demo-test-secret" });
    const t = newTest();
    const call = (path: string, method: string, secret?: string, body?: unknown) =>
      t.fetch(path, { method, headers: { ...(secret ? { Authorization: `Bearer ${secret}` } : {}), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    expect((await call("/demo/start", "POST")).status).toBe(401);
    expect((await call("/demo/start", "POST", "wrong")).status).toBe(401);
    expect((await call("/demo/start", "POST", "demo-test-secret", { delayMs: -1 })).status).toBe(400);
    const started = await (await call("/demo/start", "POST", "demo-test-secret", { delayMs: 3_000 })).json();
    expect(started.on).toBe(true);
    expect(started.escalateAt - started.startedAt).toBe(3_000);
    expect(await (await call("/demo/status", "GET", "demo-test-secret")).json()).toMatchObject({ on: true });
    expect(await (await call("/demo/stop", "POST", "demo-test-secret")).json()).toMatchObject({ on: false });
  });

  it("is closed when DEMO_SECRET is not set", async () => {
    const t = newTest();
    expect((await t.fetch("/demo/status", { method: "GET", headers: { Authorization: "Bearer anything" } })).status).toBe(401);
  });
});

describe("demo switch", () => {
  it("start → calm pages, escalate → earthquake pages, stop → clean, start again from the beginning", async () => {
    const t = newTest();
    await t.mutation(internal.sources.syncRegistry, {});
    await t.mutation(internal.sources.setEnabled, { sourceId: "nws_alerts", enabled: true });
    await t.mutation(internal.ingestion.upsertBulletins, { items: [finalizeBulletin(draft({}))] });

    const first = await t.mutation(internal.demo.start, {});
    expect(first.on).toBe(true);
    expect(first.escalateAt! - first.startedAt!).toBe(5_000);
    expect(await page(t, "sf/alertsf.html")).toContain("There are no active emergency alerts");
    expect((await t.query(internal.sources.getBySourceId, { sourceId: "nws_alerts" }))?.enabled).toBe(false);
    // The real bulletin is kept but out of service (no chunks): only the demo is served.
    const real = await t.run(async (ctx) => {
      const b = (await ctx.db.query("bulletins").take(5)).find((x) => x.externalId === "real-1")!;
      return { isActive: b.isActive, chunks: (await ctx.db.query("chunks").withIndex("by_bulletinId", (q) => q.eq("bulletinId", b._id)).take(5)).length };
    });
    expect(real).toEqual({ isActive: false, chunks: 0 });

    await t.mutation(internal.demo.escalate, { runId: first.runId! });
    expect(await page(t, "sf/alertsf.html")).toContain("Evacuation Order");
    expect(await page(t, "sf/x-feed.html")).toContain("robot dog");

    // A crawl result lands (as the pipeline would write it), plus a demo caller's subscription.
    await t.mutation(internal.ingestion.upsertBulletins, {
      items: [finalizeBulletin(draft({ sourceId: "sfdemo_alerts", externalId: "alerts", title: "Marina Earthquake: Evacuation Order", isFixture: true }))],
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("subscriptions", {
        recipient: { phone: "+14155550123" },
        target: { kind: "area", area: { state: "CA", countyFips: "06075", label: "San Francisco" } },
        trigger: "any_update",
        channels: ["phone_call"],
        language: "en",
        status: "active",
        consentAt: Date.now(),
        createdVia: "call",
        expiresAt: Date.now() + 86_400_000,
      });
    });

    await t.mutation(internal.demo.stop, {});
    expect(await page(t, "sf/alertsf.html")).toContain("There are no active emergency alerts");
    const after = await t.run(async (ctx) => ({
      bulletins: (await ctx.db.query("bulletins").take(50)).map((b) => b.externalId),
      subs: (await ctx.db.query("subscriptions").take(10)).map((s) => s.status),
    }));
    expect(after.bulletins).toEqual(["real-1"]);
    expect(after.subs).toEqual(["cancelled"]);
    expect((await t.query(internal.demo.getStatus, {})).on).toBe(false);

    // A stale escalation from the stopped run does nothing; a new start begins calm again.
    await t.mutation(internal.demo.escalate, { runId: first.runId! });
    expect(await page(t, "sf/alertsf.html")).toContain("There are no active emergency alerts");
    const second = await t.mutation(internal.demo.start, {});
    expect(second.runId).not.toBe(first.runId);
    expect(await t.mutation(internal.demo.crawlWave, { runId: first.runId!, wave: 1 })).toEqual([]);
  });
});
