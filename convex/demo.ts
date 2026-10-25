// [S] The Marina Earthquake demo workflow (demo/scenario.ts). One switch:
//   start → clean slate, every real source switched off, the 13 mock sites written and serving their calm "before"
//           pages; after `delayMs` (default 5 s) the pages switch to "after" and real Apify actors crawl them
//           (wave 1 at once, wave 2 a few seconds later). Callbacks go out through the normal pipeline.
//   stop  → pages back to "before", demo data deleted, demo subscriptions cancelled. Start again = from the beginning.
// Outside the demo, `takeOffline` keeps the deployment quiet: no source polls and only demo data is ever served.
// The button: POST /demo/start, POST /demo/stop, GET /demo/status with `Authorization: Bearer <DEMO_SECRET>`.
// Scripts: npm run demo:start | demo:stop | demo:status | demo:offline.
import { v } from "convex/values";
import { DEMO_POST_IDS, DEMO_SITES, DEMO_SOURCE_IDS, demoTimes } from "../demo/scenario";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { deleteDerivedRows } from "./ingestion";
import { config, errorResponse, json, requireBearer } from "./lib/http";
import { writeVariant } from "./mockSites";

const RUN_KEY = "demoRun";
const DEFAULT_DELAY_MS = 5_000;
const WAVE_GAP_MS = 8_000;
/** Older fictional data (the Sonoma "Ridgeview Fire" fixtures): removed so it never mixes with the demo. */
const LEGACY_FIXTURE_SOURCES = ["demo_county", "demo_fire", "demo_nws", "demo_caltrans", "mock_county_emergency", "mock_shelters", "mock_disaster_assistance", "x_posts"];

type Run = { runId: string; seq?: number; on: boolean; startedAt: number; escalateAt: number };

async function readRun(ctx: QueryCtx): Promise<Run | null> {
  const row = await ctx.db.query("devSettings").withIndex("by_key", (q) => q.eq("key", RUN_KEY)).unique();
  return row ? (JSON.parse(row.value) as Run) : null;
}

async function writeRun(ctx: MutationCtx, run: Run): Promise<void> {
  const row = await ctx.db.query("devSettings").withIndex("by_key", (q) => q.eq("key", RUN_KEY)).unique();
  if (row) await ctx.db.patch("devSettings", row._id, { value: JSON.stringify(run) });
  else await ctx.db.insert("devSettings", { key: RUN_KEY, value: JSON.stringify(run) });
}

const status = v.object({ on: v.boolean(), runId: v.optional(v.string()), startedAt: v.optional(v.number()), escalateAt: v.optional(v.number()) });

/** For the button: is the demo running, and since when. */
export const getStatus = internalQuery({
  args: {},
  returns: status,
  handler: async (ctx) => {
    const run = await readRun(ctx);
    return run ? { on: run.on, runId: run.runId, startedAt: run.startedAt, escalateAt: run.escalateAt } : { on: false };
  },
});

export const start = internalMutation({
  args: { delayMs: v.optional(v.number()) },
  returns: status,
  handler: async (ctx, { delayMs }) => {
    const now = Date.now();
    const delay = Math.max(0, delayMs ?? DEFAULT_DELAY_MS);
    const previous = await readRun(ctx);
    await resetDemo(ctx, previous?.startedAt);

    await ctx.runMutation(internal.sources.syncRegistry, {}); // the demo sources need their rows
    await offline(ctx);

    const times = demoTimes(now, delay);
    for (const site of DEMO_SITES) {
      await writePage(ctx, site.path, "v1", site.before(times), now);
      await writePage(ctx, site.path, "v2", site.after(times), now);
    }
    await writeVariant(ctx, "v1");

    const seq = (previous?.seq ?? 0) + 1;
    const run: Run = { runId: `demo-${seq}`, seq, on: true, startedAt: now, escalateAt: now + delay };
    await writeRun(ctx, run);
    await ctx.scheduler.runAfter(delay, internal.demo.escalate, { runId: run.runId });
    return { on: true, runId: run.runId, startedAt: run.startedAt, escalateAt: run.escalateAt };
  },
});

/** Scheduled by start: the pages switch to the earthquake, then the crawls begin. */
export const escalate = internalMutation({
  args: { runId: v.string() },
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    const run = await readRun(ctx);
    if (!run?.on || run.runId !== runId) return null;
    await writeVariant(ctx, "v2");
    await ctx.scheduler.runAfter(0, internal.demo.crawlWave, { runId, wave: 1 });
    await ctx.scheduler.runAfter(WAVE_GAP_MS, internal.demo.crawlWave, { runId, wave: 2 });
    return null;
  },
});

