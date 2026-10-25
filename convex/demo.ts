// [S] The Marina Earthquake demo workflow (demo/scenario.ts). One switch:
//   start → clean slate, every real source switched off, the 13 mock sites written and serving their calm "before"
//           pages. Two ways to go on:
//           manual (npm run demo:start): real Apify actors crawl the calm pages of wave 1 ("calm ready" when all
//             finished). The first `release` (Enter in the terminal) switches every page to the earthquake, with times
//             from that moment, and crawls wave 1 again; each later release crawls one wave-2 site.
//           auto (the button, demo:start --auto): after `delayMs` (default 5 s) the pages switch to "after" and every
//             site is crawled. Either way at most APIFY_CONCURRENCY runs at a time; the rest start as runs finish.
//           Callbacks go out through the normal pipeline.
//   stop  → pages back to "before", demo data deleted, demo subscriptions cancelled. Start again = from the beginning.
// Outside the demo, `takeOffline` keeps the deployment quiet: no source polls and only demo data is ever served.
// The button: POST /demo/start, POST /demo/stop, GET /demo/status with `Authorization: Bearer <DEMO_SECRET>`.
// Scripts: npm run demo:start | demo:control | demo:stop | demo:status | demo:offline.
import { v } from "convex/values";
import { DEMO_POST_IDS, DEMO_SITES, DEMO_SOURCE_IDS, demoTimes } from "../demo/scenario";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { httpAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { deleteDerivedRows } from "./ingestion";
import { config, errorResponse, json, requireBearer } from "./lib/http";
import { writeVariant } from "./mockSites";

const RUN_KEY = "demoRun";
const DEFAULT_DELAY_MS = 5_000;
/** The Apify plan allows 5 concurrent actor runs; more fail with HTTP 402 concurrent-runs-limit-exceeded. */
const APIFY_CONCURRENCY = 5;
const CRAWL_POLL_MS = 2_000;
const IN_FLIGHT = new Set(["running", "awaiting_apify", "processing"]);
const LIMIT_ERROR = /concurrent-runs-limit-exceeded/;
/** Older fictional data (the Sonoma "Ridgeview Fire" fixtures): removed so it never mixes with the demo. */
const LEGACY_FIXTURE_SOURCES = ["demo_county", "demo_fire", "demo_nws", "demo_caltrans", "mock_county_emergency", "mock_shelters", "mock_disaster_assistance", "x_posts"];

type Run = {
  runId: string;
  seq?: number;
  on: boolean;
  startedAt: number;
  /** When the pages switched to the earthquake. Unset in manual mode until the first release. */
  escalateAt?: number;
  /** Earthquake crawls started (in queue order). */
  launched?: string[];
  stoppedAt?: number;
  /** Manual mode: calm crawls of wave 1, then wave 1's earthquake crawls, then one wave-2 crawl per release. */
  manual?: boolean;
  /** Manual mode: calm crawls started (wave 1). */
  calmLaunched?: string[];
  /** Manual mode: how many earthquake crawls have been released (wave 1 counts as one release of all its sites). */
  released?: number;
};
type Phase = "calm" | "quake";
type SiteState = { sourceId: string; label: string; state: "queued" | "starting" | "running" | "done" | "failed"; startedAt?: number; error?: string };

/** Crawl order: wave 1 first (the Evacuation Order drives the callback). */
const QUEUE = [...DEMO_SITES].sort((x, y) => x.wave - y.wave);
/** Manual mode: crawled calm on their own, then together on the first release. Wave 2 is released one site at a time. */
const WAVE1 = QUEUE.filter((s) => s.wave === 1);
const phase = v.union(v.literal("calm"), v.literal("quake"));

async function readRun(ctx: QueryCtx): Promise<Run | null> {
  const row = await ctx.db.query("devSettings").withIndex("by_key", (q) => q.eq("key", RUN_KEY)).unique();
  return row ? (JSON.parse(row.value) as Run) : null;
}

async function writeRun(ctx: MutationCtx, run: Run): Promise<void> {
  const row = await ctx.db.query("devSettings").withIndex("by_key", (q) => q.eq("key", RUN_KEY)).unique();
  if (row) await ctx.db.patch("devSettings", row._id, { value: JSON.stringify(run) });
  else await ctx.db.insert("devSettings", { key: RUN_KEY, value: JSON.stringify(run) });
}

/** Latest ingestion run per demo source in one phase: calm runs start before the switch, earthquake runs after it. */
async function latestRuns(ctx: QueryCtx, run: Run, which: Phase): Promise<Map<string, Doc<"ingestionRuns">>> {
  const since = which === "calm" ? run.startedAt : run.escalateAt;
  const until = which === "calm" ? (run.escalateAt ?? Infinity) : Infinity;
  const latest = new Map<string, Doc<"ingestionRuns">>();
  if (since === undefined) return latest;
  for (const r of await ctx.db.query("ingestionRuns").order("desc").take(100)) {
    if (r.startedAt < since) break;
    if (r.startedAt < until && !latest.has(r.sourceId)) latest.set(r.sourceId, r);
  }
  return latest;
}

/** Apify refused the run for the concurrency limit: the site goes back in the queue. */
const refused = (r: Doc<"ingestionRuns"> | undefined) => r?.status === "failed" && LIMIT_ERROR.test(r.error ?? "");

/** Every site's crawl in one phase, in queue order. */
function siteStates(launched: string[], latest: Map<string, Doc<"ingestionRuns">>, sites = QUEUE): SiteState[] {
  return sites.map(({ sourceId, label }) => {
    const r = latest.get(sourceId);
    if (!launched.includes(sourceId)) return { sourceId, label, state: "queued" };
    // Started but not yet visible as a row (runSource is scheduled), or refused and about to start again.
    if (!r || refused(r)) return { sourceId, label, state: "starting" };
    if (IN_FLIGHT.has(r.status)) return { sourceId, label, state: "running", startedAt: r.startedAt };
    return { sourceId, label, state: r.status === "succeeded" ? "done" : "failed", startedAt: r.startedAt, error: r.error };
  });
}

const finished = (s: SiteState) => s.state === "done" || s.state === "failed";

async function calmStates(ctx: QueryCtx, run: Run): Promise<SiteState[]> {
  return siteStates(run.calmLaunched ?? [], await latestRuns(ctx, run, "calm"), WAVE1);
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
  args: { delayMs: v.optional(v.number()), manual: v.optional(v.boolean()) },
  returns: status,
  handler: async (ctx, { delayMs, manual }) => {
    const now = Date.now();
    const delay = Math.max(0, delayMs ?? DEFAULT_DELAY_MS);
    const previous = await readRun(ctx);
    // A stopped run's subscriptions were cancelled at stop. What a caller set up after that ("call me back" before the
    // earthquake) belongs to this run and is kept: that is the demo's callback.
    await resetDemo(ctx, previous?.startedAt, previous && !previous.on ? previous.stoppedAt : undefined);

    await ctx.runMutation(internal.sources.syncRegistry, {}); // the demo sources need their rows
    await offline(ctx);

    const times = demoTimes(now, delay);
    for (const site of DEMO_SITES) {
      await writePage(ctx, site.path, "v1", site.before(times), now);
      await writePage(ctx, site.path, "v2", site.after(times), now);
    }
    await writeVariant(ctx, "v1");

    const seq = (previous?.seq ?? 0) + 1;
    const runId = `demo-${seq}`;
    const run: Run = manual ? { runId, seq, on: true, startedAt: now, manual, calmLaunched: [], released: 0 } : { runId, seq, on: true, startedAt: now, escalateAt: now + delay };
    await writeRun(ctx, run);
    if (manual) await ctx.scheduler.runAfter(0, internal.demo.crawlNext, { runId, phase: "calm" });
    else await ctx.scheduler.runAfter(delay, internal.demo.escalate, { runId });
    return { on: true, runId: run.runId, startedAt: run.startedAt, escalateAt: run.escalateAt };
  },
});

