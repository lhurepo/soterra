// [I] Ingestion: storage (upsertBulletins), the one-minute tick, per-source runs (direct feeds and Apify),
// the Apify webhook, expiry, raw-payload retention and Moss sync. Parsing lives in src/ingestion/.
import { v } from "convex/values";
import { loadConfig, type Config } from "../src/config/env";
import type { RetrievedChunk, UpsertResult } from "../src/contracts";
import { APIFY_ADAPTERS, DIRECT_ADAPTERS } from "../src/ingestion/adapters";
import type { NormalizeContext, NormalizeResult } from "../src/ingestion/adapters/types";
import { MOCK_APIFY_DATASETS } from "../src/ingestion/apifyFixtures";
import { chunkBulletin } from "../src/ingestion/chunk";
import { loadIngestionSettings, type IngestionSettings } from "../src/ingestion/config";
import { triggersCrisis } from "../src/ingestion/crisis";
import { decideChange } from "../src/ingestion/dedupe";
import { createDeterministicExtractionLlm } from "../src/ingestion/extractionMock";
import {
  GEOMETRY_INLINE_MAX_CHARS,
  UPSERT_BATCH_SIZE,
  batches,
  emptyCounts,
  excerpt,
  prepareItems,
  type RunCounts,
} from "../src/ingestion/pipeline";
import { isDue } from "../src/ingestion/schedule";
import { effectiveMode as runMode, isFixtureRun, sourceById, type IngestionSource } from "../src/ingestion/sources";
import { isServableStatus, validateBulletin } from "../src/ingestion/validate";
import { NotConfiguredError } from "../src/config/errors";
import { ApifyWebhookPayload, LiveApifyClient, RUN_END_EVENTS, WEBHOOK_SECRET_HEADER, verifyApifyWebhook, type ApifyClient } from "../src/providers/apify";
import { actorInput } from "../src/providers/apify/actors";
import { MockApifyClient } from "../src/providers/apify/mock";
import { createAnthropicFromConfig } from "../src/providers/llm";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { httpAction, internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx } from "./_generated/server";
import { runCounts, runTrigger, sourceMode } from "./ingestionRuns";
import { config, errorResponse, json } from "./lib/http";
import { enterOrExtend, maintainCrisis } from "./systemState";
import { normalizedBulletin } from "./validators";

/** Bulletins with no area (national items) are filed under this pseudo-state. */
export const NATIONAL = "US";

const DEFAULT_USER_AGENT = "Soterra disaster hotline ingestion (set NWS_USER_AGENT with a contact)";

type StoredUpsertResult = Omit<UpsertResult, "bulletinId"> & { bulletinId: Id<"bulletins"> | null };
export type UpsertBatchResult = { results: StoredUpsertResult[]; changedChunkIds: Id<"chunks">[]; removedChunkIds: Id<"chunks">[] };

// ───────────────────────── Storage ─────────────────────────

export async function deleteDerivedRows(ctx: MutationCtx, bulletinId: Id<"bulletins">): Promise<Id<"chunks">[]> {
  const removed: Id<"chunks">[] = [];
  for (const c of await ctx.db.query("chunks").withIndex("by_bulletinId", (q) => q.eq("bulletinId", bulletinId)).take(500)) {
    await ctx.db.delete("chunks", c._id);
    removed.push(c._id);
  }
  for (const a of await ctx.db.query("bulletinAreas").withIndex("by_bulletinId", (q) => q.eq("bulletinId", bulletinId)).take(500)) {
    await ctx.db.delete("bulletinAreas", a._id);
  }
  return removed;
}

/** Finds the bulletin for this item: its own external id, or any id it supersedes (NWS lineage). */
async function resolveExisting(ctx: MutationCtx, sourceId: string, externalIds: string[]): Promise<Doc<"bulletins"> | null> {
  for (const externalId of externalIds) {
    const alias = await ctx.db
      .query("bulletinAliases")
      .withIndex("by_sourceId_and_externalId", (q) => q.eq("sourceId", sourceId).eq("externalId", externalId))
      .first();
    const viaAlias = alias ? await ctx.db.get("bulletins", alias.bulletinId) : null;
    if (viaAlias) return viaAlias;
    const direct = await ctx.db
      .query("bulletins")
      .withIndex("by_sourceId_and_externalId", (q) => q.eq("sourceId", sourceId).eq("externalId", externalId))
      .first();
    if (direct) return direct;
  }
  return null;
}

