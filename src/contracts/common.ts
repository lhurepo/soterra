// [S] Shared primitives used by every contract: time, language, phone, area, trust, hazard.
import { z } from "zod";

/** Every timestamp in Soterra is epoch milliseconds, UTC. */
export const EpochMs = z.number().int().nonnegative();

/** BCP-47 language tag, e.g. "en", "es", "en-US". Phrase tables key on the primary subtag. */
export const Language = z
  .string()
  .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/, "must be a BCP-47 language tag");
export type Language = z.infer<typeof Language>;

/** E.164 phone number, e.g. "+17075550123". */
export const E164 = z.string().regex(/^\+[1-9]\d{6,14}$/, "must be an E.164 phone number");

export const AreaRef = z.object({
  /** USPS state code, e.g. "CA". */
  state: z.string().regex(/^[A-Z]{2}$/),
  county: z.string().optional(),
  /** 5-digit county FIPS, e.g. "06097". */
  countyFips: z.string().regex(/^\d{5}$/).optional(),
  city: z.string().optional(),
  zip: z.string().regex(/^\d{5}$/).optional(),
  /** NWS UGC zone or county code, e.g. "CAZ504". */
  nwsZone: z.string().regex(/^[A-Z]{2}[CZ]\d{3}$/).optional(),
  /** Human/speakable label, e.g. "Sonoma County". */
  label: z.string().min(1),
});
export type AreaRef = z.infer<typeof AreaRef>;

export const HazardType = z.enum([
  "wildfire",
  "flood",
  "hurricane",
  "tornado",
  "earthquake",
  "tsunami",
  "winter_storm",
  "extreme_heat",
  "evacuation",
  "shelter",
  "road_closure",
  "other",
]);
export type HazardType = z.infer<typeof HazardType>;

export const Severity = z.enum(["extreme", "severe", "moderate", "minor", "unknown"]);
export type Severity = z.infer<typeof Severity>;

/** Only "official" and "official_social" content may ever be used to answer callers. */
export const TrustTier = z.enum(["official", "official_social", "unverified"]);
export type TrustTier = z.infer<typeof TrustTier>;
export const ANSWERABLE_TRUST_TIERS: readonly TrustTier[] = ["official", "official_social"];

/** A citation is always built from stored chunk metadata, never from model text. */
export const Citation = z.object({
  sourceName: z.string().min(1),
  url: z.string().url(),
  issuedAt: EpochMs,
  updatedAt: EpochMs.optional(),
});
export type Citation = z.infer<typeof Citation>;