/** Scheduled by start (auto mode): the pages switch to the earthquake, then the crawls begin. */
export const escalate = internalMutation({
  args: { runId: v.string() },
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    const run = await readRun(ctx);
    if (!run?.on || run.runId !== runId || run.manual) return null;
    await writeVariant(ctx, "v2");
    await writeRun(ctx, { ...run, escalateAt: Date.now(), launched: [] });
    await ctx.scheduler.runAfter(0, internal.demo.crawlNext, { runId });
    return null;
  },
});

/**
 * The crawl queue: keeps at most APIFY_CONCURRENCY demo runs in flight (wave 1 sites first) and starts the next site
 * as soon as one finishes. A run Apify refused for the concurrency limit is queued again. Phase "calm" crawls wave 1's
 * calm pages (manual mode); phase "quake" crawls the earthquake pages, all of them in auto mode or as many as were
 * released in manual mode. Polls until every allowed site has been started and accepted by Apify; stops on its own
 * when the demo is stopped or restarted. Returns the sources started this tick.
 */
export const crawlNext = internalMutation({
  args: { runId: v.string(), phase: v.optional(phase) },
  returns: v.array(v.string()),
  handler: async (ctx, { runId, phase: which = "quake" }) => {
    const run = await readRun(ctx);
    if (!run?.on || run.runId !== runId) return [];
    // Calm crawls belong before the switch, earthquake crawls after it.
    if ((which === "calm") !== (run.escalateAt === undefined)) return [];
    const latest = await latestRuns(ctx, run, which);
    const launched = ((which === "calm" ? run.calmLaunched : run.launched) ?? []).filter((id) => !refused(latest.get(id)));
    const inFlight = launched.filter((id) => !latest.has(id) || IN_FLIGHT.has(latest.get(id)!.status)).length;
    const allowed = which === "calm" ? WAVE1.length : run.manual ? (run.released ?? 0) : QUEUE.length;
    const queue = (which === "calm" ? WAVE1 : QUEUE)
      .map((s) => s.sourceId)
      .filter((id) => !launched.includes(id))
      .slice(0, Math.max(0, allowed - launched.length));
    const next = queue.slice(0, Math.max(0, APIFY_CONCURRENCY - inFlight));
    const trigger = which === "calm" ? "manual" : "escalation";
    for (const sourceId of next) {
      await ctx.scheduler.runAfter(0, internal.ingestion.runSource, { sourceId, trigger, modeOverride: "live" });
    }
    const nowLaunched = [...launched, ...next];
    await writeRun(ctx, which === "calm" ? { ...run, calmLaunched: nowLaunched } : { ...run, launched: nowLaunched });
    // Keep polling while a site waits for a slot, or a started run may still be refused for the limit.
    const unconfirmed = nowLaunched.some((id) => !latest.has(id) || latest.get(id)!.status === "running");
    if (queue.length > next.length || unconfirmed) await ctx.scheduler.runAfter(CRAWL_POLL_MS, internal.demo.crawlNext, { runId, phase: which });
    return next;
  },
});

