// [I] NHC current storms. GET https://www.nhc.noaa.gov/CurrentStorms.json → activeStorms[] (live-verified
// 2026-10-24, not formally documented by NHC). One bulletin per storm id; each new advisory is a version.
// The file names no US state, so these bulletins have no area (filed nationally). Only facts present in
// the file are restated; units are not stated by the file, so wind and movement are not restated.
import { z } from "zod";
import type { NormalizedBulletinDraft, Severity } from "../../contracts";
import nhcFixture from "../../../fixtures/raw/nhc-current-storms.json";
import { parseFeedTime } from "../time";
import { emptyResult, getRaw, type DirectAdapter, type NormalizeContext, type NormalizeResult, type RawResponse } from "./types";

export const NHC_URL = "https://www.nhc.noaa.gov/CurrentStorms.json";

const Product = z.object({ advNum: z.string().optional(), issuance: z.string().optional(), url: z.string().url().optional() }).passthrough();

const Storm = z.object({
  id: z.string().min(1),
  name: z.string(),
  classification: z.string(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  lastUpdate: z.string().optional(),
  publicAdvisory: Product.optional(),
});

const Response = z.object({ activeStorms: z.array(z.unknown()) });

const CLASSIFICATIONS: Record<string, { label: string; severity: Severity }> = {
  HU: { label: "Hurricane", severity: "severe" },
  TS: { label: "Tropical Storm", severity: "moderate" },
  TD: { label: "Tropical Depression", severity: "minor" },
  STS: { label: "Subtropical Storm", severity: "moderate" },
  SD: { label: "Subtropical Depression", severity: "minor" },
  PTC: { label: "Potential Tropical Cyclone", severity: "minor" },
};

export function normalizeNhc(raw: RawResponse[], ctx: NormalizeContext): NormalizeResult {
  const out = emptyResult();
  for (const r of raw) {
    const parsed = Response.safeParse(r.kind === "json" ? r.body : undefined);
    if (!parsed.success) {
      out.rejected.push({ reason: "NHC response missing activeStorms", raw: r.url });
      continue;
    }
    for (const item of parsed.data.activeStorms) {
      const storm = Storm.safeParse(item);
      if (!storm.success) {
        out.rejected.push({ reason: `invalid NHC storm: ${storm.error.issues[0]?.message}`, raw: item });
        continue;
      }
      const s = storm.data;
      const issuedAt = parseFeedTime(s.publicAdvisory?.issuance) ?? parseFeedTime(s.lastUpdate);
      if (issuedAt === undefined) {
        out.rejected.push({ externalId: s.id, reason: "storm without advisory issuance or lastUpdate time", raw: item });
        continue;
      }
      const cls = CLASSIFICATIONS[s.classification] ?? { label: `Tropical system (${s.classification})`, severity: "unknown" as Severity };
      const where = s.latitude && s.longitude ? ` near ${s.latitude} ${s.longitude}` : "";
      const adv = s.publicAdvisory?.advNum ? ` Latest public advisory number ${s.publicAdvisory.advNum}.` : "";
      const draft: NormalizedBulletinDraft = {
        sourceId: ctx.source.sourceId,
        sourceName: ctx.source.name,
        externalId: s.id,
        url: s.publicAdvisory?.url ?? "https://www.nhc.noaa.gov/",
        title: `${cls.label} ${s.name}`,
        body: `${cls.label} ${s.name} (NHC id ${s.id})${where}.${adv}`,
        hazardType: "hurricane",
        severity: cls.severity,
        status: "actual",
        issuedAt,
        areas: [],
        incidentKey: `nhc:${s.id}`,
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

export const nhcAdapter: DirectAdapter = {
  sourceId: "nhc_storms",
  fixture: () => [{ kind: "json", url: "fixture:nhc-current-storms.json", fetchedAt: 0, body: nhcFixture }],
  fetchLive: async (ctx, now) => [await getRaw(ctx, NHC_URL, "application/json", "json", now)],
  normalize: normalizeNhc,
};
