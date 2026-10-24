// [I] Every adapter normalizes its fixture into valid NormalizedBulletins (no network).
import { describe, expect, it } from "vitest";
import { NormalizedBulletin } from "../src/contracts";
import { APIFY_ADAPTERS, DIRECT_ADAPTERS } from "../src/ingestion/adapters";
import type { NormalizeContext } from "../src/ingestion/adapters/types";
import { MOCK_APIFY_DATASETS } from "../src/ingestion/apifyFixtures";
import { loadIngestionSettings } from "../src/ingestion/config";
import { createDeterministicExtractionLlm } from "../src/ingestion/extractionMock";
import { finalizeBulletin } from "../src/ingestion/normalize";
import { SOURCES, sourceById } from "../src/ingestion/sources";

const NOW = Date.parse("2026-10-25T02:00:00Z");
const settings = loadIngestionSettings({});
const ctx = (sourceId: string): NormalizeContext => ({ source: sourceById(sourceId)!, now: NOW, ingestStates: ["CA"], isFixture: true, settings });
const deps = { llm: createDeterministicExtractionLlm(), model: "claude-sonnet-5-5" };

describe("registry", () => {
  it("has an adapter for every source", () => {
    for (const s of SOURCES) {
      expect(s.fetchVia === "direct" ? DIRECT_ADAPTERS[s.sourceId] : APIFY_ADAPTERS[s.sourceId], s.sourceId).toBeDefined();
    }
  });
});

describe("direct adapters on fixtures", () => {
  it.each(Object.keys(DIRECT_ADAPTERS))("%s → valid bulletins", (sourceId) => {
    const adapter = DIRECT_ADAPTERS[sourceId];
    const result = adapter.normalize(adapter.fixture(), ctx(sourceId));
    expect(result.rejected).toEqual([]);
    expect(result.drafts.length).toBeGreaterThan(0);
    for (const d of result.drafts) {
      const parsed = NormalizedBulletin.safeParse(finalizeBulletin(d));
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      expect(d.isFixture).toBe(true);
      expect(d.trustTier).toBe("official");
    }
  });
});

describe("NWS", () => {
  const result = DIRECT_ADAPTERS.nws_alerts.normalize(DIRECT_ADAPTERS.nws_alerts.fixture(), ctx("nws_alerts"));
  const byEvent = (re: RegExp) => result.drafts.filter((d) => re.test(d.title));

  it("maps Alert fields, severity, hazard, times and areas (UGC zone + SAME county)", () => {
    const alert = result.drafts.find((d) => d.externalId.includes("demo-rfw-a"))!;
    expect(alert).toMatchObject({
      hazardType: "wildfire",
      severity: "severe",
      status: "actual",
      issuedAt: Date.parse("2026-10-24T08:00:00-07:00"),
      expiresAt: Date.parse("2026-10-25T20:00:00-07:00"),
      url: "https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.demo-rfw-a.001.1",
      incidentKey: "nws:KMTR.FW.W.0099",
    });
    expect(alert.updatedAt).toBeUndefined();
    expect(alert.areas).toEqual([
      { state: "CA", nwsZone: "CAZ504", label: "North Bay Interior Valleys (Demo)" },
      { state: "CA", county: "Sonoma", countyFips: "06097", label: "Sonoma County" },
    ]);
  });

  it("keeps an Update in the same lineage via references, with the original issue time", () => {
    const upd = result.drafts.find((d) => d.externalId.includes("demo-rfw-b"))!;
    expect(upd.supersedesExternalIds).toEqual(["urn:oid:2.49.0.1.840.0.demo-rfw-a.001.1"]);
    expect(upd.issuedAt).toBe(Date.parse("2026-10-24T08:00:00-07:00"));
    expect(upd.updatedAt).toBe(Date.parse("2026-10-24T15:00:00-07:00"));
    expect(upd.severity).toBe("extreme");
    expect(upd.areas.map((a) => a.nwsZone ?? a.countyFips)).toEqual(["CAZ504", "CAZ505", "06097", "06055"]);
    // processed after the alert it updates
    const order = result.drafts.map((d) => d.externalId);
    expect(order.indexOf(upd.externalId)).toBeGreaterThan(order.findIndex((id) => id.includes("demo-rfw-a")));
  });

  it("maps Cancel to cancelled and Test to test (stored, never served)", () => {
    expect(byEvent(/cancelled/i)[0]).toMatchObject({ status: "cancelled", supersedesExternalIds: ["urn:oid:2.49.0.1.840.0.demo-fla-c.001.1"] });
    expect(byEvent(/test message/i)[0].status).toBe("test");
  });

  it("treats an Alert whose VTEC actions are all CAN/EXP as a cancellation (seen live)", () => {
    const fixture = DIRECT_ADAPTERS.nws_alerts.fixture()[0];
    const body = structuredClone(fixture.kind === "json" ? fixture.body : {}) as { features: { properties: Record<string, unknown> }[] };
    body.features = [body.features[0]];
    body.features[0].properties.parameters = { VTEC: ["/O.CAN.KMTR.FW.W.0099.000000T0000Z-261026T0300Z/"] };
    expect(DIRECT_ADAPTERS.nws_alerts.normalize([{ ...fixture, kind: "json", body }], ctx("nws_alerts")).drafts[0].status).toBe("cancelled");
    body.features[0].properties.parameters = { VTEC: ["/O.CAN.KMTR.FW.A.0099.000000T0000Z-261026T0300Z/", "/O.NEW.KMTR.FW.W.0100.261024T1500Z-261026T0300Z/"] };
    expect(DIRECT_ADAPTERS.nws_alerts.normalize([{ ...fixture, kind: "json", body }], ctx("nws_alerts")).drafts[0].status).toBe("actual");
  });

  it("rejects an alert without a sent time instead of inventing one", () => {
    const fixture = DIRECT_ADAPTERS.nws_alerts.fixture()[0];
    const body = structuredClone(fixture.kind === "json" ? fixture.body : {}) as { features: { properties: Record<string, unknown> }[] };
    delete body.features[0].properties.sent;
    const r = DIRECT_ADAPTERS.nws_alerts.normalize([{ ...fixture, kind: "json", body }], ctx("nws_alerts"));
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].reason).toMatch(/sent time/);
  });

  it("drops alerts with no area in INGEST_STATES", () => {
    const other = DIRECT_ADAPTERS.nws_alerts.normalize(DIRECT_ADAPTERS.nws_alerts.fixture(), { ...ctx("nws_alerts"), ingestStates: ["NV"] });
    expect(other.drafts).toEqual([]);
    expect(other.skipped).toBe(5);
  });
});

