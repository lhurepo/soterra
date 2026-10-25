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
    expect(await t.mutation(internal.demo.crawlNext, { runId: first.runId! })).toEqual([]);
  });
});

describe("demo crawl queue and late-result gate", () => {
  it("keeps at most 5 Apify runs in flight, refills as runs finish, and drops results from a stopped run", async () => {
    const t = newTest();
    const run = await t.mutation(internal.demo.start, {});
    await t.mutation(internal.demo.escalate, { runId: run.runId! });

    const first = await t.mutation(internal.demo.crawlNext, { runId: run.runId! });
    expect(first).toHaveLength(5);
    expect(await t.mutation(internal.demo.crawlNext, { runId: run.runId! })).toEqual([]);

    // Two finish, one is refused for the concurrency limit (queued again), two still running.
    const now = Date.now() + 1;
    await t.run(async (ctx) => {
      const row = (sourceId: string, status: "succeeded" | "failed" | "awaiting_apify", error?: string) =>
        ctx.db.insert("ingestionRuns", { sourceId, trigger: "escalation", mode: "live", status, startedAt: now, error });
      await row(first[0], "succeeded");
      await row(first[1], "succeeded");
      await row(first[2], "failed", "HTTP 402 concurrent-runs-limit-exceeded");
      await row(first[3], "awaiting_apify");
      await row(first[4], "awaiting_apify");
    });
    const second = await t.mutation(internal.demo.crawlNext, { runId: run.runId! });
    expect(second).toHaveLength(3);
    expect(second).toContain(first[2]);

    expect(await t.query(internal.demo.acceptsResult, { sourceId: first[3], startedAt: now })).toBe(true);
    expect(await t.query(internal.demo.acceptsResult, { sourceId: first[3], startedAt: run.startedAt! - 1 })).toBe(false);
    expect(await t.query(internal.demo.acceptsResult, { sourceId: "nws_alerts", startedAt: 0 })).toBe(true);
    await t.mutation(internal.demo.stop, {});
    expect(await t.query(internal.demo.acceptsResult, { sourceId: first[3], startedAt: now })).toBe(false);
    expect(await t.mutation(internal.demo.crawlNext, { runId: run.runId! })).toEqual([]);
  });
});

describe("demo start keeps a callback asked for before it", () => {
  it("a subscription made after stop survives the next start; one made during the run does not", async () => {
    const t = newTest();
    const sub = (consentAt: number) =>
      t.run(async (ctx) =>
        ctx.db.insert("subscriptions", {
          recipient: { phone: "+14155550123" },
          target: { kind: "area", area: { state: "CA", countyFips: "06075", label: "San Francisco" } },
          trigger: "any_update",
          channels: ["phone_call"],
          language: "en",
          status: "active",
          consentAt,
          createdVia: "call",
          expiresAt: consentAt + 86_400_000,
        }),
      );
    await t.mutation(internal.demo.start, {});
    vi.advanceTimersByTime(1_000);
    const during = await sub(Date.now());
    vi.advanceTimersByTime(1_000);
    await t.mutation(internal.demo.stop, {});
    vi.advanceTimersByTime(1_000);
    const before = await sub(Date.now()); // the caller asks "call me back" while the demo is off
    vi.advanceTimersByTime(1_000);
    await t.mutation(internal.demo.start, {});
    const status = await t.run(async (ctx) => [(await ctx.db.get("subscriptions", during))?.status, (await ctx.db.get("subscriptions", before))?.status]);
    expect(status).toEqual(["cancelled", "active"]);
  });
});