/** Starts one real Apify run per site of the wave (skipped if the demo was stopped or restarted meanwhile). */
export const crawlWave = internalMutation({
  args: { runId: v.string(), wave: v.union(v.literal(1), v.literal(2)) },
  returns: v.array(v.string()),
  handler: async (ctx, { runId, wave }) => {
    const run = await readRun(ctx);
    if (!run?.on || run.runId !== runId) return [];
    const sites = DEMO_SITES.filter((s) => s.wave === wave);
    for (const site of sites) {
      await ctx.scheduler.runAfter(0, internal.ingestion.runSource, { sourceId: site.sourceId, trigger: "escalation", modeOverride: "live" });
    }
    return sites.map((s) => s.sourceId);
  },
});

export const stop = internalMutation({
  args: {},
  returns: status,
  handler: async (ctx) => {
    const run = await readRun(ctx);
    await resetDemo(ctx, run?.startedAt);
    await writeVariant(ctx, "v1");
    if (run) await writeRun(ctx, { ...run, on: false });
    return { on: false, runId: run?.runId, startedAt: run?.startedAt, escalateAt: run?.escalateAt };
  },
});

/**
 * Only the demo, nothing else: every source switched off (the pipeline code and the rows stay; switch one back on with
 * sources:setEnabled) and every active non-demo bulletin, real or fictional, taken out of service the way expiry does it
 * (inactive, chunks and areas removed, no event). Re-enabled sources bring fresh data back on their next run.
 */
async function offline(ctx: MutationCtx): Promise<{ sourcesOff: number; bulletinsOff: number }> {
  let sourcesOff = 0;
  for (const source of await ctx.db.query("sources").take(100)) {
    if (!source.enabled) continue;
    await ctx.db.patch("sources", source._id, { enabled: false });
    sourcesOff++;
  }
  const demo = new Set(DEMO_SOURCE_IDS);
  const removed: Id<"chunks">[] = [];
  let bulletinsOff = 0;
  for (const b of await ctx.db
    .query("bulletins")
    .withIndex("by_isActive_and_expiresAt", (q) => q.eq("isActive", true))
    .take(400)) {
    if (demo.has(b.sourceId)) continue;
    await ctx.db.patch("bulletins", b._id, { isActive: false });
    removed.push(...(await deleteDerivedRows(ctx, b._id)));
    bulletinsOff++;
  }
  if (removed.length > 0) await ctx.scheduler.runAfter(0, internal.ingestion.syncMossRemovals, { chunkIds: removed });
  return { sourcesOff, bulletinsOff };
}

/** npm run demo:offline — switch everything but the demo off now (also part of every start). */
export const takeOffline = internalMutation({
  args: {},
  returns: v.object({ sourcesOff: v.number(), bulletinsOff: v.number() }),
  handler: async (ctx) => {
    await resetDemo(ctx, undefined);
    return await offline(ctx);
  },
});

async function writePage(ctx: MutationCtx, path: string, variant: "v1" | "v2", body: string, now: number): Promise<void> {
  const row = { path, variant, contentType: "text/html; charset=utf-8", body, updatedAt: now };
  const existing = await ctx.db
    .query("mockSites")
    .withIndex("by_path_and_variant", (q) => q.eq("path", path).eq("variant", variant))
    .unique();
  if (existing) await ctx.db.replace("mockSites", existing._id, row);
  else await ctx.db.insert("mockSites", row);
}

/**
 * Clean slate. Deletes only fictional data: every bulletin of the demo sources, fixture bulletins of the older demo
 * sources, the mock feed's signals. Since the previous run started (`since`): cancels the subscriptions created and
 * deletes the update notifications sent, so the next run's callback is not blocked or duplicated. Crisis mode → normal.
 */
