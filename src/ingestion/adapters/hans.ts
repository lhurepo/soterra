// [I] USGS Volcano Hazards Program (HANS) adapter. Two JSON endpoints, live-verified 2026-10-24:
//   elevated volcanoes (alert level, aviation color code, observatory synopsis, lat/long):
//     https://volcanoes.usgs.gov/vsc/api/volcanoApi/elevated
//   US volcano list (`subregion` is the state name; used only to place each volcano):
//     https://volcanoes.usgs.gov/vsc/api/volcanoApi/volcanoesUS
// Only elevated volcanoes appear in the first feed, so a volcano that returns to normal simply stops
// being updated; every bulletin therefore expires 8 days after its last notice (HANS notices are at least weekly).
// Times are UTC strings "YYYY-MM-DD HH:MM:SS". Areas come from the volcano list, never from the synopsis.
import { z } from "zod";
import type { AreaRef, NormalizedBulletinDraft, Severity } from "../../contracts";
import hansFixture from "../../../fixtures/raw/hans-volcanoes.json";
import { STATE_NAMES } from "../geo";
import { emptyResult, getRaw, type DirectAdapter, type NormalizeContext, type NormalizeResult, type RawResponse } from "./types";

export const HANS_ELEVATED_URL = "https://volcanoes.usgs.gov/vsc/api/volcanoApi/elevated";
export const HANS_VOLCANOES_URL = "https://volcanoes.usgs.gov/vsc/api/volcanoApi/volcanoesUS";
const EXPIRY_MS = 8 * 24 * 3_600_000;

const Elevated = z.object({
  noticeId: z.string().min(1),
  vName: z.string().min(1),
  vnum: z.string().min(1),
  lat: z.number().nullish(),
  long: z.number().nullish(),
  noticeSynopsis: z.string().nullish(),
  obs: z.string().nullish(),
  alertLevel: z.string().min(1),
  colorCode: z.string().nullish(),
  alertLevelPrev: z.string().nullish(),
  sentUtc: z.string().min(1),
  codeChangeDate: z.string().nullish(),
  noticeUrl: z.string().url(),
});

const VolcanoListItem = z.object({ vnum: z.string(), subregion: z.string().nullish() });

const STATE_BY_NAME: Record<string, string> = Object.fromEntries(Object.entries(STATE_NAMES).map(([usps, name]) => [name, usps]));

const SEVERITY: Record<string, Severity> = { WARNING: "severe", WATCH: "moderate", ADVISORY: "minor" };

/** "2026-10-23 19:37:45" (UTC) → epoch ms. */
export function parseHansTime(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(`${value.trim().replace(" ", "T")}Z`);
  return Number.isFinite(ms) ? ms : undefined;
}

export function normalizeHans(raw: RawResponse[], ctx: NormalizeContext): NormalizeResult {
  const out = emptyResult();
  const elevatedRaw = raw.find((r) => r.url.includes("elevated"));
  const listRaw = raw.find((r) => r.url.includes("volcanoesUS") || r.url.includes("volcanoes-us"));
  if (!elevatedRaw || elevatedRaw.kind !== "json" || !Array.isArray(elevatedRaw.body)) {
    out.rejected.push({ reason: "HANS elevated-volcanoes response is not a JSON array", raw: elevatedRaw?.url ?? "missing" });
    return out;
  }
  const stateByVnum = new Map<string, string>();
  for (const item of listRaw?.kind === "json" && Array.isArray(listRaw.body) ? listRaw.body : []) {
    const p = VolcanoListItem.safeParse(item);
    const state = p.success && p.data.subregion ? STATE_BY_NAME[p.data.subregion] : undefined;
    if (p.success && state) stateByVnum.set(p.data.vnum, state);
  }

  for (const item of elevatedRaw.body) {
    const parsed = Elevated.safeParse(item);
    if (!parsed.success) {
      out.rejected.push({ reason: `invalid HANS notice: ${parsed.error.issues[0]?.message}`, raw: item });
      continue;
    }
    const v = parsed.data;
    const state = stateByVnum.get(v.vnum);
    if (!state) {
      out.rejected.push({ externalId: `hans:${v.vnum}`, reason: `no US state for volcano ${v.vName} (${v.vnum}) in the volcano list`, raw: item });
      continue;
    }
    if (!ctx.ingestStates.includes(state)) {
      out.skipped++;
      continue;
    }
    const sent = parseHansTime(v.sentUtc);
    if (sent === undefined) {
      out.rejected.push({ externalId: `hans:${v.vnum}`, reason: `unparseable HANS time ${v.sentUtc}`, raw: item });
      continue;
    }
    const changed = parseHansTime(v.codeChangeDate);
    const issuedAt = changed !== undefined && changed <= sent ? changed : sent;
    const level = v.alertLevel.toUpperCase();
    const area: AreaRef = { state, label: `${v.vName}, ${STATE_NAMES[state]}` };
    const observatory = v.obs ? v.obs.toUpperCase() : "USGS";
    const levelText = `${observatory} alert level ${level}${v.colorCode ? `, aviation color code ${v.colorCode}` : ""}`;
    const prevLevel = v.alertLevelPrev?.toUpperCase();
    const previous = prevLevel && !prevLevel.startsWith("UNASSIGN") && prevLevel !== level ? ` The previous alert level was ${prevLevel}.` : "";
    const draft: NormalizedBulletinDraft = {
      sourceId: ctx.source.sourceId,
      sourceName: ctx.source.name,
      externalId: `hans:${v.vnum}`,
      url: v.noticeUrl,
      title: `${v.vName} volcano: ${level}${v.colorCode ? ` (${v.colorCode})` : ""}`,
      body: `${v.vName} volcano, ${STATE_NAMES[state]}: ${levelText}.${previous} ${v.noticeSynopsis ?? ""}`.trim(),
      hazardType: "other",
      severity: SEVERITY[level] ?? "unknown",
      status: "actual",
      issuedAt,
      updatedAt: sent > issuedAt ? sent : undefined,
      expiresAt: sent + EXPIRY_MS,
      areas: [area],
      geometry: v.lat != null && v.long != null ? JSON.stringify({ type: "Point", coordinates: [v.long, v.lat] }) : undefined,
      incidentKey: `volcano:${v.vnum}`,
      trustTier: ctx.source.trustTier,
      language: "en",
      isFixture: ctx.isFixture,
      timeBasis: "issued",
    };
    out.drafts.push(draft);
  }
  return out;
}

export const hansAdapter: DirectAdapter = {
  sourceId: "usgs_volcanoes",
  fixture: () => [
    { kind: "json", url: "fixture:hans-elevated", fetchedAt: 0, body: hansFixture.elevated },
    { kind: "json", url: "fixture:hans-volcanoesUS", fetchedAt: 0, body: hansFixture.volcanoes },
  ],
  async fetchLive(ctx, now) {
    return [await getRaw(ctx, HANS_ELEVATED_URL, "application/json", "json", now), await getRaw(ctx, HANS_VOLCANOES_URL, "application/json", "json", now)];
  },
  normalize: normalizeHans,
};
