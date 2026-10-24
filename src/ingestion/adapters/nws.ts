// [I] NWS alerts adapter. GET https://api.weather.gov/alerts/active?area=<STATE> (no key; a User-Agent that
// identifies the app and a contact is required; GeoJSON with CAP fields). Verified live 2026-10-24.
//
// Lineage: Update and Cancel messages arrive with a NEW properties.id and list earlier messages in
// `references`. externalId is this message's id; `supersedesExternalIds` carries the referenced ids so
// upsertBulletins keeps one bulletin (with versions) per alert lineage.
import { z } from "zod";
import { NotConfiguredError } from "../../config/errors";
import type { AreaRef, HazardType, NormalizedBulletinDraft, Severity } from "../../contracts";
import nwsFixture from "../../../fixtures/raw/nws-alerts.json";
import { areaFromSame, areaFromUgc } from "../geo";
import { parseFeedTime } from "../time";
import { emptyResult, getRaw, type DirectAdapter, type NormalizeContext, type NormalizeResult, type RawResponse } from "./types";

const Reference = z.object({ identifier: z.string(), sent: z.string().optional() });

const Properties = z.object({
  "@id": z.string().url().optional(),
  id: z.string().min(1),
  areaDesc: z.string().optional().default(""),
  geocode: z.object({ SAME: z.array(z.string()).optional().default([]), UGC: z.array(z.string()).optional().default([]) }).optional(),
  references: z.array(Reference).optional().default([]),
  sent: z.string().optional(),
  effective: z.string().nullish(),
  expires: z.string().nullish(),
  ends: z.string().nullish(),
  status: z.string(),
  messageType: z.string(),
  severity: z.string().optional(),
  event: z.string().min(1),
  senderName: z.string().nullish(),
  headline: z.string().nullish(),
  description: z.string().nullish(),
  instruction: z.string().nullish(),
  language: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

const Feature = z.object({
  id: z.string().optional(),
  geometry: z.unknown().nullable().optional(),
  properties: Properties,
});

const Collection = z.object({ features: z.array(z.unknown()) });

const SEVERITY: Record<string, Severity> = {
  Extreme: "extreme",
  Severe: "severe",
  Moderate: "moderate",
  Minor: "minor",
  Unknown: "unknown",
};

export function hazardFromNwsEvent(event: string): HazardType {
  const e = event.toLowerCase();
  if (/red flag|fire weather|fire warning|smoke/.test(e)) return "wildfire";
  if (/tsunami/.test(e)) return "tsunami";
  if (/hurricane|tropical storm|storm surge|typhoon/.test(e)) return "hurricane";
  if (/tornado/.test(e)) return "tornado";
  if (/flood|hydrologic/.test(e)) return "flood";
  if (/earthquake/.test(e)) return "earthquake";
  if (/winter|blizzard|ice storm|snow|freeze|frost|wind chill|cold/.test(e)) return "winter_storm";
  if (/heat/.test(e)) return "extreme_heat";
  if (/evacuation/.test(e)) return "evacuation";
  return "other";
}

function vtecStrings(parameters: Record<string, unknown> | undefined): string[] {
  const vtec = parameters?.VTEC;
  return Array.isArray(vtec) ? vtec.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Cancellations come either as messageType "Cancel" or (verified live 2026-10-24) as an "Alert" whose VTEC
 * actions are all CAN/EXP ("The Winter Storm Watch has been cancelled.").
 */
function statusOf(status: string, messageType: string, vtec: string[]): NormalizedBulletinDraft["status"] {
  if (status === "Exercise") return "exercise";
  if (status !== "Actual") return "test"; // Test, System, Draft: stored, never served
  const actions = vtec.map((v) => /^\/\w\.(\w{3})\./.exec(v)?.[1]).filter(Boolean);
  const allEnded = actions.length > 0 && actions.every((a) => a === "CAN" || a === "EXP");
  return messageType === "Cancel" || allEnded ? "cancelled" : "actual";
}

function vtecKey(parameters: Record<string, unknown> | undefined): string | undefined {
  const first = vtecStrings(parameters)[0];
  // /O.NEW.KMTR.FW.W.0099.<start>-<end>/ → office.phenomena.significance.event number
  const m = first && /^\/\w\.\w{3}\.(\w{4})\.(\w{2})\.(\w)\.(\d{4})\./.exec(first);
  return m ? `nws:${m[1]}.${m[2]}.${m[3]}.${m[4]}` : undefined;
}

function areasOf(p: z.infer<typeof Properties>): AreaRef[] {
  const labels = p.areaDesc.split(";").map((s) => s.trim()).filter(Boolean);
  const ugc = p.geocode?.UGC ?? [];
  const areas: AreaRef[] = [];
  ugc.forEach((code, i) => {
    // areaDesc usually lists names in UGC order; only use a name when the counts line up.
    const area = areaFromUgc(code, labels.length === ugc.length ? labels[i] : undefined);
    if (area) areas.push(area);
  });
  for (const code of p.geocode?.SAME ?? []) {
    const area = areaFromSame(code);
    if (area && !areas.some((a) => a.countyFips === area.countyFips && a.nwsZone === undefined)) areas.push(area);
  }
  return areas;
}

export function normalizeNwsAlerts(raw: RawResponse[], ctx: NormalizeContext): NormalizeResult {
  const out = emptyResult();
  const features: unknown[] = [];
  for (const r of raw) {
    const parsed = Collection.safeParse(r.kind === "json" ? r.body : undefined);
    if (!parsed.success) {
      out.rejected.push({ reason: `NWS response is not a FeatureCollection: ${parsed.error.issues[0]?.message}`, raw: r.url });
      continue;
    }
    features.push(...parsed.data.features);
  }

  const drafts: NormalizedBulletinDraft[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    const parsed = Feature.safeParse(f);
    if (!parsed.success) {
      out.rejected.push({ reason: `invalid NWS feature: ${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`, raw: f });
      continue;
    }
    const p = parsed.data.properties;
    if (seen.has(p.id)) continue; // the same alert listed for several states
    seen.add(p.id);

    const areas = areasOf(p);
    if (!areas.some((a) => ctx.ingestStates.includes(a.state))) {
      out.skipped++;
      continue;
    }
    const sent = parseFeedTime(p.sent);
    const url = p["@id"] ?? parsed.data.id;
    if (sent === undefined || !url) {
      out.rejected.push({ externalId: p.id, reason: "NWS alert without sent time or URL", raw: f });
      continue;
    }
    const referenced = p.references.map((r) => parseFeedTime(r.sent)).filter((t): t is number => t !== undefined);
    const isFollowUp = p.messageType === "Update" || p.messageType === "Cancel";
    const originalIssue = isFollowUp && referenced.length > 0 ? Math.min(...referenced) : sent;
    const geometry = parsed.data.geometry ? JSON.stringify(parsed.data.geometry) : undefined;

    drafts.push({
      sourceId: ctx.source.sourceId,
      sourceName: p.senderName ? `${ctx.source.name} (${p.senderName})` : ctx.source.name,
      externalId: p.id,
      supersedesExternalIds: p.references.length > 0 ? p.references.map((r) => r.identifier) : undefined,
      url,
      title: (p.headline ?? p.event).trim(),
      body: (p.description ?? "").trim(),
      instructions: p.instruction?.trim() || undefined,
      hazardType: hazardFromNwsEvent(p.event),
      severity: SEVERITY[p.severity ?? "Unknown"] ?? "unknown",
      status: statusOf(p.status, p.messageType, vtecStrings(p.parameters)),
      issuedAt: originalIssue,
      updatedAt: isFollowUp && sent > originalIssue ? sent : undefined,
      effectiveAt: parseFeedTime(p.effective),
      expiresAt: parseFeedTime(p.ends) ?? parseFeedTime(p.expires),
      areas,
      geometry,
      incidentKey: vtecKey(p.parameters),
      trustTier: ctx.source.trustTier,
      language: p.language?.split("-")[0] || "en",
      isFixture: ctx.isFixture,
      timeBasis: "issued",
    });
  }
  // Oldest first so an Update is processed after the alert it updates.
  out.drafts = drafts.sort((a, b) => (a.updatedAt ?? a.issuedAt) - (b.updatedAt ?? b.issuedAt));
  return out;
}

export function nwsUrl(state: string): string {
  return `https://api.weather.gov/alerts/active?area=${encodeURIComponent(state)}`;
}

export const nwsAdapter: DirectAdapter = {
  sourceId: "nws_alerts",
  fixture: () => [{ kind: "json", url: "fixture:nws-alerts.json", fetchedAt: 0, body: nwsFixture }],
  async fetchLive(ctx, now) {
    if (!ctx.userAgent.includes("@") && !ctx.userAgent.includes("http")) {
      throw new NotConfiguredError("NWS alerts", ["NWS_USER_AGENT (must include a contact, e.g. an email)"]);
    }
    const responses: RawResponse[] = [];
    for (const state of ctx.ingestStates) {
      responses.push(await getRaw(ctx, nwsUrl(state), "application/geo+json", "json", now));
    }
    return responses;
  },
  normalize: normalizeNwsAlerts,
};
