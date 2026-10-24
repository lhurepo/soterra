// [I] Ingestion: storage (upsertBulletins), the one-minute tick, per-source fetch, expiry, Apify webhook.
// upsertBulletins is minimally functional (naive chunking) because the mock end-to-end path depends on it.
import { v } from "convex/values";
import { loadConfig } from "../src/config/env";
import type { UpsertResult } from "../src/contracts";
import { ADAPTERS } from "../src/ingestion/adapters";
import { chunkBulletin } from "../src/ingestion/chunk";
import { CRISIS_DURATION_MS, triggersCrisis } from "../src/ingestion/crisis";
import { decideChange } from "../src/ingestion/dedupe";
import { finalizeBulletin } from "../src/ingestion/normalize";
import { dueSources } from "../src/ingestion/schedule";
import { isServableStatus, validateBulletin } from "../src/ingestion/validate";
import { verifyApifyWebhook, type ApifyWebhookPayload } from "../src/providers/apify";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import { config, errorResponse, json } from "./lib/http";
import { effectiveMode, getSystemState, setSystemMode } from "./systemState";
import { normalizedBulletin } from "./validators";

/** Bulletins with no area (national items) are filed under this pseudo-state. */
export const NATIONAL = "US";

async function replaceDerivedRows(ctx: MutationCtx, bulletinId: Id<"bulletins">) {
  for (const c of await ctx.db.query("chunks").withIndex("by_bulletinId", (q) => q.eq("bulletinId", bulletinId)).take(500)) {
    await ctx.db.delete("chunks", c._id);
  }
  for (const a of await ctx.db.query("bulletinAreas").withIndex("by_bulletinId", (q) => q.eq("bulletinId", bulletinId)).take(500)) {
    await ctx.db.delete("bulletinAreas", a._id);
  }
}

/**
 * Dedupes on (sourceId, externalId) and contentHash, keeps version history, rewrites chunks and
 * bulletinAreas for the latest version, writes a bulletinEvents row per created/updated/cancelled item.
 * Exported as a plain function so dev seeding uses the exact same path.
 */
type StoredUpsertResult = Omit<UpsertResult, "bulletinId"> & { bulletinId: Id<"bulletins"> | null };

export async function upsertBulletinsImpl(ctx: MutationCtx, items: unknown[]): Promise<StoredUpsertResult[]> {
  const now = Date.now();
  const cfg = loadConfig(process.env);
  const results: StoredUpsertResult[] = [];
  const eventIds: Id<"bulletinEvents">[] = [];

  for (const item of items) {
    const validation = validateBulletin(item);
    if (!validation.ok) {
      const raw = item as { sourceId?: unknown; externalId?: unknown };
      await ctx.db.insert("quarantine", {
        sourceId: typeof raw?.sourceId === "string" ? raw.sourceId : "unknown",
        externalId: typeof raw?.externalId === "string" ? raw.externalId : undefined,
        reason: validation.reason,
        rawExcerpt: JSON.stringify(item).slice(0, 4_000),
        createdAt: now,
      });
      results.push({ bulletinId: null, versionNumber: 0, change: "rejected", reason: validation.reason });
      continue;
    }
    const b = validation.bulletin;

    const existing = await ctx.db
      .query("bulletins")
      .withIndex("by_sourceId_and_externalId", (q) => q.eq("sourceId", b.sourceId).eq("externalId", b.externalId))
      .unique();
    const change = decideChange(existing, b);
    if (existing && change === "unchanged") {
      results.push({ bulletinId: existing._id, versionNumber: existing.latestVersion, change });
      continue;
    }

    const versionNumber = (existing?.latestVersion ?? 0) + 1;
    const isActive = isServableStatus(b.status) && (b.expiresAt === undefined || b.expiresAt > now);
    const primaryState = b.areas[0]?.state ?? NATIONAL;
    const fields = {
      sourceId: b.sourceId,
      externalId: b.externalId,
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
      geometry: b.geometry,
    };
    let bulletinId: Id<"bulletins">;
    if (existing) {
      bulletinId = existing._id;
      await ctx.db.replace("bulletins", bulletinId, fields);
      await replaceDerivedRows(ctx, bulletinId);
    } else {
      bulletinId = await ctx.db.insert("bulletins", fields);
    }

    const { geometry: _geometry, ...payload } = b;
    await ctx.db.insert("bulletinVersions", {
      bulletinId,
      versionNumber,
      contentHash: b.contentHash,
      payload: JSON.stringify(payload),
      createdAt: now,
    });

    // Unverified content is stored as a signal only: never chunked, never retrievable.
    if (isActive && b.trustTier !== "unverified") {
      for (const [chunkIndex, text] of chunkBulletin(b).entries()) {
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
        });
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

    if (b.trustTier !== "unverified" && change !== "unchanged") {
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

    if (isActive && triggersCrisis(b, cfg.INGEST_STATES)) {
      await setSystemMode(ctx, {
        mode: "crisis",
        reason: `${b.sourceName}: ${b.title}`,
        triggeredByBulletinId: bulletinId,
        expiresAt: now + CRISIS_DURATION_MS,
      });
    }
    results.push({ bulletinId, versionNumber, change });
  }

  if (eventIds.length > 0) {
    await ctx.scheduler.runAfter(0, internal.subscriptions.matchEvents, { eventIds });
  }
  // TODO(I/B): best-effort Moss sync of changed chunks (src/providers/moss) when MOSS_* is configured.
  return results;
}

const upsertResult = v.object({
  bulletinId: v.union(v.id("bulletins"), v.null()),
  versionNumber: v.number(),
  change: v.union(v.literal("created"), v.literal("updated"), v.literal("unchanged"), v.literal("cancelled"), v.literal("rejected")),
  reason: v.optional(v.string()),
});

export const upsertBulletins = internalMutation({
  args: { items: v.array(normalizedBulletin) },
  returns: v.array(upsertResult),
  handler: async (ctx, { items }) => await upsertBulletinsImpl(ctx, items),
});

/** Cron, every minute: revert an expired crisis, then schedule every due source. Harmless when all are disabled. */
export const tick = internalMutation({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const now = Date.now();
    const state = await getSystemState(ctx);
    const mode = effectiveMode(state, now);
    if (state?.mode === "crisis" && mode === "normal") {
      await setSystemMode(ctx, { mode: "normal", reason: "crisis mode expired" });
    }
    const sources = await ctx.db.query("sources").take(100);
    const due = dueSources(sources, mode, now);
    for (const source of sources.filter((s) => due.includes(s.sourceId))) {
      await ctx.db.patch("sources", source._id, { lastFetchedAt: now });
      await ctx.scheduler.runAfter(0, internal.ingestion.fetchSource, { sourceId: source.sourceId });
    }
    return due;
  },
});

