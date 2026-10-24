// [I] Run bookkeeping: every source run gets a row and ends with a recorded outcome, which also updates
// the source's schedule (lastOutcome, consecutiveFailures → backoff, nextDueAt).
import { v } from "convex/values";
import { loadIngestionSettings } from "../src/ingestion/config";
import { nextDueAt } from "../src/ingestion/schedule";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { effectiveMode, getSystemState } from "./systemState";

export const runTrigger = v.union(v.literal("tick"), v.literal("manual"), v.literal("signal_burst"), v.literal("escalation"));
export const sourceMode = v.union(v.literal("fixture"), v.literal("live"));
export const runCounts = v.object({
  fetched: v.number(),
  created: v.number(),
  updated: v.number(),
  unchanged: v.number(),
  cancelled: v.number(),
  rejected: v.number(),
  skipped: v.number(),
  signals: v.number(),
});

async function sourceRow(ctx: MutationCtx, sourceId: string): Promise<Doc<"sources"> | null> {
  return await ctx.db
    .query("sources")
    .withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId))
    .unique();
}

export const createRun = internalMutation({
  args: { sourceId: v.string(), trigger: runTrigger, mode: sourceMode },
  returns: v.id("ingestionRuns"),
  handler: async (ctx, { sourceId, trigger, mode }) => {
    const now = Date.now();
    const source = await sourceRow(ctx, sourceId);
    if (source) await ctx.db.patch("sources", source._id, { lastRunAt: now, lastOutcome: "running" });
    return await ctx.db.insert("ingestionRuns", { sourceId, trigger, mode, status: "running", startedAt: now });
  },
});

export const markAwaitingApify = internalMutation({
  args: { runId: v.id("ingestionRuns"), apifyRunId: v.string(), apifyDatasetId: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { runId, apifyRunId, apifyDatasetId }) => {
    const run = await ctx.db.get("ingestionRuns", runId);
    if (!run) return null;
    // A fast webhook may already have advanced the run; never move it backwards.
    if (run.status === "running") await ctx.db.patch("ingestionRuns", runId, { status: "awaiting_apify" });
    await ctx.db.patch("ingestionRuns", runId, { apifyRunId, apifyDatasetId: run.apifyDatasetId ?? apifyDatasetId });
    const source = await sourceRow(ctx, run.sourceId);
    if (source && source.lastOutcome === "running") await ctx.db.patch("sources", source._id, { lastOutcome: "awaiting_apify" });
    return null;
  },
});

/**
 * Called by POST /ingest/apify (after the secret check) and by MockApify's simulated webhook. Idempotent:
 * Apify may deliver a webhook more than once; only the first end event for a run schedules processing.
 */
export const recordApifyEvent = internalMutation({
  args: {
    runRecordId: v.optional(v.string()),
    apifyRunId: v.string(),
    eventType: v.string(),
    datasetId: v.optional(v.string()),
  },
  returns: v.union(v.literal("scheduled"), v.literal("duplicate"), v.literal("unknown_run")),
  handler: async (ctx, args) => {
    const byRecord = args.runRecordId ? ctx.db.normalizeId("ingestionRuns", args.runRecordId) : null;
    const run =
      (byRecord ? await ctx.db.get("ingestionRuns", byRecord) : null) ??
      (await ctx.db
        .query("ingestionRuns")
        .withIndex("by_apifyRunId", (q) => q.eq("apifyRunId", args.apifyRunId))
        .first());
    if (!run) return "unknown_run";
    if (run.apifyEventType !== undefined || run.status === "succeeded" || run.status === "failed") return "duplicate";
    await ctx.db.patch("ingestionRuns", run._id, {
      apifyEventType: args.eventType,
      apifyRunId: run.apifyRunId ?? args.apifyRunId,
      apifyDatasetId: run.apifyDatasetId ?? args.datasetId,
    });
    await ctx.scheduler.runAfter(0, internal.ingestion.processApifyRun, { runId: run._id });
    return "scheduled";
  },
});

/** Claims a run for processing so duplicate deliveries never process twice. */
export const claimForProcessing = internalMutation({
  args: { runId: v.id("ingestionRuns") },
  returns: v.boolean(),
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get("ingestionRuns", runId);
    if (!run || (run.status !== "awaiting_apify" && run.status !== "running")) return false;
    await ctx.db.patch("ingestionRuns", runId, { status: "processing" });
    return true;
  },
});

export const finishRun = internalMutation({
  args: {
    runId: v.id("ingestionRuns"),
    status: v.union(v.literal("succeeded"), v.literal("failed")),
    counts: v.optional(runCounts),
    mossSync: v.optional(v.union(v.literal("skipped"), v.literal("ok"), v.literal("failed"))),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { runId, status, counts, mossSync, error }) => {
    const now = Date.now();
    const run = await ctx.db.get("ingestionRuns", runId);
    if (!run || run.status === "succeeded" || run.status === "failed") return null;
    await ctx.db.patch("ingestionRuns", runId, { status, counts, mossSync, error: error?.slice(0, 1_000), finishedAt: now });
    if (error) console.error(`[ingestion] ${run.sourceId} run ${runId} ${status}: ${error}`);

    const source = await sourceRow(ctx, run.sourceId);
    if (!source) return null;
    const consecutiveFailures = status === "succeeded" ? 0 : (source.consecutiveFailures ?? 0) + 1;
    const settings = loadIngestionSettings(process.env);
    const mode = effectiveMode(await getSystemState(ctx), now);
    const updated = { ...source, consecutiveFailures, lastOutcome: status };
    await ctx.db.patch("sources", source._id, {
      lastOutcome: status,
      consecutiveFailures,
      lastSuccessAt: status === "succeeded" ? now : source.lastSuccessAt,
      lastError: status === "failed" ? (error ?? "failed").slice(0, 500) : undefined,
      nextDueAt: nextDueAt(updated, mode, { apifyMinIntervalMin: settings.APIFY_MIN_INTERVAL_MIN, backoffCapMin: settings.BACKOFF_CAP_MIN }),
    });
    return null;
  },
});

export const getRun = internalQuery({
  args: { runId: v.id("ingestionRuns") },
  handler: async (ctx, { runId }) => await ctx.db.get("ingestionRuns", runId),
});

export const recentRuns = internalQuery({
  args: { sourceId: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { sourceId, limit }) => {
    const n = Math.min(limit ?? 20, 100);
    if (sourceId) {
      return await ctx.db
        .query("ingestionRuns")
        .withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId))
        .order("desc")
        .take(n);
    }
    return await ctx.db.query("ingestionRuns").order("desc").take(n);
  },
});

/** Per-source status for the backend's /health (no secrets). */
export const sourceStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("sources").take(100);
    return rows.map((s) => ({
      sourceId: s.sourceId,
      enabled: s.enabled,
      mode: s.mode ?? "fixture",
      fetchVia: s.fetchVia,
      lastRunAt: s.lastRunAt,
      nextDueAt: s.nextDueAt,
      lastOutcome: s.lastOutcome,
      consecutiveFailures: s.consecutiveFailures ?? 0,
      lastSuccessAt: s.lastSuccessAt,
      lastError: s.lastError,
    }));
  },
});