describe("manual demo: wave 1 calm, then wave 1 on the first release, then one wave-2 site per release", () => {
  it("crawls wave 1's calm pages, waits for calm ready, then releases on Enter in queue order", async () => {
    const t = newTest();
    const run = await t.mutation(internal.demo.start, { manual: true });
    expect(run.escalateAt).toBeUndefined();
    expect(await t.mutation(internal.demo.escalate, { runId: run.runId! })).toBeNull(); // auto escalation never applies
    expect(await page(t, "sf/alertsf.html")).toContain("There are no active emergency alerts");
    expect(await t.query(internal.demo.progress, {})).toMatchObject({ stage: "calm", inProgress: { calm: 5, escalation: 0 }, remaining: { escalation: 13 } });

    // As the pipeline would record them: one ingestion run per started site.
    const finish = (sourceIds: string[], status: "succeeded" | "failed" | "awaiting_apify", error?: string) =>
      t.run(async (ctx) => {
        for (const sourceId of sourceIds) {
          await ctx.db.insert("ingestionRuns", { sourceId, trigger: "manual", mode: "live", status, startedAt: Date.now(), error });
        }
      });
    const wave1 = ["sfdemo_alerts", "sfdemo_usgs", "sfdemo_sffd", "sfdemo_shelters", "sfdemo_x"];

    // The calm queue: wave 1 only; a limit refusal is queued again.
    const calm1 = await t.mutation(internal.demo.crawlNext, { runId: run.runId!, phase: "calm" });
    expect(calm1).toEqual(wave1);
    vi.setSystemTime(Date.now() + 1_000);
    await finish(calm1.slice(0, 4), "succeeded");
    await finish([calm1[4]], "failed", "HTTP 402 concurrent-runs-limit-exceeded");
    expect(await t.mutation(internal.demo.crawlNext, { runId: run.runId!, phase: "calm" })).toEqual([calm1[4]]);
    expect(await t.mutation(internal.demo.release, {})).toMatchObject({ ok: false });
    vi.setSystemTime(Date.now() + 1_000);
    await finish([calm1[4]], "succeeded");
    expect(await t.mutation(internal.demo.crawlNext, { runId: run.runId!, phase: "calm" })).toEqual([]);
    expect(await t.query(internal.demo.acceptsResult, { sourceId: "sfdemo_alerts", startedAt: Date.now() })).toBe(true);
    const ready = await t.query(internal.demo.progress, {});
    expect(ready).toMatchObject({ stage: "calm_ready", done: { calm: 5, escalation: 0 }, inProgress: { calm: 0, escalation: 0 }, remaining: { calm: 0, escalation: 13 } });
    expect(ready.calm.map((s) => s.sourceId)).toEqual(wave1);

    // First Enter: the pages switch to the earthquake and wave 1 is crawled again; the wave-2 counts do not move.
    vi.setSystemTime(Date.now() + 60_000);
    expect(await t.mutation(internal.demo.release, {})).toMatchObject({ ok: true, message: expect.stringContaining("wave 1") });
    expect(await page(t, "sf/alertsf.html")).toContain("Evacuation Order");
    expect(await t.query(internal.demo.progress, {})).toMatchObject({ stage: "quake", done: { calm: 5, escalation: 0 }, inProgress: { escalation: 5 }, remaining: { escalation: 8 } });
    expect(await t.mutation(internal.demo.crawlNext, { runId: run.runId!, phase: "calm" })).toEqual([]);
    expect(await t.mutation(internal.demo.crawlNext, { runId: run.runId! })).toEqual(wave1);
    expect(await t.mutation(internal.demo.crawlNext, { runId: run.runId! })).toEqual([]);

    // Next Enter: one wave-2 site. It waits for a slot while wave 1 holds all 5.
    expect(await t.mutation(internal.demo.release, {})).toEqual({ ok: true, message: "Started: Situation Update." });
    expect(await t.query(internal.demo.progress, {})).toMatchObject({ inProgress: { escalation: 6 }, remaining: { escalation: 7 } });
    expect(await t.mutation(internal.demo.crawlNext, { runId: run.runId! })).toEqual([]);
    vi.setSystemTime(Date.now() + 1_000);
    await finish(wave1, "succeeded");
    expect(await t.mutation(internal.demo.crawlNext, { runId: run.runId! })).toEqual(["sfdemo_situation"]);
    vi.setSystemTime(Date.now() + 1_000);
    await finish(["sfdemo_situation"], "succeeded");
    const p = await t.query(internal.demo.progress, {});
    // The panel's example: 11 done (5 calm, 6 escalation), 0 in progress, 7 remaining (7 escalation).
    expect(p).toMatchObject({ done: { calm: 5, escalation: 6 }, inProgress: { calm: 0, escalation: 0 }, remaining: { calm: 0, escalation: 7 } });
    expect(p.calm.every((s) => s.state === "done")).toBe(true); // calm and earthquake runs are counted apart

    // The rest of wave 2, then nothing more to release.
    for (let i = 0; i < 7; i++) expect((await t.mutation(internal.demo.release, {})).ok).toBe(true);
    expect(await t.query(internal.demo.progress, {})).toMatchObject({ done: { escalation: 6 }, inProgress: { escalation: 7 }, remaining: { escalation: 0 } });
    expect(await t.mutation(internal.demo.crawlNext, { runId: run.runId! })).toHaveLength(5);
    expect(await t.mutation(internal.demo.release, {})).toEqual({ ok: false, message: "Every source has been released." });

    await t.mutation(internal.demo.stop, {});
    expect(await t.mutation(internal.demo.release, {})).toMatchObject({ ok: false });
    expect((await t.query(internal.demo.progress, {})).stage).toBe("off");
  });

  it("auto mode is not driven by release", async () => {
    const t = newTest();
    await t.mutation(internal.demo.start, {});
    expect(await t.mutation(internal.demo.release, {})).toEqual({ ok: false, message: "This run crawls on its own (auto mode)." });
  });
});
