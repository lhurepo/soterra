// [I] OpenFEMA disaster declarations. GET https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries
// (no key, OData-style $filter). One row per designated county; rows are grouped into one bulletin per
// declaration (femaDeclarationString). Declarations are context, not live hazard warnings.
import { z } from "zod";
import type { AreaRef, HazardType, NormalizedBulletinDraft } from "../../contracts";
import femaFixture from "../../../fixtures/raw/openfema-declarations.json";
import { STATE_FIPS_TO_USPS, countyByFips } from "../geo";
import { parseFeedTime } from "../time";
import { emptyResult, getRaw, type DirectAdapter, type NormalizeContext, type NormalizeResult, type RawResponse } from "./types";

const Row = z.object({
  femaDeclarationString: z.string().min(1),
  disasterNumber: z.number(),
  state: z.string(),
  declarationType: z.string(),
  declarationDate: z.string(),
  incidentType: z.string(),
  declarationTitle: z.string(),
  incidentBeginDate: z.string().nullish(),
  incidentEndDate: z.string().nullish(),
  fipsStateCode: z.string(),
  fipsCountyCode: z.string(),
  designatedArea: z.string(),
});

const Response = z.object({ DisasterDeclarationsSummaries: z.array(z.unknown()) });

/** Declarations whose incident period ended more than this long ago are skipped. */
const RECENTLY_ENDED_MS = 30 * 86_400_000;

/**
 * Declarations have no end of their own, so each bulletin expires: 30 days after the incident period ended,
 * otherwise a type-based window after the declaration (fire management 60 days, emergency 180, major disaster 365).
 */
const OPEN_ENDED_MS: Record<string, number> = { FM: 60 * 86_400_000, EM: 180 * 86_400_000, DR: 365 * 86_400_000 };

const DECLARATION_TYPES: Record<string, string> = {
  DR: "Major Disaster Declaration",
  EM: "Emergency Declaration",
  FM: "Fire Management Assistance Declaration",
};

export function hazardFromFemaIncident(incidentType: string): HazardType {
  const t = incidentType.toLowerCase();
  if (t.includes("fire")) return "wildfire";
  if (t.includes("flood") || t.includes("dam/levee")) return "flood";
  if (t.includes("hurricane") || t.includes("tropical") || t.includes("typhoon") || t.includes("coastal storm")) return "hurricane";
  if (t.includes("tornado")) return "tornado";
  if (t.includes("earthquake")) return "earthquake";
  if (t.includes("tsunami")) return "tsunami";
  if (t.includes("snow") || t.includes("ice") || t.includes("winter")) return "winter_storm";
  return "other";
}

function areaOf(row: z.infer<typeof Row>): AreaRef | undefined {
  const state = STATE_FIPS_TO_USPS[row.fipsStateCode];
  if (!state) return undefined;
  // fipsCountyCode "000" means a statewide designation.
  if (row.fipsCountyCode === "000") return { state, label: row.designatedArea };
  const countyFips = `${row.fipsStateCode}${row.fipsCountyCode}`;
  const county = countyByFips(countyFips);
  return { state, county: county?.name, countyFips, label: row.designatedArea };
}

export function normalizeFema(raw: RawResponse[], ctx: NormalizeContext): NormalizeResult {
  const out = emptyResult();
  const groups = new Map<string, z.infer<typeof Row>[]>();
  for (const r of raw) {
    const parsed = Response.safeParse(r.kind === "json" ? r.body : undefined);
    if (!parsed.success) {
      out.rejected.push({ reason: "OpenFEMA response missing DisasterDeclarationsSummaries", raw: r.url });
      continue;
    }
    for (const item of parsed.data.DisasterDeclarationsSummaries) {
      const row = Row.safeParse(item);
      if (!row.success) {
        out.rejected.push({ reason: `invalid OpenFEMA row: ${row.error.issues[0]?.message}`, raw: item });
        continue;
      }
      const ended = parseFeedTime(row.data.incidentEndDate);
      if (!ctx.ingestStates.includes(row.data.state) || (ended !== undefined && ended < ctx.now - RECENTLY_ENDED_MS)) {
        out.skipped++;
        continue;
      }
      const list = groups.get(row.data.femaDeclarationString) ?? [];
      list.push(row.data);
      groups.set(row.data.femaDeclarationString, list);
    }
  }

  for (const [declaration, rows] of groups) {
    const first = rows[0];
    const issuedAt = parseFeedTime(first.declarationDate);
    if (issuedAt === undefined) {
      out.rejected.push({ externalId: declaration, reason: "declaration without declarationDate", raw: first });
      continue;
    }
    const ended = parseFeedTime(first.incidentEndDate);
    const expiresAt = ended !== undefined ? ended + RECENTLY_ENDED_MS : issuedAt + (OPEN_ENDED_MS[first.declarationType] ?? OPEN_ENDED_MS.DR);
    if (expiresAt <= ctx.now) {
      out.skipped++;
      continue;
    }
    const areas = rows.map(areaOf).filter((a): a is AreaRef => a !== undefined);
    const kind = DECLARATION_TYPES[first.declarationType] ?? `${first.declarationType} declaration`;
    const begin = first.incidentBeginDate?.slice(0, 10);
    const end = first.incidentEndDate?.slice(0, 10);
    const draft: NormalizedBulletinDraft = {
      sourceId: ctx.source.sourceId,
      sourceName: ctx.source.name,
      externalId: declaration,
      url: `https://www.fema.gov/disaster/${first.disasterNumber}`,
      title: `${kind} ${declaration}: ${first.declarationTitle}`,
      body:
        `FEMA ${kind} ${declaration} (${first.incidentType}) covers ${areas.map((a) => a.label).join(", ")}.` +
        (begin ? ` Incident period began ${begin}${end ? ` and ended ${end}` : ""}.` : ""),
      hazardType: hazardFromFemaIncident(first.incidentType),
      severity: "unknown",
      status: "actual",
      issuedAt,
      expiresAt,
      areas,
      incidentKey: `fema:${declaration}`,
      trustTier: ctx.source.trustTier,
      language: "en",
      isFixture: ctx.isFixture,
      timeBasis: "issued",
    };
    out.drafts.push(draft);
  }
  return out;
}

export function femaUrl(state: string): string {
  // Literal "$" and %20 spaces, exactly as verified against the live API.
  const filter = encodeURIComponent(`state eq '${state}'`);
  const orderby = encodeURIComponent("declarationDate desc");
  return `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$filter=${filter}&$orderby=${orderby}&$top=50`;
}

export const femaAdapter: DirectAdapter = {
  sourceId: "openfema_declarations",
  fixture: () => [{ kind: "json", url: "fixture:openfema-declarations.json", fetchedAt: 0, body: femaFixture }],
  async fetchLive(ctx, now) {
    const responses: RawResponse[] = [];
    for (const state of ctx.ingestStates) responses.push(await getRaw(ctx, femaUrl(state), "application/json", "json", now));
    return responses;
  },
  normalize: normalizeFema,
};