export const fetchSource = internalAction({
  args: { sourceId: v.string() },
  returns: v.null(),
  handler: async (ctx, { sourceId }) => {
    const source = await ctx.runQuery(internal.sources.getBySourceId, { sourceId });
    const adapter = ADAPTERS[sourceId];
    if (!source || !adapter) return null;
    try {
      const { _id, _creationTime, lastFetchedAt, lastSuccessAt, lastError, ...definition } = source;
      const drafts = await adapter.run({ config: loadConfig(process.env), source: definition, fetch, now: Date.now() });
      // Live sources are never fixtures, whatever the adapter says.
      const items = drafts.map((d) => finalizeBulletin({ ...d, isFixture: false }));
      for (let i = 0; i < items.length; i += 50) {
        await ctx.runMutation(internal.ingestion.upsertBulletins, { items: items.slice(i, i + 50) });
      }
      await ctx.runMutation(internal.sources.recordFetch, { sourceId, ok: true });
    } catch (err) {
      console.error(`[ingestion] ${sourceId} failed:`, err);
      await ctx.runMutation(internal.sources.recordFetch, { sourceId, ok: false, error: String(err).slice(0, 500) });
    }
    return null;
  },
});

/** Cron: deactivates bulletins (and their chunks and areas) whose expiresAt has passed. */
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
    for (const b of expired) {
      await ctx.db.patch("bulletins", b._id, { isActive: false });
      await replaceDerivedRows(ctx, b._id);
    }
    return expired.length;
  },
});

/** POST /ingest/apify — Apify run webhook. Verifies the shared secret, then hands off asynchronously. */
export const apifyWebhook = httpAction(async (ctx, req) => {
  const cfg = config();
  const url = new URL(req.url);
  if (!verifyApifyWebhook(cfg, req.headers.get("X-Soterra-Webhook-Secret"), url.searchParams.get("secret"))) {
    return errorResponse(401, "unauthorized", "invalid webhook secret");
  }
  let payload: ApifyWebhookPayload;
  try {
    payload = (await req.json()) as ApifyWebhookPayload;
  } catch {
    return errorResponse(400, "bad_request", "body must be JSON");
  }
  if (payload.eventType === "ACTOR.RUN.SUCCEEDED" && payload.datasetId) {
    await ctx.scheduler.runAfter(0, internal.ingestion.processApifyRun, { datasetId: payload.datasetId, actorId: payload.actorId });
  }
  return json({ ok: true });
});

export const processApifyRun = internalAction({
  args: { datasetId: v.string(), actorId: v.optional(v.string()) },
  returns: v.null(),
  handler: async (_ctx, { datasetId, actorId }) => {
    // TODO(I): readDataset → per-source mapping (scraped pages → extractFromText with quoted spans;
    // X posts → official_social only for X_OFFICIAL_ALLOWLIST, else unverified) → upsertBulletins.
    // Failed extractions go to the quarantine table with the reason.
    console.log(`[ingestion] Apify run finished (actor ${actorId ?? "?"}, dataset ${datasetId}); processing is TODO(I)`);
    return null;
  },
});
