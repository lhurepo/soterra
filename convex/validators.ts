// [S] Convex `v` validators mirroring the zod contracts in src/contracts (hand-written; no converter).
// Change both together; the end-to-end test fails if they drift on the fixture data.
import { v } from "convex/values";

export const areaRef = v.object({
  state: v.string(),
  county: v.optional(v.string()),
  countyFips: v.optional(v.string()),
  city: v.optional(v.string()),
  zip: v.optional(v.string()),
  nwsZone: v.optional(v.string()),
  label: v.string(),
});

export const hazardType = v.union(
  v.literal("wildfire"),
  v.literal("flood"),
  v.literal("hurricane"),
  v.literal("tornado"),
  v.literal("earthquake"),
  v.literal("tsunami"),
  v.literal("winter_storm"),
  v.literal("extreme_heat"),
  v.literal("evacuation"),
  v.literal("shelter"),
  v.literal("road_closure"),
  v.literal("other"),
);

export const severity = v.union(
  v.literal("extreme"),
  v.literal("severe"),
  v.literal("moderate"),
  v.literal("minor"),
  v.literal("unknown"),
);

export const trustTier = v.union(v.literal("official"), v.literal("official_social"), v.literal("unverified"));

export const bulletinStatus = v.union(v.literal("actual"), v.literal("test"), v.literal("exercise"), v.literal("cancelled"));

export const citation = v.object({
  sourceName: v.string(),
  url: v.string(),
  issuedAt: v.number(),
  updatedAt: v.optional(v.number()),
});

export const replyKind = v.union(
  v.literal("answer"),
  v.literal("no_info"),
  v.literal("clarify"),
  v.literal("safety"),
  v.literal("smalltalk"),
  v.literal("followup"),
  v.literal("goodbye"),
);

export const normalizedBulletin = v.object({
  sourceId: v.string(),
  sourceName: v.string(),
  externalId: v.string(),
  url: v.string(),
  title: v.string(),
  body: v.string(),
  instructions: v.optional(v.string()),
  hazardType,
  severity,
  status: bulletinStatus,
  issuedAt: v.number(),
  updatedAt: v.optional(v.number()),
  effectiveAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
  areas: v.array(areaRef),
  geometry: v.optional(v.string()),
  incidentKey: v.optional(v.string()),
  trustTier,
  language: v.string(),
  contentHash: v.string(),
  isFixture: v.boolean(),
});

export const subscriptionTrigger = v.union(
  v.literal("any_update"),
  v.literal("severity_change"),
  v.literal("evacuation_change"),
  v.literal("answer_available"),
);

export const notificationChannel = v.union(v.literal("phone_call"), v.literal("sms"));

export const notificationStatus = v.union(
  v.literal("sent"),
  v.literal("queued"),
  v.literal("failed"),
  v.literal("unconfigured"),
  v.literal("mock"),
);