/**
 * Manual mode (Enter in `npm run demo:start`). Refused until every calm crawl has finished ("calm ready"). The first
 * release writes the earthquake pages with times from now, switches to them and crawls all of wave 1 (the Evacuation
 * Order among them: the callback). Each later release crawls the next wave-2 site.
 */
export const release = internalMutation({
  args: {},
  returns: v.object({ ok: v.boolean(), message: v.string() }),
  handler: async (ctx) => {
    let run = await readRun(ctx);
    if (!run?.on) return { ok: false, message: "The demo is not on. Start it with: npm run demo:start" };
    if (!run.manual) return { ok: false, message: "This run crawls on its own (auto mode)." };
    const released = run.released ?? 0;
    if (released >= QUEUE.length) return { ok: false, message: "Every source has been released." };
    if (run.escalateAt === undefined) {
      const calm = await calmStates(ctx, run);
      if (!calm.every(finished)) return { ok: false, message: "Calm crawls are still running: wait for calm ready." };
      const now = Date.now();
      const times = demoTimes(now, 0);
      for (const site of DEMO_SITES) await writePage(ctx, site.path, "v2", site.after(times), now);
      await writeVariant(ctx, "v2");
      run = { ...run, escalateAt: now, launched: [] };
    }
    const first = released === 0;
    await writeRun(ctx, { ...run, released: first ? WAVE1.length : released + 1 });
    await ctx.scheduler.runAfter(0, internal.demo.crawlNext, { runId: run.runId, phase: "quake" });
    return { ok: true, message: first ? `Earthquake: crawling wave 1 (${WAVE1.map((s) => s.label).join(", ")}).` : `Started: ${QUEUE[released].label}.` };
  },
});