async function addAliases(ctx: MutationCtx, sourceId: string, externalIds: string[], bulletinId: Id<"bulletins">) {
  for (const externalId of new Set(externalIds)) {
    const existing = await ctx.db
      .query("bulletinAliases")
      .withIndex("by_sourceId_and_externalId", (q) => q.eq("sourceId", sourceId).eq("externalId", externalId))
      .first();
    if (!existing) await ctx.db.insert("bulletinAliases", { sourceId, externalId, bulletinId });
  }
}

/**
 * Dedupes on (sourceId, externalId incl. superseded ids) and contentHash; creates a version only on a real
 * change; rewrites chunks and bulletinAreas for the latest version; emits bulletinEvents (created, updated,
 * cancelled) with severity before/after; evaluates crisis mode. Exported so dev seeding uses the same path.
 */
export async function upsertBulletinsImpl(
  ctx: MutationCtx,
  items: unknown[],
  options: { geometryRefs?: { externalId: string; storageId: Id<"_storage"> }[]; runId?: Id<"ingestionRuns"> } = {},
): Promise<UpsertBatchResult> {
  const now = Date.now();
  const cfg = loadConfig(process.env);
  const results: StoredUpsertResult[] = [];
  const changedChunkIds: Id<"chunks">[] = [];
  const removedChunkIds: Id<"chunks">[] = [];
  const eventIds: Id<"bulletinEvents">[] = [];

  for (const item of items) {
    const validation = validateBulletin(item);
    if (!validation.ok) {
      const raw = item as { sourceId?: unknown; externalId?: unknown };
      await ctx.db.insert("quarantine", {
        sourceId: typeof raw?.sourceId === "string" ? raw.sourceId : "unknown",
        externalId: typeof raw?.externalId === "string" ? raw.externalId : undefined,
        reason: validation.reason,
        rawExcerpt: excerpt(item),
        createdAt: now,
        runId: options.runId,
      });
      results.push({ bulletinId: null, versionNumber: 0, change: "rejected", reason: validation.reason });
      continue;
    }
    const b = validation.bulletin;
    const ids = [b.externalId, ...(b.supersedesExternalIds ?? [])];

    const existing = await resolveExisting(ctx, b.sourceId, ids);
    const change = decideChange(existing, b);
    if (existing && change === "unchanged") {
      await addAliases(ctx, b.sourceId, ids, existing._id);
      results.push({ bulletinId: existing._id, versionNumber: existing.latestVersion, change });
      continue;
    }

    const versionNumber = (existing?.latestVersion ?? 0) + 1;
    const isActive = isServableStatus(b.status) && (b.expiresAt === undefined || b.expiresAt > now);
    const primaryState = b.areas[0]?.state ?? NATIONAL;
    const geometryStorageId = options.geometryRefs?.find((g) => g.externalId === b.externalId)?.storageId;
    const fields = {
      sourceId: b.sourceId,
      // Keep the first external id of a lineage as the bulletin's id; later ids are aliases.
      externalId: existing?.externalId ?? b.externalId,
      sourceName: b.sourceName,
      url: b.url,
      title: b.title,
      body: b.body,
      hazardType: b.hazardType,
      severity: b.severity,
      status: b.status,
      issuedAt: b.issuedAt,
      updatedAt: b.updatedAt,
      expiresAt: b.expiresAt,
      incidentKey: b.incidentKey,
      trustTier: b.trustTier,
      language: b.language,
      contentHash: b.contentHash,
      latestVersion: versionNumber,
      isActive,
      isFixture: b.isFixture,
      primaryState,
      geometry: geometryStorageId ? undefined : b.geometry,
      geometryStorageId,
      timeBasis: b.timeBasis,
    };
    let bulletinId: Id<"bulletins">;
    if (existing) {
      bulletinId = existing._id;
      if (existing.geometryStorageId && existing.geometryStorageId !== geometryStorageId) await ctx.storage.delete(existing.geometryStorageId);
      await ctx.db.replace("bulletins", bulletinId, fields);
      removedChunkIds.push(...(await deleteDerivedRows(ctx, bulletinId)));
    } else {
      bulletinId = await ctx.db.insert("bulletins", fields);
    }
    await addAliases(ctx, b.sourceId, ids, bulletinId);

    const { geometry: _geometry, ...payload } = b;
    await ctx.db.insert("bulletinVersions", {
      bulletinId,
      versionNumber,
      contentHash: b.contentHash,
      payload: JSON.stringify(payload),
      createdAt: now,
    });

    // Unverified content is never chunked and never retrievable. Inactive bulletins have no chunks.
    if (isActive && b.trustTier !== "unverified") {
      for (const [chunkIndex, text] of chunkBulletin(b).entries()) {
        changedChunkIds.push(
          await ctx.db.insert("chunks", {
            bulletinId,
            versionNumber,
            chunkIndex,
            text,
            sourceId: b.sourceId,
            sourceName: b.sourceName,
            url: b.url,
            trustTier: b.trustTier,
            hazardType: b.hazardType,
            severity: b.severity,
            issuedAt: b.issuedAt,
            updatedAt: b.updatedAt,
            expiresAt: b.expiresAt,
            incidentKey: b.incidentKey,
            isActive: true,
            isFixture: b.isFixture,
            primaryState,
            timeBasis: b.timeBasis,
          }),
        );
      }
      for (const area of b.areas) {
        await ctx.db.insert("bulletinAreas", {
          bulletinId,
          state: area.state,
          countyFips: area.countyFips,
          nwsZone: area.nwsZone,
          label: area.label,
          isActive: true,
        });
      }
    }

    // A cancellation for something we never stored is kept for audit but is not an event.
    const emits = b.trustTier !== "unverified" && !(change === "cancelled" && !existing);
    if (emits && change !== "unchanged") {
      eventIds.push(
        await ctx.db.insert("bulletinEvents", {
          bulletinId,
          incidentKey: b.incidentKey,
          change,
          versionNumber,
          severityBefore: existing?.severity,
          severityAfter: b.severity,
          createdAt: now,
        }),
      );
    }

    const candidate = {
      trustTier: b.trustTier,
      status: b.status,
      isActive,
      isFixture: b.isFixture,
      severity: b.severity,
      title: b.title,
      states: b.areas.map((a) => a.state),
    };
    if (triggersCrisis(candidate, cfg.INGEST_STATES, cfg.SERVE_FIXTURES)) {
      await enterOrExtend(ctx, `${b.sourceName}: ${b.title}`.slice(0, 300), bulletinId, now);
    }
    results.push({ bulletinId, versionNumber, change });
  }

  if (eventIds.length > 0) {
    await ctx.scheduler.runAfter(0, internal.subscriptions.matchEvents, { eventIds });
  }
  return { results, changedChunkIds, removedChunkIds };
}

