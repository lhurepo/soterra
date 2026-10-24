// [I] Adapter lookup. Each non-NWS source is a stub until implemented; see the notes for each.
import { NotImplementedError } from "../../config/errors";
import { nwsAdapter } from "./nws";
import type { SourceAdapter } from "./types";

const stub = (sourceId: string, notes: string): SourceAdapter => ({
  sourceId,
  async run() {
    throw new NotImplementedError(`${sourceId} adapter (${notes})`, "I");
  },
});

export const ADAPTERS: Record<string, SourceAdapter> = {
  nws_alerts: nwsAdapter,
  // GeoJSON FeatureCollection; properties.time/updated are epoch ms, properties.url is the event page.
  usgs_earthquakes: stub("usgs_earthquakes", "USGS GeoJSON summary feed"),
  // OData-style API, no key; declarations are context, not live hazards.
  openfema_declarations: stub("openfema_declarations", "OpenFEMA v2 DisasterDeclarationsSummaries"),
  // CurrentStorms.json: activeStorms[] with publicAdvisory/forecastAdvisory product links.
  nhc_storms: stub("nhc_storms", "NHC CurrentStorms.json"),
  // CAP XML; also PHEBCAP.xml (PTWC) and Atom feeds.
  tsunami_ntwc: stub("tsunami_ntwc", "Tsunami.gov CAP XML"),
  // RSS 2.0 incident list; details need the incident page.
  inciweb: stub("inciweb", "InciWeb RSS"),
  // ArcGIS FeatureServer query; ModifiedOnDateTime_dt is epoch ms; POOState like "US-CA".
  nifc_wfigs: stub("nifc_wfigs", "WFIGS current incident locations"),
  // Scraped through Apify (POST /ingest/apify), then LLM extraction with quoted spans.
  disasterassistance_gov: stub("disasterassistance_gov", "scrape via Apify"),
  county_emergency_web: stub("county_emergency_web", "scrape via Apify"),
  x_official: stub("x_official", "Apify X actor, allowlisted accounts only"),
  x_unverified: stub("x_unverified", "Apify X actor, signal only, never answerable"),
};
