// [B] Corroboration tiers: when two sources count as independent confirmation, and when they must not.
import { describe, expect, it } from "vitest";
import type { RetrievedChunk } from "../src/contracts";
import { corroborationSentence } from "../src/orchestration/grounding";
import { parseXAllowlist } from "../src/ingestion/config";
import { independenceGroupOf } from "../src/ingestion/sources";
import { acresIn, containmentIn, corroborate, figuresConflict, sameIncident } from "../src/retrieval/corroboration";

const NOW = Date.parse("2026-10-24T20:00:00Z");
const BOUQUET = [{ state: "CA", county: "Los Angeles", countyFips: "06037", label: "Los Angeles County" }];

let n = 0;
function chunk(over: Partial<RetrievedChunk> & { sourceId: string; sourceName: string; text: string }): RetrievedChunk {
  n++;
  return {
    chunkId: `c${n}`,
    bulletinId: `b${n}`,
    url: "https://example.org",
    trustTier: "official",
    issuedAt: NOW - 3_600_000,
    areas: BOUQUET,
    hazardType: "wildfire",
    severity: "unknown",
    score: 1,
    ...over,
  };
}

const wfigs = (over: Partial<RetrievedChunk> = {}) =>
  chunk({ sourceId: "nifc_wfigs", sourceName: "National Interagency Fire Center", text: "Bouquet Fire — National Interagency Fire Center — Los Angeles County — issued today. Bouquet Fire, Los Angeles County: about 1200 acres, 10 percent contained.", ...over });
const inciweb = (over: Partial<RetrievedChunk> = {}) =>
  chunk({ sourceId: "inciweb", sourceName: "InciWeb", text: "CAANF Bouquet — InciWeb — Los Angeles County — issued today. Bouquet incident on the Angeles National Forest.", ...over });
const xPost = (over: Partial<RetrievedChunk> = {}) =>
  chunk({
    sourceId: "x_posts",
    sourceName: "CAL FIRE",
    areas: [{ state: "CA", label: "California" }],
    hazardType: "evacuation",
    text: "Post by CAL FIRE on X — CAL FIRE — California — issued today. Evacuation orders for the Bouquet Fire remain in place near Santa Clarita.",
    ...over,
  });

const groups = (c: RetrievedChunk) => independenceGroupOf(c.sourceId, c.sourceName, parseXAllowlist("CAL_FIRE:CAL FIRE:CA:calfire,NWSBayArea:NWS Bay Area:CA:nws"));
const tierOf = (pool: RetrievedChunk[], c: RetrievedChunk) => corroborate(pool, groups).get(c.chunkId)!;

describe("independence", () => {
  it("InciWeb and WFIGS share one upstream, so agreeing is not corroboration", () => {
    const a = wfigs();
    const b = inciweb();
    expect(sameIncident(a, b)).toBe(true);
    expect(tierOf([a, b], a)).toEqual({ tier: "single", sources: [] });
  });

  it("an agency's X account is the same voice as its feed when it shares the group", () => {
    const nwsAlert = chunk({ sourceId: "nws_alerts", sourceName: "National Weather Service", hazardType: "flood", text: "Coastal Flood Advisory — National Weather Service — Los Angeles County — issued today. Coastal flooding near Malibu." });
    const nwsPost = chunk({ sourceId: "x_posts", sourceName: "NWS Bay Area", hazardType: "flood", text: "Post by NWS Bay Area on X — NWS Bay Area — Los Angeles County — issued today. Coastal flooding near Malibu continues." });
    expect(tierOf([nwsAlert, nwsPost], nwsAlert).tier).toBe("single");
  });
});

describe("confirmed", () => {
  it("a different publisher reporting the same named fire confirms it, on both sides", () => {
    const a = wfigs();
    const x = xPost();
    expect(tierOf([a, x], a)).toEqual({ tier: "confirmed", sources: ["CAL FIRE"] });
    expect(tierOf([a, x], x)).toEqual({ tier: "confirmed", sources: ["National Interagency Fire Center"] });
  });

  it("counts a source once even when several of its bulletins match", () => {
    const a = wfigs();
    const t = tierOf([a, xPost(), xPost({ text: "Post by CAL FIRE on X — CAL FIRE — California — issued today. More on the Bouquet Fire." })], a);
    expect(t.sources).toEqual(["CAL FIRE"]);
  });
});