const upsertResult = v.object({
  bulletinId: v.union(v.id("bulletins"), v.null()),
  versionNumber: v.number(),
  change: v.union(v.literal("created"), v.literal("updated"), v.literal("unchanged"), v.literal("cancelled"), v.literal("rejected")),
  reason: v.optional(v.string()),
});

/** The contract operation (docs/contracts/ingestion-retrieval.md). Keep calls to ≤ 25 items. */
export const upsertBulletins = internalMutation({
  args: { items: v.array(normalizedBulletin) },
  returns: v.array(upsertResult),
  handler: async (ctx, { items }) => (await upsertBulletinsImpl(ctx, items)).results,
});

/** Pipeline variant: also reports chunk changes for Moss and links quarantine rows to the run. */
export const upsertBatch = internalMutation({
  args: {
    items: v.array(normalizedBulletin),
    geometryRefs: v.optional(v.array(v.object({ externalId: v.string(), storageId: v.id("_storage") }))),
    runId: v.optional(v.id("ingestionRuns")),
  },
  returns: v.object({ results: v.array(upsertResult), changedChunkIds: v.array(v.id("chunks")), removedChunkIds: v.array(v.id("chunks")) }),
  handler: async (ctx, { items, geometryRefs, runId }) => await upsertBulletinsImpl(ctx, items, { geometryRefs, runId }),
});