async function resetDemo(ctx: MutationCtx, since: number | undefined): Promise<void> {
  for (const sourceId of [...DEMO_SOURCE_IDS, ...LEGACY_FIXTURE_SOURCES]) {
    const rows = await ctx.db
      .query("bulletins")
      .withIndex("by_sourceId_and_externalId", (q) => q.eq("sourceId", sourceId))
      .take(200);
    for (const b of rows) if (b.isFixture) await deleteBulletin(ctx, b._id, b.geometryStorageId);
    for (const a of await ctx.db
      .query("bulletinAliases")
      .withIndex("by_sourceId_and_externalId", (q) => q.eq("sourceId", sourceId))
      .take(200)) {
      const target = await ctx.db.get("bulletins", a.bulletinId);
      if (!target) await ctx.db.delete("bulletinAliases", a._id);
    }
  }
  for (const externalId of DEMO_POST_IDS) {
    for (const s of await ctx.db.query("signals").withIndex("by_externalId", (q) => q.eq("externalId", externalId)).take(5)) {
      if (s.isFixture) await ctx.db.delete("signals", s._id);
    }
  }

  if (since !== undefined) {
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_status_and_expiresAt", (q) => q.eq("status", "active"))
      .take(300);
    for (const s of subs) if (s.consentAt >= since) await ctx.db.patch("subscriptions", s._id, { status: "cancelled", cancelledAt: Date.now() });
    for (const n of await ctx.db.query("notifications").order("desc").take(200)) {
      if (n.createdAt < since) break;
      if (n.purpose !== "verification" && n.purpose !== "app_code") await ctx.db.delete("notifications", n._id);
    }
  }

  const state = await ctx.db.query("systemState").withIndex("by_key", (q) => q.eq("key", "global")).unique();
  if (state && (state.mode !== "normal" || state.lastSignalPollAt !== undefined)) {
    await ctx.db.patch("systemState", state._id, { mode: "normal", reason: "demo reset", since: Date.now(), expiresAt: undefined, triggeredByBulletinId: undefined, lastSignalPollAt: undefined });
  }
}

async function deleteBulletin(ctx: MutationCtx, id: Id<"bulletins">, geometryStorageId: Id<"_storage"> | undefined): Promise<void> {
  for (const c of await ctx.db.query("chunks").withIndex("by_bulletinId", (q) => q.eq("bulletinId", id)).take(100)) await ctx.db.delete("chunks", c._id);
  for (const a of await ctx.db.query("bulletinAreas").withIndex("by_bulletinId", (q) => q.eq("bulletinId", id)).take(100)) await ctx.db.delete("bulletinAreas", a._id);
  for (const e of await ctx.db.query("bulletinEvents").withIndex("by_bulletinId", (q) => q.eq("bulletinId", id)).take(100)) await ctx.db.delete("bulletinEvents", e._id);
  for (const x of await ctx.db.query("bulletinVersions").withIndex("by_bulletinId_and_versionNumber", (q) => q.eq("bulletinId", id)).take(100)) await ctx.db.delete("bulletinVersions", x._id);
  if (geometryStorageId) await ctx.storage.delete(geometryStorageId);
  await ctx.db.delete("bulletins", id);
}

/** Ingestion runs of the demo sources since the current run started (for `npm run demo:status`). */
export const recentRuns = internalQuery({
  args: {},
  handler: async (ctx) => {
    const run = await readRun(ctx);
    if (!run) return [];
    const demo = new Set(DEMO_SOURCE_IDS);
    const rows = await ctx.db.query("ingestionRuns").order("desc").take(100);
    return rows
      .filter((r) => demo.has(r.sourceId) && r.startedAt >= run.startedAt)
      .map((r) => ({
        sourceId: r.sourceId,
        status: r.status,
        seconds: r.finishedAt !== undefined ? Math.round((r.finishedAt - r.startedAt) / 1000) : undefined,
        counts: r.counts,
        error: r.error,
      }));
  },
});

// ───────────────────────── The button (HTTP) ─────────────────────────

function demoAuth(req: Request): Response | null {
  return requireBearer(req, config().DEMO_SECRET, "DEMO_SECRET");
}

/** POST /demo/start  body (optional): {"delayMs": 5000} */
export const demoStartHttp = httpAction(async (ctx, req) => {
  const denied = demoAuth(req);
  if (denied) return denied;
  let delayMs: number | undefined;
  const body: unknown = await req.json().catch(() => null);
  if (body !== null && typeof body === "object" && "delayMs" in body) {
    if (typeof body.delayMs !== "number" || !Number.isFinite(body.delayMs) || body.delayMs < 0 || body.delayMs > 120_000) {
      return errorResponse(400, "bad_request", "delayMs must be a number of milliseconds between 0 and 120000");
    }
    delayMs = body.delayMs;
  }
  return json(await ctx.runMutation(internal.demo.start, { delayMs }));
});

/** POST /demo/stop */
export const demoStopHttp = httpAction(async (ctx, req) => {
  const denied = demoAuth(req);
  if (denied) return denied;
  return json(await ctx.runMutation(internal.demo.stop, {}));
});

/** GET /demo/status */
export const demoStatusHttp = httpAction(async (ctx, req) => {
  const denied = demoAuth(req);
  if (denied) return denied;
  return json(await ctx.runQuery(internal.demo.getStatus, {}));
});