describe("what must not match", () => {
  it("a different fire in the same county", () => {
    expect(sameIncident(wfigs(), xPost({ text: "Post by CAL FIRE on X — CAL FIRE — California — issued today. Evacuation orders for the Ridgeline Fire." }))).toBe(false);
  });
  it("another hazard, another state, other counties, or more than 72 hours apart", () => {
    expect(sameIncident(wfigs(), xPost({ hazardType: "flood" }))).toBe(false);
    expect(sameIncident(wfigs(), xPost({ areas: [{ state: "OR", label: "Oregon" }] }))).toBe(false);
    expect(sameIncident(wfigs(), xPost({ areas: [{ state: "CA", county: "Kern", countyFips: "06029", label: "Kern County" }] }))).toBe(false);
    expect(sameIncident(wfigs(), xPost({ issuedAt: NOW - 5 * 86_400_000 }))).toBe(false);
  });
  it("fixture data never corroborates real data", () => {
    expect(sameIncident(wfigs(), xPost({ isFixture: true }))).toBe(false);
  });
  it("two chunks of the same incident from the same group are not two sources", () => {
    const [a, b] = [wfigs(), wfigs()];
    expect(tierOf([a, b], a).tier).toBe("single");
  });
});

describe("differs", () => {
  it("parses acres and containment", () => {
    expect(acresIn("about 1,200 acres")).toBe(1200);
    expect(containmentIn("10 percent contained")).toBe(10);
    expect(containmentIn("25% contained")).toBe(25);
    expect(acresIn("no figures")).toBeUndefined();
  });

  it("flags clearly different acres or containment, ignores small gaps and missing figures", () => {
    const a = wfigs();
    expect(figuresConflict(a, xPost({ text: `${xPost().text} It has burned 3,000 acres.` }))).toBe(true);
    expect(figuresConflict(a, xPost({ text: `${xPost().text} It is 60 percent contained.` }))).toBe(true);
    expect(figuresConflict(a, xPost({ text: `${xPost().text} It has burned 1,300 acres.` }))).toBe(false);
    expect(figuresConflict(a, xPost())).toBe(false);
  });

  it("marks both sides as differing", () => {
    const a = wfigs();
    const x = xPost({ text: `${xPost().text} It has burned 3,000 acres.` });
    expect(tierOf([a, x], a).tier).toBe("differs");
    expect(tierOf([a, x], x).tier).toBe("differs");
  });
});

describe("spoken sentence", () => {
  const confirmed = (name: string) => ({ ...wfigs(), corroboration: { tier: "confirmed" as const, sources: [name] } });

  it("names the other source, never one that is already cited, and says nothing for a single source", () => {
    expect(corroborationSentence([confirmed("CAL FIRE")], "en")).toBe("Also reported by CAL FIRE.");
    expect(corroborationSentence([{ ...wfigs(), corroboration: { tier: "single", sources: [] } }], "en")).toBe("");
    expect(corroborationSentence([wfigs()], "en")).toBe("");
    expect(corroborationSentence([confirmed("National Interagency Fire Center")], "en")).toBe("");
  });

  it("never reads out a source whose spoken name overlaps a cited one", () => {
    const fire = { ...wfigs({ sourceName: "Sonoma County Fire Information (Demo)" }), corroboration: { tier: "confirmed" as const, sources: ["Sonoma County Emergency Management (Demo)"] } };
    expect(corroborationSentence([fire], "en")).toBe("");
  });

  it("the Sonoma County demo sources are one publisher, so they never confirm each other", () => {
    expect(independenceGroupOf("demo_fire", "Sonoma County Fire Information (Demo)")).toBe(independenceGroupOf("demo_county", "Sonoma County Emergency Management (Demo)"));
  });

  it("joins two sources, in Spanish too, and a conflict wins", () => {
    const c = { ...wfigs(), corroboration: { tier: "confirmed" as const, sources: ["CAL FIRE", "County Sheriff"] } };
    expect(corroborationSentence([c], "en")).toBe("Also reported by CAL FIRE and County Sheriff.");
    expect(corroborationSentence([c], "es")).toBe("También lo informa CAL FIRE y County Sheriff.");
    expect(corroborationSentence([c, { ...wfigs(), corroboration: { tier: "differs", sources: ["CAL FIRE"] } }], "en")).toBe("Sources differ on the figures.");
  });
});

describe("X allowlist groups", () => {
  it("an optional fourth segment sets the independence group; the default is per handle", () => {
    const list = parseXAllowlist("CAL_FIRE:CAL FIRE:CA:calfire,NWSBayArea:NWS Bay Area:CA:nws,Someone:Some Agency:CA");
    expect(list.map((e) => e.group)).toEqual(["calfire", "nws", undefined]);
    expect(independenceGroupOf("x_posts", "NWS Bay Area", list)).toBe("nws");
    expect(independenceGroupOf("nws_alerts", "National Weather Service")).toBe("nws");
    expect(independenceGroupOf("x_posts", "Some Agency", list)).toBe("x:someone");
    expect(independenceGroupOf("nifc_wfigs", "x")).toBe(independenceGroupOf("inciweb", "y"));
  });
});