export const quarantineItems = internalMutation({
  args: {
    sourceId: v.string(),
    runId: v.optional(v.id("ingestionRuns")),
    items: v.array(v.object({ externalId: v.optional(v.string()), reason: v.string(), rawExcerpt: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, { sourceId, runId, items }) => {
    const now = Date.now();
    for (const item of items) await ctx.db.insert("quarantine", { sourceId, runId, ...item, createdAt: now });
    return null;
  },
});

export const recordRawPayload = internalMutation({
  args: {
    sourceId: v.string(),
    runId: v.id("ingestionRuns"),
    storageId: v.id("_storage"),
    url: v.string(),
    contentType: v.string(),
    ttlHours: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { ttlHours, ...row }) => {
    const now = Date.now();
    await ctx.db.insert("rawPayloads", { ...row, createdAt: now, expiresAt: now + ttlHours * 3_600_000 });
    return null;
  },
});

// ───────────────────────── Scheduling ─────────────────────────

/** Cron, every minute: maintain crisis mode, then schedule every due source. Harmless when all are disabled. */
export const tick = internalMutation({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const now = Date.now();
    const cfg = loadConfig(process.env);
    const settings = loadIngestionSettings(process.env);
    const mode = await maintainCrisis(ctx, now, async (bulletinId) => {
      const b = await ctx.db.get("bulletins", bulletinId);
      return (
        !!b &&
        triggersCrisis(
          { trustTier: b.trustTier, status: b.status, isActive: b.isActive, isFixture: b.isFixture, severity: b.severity, title: b.title, states: [b.primaryState] },
          cfg.INGEST_STATES,
          cfg.SERVE_FIXTURES,
        )
      );
    });
    const scheduleSettings = { apifyMinIntervalMin: settings.APIFY_MIN_INTERVAL_MIN, backoffCapMin: settings.BACKOFF_CAP_MIN };
    const due: string[] = [];
    for (const source of await ctx.db.query("sources").take(100)) {
      if (!isDue(source, mode, now, scheduleSettings)) continue;
      // Mark as running now so the next tick does not schedule it again before the action starts.
      await ctx.db.patch("sources", source._id, { lastRunAt: now, lastOutcome: "running" });
      await ctx.scheduler.runAfter(0, internal.ingestion.runSource, { sourceId: source.sourceId, trigger: "tick" });
      due.push(source.sourceId);
    }
    return due;
  },
});

// ───────────────────────── Runs ─────────────────────────

const runResult = v.object({
  runId: v.optional(v.id("ingestionRuns")),
  status: v.union(v.literal("succeeded"), v.literal("failed"), v.literal("awaiting_apify"), v.literal("skipped")),
  counts: v.optional(runCounts),
  error: v.optional(v.string()),
});
type RunResult = { runId?: Id<"ingestionRuns">; status: "succeeded" | "failed" | "awaiting_apify" | "skipped"; counts?: RunCounts; error?: string };

function errorMessage(err: unknown): string {
  return (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 1_000);
}

function normalizeContext(source: IngestionSource, cfg: Config, settings: IngestionSettings, isFixture: boolean, now: number): NormalizeContext {
  return { source, now, ingestStates: cfg.INGEST_STATES, isFixture, settings };
}

function mossConfigured(cfg: Config): boolean {
  return !!(cfg.MOSS_PROJECT_ID && cfg.MOSS_PROJECT_KEY && cfg.MOSS_INDEX_NAME);
}

/** Best effort: Convex stays the source of truth, so a Moss failure is recorded and never fails ingestion. */
async function syncMoss(ctx: ActionCtx, cfg: Config, changed: string[], removed: string[]): Promise<"skipped" | "ok" | "failed"> {
  if (!mossConfigured(cfg) || (changed.length === 0 && removed.length === 0)) return "skipped";
  try {
    const chunks: RetrievedChunk[] = await ctx.runQuery(internal.ingestion.chunksForMoss, { chunkIds: changed.slice(0, 500) });
    // The Moss SDK only loads in the Node runtime, so the sync itself runs in convex/mossNode.ts.
    const upserts = chunks.map((c) => ({
      chunkId: c.chunkId,
      bulletinId: c.bulletinId,
      text: c.text,
      sourceName: c.sourceName,
      trustTier: c.trustTier,
      hazardType: c.hazardType,
      severity: c.severity,
      issuedAt: c.issuedAt,
      expiresAt: c.expiresAt,
      isFixture: c.isFixture ?? false,
    }));
    const result = await ctx.runAction(internal.mossNode.syncChunks, { upserts, removedChunkIds: removed });
    if (!result.ok) {
      console.error("[ingestion] Moss sync failed:", result.error);
      return "failed";
    }
    return "ok";
  } catch (err) {
    console.error("[ingestion] Moss sync failed:", errorMessage(err));
    return "failed";
  }
}

/** Raw payloads are for debugging only: a storage failure is logged and never fails the run. */
async function storeRaw(
  ctx: ActionCtx,
  runId: Id<"ingestionRuns">,
  sourceId: string,
  payloads: { url: string; contentType: string; body: string }[],
  settings: IngestionSettings,
): Promise<void> {
  for (const p of payloads) {
    if (p.body.length > 5_000_000) continue;
    try {
      const storageId = await ctx.storage.store(new Blob([p.body], { type: p.contentType }));
      await ctx.runMutation(internal.ingestion.recordRawPayload, {
        sourceId,
        runId,
        storageId,
        url: p.url,
        contentType: p.contentType,
        ttlHours: settings.RAW_PAYLOAD_TTL_HOURS,
      });
    } catch (err) {
      console.warn(`[ingestion] could not keep raw payload for ${sourceId}: ${errorMessage(err)}`);
    }
  }
}

/** normalize result → quarantine, geometry storage, batched upserts, signals, Moss, recorded outcome. */
async function completeRun(
  ctx: ActionCtx,
  args: { runId: Id<"ingestionRuns">; source: IngestionSource; result: NormalizeResult; isFixture: boolean; cfg: Config; fetched: number },
): Promise<RunResult> {
  const { runId, source, result, isFixture, cfg } = args;
  const counts = emptyCounts();
  counts.fetched = args.fetched;
  counts.skipped = result.skipped;

  const { items, rejected } = prepareItems(result, source, isFixture);
  if (rejected.length > 0) {
    await ctx.runMutation(internal.ingestion.quarantineItems, {
      sourceId: source.sourceId,
      runId,
      items: rejected.map((r) => ({ externalId: r.externalId, reason: r.reason.slice(0, 1_000), rawExcerpt: excerpt(r.raw) })),
    });
    counts.rejected += rejected.length;
  }

  const geometryRefs: { externalId: string; storageId: Id<"_storage"> }[] = [];
  for (const item of items) {
    if (item.geometry && item.geometry.length > GEOMETRY_INLINE_MAX_CHARS) {
      const storageId = await ctx.storage.store(new Blob([item.geometry], { type: "application/geo+json" }));
      geometryRefs.push({ externalId: item.externalId, storageId });
      item.geometry = undefined;
    }
  }

  const changed: string[] = [];
  const removed: string[] = [];
  for (const batch of batches(items, UPSERT_BATCH_SIZE)) {
    const ids = new Set(batch.map((b) => b.externalId));
    const r: UpsertBatchResult = await ctx.runMutation(internal.ingestion.upsertBatch, {
      items: batch,
      geometryRefs: geometryRefs.filter((g) => ids.has(g.externalId)),
      runId,
    });
    for (const res of r.results) {
      if (res.change === "rejected") counts.rejected++;
      else counts[res.change]++;
    }
    changed.push(...r.changedChunkIds);
    removed.push(...r.removedChunkIds);
  }

  if (result.signals.length > 0) {
    const r = await ctx.runMutation(internal.signals.recordSignals, { signals: result.signals });
    counts.signals = r.inserted;
  }

  const mossSync = await syncMoss(ctx, cfg, changed, removed);
  await ctx.runMutation(internal.ingestionRuns.finishRun, { runId, status: "succeeded", counts, mossSync });
  return { runId, status: "succeeded", counts };
}

function siteUrl(path: string, live: boolean): string {
  const base = process.env.CONVEX_SITE_URL;
  if (!base) {
    if (live) throw new NotConfiguredError("Apify webhook / mock-site URLs", ["CONVEX_SITE_URL (set automatically on deployments)"]);
    return `https://demo.soterra.example/${path}`;
  }
  return `${base.replace(/\/$/, "")}/${path}`;
}

async function apifyClientFor(ctx: ActionCtx, mode: "fixture" | "live", cfg: Config): Promise<ApifyClient> {
  if (mode === "live") return new LiveApifyClient(cfg.APIFY_TOKEN, fetch);
  const variant: "v1" | "v2" = await ctx.runQuery(internal.mockSites.getActiveVariant, {});
  return new MockApifyClient(MOCK_APIFY_DATASETS, variant);
}

/** Runs one source now. Called by the tick, `npm run ingest:run`, signal bursts and the escalation demo. */
export const runSource = internalAction({
  args: { sourceId: v.string(), trigger: runTrigger, modeOverride: v.optional(sourceMode) },
  returns: runResult,
  handler: async (ctx, args): Promise<RunResult> => {
    const source = sourceById(args.sourceId);
    const row = await ctx.runQuery(internal.sources.getBySourceId, { sourceId: args.sourceId });
    if (!source || !row) return { status: "skipped", error: `unknown source ${args.sourceId}; run sources:syncRegistry` };
    const cfg = loadConfig(process.env);
    const settings = loadIngestionSettings(process.env);
    const mode = runMode({ fetchVia: source.fetchVia, mode: row.mode ?? source.mode }, args.modeOverride, settings.APIFY_MODE);
    const isFixture = isFixtureRun(source, mode);
    const runId = await ctx.runMutation(internal.ingestionRuns.createRun, { sourceId: source.sourceId, trigger: args.trigger, mode });
    const now = Date.now();

    try {
      if (source.fetchVia === "direct") {
        const adapter = DIRECT_ADAPTERS[source.sourceId];
        if (!adapter) throw new Error(`no adapter for ${source.sourceId}`);
        const raw =
          mode === "fixture"
            ? adapter.fixture().map((r) => ({ ...r, fetchedAt: now }))
            : await adapter.fetchLive({ fetch, ingestStates: cfg.INGEST_STATES, userAgent: cfg.NWS_USER_AGENT ?? DEFAULT_USER_AGENT }, now);
        await storeRaw(
          ctx,
          runId,
          source.sourceId,
          raw.map((r) => ({
            url: r.url,
            contentType: r.kind === "json" ? "application/json" : r.contentType,
            body: r.kind === "json" ? JSON.stringify(r.body) : r.body,
          })),
          settings,
        );
        const result = adapter.normalize(raw, normalizeContext(source, cfg, settings, isFixture, now));
        return await completeRun(ctx, { runId, source, result, isFixture, cfg, fetched: raw.length });
      }

      // Apify: start a run whose webhook comes back to /ingest/apify; MockApify simulates that webhook.
      const live = mode === "live";
      if (live && source.apify?.mockSitePath && !cfg.ENABLE_MOCK_SITES) {
        throw new NotConfiguredError("Mock sites for live Apify", ["ENABLE_MOCK_SITES=true"]);
      }
      const client = await apifyClientFor(ctx, mode, cfg);
      const { actorId, input } = actorInput(
        source,
        source.apify?.mockSitePath ? siteUrl(`mock-sites/${source.apify.mockSitePath}`, live) : undefined,
        { maxItems: source.apify?.maxItems ?? settings.APIFY_MAX_ITEMS, xAllowlist: settings.xAllowlist, ingestStates: cfg.INGEST_STATES },
      );
      const started = await client.startRun(actorId, input, {
        webhookUrl: siteUrl("ingest/apify", live),
        webhookSecret: live ? (cfg.APIFY_WEBHOOK_SECRET ?? "") : "mock",
        sourceId: source.sourceId,
        runRecordId: runId,
        maxItems: Math.min(source.apify?.maxItems ?? settings.APIFY_MAX_ITEMS, settings.APIFY_MAX_ITEMS),
        maxTotalChargeUsd: settings.APIFY_MAX_CHARGE_USD,
        timeoutSecs: 300,
        memoryMbytes: settings.APIFY_MEMORY_MB,
      });
      await ctx.runMutation(internal.ingestionRuns.markAwaitingApify, { runId, apifyRunId: started.runId, apifyDatasetId: started.datasetId });
      if (client.mode === "mock") {
        await ctx.runMutation(internal.ingestionRuns.recordApifyEvent, {
          runRecordId: runId,
          apifyRunId: started.runId,
          eventType: "ACTOR.RUN.SUCCEEDED",
          datasetId: started.datasetId,
        });
      }
      return { runId, status: "awaiting_apify" };
    } catch (err) {
      const error = errorMessage(err);
      await ctx.runMutation(internal.ingestionRuns.finishRun, { runId, status: "failed", error });
      return { runId, status: "failed", error };
    }
  },
});

/** Scheduled by recordApifyEvent: fetch the run's dataset and run the pipeline. */
export const processApifyRun = internalAction({
  args: { runId: v.id("ingestionRuns") },
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    const run = await ctx.runQuery(internal.ingestionRuns.getRun, { runId });
    if (!run) return null;
    if (!(await ctx.runMutation(internal.ingestionRuns.claimForProcessing, { runId }))) return null;
    const source = sourceById(run.sourceId);
    const adapter = APIFY_ADAPTERS[run.sourceId];
    try {
      if (!source || !adapter) throw new Error(`no Apify adapter for ${run.sourceId}`);
      if (run.apifyEventType !== "ACTOR.RUN.SUCCEEDED") throw new Error(`Apify run ended with ${run.apifyEventType ?? "no event"}`);
      if (!run.apifyDatasetId) throw new Error("Apify run has no dataset id");
      const cfg = loadConfig(process.env);
      const settings = loadIngestionSettings(process.env);
      const client: ApifyClient =
        run.mode === "live" ? new LiveApifyClient(cfg.APIFY_TOKEN, fetch) : new MockApifyClient(MOCK_APIFY_DATASETS, "v1");
      const items = await client.getDatasetItems(run.apifyDatasetId, settings.APIFY_MAX_ITEMS);
      await storeRaw(ctx, runId, run.sourceId, [{ url: `apify:dataset/${run.apifyDatasetId}`, contentType: "application/json", body: JSON.stringify(items) }], settings);
      const isFixture = isFixtureRun(source, run.mode);
      const llm =
        cfg.LLM_PROVIDER === "anthropic"
          ? createAnthropicFromConfig(cfg, { timeoutMs: settings.EXTRACTION_TIMEOUT_MS })
          : createDeterministicExtractionLlm();
      const result = await adapter.normalizeItems(items, normalizeContext(source, cfg, settings, isFixture, Date.now()), {
        llm,
        model: cfg.CLAUDE_SMART_MODEL,
      });
      await completeRun(ctx, { runId, source, result, isFixture, cfg, fetched: items.length });
    } catch (err) {
      await ctx.runMutation(internal.ingestionRuns.finishRun, { runId, status: "failed", error: errorMessage(err) });
    }
    return null;
  },
});

/** POST /ingest/apify — Apify run webhook. Checks the secret (401), records the event, schedules processing, returns 200 fast. */
export const apifyWebhook = httpAction(async (ctx, req) => {
  const cfg = config();
  const url = new URL(req.url);
  if (!verifyApifyWebhook(cfg.APIFY_WEBHOOK_SECRET, req.headers.get(WEBHOOK_SECRET_HEADER), url.searchParams.get("secret"))) {
    return errorResponse(401, "unauthorized", "invalid webhook secret");
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "bad_request", "body must be JSON");
  }
  const payload = ApifyWebhookPayload.safeParse(body);
  if (!payload.success) return errorResponse(400, "bad_request", `unexpected webhook payload: ${payload.error.issues[0]?.message}`);
  if (!(RUN_END_EVENTS as readonly string[]).includes(payload.data.eventType)) return json({ ok: true, ignored: payload.data.eventType });
  const result = await ctx.runMutation(internal.ingestionRuns.recordApifyEvent, {
    runRecordId: payload.data.soterra.runRecordId,
    apifyRunId: payload.data.resource.id,
    eventType: payload.data.eventType,
    datasetId: payload.data.resource.defaultDatasetId,
  });
  return json({ ok: true, result });
});

