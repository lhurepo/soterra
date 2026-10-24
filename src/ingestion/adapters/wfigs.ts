// [I] NIFC WFIGS current incident locations (ArcGIS FeatureServer, GeoJSON). URL from catalog mirrors,
// answered live 2026-10-24. POOState is "US-CA"; county comes from POOCounty. Prescribed fires (RX) skipped.
// Times: FireDiscoveryDateTime is the issue time; ModifiedOnDateTime_dt is the record's update time.
// Quality filters (live data 2026-10-24: 83 CA records, 41 prescribed burns, 12 with ID-only names like
// "LAC-384174", some 0.01-acre or "WILDFIRE TRAINING" records): a caller can't use those, so they are skipped.
// The layer keeps stale records, so a bulletin expires 7 days after the record's last modification.
import { z } from "zod";
import type { AreaRef, NormalizedBulletinDraft } from "../../contracts";
import wfigsFixture from "../../../fixtures/raw/wfigs-incidents.json";
import { countyArea, countyByName } from "../geo";
import { emptyResult, getRaw, type DirectAdapter, type NormalizeContext, type NormalizeResult, type RawResponse } from "./types";

const LAYER = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0";

const Feature = z.object({
  geometry: z.unknown().optional(),
  properties: z.object({
    IncidentName: z.string().min(1),
    POOState: z.string(),
    POOCounty: z.string().nullish(),
    ModifiedOnDateTime_dt: z.number().nullish(),
    FireDiscoveryDateTime: z.number().nullish(),
    IncidentSize: z.number().nullish(),
    PercentContained: z.number().nullish(),
    UniqueFireIdentifier: z.string().min(1),
    IncidentTypeCategory: z.string().nullish(),
  }),
});

const EXPIRY_MS = 7 * 86_400_000;
/** "LAC-384174" style placeholders and drills: no name a caller could say. */
const UNUSABLE_NAME = /^[A-Z]{2,4}-\d+$|training|exercise|\btest\b/i;
const MIN_ACRES = 1;

/** "Timber" → "Timber Fire"; "Bear Creek Fire" and "Dixie Complex" stay as they are. */
export function fireTitle(name: string): string {
  const trimmed = name.trim();
  return /\b(fire|complex|incident|fires)$/i.test(trimmed) ? trimmed : `${trimmed} Fire`;
}

const Collection = z.object({ features: z.array(z.unknown()) });

export function wfigsUrl(state: string): string {
  return `${LAYER}/query?where=${encodeURIComponent(`POOState='US-${state}'`)}&outFields=*&f=geojson`;
}

function recordUrl(id: string): string {
  return `${LAYER}/query?where=${encodeURIComponent(`UniqueFireIdentifier='${id}'`)}&outFields=*&f=html`;
}

export function normalizeWfigs(raw: RawResponse[], ctx: NormalizeContext): NormalizeResult {
  const out = emptyResult();
  for (const r of raw) {
    const collection = Collection.safeParse(r.kind === "json" ? r.body : undefined);
    if (!collection.success) {
      out.rejected.push({ reason: "WFIGS response is not a FeatureCollection", raw: r.url });
      continue;
    }
    for (const f of collection.data.features) {
      const parsed = Feature.safeParse(f);
      if (!parsed.success) {
        out.rejected.push({ reason: `invalid WFIGS feature: ${parsed.error.issues[0]?.message}`, raw: f });
        continue;
      }
      const p = parsed.data.properties;
      if (p.IncidentTypeCategory === "RX" || UNUSABLE_NAME.test(p.IncidentName.trim()) || (p.IncidentSize != null && p.IncidentSize < MIN_ACRES)) {
        out.skipped++;
        continue;
      }
      const state = /^US-([A-Z]{2})$/.exec(p.POOState)?.[1];
      if (!state || !ctx.ingestStates.includes(state)) {
        out.skipped++;
        continue;
      }
      const discovered = p.FireDiscoveryDateTime ?? undefined;
      const modified = p.ModifiedOnDateTime_dt ?? undefined;
      const issuedAt = discovered ?? modified;
      if (issuedAt === undefined) {
        out.rejected.push({ externalId: p.UniqueFireIdentifier, reason: "WFIGS record without discovery or modified time", raw: f });
        continue;
      }
      const expiresAt = (modified ?? issuedAt) + EXPIRY_MS;
      if (expiresAt <= ctx.now) {
        out.skipped++;
        continue;
      }
      const county = p.POOCounty ? countyByName(state, p.POOCounty) : undefined;
      const areas: AreaRef[] = county ? [countyArea(county)] : [{ state, county: p.POOCounty ?? undefined, label: p.POOCounty ? `${p.POOCounty} County, ${state}` : state }];
      const facts = [
        p.IncidentSize != null ? `about ${p.IncidentSize} acres` : undefined,
        p.PercentContained != null ? `${p.PercentContained} percent contained` : undefined,
      ].filter(Boolean);
      const draft: NormalizedBulletinDraft = {
        sourceId: ctx.source.sourceId,
        sourceName: ctx.source.name,
        externalId: p.UniqueFireIdentifier,
        url: recordUrl(p.UniqueFireIdentifier),
        title: fireTitle(p.IncidentName),
        body: `${fireTitle(p.IncidentName)}, ${areas[0].label}${facts.length ? `: ${facts.join(", ")}` : ""}. Incident ${p.UniqueFireIdentifier} in the NIFC WFIGS current incidents layer.`,
        hazardType: "wildfire",
        severity: "unknown",
        status: "actual",
        issuedAt,
        expiresAt,
        updatedAt: discovered !== undefined && modified !== undefined && modified > discovered ? modified : undefined,
        areas,
        geometry: parsed.data.geometry ? JSON.stringify(parsed.data.geometry) : undefined,
        incidentKey: `wfigs:${p.UniqueFireIdentifier}`,
        trustTier: ctx.source.trustTier,
        language: "en",
        isFixture: ctx.isFixture,
        timeBasis: discovered !== undefined ? "issued" : "page_updated",
      };
      out.drafts.push(draft);
    }
  }
  return out;
}

export const wfigsAdapter: DirectAdapter = {
  sourceId: "nifc_wfigs",
  fixture: () => [{ kind: "json", url: "fixture:wfigs-incidents.json", fetchedAt: 0, body: wfigsFixture }],
  async fetchLive(ctx, now) {
    const responses: RawResponse[] = [];
    for (const state of ctx.ingestStates) responses.push(await getRaw(ctx, wfigsUrl(state), "application/geo+json", "json", now));
    return responses;
  },
  normalize: normalizeWfigs,
};
