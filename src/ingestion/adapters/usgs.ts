// [I] USGS earthquakes adapter. GeoJSON summary feed, updated every minute, no key. Times are epoch ms.
// Keeps events at or above USGS_MIN_MAGNITUDE whose `place` names a configured state.
import { z } from "zod";
import type { NormalizedBulletinDraft, Severity } from "../../contracts";
import usgsFixture from "../../../fixtures/raw/usgs-earthquakes.json";
import { stateFromPlace } from "../geo";
import { emptyResult, getRaw, type DirectAdapter, type NormalizeContext, type NormalizeResult, type RawResponse } from "./types";

export const USGS_FEED_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_hour.geojson";

const Feature = z.object({
  id: z.string().min(1),
  properties: z.object({
    mag: z.number().nullable(),
    place: z.string().nullable(),
    time: z.number(),
    updated: z.number().nullable().optional(),
    url: z.string().url(),
    title: z.string().nullable().optional(),
    alert: z.enum(["green", "yellow", "orange", "red"]).nullable().optional(),
    status: z.string().optional(),
    tsunami: z.number().optional(),
    type: z.string().optional(),
  }),
  geometry: z.unknown().optional(),
});

const Collection = z.object({ features: z.array(z.unknown()) });

const PAGER: Record<string, Severity> = { red: "extreme", orange: "severe", yellow: "moderate", green: "minor" };

export function usgsSeverity(mag: number, alert: string | null | undefined): Severity {
  if (alert && PAGER[alert]) return PAGER[alert];
  if (mag >= 7) return "extreme";
  if (mag >= 6) return "severe";
  if (mag >= 5) return "moderate";
  return "minor";
}

export function normalizeUsgs(raw: RawResponse[], ctx: NormalizeContext): NormalizeResult {
  const out = emptyResult();
  for (const r of raw) {
    const collection = Collection.safeParse(r.kind === "json" ? r.body : undefined);
    if (!collection.success) {
      out.rejected.push({ reason: "USGS response is not a FeatureCollection", raw: r.url });
      continue;
    }
    for (const f of collection.data.features) {
      const parsed = Feature.safeParse(f);
      if (!parsed.success) {
        out.rejected.push({ reason: `invalid USGS feature: ${parsed.error.issues[0]?.message}`, raw: f });
        continue;
      }
      const { id, properties: p } = parsed.data;
      if ((p.type && p.type !== "earthquake") || p.mag === null || p.place === null) {
        out.skipped++;
        continue;
      }
      const state = stateFromPlace(p.place);
      if (p.mag < ctx.settings.USGS_MIN_MAGNITUDE || !state || !ctx.ingestStates.includes(state)) {
        out.skipped++;
        continue;
      }
      const draft: NormalizedBulletinDraft = {
        sourceId: ctx.source.sourceId,
        sourceName: ctx.source.name,
        externalId: id,
        url: p.url,
        title: p.title ?? `M ${p.mag.toFixed(1)} - ${p.place}`,
        body:
          `Magnitude ${p.mag.toFixed(1)} earthquake, ${p.place}.` +
          (p.status ? ` USGS review status: ${p.status}.` : "") +
          (p.tsunami === 1 ? " USGS marks this event with its tsunami flag." : ""),
        hazardType: "earthquake",
        severity: usgsSeverity(p.mag, p.alert),
        status: "actual",
        issuedAt: p.time,
        updatedAt: p.updated && p.updated > p.time ? p.updated : undefined,
        areas: [{ state, label: p.place }],
        geometry: parsed.data.geometry ? JSON.stringify(parsed.data.geometry) : undefined,
        trustTier: ctx.source.trustTier,
        language: "en",
        isFixture: ctx.isFixture,
        timeBasis: "issued",
      };
      out.drafts.push(draft);
    }
  }
  return out;
}

export const usgsAdapter: DirectAdapter = {
  sourceId: "usgs_earthquakes",
  fixture: () => [{ kind: "json", url: "fixture:usgs-earthquakes.json", fetchedAt: 0, body: usgsFixture }],
  fetchLive: async (ctx, now) => [await getRaw(ctx, USGS_FEED_URL, "application/geo+json", "json", now)],
  normalize: normalizeUsgs,
};
