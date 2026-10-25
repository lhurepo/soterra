// [I] Typed source registry, synced into the `sources` table by internal.sources.syncRegistry.
// Sources start disabled (the cron tick only runs enabled ones) and in fixture mode (no network, no keys).
// Trust tier is a property of the source and is never taken from content or from a model.
// Endpoints verified 2026-10-24 (docs/DECISIONS.md, docs/ingestion.md).
import { DEMO_SITES, DEMO_X_ACCOUNTS } from "../../demo/scenario";
import type { AreaRef, SourceDefinition } from "../contracts";
import type { XAllowlistEntry } from "./config";

export type SourceMode = "fixture" | "live";
export type ApifyActorKind = "website-content-crawler" | "cheerio-scraper" | "tweet-scraper";

export type IngestionSource = SourceDefinition & {
  mode: SourceMode;
  /** The content is fictional even when fetched live (the Convex-served mock sites): always isFixture. */
  contentIsFixture?: boolean;
  /** The area this source has authority over. Comes from configuration, never from content. */
  jurisdiction?: AreaRef;
  apify?: { actor: ApifyActorKind; mockSitePath?: string; maxItems?: number; pageFunction?: "shelters" | "x-feed" };
  /** Mock X feeds only: fictional official accounts whose posts become bulletins (added to X_ALLOWLIST). */
  xAllowlist?: XAllowlistEntry[];
};

const SONOMA: AreaRef = { state: "CA", county: "Sonoma", countyFips: "06097", label: "Sonoma County" };
const SAN_FRANCISCO: AreaRef = { state: "CA", county: "San Francisco", countyFips: "06075", label: "San Francisco County" };

/** The Marina Earthquake demo (demo/scenario.ts): Convex-served mock sites crawled by real Apify actors on demand. */
const DEMO_SOURCES: IngestionSource[] = DEMO_SITES.map((site) => ({
  sourceId: site.sourceId,
  name: site.name,
  kind: site.kind,
  trustTier: site.kind === "social" ? "official_social" : "official",
  fetchVia: "apify",
  normalIntervalMin: 30,
  crisisIntervalMin: 5,
  // Never polled by the tick: `npm run demo:start` crawls them when the presenter says so (convex/demo.ts).
  enabled: false,
  mode: "fixture",
  regionStates: ["CA"],
  endpoint: `{CONVEX_SITE_URL}/mock-sites/${site.path}`,
  contentIsFixture: true,
  jurisdiction: SAN_FRANCISCO,
  apify: { actor: site.actor, mockSitePath: site.path, maxItems: 1, pageFunction: site.pageFunction },
  ...(site.pageFunction === "x-feed" ? { xAllowlist: DEMO_X_ACCOUNTS } : {}),
}));

