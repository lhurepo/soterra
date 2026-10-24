// [B] Area resolution for a turn, in priority order: a US ZIP code in the utterance, a city or county
// name matching an active bulletin area label, the call's known area, then the caller context.
// US only. A ZIP gives a state (from its 3-digit prefix) and the ZIP itself; county needs a lookup
// table we do not ship yet (see docs/backend.md, known limits).
import type { AreaRef } from "../contracts";
import { normalizeForMatch } from "./text";

/** An active bulletin area, as cached on the call for name matching. */
export type AreaCandidate = { label: string; state: string; countyFips?: string; nwsZone?: string };

export type AreaSource = "zip" | "place" | "call" | "context" | "none";
export type ResolvedArea = { area?: AreaRef; source: AreaSource };

// First three ZIP digits → state (USPS ranges). Military, territories and gaps are left out.
const ZIP3_RANGES: [number, number, string][] = [
  [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"], [39, 49, "ME"], [50, 59, "VT"], [60, 69, "CT"],
  [70, 89, "NJ"], [100, 149, "NY"], [150, 196, "PA"], [197, 199, "DE"], [200, 205, "DC"], [206, 219, "MD"],
  [220, 246, "VA"], [247, 268, "WV"], [270, 289, "NC"], [290, 299, "SC"], [300, 319, "GA"], [320, 349, "FL"],
  [350, 369, "AL"], [370, 385, "TN"], [386, 397, "MS"], [398, 399, "GA"], [400, 427, "KY"], [430, 458, "OH"],
  [460, 479, "IN"], [480, 499, "MI"], [500, 528, "IA"], [530, 549, "WI"], [550, 567, "MN"], [570, 577, "SD"],
  [580, 588, "ND"], [590, 599, "MT"], [600, 629, "IL"], [630, 658, "MO"], [660, 679, "KS"], [680, 693, "NE"],
  [700, 714, "LA"], [716, 729, "AR"], [730, 749, "OK"], [750, 799, "TX"], [800, 816, "CO"], [820, 831, "WY"],
  [832, 838, "ID"], [840, 847, "UT"], [850, 865, "AZ"], [870, 884, "NM"], [885, 885, "TX"], [889, 898, "NV"],
  [900, 961, "CA"], [967, 968, "HI"], [970, 979, "OR"], [980, 994, "WA"], [995, 999, "AK"],
];

export function stateForZip(zip: string): string | undefined {
  if (!/^\d{5}$/.test(zip)) return undefined;
  const prefix = Number(zip.slice(0, 3));
  return ZIP3_RANGES.find(([lo, hi]) => prefix >= lo && prefix <= hi)?.[2];
}

/** A 5-digit US ZIP code that maps to a state, ignoring numbers that are part of addresses or times. */
export function extractZip(utterance: string): string | undefined {
  for (const match of utterance.matchAll(/(?<![\d:,.-])(\d{5})(?:-\d{4})?(?![\d:])/g)) {
    if (stateForZip(match[1])) return match[1];
  }
  return undefined;
}

const LABEL_NOISE = /\b(zones?\s+[a-z0-9-]+(\s+(and|y)\s+[a-z0-9-]+)*|interior valleys|area|east of|west of|north of|south of|near)\b/g;
/** Label parts naming a road are not places a caller lives in ("Ridgeview Road, Sonoma County"). */
const ROAD_WORDS = /\b(road|rd|highway|hwy|street|st|avenue|ave|lane|ln|boulevard|blvd|drive|dr|interstate|route)\b/;

/**
 * Speakable place names inside an area label: "Santa Rosa, Sonoma County" → ["santa rosa", "sonoma county",
 * "sonoma"]. Returns normalized (lowercase, no accents) names of at least four characters.
 */
export function placeNamesFromLabel(label: string): string[] {
  const names = new Set<string>();
  const normalized = normalizeForMatch(label);
  for (const county of normalized.matchAll(/\b([a-z][a-z .'-]*?) county\b/g)) {
    const name = county[1].split(/\s*(?:,|\bof\b|\bfor\b)\s*/).pop()!.trim();
    if (name.length >= 4) {
      names.add(`${name} county`);
      names.add(name);
    }
  }
  for (const part of normalized.split(/[,;()]/)) {
    if (ROAD_WORDS.test(part)) continue;
    const cleaned = part.replace(/\b[a-z]+ county\b/g, "").replace(LABEL_NOISE, "").replace(/\s+/g, " ").trim();
    if (cleaned.length >= 4 && !/\d/.test(cleaned)) names.add(cleaned);
  }
  return [...names];
}

/** The longest place name from the candidates that appears as whole words in the utterance. */
export function matchPlace(utterance: string, candidates: AreaCandidate[]): AreaRef | undefined {
  const text = ` ${normalizeForMatch(utterance).replace(/[^\p{L}\p{N}' -]/gu, " ")} `;
  let best: { name: string; candidate: AreaCandidate } | undefined;
  for (const candidate of candidates) {
    for (const name of placeNamesFromLabel(candidate.label)) {
      if (text.includes(` ${name} `) && (!best || name.length > best.name.length)) best = { name, candidate };
    }
  }
  if (!best) return undefined;
  const spoken = best.name.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  return {
    state: best.candidate.state,
    countyFips: best.candidate.countyFips,
    county: best.name.endsWith(" county") ? spoken.replace(/ County$/, "") : undefined,
    city: best.name.endsWith(" county") ? undefined : spoken,
    label: spoken,
  };
}

export function resolveArea(args: {
  utterance: string;
  candidates: AreaCandidate[];
  callArea?: AreaRef;
  contextArea?: AreaRef;
}): ResolvedArea {
  const zip = extractZip(args.utterance);
  if (zip) {
    const state = stateForZip(zip)!;
    // Keep the county of the known area when it is in the same state: a ZIP refines, it doesn't erase.
    const known = args.callArea ?? args.contextArea;
    const sameState = known?.state === state ? known : undefined;
    return {
      area: { state, zip, countyFips: sameState?.countyFips, county: sameState?.county, label: `ZIP code ${zip}` },
      source: "zip",
    };
  }
  const place = matchPlace(args.utterance, args.candidates);
  if (place) return { area: place, source: "place" };
  if (args.callArea) return { area: args.callArea, source: "call" };
  if (args.contextArea) return { area: args.contextArea, source: "context" };
  return { source: "none" };
}