const siteState = v.object({
  sourceId: v.string(),
  label: v.string(),
  state: v.union(v.literal("queued"), v.literal("starting"), v.literal("running"), v.literal("done"), v.literal("failed")),
  startedAt: v.optional(v.number()),
  error: v.optional(v.string()),
});

const tally = v.object({ calm: v.number(), escalation: v.number() });

/**
 * For the terminal control panel: every crawl of the run, calm (wave 1 at start) and escalation (the earthquake pages:
 * wave 1 on the first release, then one wave-2 site per release), counted as done / in progress / remaining.
 * Wave 1 is crawled twice, so a manual run has 18 crawls over 13 sources; an auto run has 13 escalation crawls.
 */
export const progress = internalQuery({
  args: {},
  returns: v.object({
    on: v.boolean(),
    runId: v.optional(v.string()),
    manual: v.boolean(),
    stage: v.union(v.literal("off"), v.literal("calm"), v.literal("calm_ready"), v.literal("quake")),
    calm: v.array(siteState),
    quake: v.array(siteState),
    done: tally,
    inProgress: tally,
    remaining: tally,
  }),
  handler: async (ctx) => {
    const run = await readRun(ctx);
    const none = { calm: 0, escalation: 0 };
    if (!run?.on) return { on: false, runId: run?.runId, manual: false, stage: "off" as const, calm: [], quake: [], done: none, inProgress: none, remaining: none };
    const manual = run.manual === true;
    const calm = manual ? await calmStates(ctx, run) : [];
    // `launched` is set when the pages switch (escalate, or the first release).
    const switched = run.launched !== undefined;
    const quake = siteStates(run.launched ?? [], switched ? await latestRuns(ctx, run, "quake") : new Map());
    const released = manual ? (run.released ?? 0) : switched ? QUEUE.length : 0;
    const calmDone = calm.filter(finished).length;
    const quakeDone = quake.filter(finished).length;
    const stage: "calm" | "calm_ready" | "quake" = switched ? "quake" : manual && calmDone === calm.length ? "calm_ready" : "calm";
    return {
      on: true,
      runId: run.runId,
      manual,
      stage,
      calm,
      quake,
      done: { calm: calmDone, escalation: quakeDone },
      // Calm crawls start on their own; a released site waiting for an Apify slot counts as in progress.
      inProgress: { calm: calm.length - calmDone, escalation: released - quakeDone },
      remaining: { calm: 0, escalation: QUEUE.length - released },
    };
  },
});

/**
 * Late-result gate: an Apify result for a demo source is only ingested if it was started by the demo run that is on now
 * (calm crawls included).
 * Results from a stopped or earlier run (crawls still in flight at stop) are dropped.
 */
export const acceptsResult = internalQuery({
  args: { sourceId: v.string(), startedAt: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { sourceId, startedAt }) => {
    if (!DEMO_SOURCE_IDS.includes(sourceId)) return true;
    const run = await readRun(ctx);
    return !!run?.on && startedAt >= run.startedAt;
  },
});

export const stop = internalMutation({
  args: {},
  returns: status,
  handler: async (ctx) => {
    const run = await readRun(ctx);
    await resetDemo(ctx, run?.startedAt);
    await writeVariant(ctx, "v1");
    if (run) await writeRun(ctx, { ...run, on: false, stoppedAt: run.on ? Date.now() : (run.stoppedAt ?? Date.now()) });
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
 * sources, the mock feed's signals. Between the previous run's start (`since`) and `until` (default now): cancels the
 * subscriptions created and deletes the update notifications sent, so the next run's callback is not blocked or duplicated. Crisis mode → normal.
 */
async function resetDemo(ctx: MutationCtx, since: number | undefined, until = Date.now()): Promise<void> {
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
    for (const s of subs) if (s.consentAt >= since && s.consentAt <= until) await ctx.db.patch("subscriptions", s._id, { status: "cancelled", cancelledAt: Date.now() });
    for (const n of await ctx.db.query("notifications").order("desc").take(200)) {
      if (n.createdAt < since) break;
      if (n.createdAt > until) continue;
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