describe("USGS", () => {
  it("keeps quakes above the magnitude threshold in configured states", () => {
    const r = DIRECT_ADAPTERS.usgs_earthquakes.normalize(DIRECT_ADAPTERS.usgs_earthquakes.fixture(), ctx("usgs_earthquakes"));
    expect(r.drafts).toHaveLength(1);
    expect(r.skipped).toBe(2);
    expect(r.drafts[0]).toMatchObject({ externalId: "ncdemo0001", severity: "minor", hazardType: "earthquake", areas: [{ state: "CA", label: "6 km NE of Glen Ellen, CA" }] });
  });
});

describe("other feeds", () => {
  it("FEMA groups county rows into one declaration", () => {
    const r = DIRECT_ADAPTERS.openfema_declarations.normalize(DIRECT_ADAPTERS.openfema_declarations.fixture(), ctx("openfema_declarations"));
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0].areas.map((a) => a.countyFips)).toEqual(["06097", "06055"]);
    expect(r.drafts[0].hazardType).toBe("wildfire");
  });

  it("Tsunami exercise messages are stored with status exercise", () => {
    const r = DIRECT_ADAPTERS.tsunami_ntwc.normalize(DIRECT_ADAPTERS.tsunami_ntwc.fixture(), ctx("tsunami_ntwc"));
    expect(r.drafts[0]).toMatchObject({ status: "exercise", hazardType: "tsunami", areas: [{ state: "CA", label: "California" }] });
  });

  it("InciWeb skips prescribed burns and reads the state and county", () => {
    const r = DIRECT_ADAPTERS.inciweb.normalize(DIRECT_ADAPTERS.inciweb.fixture(), ctx("inciweb"));
    expect(r.drafts).toHaveLength(1);
    expect(r.skipped).toBe(1);
    expect(r.drafts[0].areas).toEqual([{ state: "CA", county: "Sonoma", countyFips: "06097", label: "Sonoma County" }]);
  });

  it("WFIGS skips prescribed fires and maps POOCounty", () => {
    const r = DIRECT_ADAPTERS.nifc_wfigs.normalize(DIRECT_ADAPTERS.nifc_wfigs.fixture(), ctx("nifc_wfigs"));
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]).toMatchObject({ externalId: "2026-CALNU-099999", timeBasis: "issued", areas: [{ countyFips: "06097" }] });
  });
});