// ───────────────────────── Housekeeping ─────────────────────────

/** Cron: deactivates bulletins past expiresAt (no event) and removes their chunks and areas. */
export const expireBulletins = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("bulletins")
      // gte(0) excludes bulletins without an expiry (undefined sorts first in an index).
      .withIndex("by_isActive_and_expiresAt", (q) => q.eq("isActive", true).gte("expiresAt", 0).lt("expiresAt", now))
      .take(50);
    const removed: Id<"chunks">[] = [];
    for (const b of expired) {
      await ctx.db.patch("bulletins", b._id, { isActive: false });
      removed.push(...(await deleteDerivedRows(ctx, b._id)));
    }
    if (removed.length > 0 && mossConfigured(loadConfig(process.env))) {
      await ctx.scheduler.runAfter(0, internal.ingestion.syncMossRemovals, { chunkIds: removed });
    }
    return expired.length;
  },
});

/**
 * One-off cleanup after an adapter starts setting expiresAt or filtering records: active live bulletins of the
 * source that still have no expiry were not refreshed by the new rules, so retire them (no event).
 *   npx convex run ingestion:retireUnexpiring '{"sourceId":"nifc_wfigs"}'   (run the source once first)
 */
export const retireUnexpiring = internalMutation({
  args: { sourceId: v.string() },
  returns: v.number(),
  handler: async (ctx, { sourceId }) => {
    const rows = await ctx.db
      .query("bulletins")
      .withIndex("by_sourceId_and_externalId", (q) => q.eq("sourceId", sourceId))
      .take(500);
    let retired = 0;
    for (const b of rows) {
      if (!b.isActive || b.isFixture || b.expiresAt !== undefined) continue;
      await ctx.db.patch("bulletins", b._id, { isActive: false });
      await deleteDerivedRows(ctx, b._id);
      retired++;
    }
    return retired;
  },
});

