// [S] Ingestion ⇄ retrieval contract (docs/contracts/ingestion-retrieval.md). Written by [I], read by [B].
import { z } from "zod";
import { AreaRef, EpochMs, HazardType, Language, Severity, TrustTier } from "./common";

export const SourceKind = z.enum(["official_api", "official_web", "social"]);

export const SourceDefinition = z.object({
  sourceId: z.string().regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1),
  kind: SourceKind,
  trustTier: TrustTier,
  fetchVia: z.enum(["direct", "apify"]),
  normalIntervalMin: z.number().int().positive(),
  crisisIntervalMin: z.number().int().positive(),
  enabled: z.boolean(),
  /** USPS state codes this source is polled for; ["*"] for national feeds. */
  regionStates: z.array(z.string()).min(1),
  /** Where the adapter fetches from (documentation and the adapter's default). */
  endpoint: z.string().optional(),
});
export type SourceDefinition = z.infer<typeof SourceDefinition>;

export const BulletinStatus = z.enum(["actual", "test", "exercise", "cancelled"]);

/**
 * What `issuedAt` means. "issued": the source's own publication time. "page_updated": the page's own
 * "last updated" time. "observed": the source published no time, so `issuedAt` is when Soterra fetched
 * it ("as of when we checked at 3:05 PM"); nothing else about that time is implied. Absent = "issued".
 */
export const TimeBasis = z.enum(["issued", "page_updated", "observed"]);
export type TimeBasis = z.infer<typeof TimeBasis>;

/**
 * One official item after normalization. Validation rejects anything without a URL, issue time or
 * source; timestamps and areas are never invented. `test` and `exercise` items are never served.
 */
export const NormalizedBulletin = z.object({
  sourceId: z.string().min(1),
  sourceName: z.string().min(1),
  externalId: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1),
  body: z.string(),
  instructions: z.string().optional(),
  hazardType: HazardType,
  severity: Severity,
  status: BulletinStatus,
  issuedAt: EpochMs,
  updatedAt: EpochMs.optional(),
  effectiveAt: EpochMs.optional(),
  expiresAt: EpochMs.optional(),
  areas: z.array(AreaRef),
  /** GeoJSON geometry as a string. Large shapes go to file storage (TODO(I)), never inline > ~500 KB. */
  geometry: z.string().optional(),
  /** Groups bulletins about the same incident, e.g. "ridgeview-fire-2026". */
  incidentKey: z.string().optional(),
  trustTier: TrustTier,
  language: Language,
  contentHash: z.string().min(1),
  isFixture: z.boolean(),
  /** Additive (2026-10-24). Absent means "issued". */
  timeBasis: TimeBasis.optional(),
  /**
   * Additive (2026-10-24). External ids of earlier messages this one updates or cancels (NWS `references`).
   * upsertBulletins follows them so one alert lineage stays one bulletin with versions.
   */
  supersedesExternalIds: z.array(z.string()).optional(),
});
export type NormalizedBulletin = z.infer<typeof NormalizedBulletin>;

/** What adapters and fixture files produce before `finalizeBulletin` adds the content hash. */
export const NormalizedBulletinDraft = NormalizedBulletin.omit({ contentHash: true });
export type NormalizedBulletinDraft = z.infer<typeof NormalizedBulletinDraft>;

export const BulletinChange = z.enum(["created", "updated", "unchanged", "cancelled"]);
export type BulletinChange = z.infer<typeof BulletinChange>;

/** Per-item result of internal.ingestion.upsertBulletins. "rejected" items went to quarantine. */
export const UpsertResult = z.object({
  bulletinId: z.string().nullable(),
  versionNumber: z.number().int().nonnegative(),
  change: z.union([BulletinChange, z.literal("rejected")]),
  reason: z.string().optional(),
});
export type UpsertResult = z.infer<typeof UpsertResult>;

export const BulletinEvent = z.object({
  bulletinId: z.string(),
  incidentKey: z.string().optional(),
  change: z.enum(["created", "updated", "cancelled"]),
  versionNumber: z.number().int().positive(),
  severityBefore: Severity.optional(),
  severityAfter: Severity,
  createdAt: EpochMs,
});
export type BulletinEvent = z.infer<typeof BulletinEvent>;

export const SystemMode = z.enum(["normal", "crisis"]);
export const SystemState = z.object({
  mode: SystemMode,
  reason: z.string(),
  triggeredByBulletinId: z.string().optional(),
  since: EpochMs,
  expiresAt: EpochMs.optional(),
});
export type SystemState = z.infer<typeof SystemState>;

/**
 * @deprecated Superseded by the evidence-only schema in src/ingestion/extract.ts (2026-10-24). Kept so
 * nothing that imported it breaks; no module uses it.
 */
export const ExtractedField = z.object({
  value: z.string().min(1),
  quote: z.string().min(1),
});
export const ExtractionResult = z.object({
  items: z.array(
    z.object({
      title: ExtractedField,
      body: ExtractedField,
      hazardType: HazardType,
      severity: Severity,
      issuedAt: ExtractedField.optional(),
      areas: z.array(ExtractedField),
      shelterStatus: ExtractedField.optional(),
      capacity: ExtractedField.optional(),
    }),
  ),
});
export type ExtractionResult = z.infer<typeof ExtractionResult>;

/**
 * Additive (2026-10-24). An unverified social post kept only as a signal. Never a bulletin, never chunked,
 * never retrievable, never triggers crisis mode. A burst can trigger an early poll of official sources.
 */
export const Signal = z.object({
  sourceId: z.string(),
  platform: z.literal("x"),
  externalId: z.string(),
  url: z.string().url(),
  authorHandle: z.string(),
  text: z.string(),
  postedAt: EpochMs.optional(),
  observedAt: EpochMs,
  hazardTypes: z.array(HazardType),
  states: z.array(z.string()),
  isFixture: z.boolean(),
});
export type Signal = z.infer<typeof Signal>;
