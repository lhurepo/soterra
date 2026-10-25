// [I] US geography helpers: state FIPS/USPS/names, NWS UGC and SAME codes, a California county gazetteer.
// Areas are only ever built from codes or names that appear in the source, never guessed.
import type { AreaRef } from "../contracts";

/** State FIPS → USPS code (50 states, DC, territories). */
export const STATE_FIPS_TO_USPS: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
  "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT",
  "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
  "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY", "60": "AS", "66": "GU", "69": "MP",
  "72": "PR", "78": "VI",
};

export const USPS_TO_STATE_FIPS: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_FIPS_TO_USPS).map(([fips, usps]) => [usps, fips]),
);

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands", AS: "American Samoa", MP: "Northern Mariana Islands",
};

/**
 * California counties in alphabetical order. County FIPS codes are the odd numbers 001–115 in this
 * order (Alameda 001 … Sonoma 097 … Yuba 115). TODO(I): add other states as INGEST_STATES grows.
 */
const CA_COUNTIES = [
  "Alameda", "Alpine", "Amador", "Butte", "Calaveras", "Colusa", "Contra Costa", "Del Norte", "El Dorado", "Fresno",
  "Glenn", "Humboldt", "Imperial", "Inyo", "Kern", "Kings", "Lake", "Lassen", "Los Angeles", "Madera", "Marin",
  "Mariposa", "Mendocino", "Merced", "Modoc", "Mono", "Monterey", "Napa", "Nevada", "Orange", "Placer", "Plumas",
  "Riverside", "Sacramento", "San Benito", "San Bernardino", "San Diego", "San Francisco", "San Joaquin",
  "San Luis Obispo", "San Mateo", "Santa Barbara", "Santa Clara", "Santa Cruz", "Shasta", "Sierra", "Siskiyou",
  "Solano", "Sonoma", "Stanislaus", "Sutter", "Tehama", "Trinity", "Tulare", "Tuolumne", "Ventura", "Yolo", "Yuba",
];

type County = { state: string; name: string; countyFips: string };

const COUNTIES: County[] = CA_COUNTIES.map((name, i) => ({
  state: "CA",
  name,
  countyFips: `06${String(2 * i + 1).padStart(3, "0")}`,
}));

const COUNTY_BY_FIPS = new Map(COUNTIES.map((c) => [c.countyFips, c]));

/** County names that are also everyday words ("near the lake"): never matched from speech alone. */
const AMBIGUOUS_COUNTY_NAMES = new Set(["Alpine", "Glenn", "Imperial", "Kings", "Lake", "Mono", "Nevada", "Orange", "Sierra", "Trinity"]);

/** Counties a caller can name by voice ("I'm in San Francisco"), as area labels: "San Francisco County". */
export function speakableCounties(states: string[]): { label: string; state: string; countyFips: string }[] {
  return COUNTIES.filter((c) => states.includes(c.state) && !AMBIGUOUS_COUNTY_NAMES.has(c.name)).map((c) => ({
    label: `${c.name} County`,
    state: c.state,
    countyFips: c.countyFips,
  }));
}

export function countyByFips(countyFips: string): County | undefined {
  return COUNTY_BY_FIPS.get(countyFips);
}

export function countyByName(state: string, name: string): County | undefined {
  const wanted = name.trim().toLowerCase().replace(/\s+county$/, "");
  return COUNTIES.find((c) => c.state === state && c.name.toLowerCase() === wanted);
}

export function countyArea(c: County, label?: string): AreaRef {
  return { state: c.state, county: c.name, countyFips: c.countyFips, label: label ?? `${c.name} County` };
}

/** SAME code "PSSCCC" (P = county subdivision, SS = state FIPS, CCC = county FIPS) → area. */
export function areaFromSame(code: string): AreaRef | undefined {
  const m = /^(\d)(\d{2})(\d{3})$/.exec(code.trim());
  if (!m) return undefined;
  const state = STATE_FIPS_TO_USPS[m[2]];
  if (!state) return undefined;
  const countyFips = `${m[2]}${m[3]}`;
  const county = countyByFips(countyFips);
  return county ? countyArea(county) : { state, countyFips, label: `County ${countyFips}` };
}

/**
 * NWS UGC code "SSZNNN" (forecast/fire zone) or "SSCNNN" (county). The state is the two-letter prefix.
 * Zones keep the code in `nwsZone`; county UGCs become a county FIPS.
 */
export function areaFromUgc(code: string, label?: string): AreaRef | undefined {
  const m = /^([A-Z]{2})([CZ])(\d{3})$/.exec(code.trim());
  if (!m) return undefined;
  const [, state, kind, num] = m;
  if (!STATE_NAMES[state]) return undefined;
  if (kind === "Z") return { state, nwsZone: code, label: label ?? `NWS zone ${code}` };
  const stateFips = USPS_TO_STATE_FIPS[state];
  if (!stateFips) return undefined;
  const county = countyByFips(`${stateFips}${num}`);
  return county ? countyArea(county, label) : { state, countyFips: `${stateFips}${num}`, nwsZone: code, label: label ?? `NWS county ${code}` };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** States named in free text by full name (e.g. "California", "State: Colorado"). */
export function statesNamedIn(text: string): string[] {
  // "West Virginia" must not also count as "Virginia".
  const withoutWestVirginia = text.replace(/West Virginia/g, " ");
  return Object.entries(STATE_NAMES)
    .filter(([usps, name]) => new RegExp(`\\b${escapeRegExp(name)}\\b`).test(usps === "VA" ? withoutWestVirginia : text))
    .map(([usps]) => usps);
}

/** Counties named as "<Name> County" in free text (gazetteer states only). */
export function countiesNamedIn(text: string): County[] {
  return COUNTIES.filter((c) => new RegExp(`\\b${escapeRegExp(c.name)} County\\b`, "i").test(text));
}

/** "10 km NE of Glen Ellen, CA" or "..., California" → USPS state, if the place names one. */
export function stateFromPlace(place: string): string | undefined {
  const last = place.split(",").at(-1)?.trim();
  if (!last) return undefined;
  if (/^[A-Z]{2}$/.test(last) && STATE_NAMES[last]) return last;
  return Object.entries(STATE_NAMES).find(([, name]) => name === last)?.[0];
}