export const syncMossRemovals = internalAction({
  args: { chunkIds: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { chunkIds }) => {
    await syncMoss(ctx, loadConfig(process.env), [], chunkIds);
    return null;
  },
});

/** Cron: deletes raw payloads past their TTL. */
export const purgeRawPayloads = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("rawPayloads")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", Date.now()))
      .take(100);
    for (const p of expired) {
      await ctx.storage.delete(p.storageId);
      await ctx.db.delete("rawPayloads", p._id);
    }
    return expired.length;
  },
});

/** Chunks in RetrievedChunk shape for the Moss mirror. */
export const chunksForMoss = internalQuery({
  args: { chunkIds: v.array(v.string()) },
  handler: async (ctx, { chunkIds }): Promise<RetrievedChunk[]> => {
    const out: RetrievedChunk[] = [];
    for (const raw of chunkIds) {
      const id = ctx.db.normalizeId("chunks", raw);
      const c = id ? await ctx.db.get("chunks", id) : null;
      if (!c) continue;
      const areas = await ctx.db
        .query("bulletinAreas")
        .withIndex("by_bulletinId", (q) => q.eq("bulletinId", c.bulletinId))
        .take(20);
      out.push({
        chunkId: c._id,
        bulletinId: c.bulletinId,
        text: c.text,
        sourceId: c.sourceId,
        sourceName: c.sourceName,
        url: c.url,
        trustTier: c.trustTier,
        issuedAt: c.issuedAt,
        updatedAt: c.updatedAt,
        expiresAt: c.expiresAt,
        areas: areas.map((a) => ({ state: a.state, countyFips: a.countyFips, nwsZone: a.nwsZone, label: a.label })),
        hazardType: c.hazardType,
        severity: c.severity,
        incidentKey: c.incidentKey,
        isFixture: c.isFixture,
        score: 0,
      });
    }
    return out;
  },
});
