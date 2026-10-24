// [I] NWS alerts adapter (stub). Dhweya's first task: make this work end to end for one state.
// Verified 2026-10-24: GET https://api.weather.gov/alerts/active?area=CA, no key, User-Agent REQUIRED,
// default response application/geo+json. See fixtures/raw/nws-alerts.json for the shape.
//
// Mapping notes for the implementation:
// - externalId: must be stable across updates. `properties.id` changes on every update (updates list the
//   prior ids in `properties.references`), so key on the VTEC event (office.phenomena.significance.etn from
//   `parameters.VTEC`) when present, else the first reference id, else `properties.id`.
// - status: "Actual" → actual, "Test"/"Exercise"/"System"/"Draft" → test/exercise (never served).
//   messageType "Cancel" → status cancelled.
// - severity: Extreme/Severe/Moderate/Minor/Unknown → lowercase. issuedAt = sent, effectiveAt = effective,
//   expiresAt = ends ?? expires. url = properties["@id"] (the `web` field is a generic homepage).
// - areas: one AreaRef per `geocode.UGC` zone; county FIPS from `geocode.SAME` (drop the leading 0).
// - geometry: often null (zone-based alerts); store when present.
import { NotConfiguredError, NotImplementedError } from "../../config/errors";
import type { NormalizedBulletinDraft } from "../../contracts";
import type { SourceAdapter } from "./types";

export function nwsRequest(state: string, userAgent: string | undefined): { url: string; init: RequestInit } {
  if (!userAgent) throw new NotConfiguredError("NWS alerts", ["NWS_USER_AGENT"]);
  return {
    url: `https://api.weather.gov/alerts/active?area=${encodeURIComponent(state)}`,
    init: { headers: { "User-Agent": userAgent, Accept: "application/geo+json" } },
  };
}

export function normalizeNwsAlerts(_raw: unknown, _now: number): NormalizedBulletinDraft[] {
  throw new NotImplementedError("NWS alert normalization", "I");
}

export const nwsAdapter: SourceAdapter = {
  sourceId: "nws_alerts",
  async run({ config, fetch, now }) {
    const drafts: NormalizedBulletinDraft[] = [];
    for (const state of config.INGEST_STATES) {
      const { url, init } = nwsRequest(state, config.NWS_USER_AGENT);
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(`NWS ${state}: HTTP ${res.status}`);
      drafts.push(...normalizeNwsAlerts(await res.json(), now));
    }
    return drafts;
  },
};