export const SOURCES: IngestionSource[] = [
  {
    sourceId: "nws_alerts",
    name: "National Weather Service",
    kind: "official_api",
    trustTier: "official",
    fetchVia: "direct",
    normalIntervalMin: 5,
    crisisIntervalMin: 1,
    enabled: false,
    mode: "fixture",
    regionStates: ["CA"],
    endpoint: "https://api.weather.gov/alerts/active?area={STATE}",
  },
  {
    sourceId: "usgs_earthquakes",
    name: "U.S. Geological Survey",
    kind: "official_api",
    trustTier: "official",
    fetchVia: "direct",
    normalIntervalMin: 5,
    crisisIntervalMin: 2,
    enabled: false,
    mode: "fixture",
    regionStates: ["CA"],
    endpoint: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_hour.geojson",
  },
  {
    sourceId: "openfema_declarations",
    name: "FEMA",
    kind: "official_api",
    trustTier: "official",
    fetchVia: "direct",
    normalIntervalMin: 60,
    crisisIntervalMin: 30,
    enabled: false,
    mode: "fixture",
    regionStates: ["CA"],
    endpoint: "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$filter=state eq '{STATE}'&$orderby=declarationDate desc&$top=50",
  },
  {
    sourceId: "nhc_storms",
    name: "National Hurricane Center",
    kind: "official_api",
    trustTier: "official",
    fetchVia: "direct",
    normalIntervalMin: 30,
    crisisIntervalMin: 10,
    enabled: false,
    mode: "fixture",
    regionStates: ["*"],
    endpoint: "https://www.nhc.noaa.gov/CurrentStorms.json",
  },
  {
    sourceId: "tsunami_ntwc",
    name: "National Tsunami Warning Center",
    kind: "official_api",
    trustTier: "official",
    fetchVia: "direct",
    normalIntervalMin: 5,
    crisisIntervalMin: 1,
    enabled: false,
    mode: "fixture",
    regionStates: ["*"],
    endpoint: "https://www.tsunami.gov/events/xml/PAAQCAP.xml",
  },
  {
    sourceId: "inciweb",
    name: "InciWeb",
    kind: "official_api",
    trustTier: "official",
    fetchVia: "direct",
    normalIntervalMin: 30,
    crisisIntervalMin: 10,
    enabled: false,
    mode: "fixture",
    regionStates: ["*"],
    endpoint: "https://inciweb.wildfire.gov/incidents/rss.xml",
  },
  {
    sourceId: "nifc_wfigs",
    name: "National Interagency Fire Center",
    kind: "official_api",
    trustTier: "official",
    fetchVia: "direct",
    normalIntervalMin: 15,
    crisisIntervalMin: 5,
    enabled: false,
    mode: "fixture",
    regionStates: ["CA"],
    endpoint:
      "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query?where=POOState%3D%27US-{STATE}%27&outFields=*&f=geojson",
  },
  {
    sourceId: "usgs_volcanoes",
    name: "U.S. Geological Survey Volcano Hazards Program",
    kind: "official_api",
    trustTier: "official",
    fetchVia: "direct",
    normalIntervalMin: 15,
    crisisIntervalMin: 5,
    enabled: false,
    mode: "fixture",
    regionStates: ["*"],
    endpoint: "https://volcanoes.usgs.gov/vsc/api/volcanoApi/elevated",
  },
  {
    sourceId: "mock_county_emergency",
    name: "Sonoma County Emergency Management (Demo)",
    kind: "official_web",
    trustTier: "official",
    fetchVia: "apify",
    normalIntervalMin: 30,
    crisisIntervalMin: 5,
    enabled: false,
    mode: "fixture",
    regionStates: ["CA"],
    endpoint: "{CONVEX_SITE_URL}/mock-sites/county-emergency.html",
    contentIsFixture: true,
    jurisdiction: SONOMA,
    apify: { actor: "website-content-crawler", mockSitePath: "county-emergency.html", maxItems: 1 },
  },
  {
    sourceId: "mock_shelters",
    name: "Sonoma County Emergency Management (Demo)",
    kind: "official_web",
    trustTier: "official",
    fetchVia: "apify",
    normalIntervalMin: 30,
    crisisIntervalMin: 5,
    enabled: false,
    mode: "fixture",
    regionStates: ["CA"],
    endpoint: "{CONVEX_SITE_URL}/mock-sites/shelters.html",
    contentIsFixture: true,
    jurisdiction: SONOMA,
    apify: { actor: "cheerio-scraper", mockSitePath: "shelters.html", maxItems: 1 },
  },
  {
    sourceId: "mock_disaster_assistance",
    name: "DisasterAssistance.gov (Demo)",
    kind: "official_web",
    trustTier: "official",
    fetchVia: "apify",
    normalIntervalMin: 360,
    crisisIntervalMin: 60,
    enabled: false,
    mode: "fixture",
    regionStates: ["CA"],
    endpoint: "{CONVEX_SITE_URL}/mock-sites/disaster-assistance.html",
    contentIsFixture: true,
    jurisdiction: SONOMA,
    apify: { actor: "website-content-crawler", mockSitePath: "disaster-assistance.html", maxItems: 1 },
  },
  {
    // Allowlisted accounts (X_ALLOWLIST) become official_social bulletins; every other post is a signal only.
    sourceId: "x_posts",
    name: "X (official accounts)",
    kind: "social",
    trustTier: "official_social",
    fetchVia: "apify",
    // The Tweet Scraper actor forbids repeating the same query at short intervals.
    normalIntervalMin: 60,
    crisisIntervalMin: 30,
    enabled: false,
    mode: "fixture",
    regionStates: ["CA"],
    apify: { actor: "tweet-scraper", maxItems: 50 },
  },
  ...DEMO_SOURCES,
];

export function sourceById(sourceId: string): IngestionSource | undefined {
  return SOURCES.find((s) => s.sourceId === sourceId);
}

/** Effective mode for one run: explicit override, else APIFY_MODE=live promotes Apify sources, else the row's mode. */
export function effectiveMode(
  source: Pick<IngestionSource, "fetchVia" | "mode">,
  override: SourceMode | undefined,
  apifyMode: "mock" | "live",
): SourceMode {
  if (override) return override;
  if (source.fetchVia === "apify" && apifyMode === "live") return "live";
  return source.mode;
}

/** Fixture runs and fictional content are always flagged; live official data never is. */
export function isFixtureRun(source: Pick<IngestionSource, "contentIsFixture">, mode: SourceMode): boolean {
  return mode === "fixture" || source.contentIsFixture === true;
}


/**
 * Independence groups: sources in the same group are one voice, so agreeing with each other is not
 * corroboration. InciWeb and WFIGS both come from NIFC's IRWIN incident data; an agency's X account is the same
 * voice as that agency's feed. A source with no entry is its own group.
 */
export const INDEPENDENCE_GROUPS: Record<string, string> = {
  nws_alerts: "nws",
  demo_nws: "nws",
  usgs_earthquakes: "usgs",
  usgs_volcanoes: "usgs",
  openfema_declarations: "fema",
  nhc_storms: "nhc",
  tsunami_ntwc: "ntwc",
  inciweb: "nifc-irwin",
  nifc_wfigs: "nifc-irwin",
  // The fictional Sonoma County sources are one publisher (county government), so they never confirm each other.
  demo_county: "sonoma-county",
  demo_fire: "sonoma-county",
  mock_county_emergency: "sonoma-county",
  mock_shelters: "sonoma-county",
  mock_disaster_assistance: "disasterassistance-demo",
  ...Object.fromEntries(DEMO_SITES.map((s) => [s.sourceId, s.group])),
};

export function independenceGroupOf(sourceId: string, sourceName: string, xAllowlist: { issuer: string; handle: string; group?: string }[] = []): string {
  const feedAccounts = sourceById(sourceId)?.xAllowlist;
  if (sourceId === "x_posts" || feedAccounts) {
    const entry = [...(feedAccounts ?? []), ...xAllowlist].find((e) => e.issuer === sourceName);
    return entry?.group ?? `x:${entry?.handle ?? sourceName}`;
  }
  return INDEPENDENCE_GROUPS[sourceId] ?? sourceId;
}