describe("Apify adapters on mock datasets", () => {
  it("county page v1 → evacuation warning (severe) with page time and zone areas", async () => {
    const r = await APIFY_ADAPTERS.mock_county_emergency.normalizeItems(MOCK_APIFY_DATASETS.mock_county_emergency.v1, ctx("mock_county_emergency"), deps);
    expect(r.rejected).toEqual([]);
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]).toMatchObject({
      title: "Ridgeview Fire: Evacuation Updates",
      hazardType: "evacuation",
      severity: "severe",
      timeBasis: "page_updated",
      issuedAt: Date.parse("2026-10-24T20:45:00Z"),
      incidentKey: "ridgeview-fire",
      trustTier: "official",
    });
    expect(r.drafts[0].areas.map((a) => a.label)).toEqual([
      "Zone SON-3A: Ridgeview Road from Highway 12 to Bennett Valley Road",
      "Zone SON-3B: Matanzas Creek area",
    ]);
    expect(r.drafts[0].areas[0]).toMatchObject({ state: "CA", countyFips: "06097" });
  });

  it("county page v2 → evacuation order (extreme)", async () => {
    const r = await APIFY_ADAPTERS.mock_county_emergency.normalizeItems(MOCK_APIFY_DATASETS.mock_county_emergency.v2, ctx("mock_county_emergency"), deps);
    expect(r.drafts[0]).toMatchObject({ severity: "extreme", externalId: "https://demo.soterra.example/mock-sites/county-emergency.html" });
    expect(r.drafts[0].instructions).toBe("If you are in zone SON-3A, leave now.");
  });

  it("a page without a published time is observed at fetch time", async () => {
    const r = await APIFY_ADAPTERS.mock_disaster_assistance.normalizeItems(MOCK_APIFY_DATASETS.mock_disaster_assistance.v1, ctx("mock_disaster_assistance"), deps);
    expect(r.drafts[0]).toMatchObject({ timeBasis: "observed", issuedAt: Date.parse("2026-10-24T21:00:12.345Z"), severity: "unknown" });
  });

  it("shelter rows → one bulletin per shelter, cell text only", async () => {
    const r = await APIFY_ADAPTERS.mock_shelters.normalizeItems(MOCK_APIFY_DATASETS.mock_shelters.v1, ctx("mock_shelters"), deps);
    expect(r.drafts).toHaveLength(2);
    expect(r.drafts[0]).toMatchObject({
      title: "Shelter: Ridgeview Community Center (Open)",
      hazardType: "shelter",
      timeBasis: "page_updated",
      issuedAt: Date.parse("2026-10-24T21:30:00Z"),
      areas: [{ state: "CA", city: "Santa Rosa", label: "Santa Rosa, Sonoma County" }],
    });
    expect(r.drafts[0].body).toBe(
      "Ridgeview Community Center, 500 Elm Street, Santa Rosa. Status: Open. Capacity: 200. Spaces available: 120. Pets: Pets in crates. Accessibility: Wheelchair accessible. Checked by county staff at 2:30 PM PDT on October 24, 2026.",
    );
    const v2 = await APIFY_ADAPTERS.mock_shelters.normalizeItems(MOCK_APIFY_DATASETS.mock_shelters.v2, ctx("mock_shelters"), deps);
    expect(v2.drafts[0].body).toContain("Spaces available: 35.");
  });

  it("a shelter row without a status is rejected rather than assumed open", async () => {
    const item = { ...MOCK_APIFY_DATASETS.mock_shelters.v1[0] as object, rows: [{ shelter: "Hillcrest Elementary", address: "1 School Rd, Santa Rosa" }] };
    const r = await APIFY_ADAPTERS.mock_shelters.normalizeItems([item], ctx("mock_shelters"), deps);
    expect(r.drafts).toEqual([]);
    expect(r.rejected[0].reason).toMatch(/status/);
  });
});

describe("X routing", () => {
  it("allowlisted posts become official_social bulletins; others become signals only", async () => {
    const r = await APIFY_ADAPTERS.x_posts.normalizeItems(MOCK_APIFY_DATASETS.x_posts.v1, ctx("x_posts"), deps);
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]).toMatchObject({
      sourceName: "Sonoma County OES (Demo)",
      trustTier: "official_social",
      issuedAt: Date.parse("2026-10-24T20:50:00Z"),
      areas: [{ state: "CA", countyFips: "06097" }],
    });
    expect(r.signals.map((s) => s.authorHandle)).toEqual(["somebody_local", "fire_rumors_demo", "another_local_demo"]);
    expect(r.skipped).toBe(1); // the retweet
  });

  it("the injection post is stored as ordinary text and gains nothing", async () => {
    const r = await APIFY_ADAPTERS.x_posts.normalizeItems(MOCK_APIFY_DATASETS.x_posts.v1, ctx("x_posts"), deps);
    const injection = r.signals.find((s) => s.authorHandle === "fire_rumors_demo")!;
    expect(injection.text).toMatch(/IGNORE ALL PREVIOUS INSTRUCTIONS/);
    expect(r.drafts.some((d) => d.body.includes("IGNORE ALL PREVIOUS"))).toBe(false);
  });
});
