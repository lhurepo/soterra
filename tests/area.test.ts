// [B] Area resolution: ZIP codes, place names from active bulletin labels, then call and context areas.
import { describe, expect, it } from "vitest";
import { extractZip, matchPlace, placeNamesFromLabel, resolveArea, stateForZip, type AreaCandidate } from "../src/orchestration/area";

const candidates: AreaCandidate[] = [
  { label: "Sonoma County interior valleys", state: "CA", countyFips: "06097", nwsZone: "CAZ504" },
  { label: "Santa Rosa, Sonoma County", state: "CA", countyFips: "06097" },
  { label: "Ridgeview Road, Sonoma County", state: "CA", countyFips: "06097" },
  { label: "Sonoma County zones SON-3A and SON-3B", state: "CA", countyFips: "06097" },
  { label: "Multnomah County", state: "OR", countyFips: "41051" },
];

describe("ZIP codes", () => {
  it("maps ZIP prefixes to states", () => {
    expect(stateForZip("95404")).toBe("CA");
    expect(stateForZip("97201")).toBe("OR");
    expect(stateForZip("10001")).toBe("NY");
    expect(stateForZip("77001")).toBe("TX");
    expect(stateForZip("00001")).toBeUndefined();
  });

  it("finds a ZIP in speech but not house numbers or times", () => {
    expect(extractZip("my zip is 95404")).toBe("95404");
    expect(extractZip("I'm in 95404-1234")).toBe("95404");
    expect(extractZip("I live at 412 Oak Lane")).toBeUndefined();
    expect(extractZip("call me at 10:30")).toBeUndefined();
    expect(extractZip("about 1,200 acres")).toBeUndefined();
  });
});

describe("place names from labels", () => {
  it("extracts county and city names, skipping zones and roads", () => {
    expect(placeNamesFromLabel("Santa Rosa, Sonoma County")).toEqual(expect.arrayContaining(["sonoma county", "sonoma", "santa rosa"]));
    expect(placeNamesFromLabel("Sonoma County zones SON-3A and SON-3B")).toEqual(["sonoma county", "sonoma"]);
    expect(placeNamesFromLabel("Ridgeview Road, Sonoma County")).not.toContain("ridgeview");
    expect(placeNamesFromLabel("East of Santa Rosa, Sonoma County")).toContain("santa rosa");
  });

  it("matches the longest place name as whole words", () => {
    expect(matchPlace("Are there shelters in Santa Rosa?", candidates)).toMatchObject({ state: "CA", countyFips: "06097", city: "Santa Rosa", label: "Santa Rosa" });
    expect(matchPlace("anything in sonoma county?", candidates)).toMatchObject({ county: "Sonoma", label: "Sonoma County" });
    expect(matchPlace("What about the Ridgeview Fire?", candidates)).toBeUndefined();
    expect(matchPlace("Is Sonomaville ok?", candidates)).toBeUndefined();
  });
});

describe("resolveArea priority", () => {
  const callArea = { state: "OR", countyFips: "41051", label: "Multnomah County" };
  const contextArea = { state: "CA", countyFips: "06097", label: "Sonoma County" };

  it("prefers a ZIP, then a place name, then the call's area, then the caller context", () => {
    expect(resolveArea({ utterance: "I'm in 95404", candidates, callArea, contextArea })).toMatchObject({ source: "zip", area: { state: "CA", zip: "95404" } });
    expect(resolveArea({ utterance: "shelters in Santa Rosa", candidates, callArea, contextArea })).toMatchObject({ source: "place", area: { label: "Santa Rosa" } });
    expect(resolveArea({ utterance: "any shelters?", candidates, callArea, contextArea })).toMatchObject({ source: "call", area: callArea });
    expect(resolveArea({ utterance: "any shelters?", candidates, contextArea })).toMatchObject({ source: "context", area: contextArea });
    expect(resolveArea({ utterance: "any shelters?", candidates })).toEqual({ source: "none" });
  });

  it("keeps the known county when a ZIP is in the same state", () => {
    expect(resolveArea({ utterance: "zip 95404", candidates, contextArea }).area).toMatchObject({ countyFips: "06097", zip: "95404" });
    expect(resolveArea({ utterance: "zip 97201", candidates, contextArea }).area?.countyFips).toBeUndefined();
  });
});
