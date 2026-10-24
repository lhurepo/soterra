// [B] Corroboration: do other independent sources report the same incident? Pure and deterministic; no model.
// Two chunks corroborate each other when they come from DIFFERENT independence groups (so a feed and an agency's
// own X account, or InciWeb and WFIGS, never count as two voices) and describe the same incident: compatible hazard,
// overlapping area, close in time, and the incident's name appears in both. When both state acres or containment and
// the figures disagree, the tier is "differs" instead of "confirmed". This is a heuristic that errs toward "single":
// a missed match only drops a spoken "also reported by", a false match would overstate confidence.
import type { Corroboration, HazardType, RetrievedChunk } from "../contracts";

const WINDOW_MS = 72 * 3_600_000;
const COMPATIBLE_HAZARDS: HazardType[][] = [["wildfire", "evacuation"]];
/** Acres differing by more than this fraction (and 50 acres), or containment by this many points, is a conflict. */
const ACRES_RATIO = 0.25;
const ACRES_MIN_DIFF = 50;
const CONTAINMENT_POINTS = 15;

/** Words that name a kind of thing or an institution, not an incident. */
const STOP = new Set([
  "fire", "fires", "wildfire", "complex", "incident", "update", "advisory", "warning", "watch", "order", "evacuation", "evacuations",
  "post", "county", "state", "national", "service", "weather", "emergency", "management", "information", "department", "office",
  "california", "services", "issued", "updated", "area", "areas", "north", "south", "east", "west", "valley", "mountain", "creek",
  "demo", "region", "storm", "tropical", "hurricane", "flood", "coastal", "zone", "zones", "road", "closure", "shelter", "shelters",
]);

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

/** The incident's name words: 4+ letters, not a generic word, not a number, not a place the chunk is filed under. */
function nameTokens(title: string, ignore: Set<string>): string[] {
  return words(title).filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !STOP.has(w) && !ignore.has(w));
}

/** Chunks start with "title — issuer — areas — time."; older text falls back to its first sentence. */
export function titleOf(chunk: RetrievedChunk): string {
  const head = chunk.text.split(" — ")[0];
  return head.length < chunk.text.length ? head : chunk.text.split(/(?<=[.!?])\s/)[0];
}

const areaWordSet = (c: RetrievedChunk) => new Set(c.areas.flatMap((a) => words(`${a.label} ${a.county ?? ""}`)));

function hazardsMatch(a: HazardType, b: HazardType): boolean {
  if (a === "other" || b === "other") return false;
  return a === b || COMPATIBLE_HAZARDS.some((g) => g.includes(a) && g.includes(b));
}

function areasOverlap(a: RetrievedChunk, b: RetrievedChunk): boolean {
  if (a.areas.length === 0 || b.areas.length === 0) return true; // national items (an NHC storm) rely on the name match
  const ids = (c: RetrievedChunk) => new Set(c.areas.flatMap((x) => [x.countyFips, x.nwsZone].filter((v): v is string => !!v)));
  const ia = ids(a);
  const ib = ids(b);
  if (ia.size > 0 && ib.size > 0) return [...ia].some((id) => ib.has(id));
  // One side only names a state (an X post): the same state is enough, the name match does the rest.
  return a.areas.some((x) => b.areas.some((y) => x.state === y.state));
}

function namesMatch(a: RetrievedChunk, b: RetrievedChunk): boolean {
  const ignore = new Set([...areaWordSet(a), ...areaWordSet(b)]);
  const inText = (tokens: string[], other: RetrievedChunk) => {
    const bag = new Set(words(other.text));
    return tokens.some((t) => bag.has(t));
  };
  return inText(nameTokens(titleOf(a), ignore), b) || inText(nameTokens(titleOf(b), ignore), a);
}

export function sameIncident(a: RetrievedChunk, b: RetrievedChunk): boolean {
  if ((a.isFixture ?? false) !== (b.isFixture ?? false)) return false;
  if (!hazardsMatch(a.hazardType, b.hazardType)) return false;
  const time = (c: RetrievedChunk) => c.updatedAt ?? c.issuedAt;
  if (Math.abs(time(a) - time(b)) > WINDOW_MS) return false;
  return areasOverlap(a, b) && namesMatch(a, b);
}

const num = (s: string) => Number(s.replace(/,/g, ""));
export function acresIn(text: string): number | undefined {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*acres/i.exec(text);
  return m ? num(m[1]) : undefined;
}
export function containmentIn(text: string): number | undefined {
  const m = /(\d+(?:\.\d+)?)\s*(?:percent|%)\s*contained/i.exec(text);
  return m ? num(m[1]) : undefined;
}

/** True when both chunks state the same figure and the figures clearly disagree. */
export function figuresConflict(a: RetrievedChunk, b: RetrievedChunk): boolean {
  const [aa, ba] = [acresIn(a.text), acresIn(b.text)];
  if (aa !== undefined && ba !== undefined) {
    const diff = Math.abs(aa - ba);
    if (diff > ACRES_MIN_DIFF && diff / Math.max(aa, ba) > ACRES_RATIO) return true;
  }
  const [ac, bc] = [containmentIn(a.text), containmentIn(b.text)];
  return ac !== undefined && bc !== undefined && Math.abs(ac - bc) >= CONTAINMENT_POINTS;
}

/**
 * Compares every servable chunk with the others in the pool (one representative chunk per bulletin) and returns
 * the result for each chunk id. `groupOf` maps a chunk to its independence group.
 */
export function corroborate(pool: RetrievedChunk[], groupOf: (c: RetrievedChunk) => string): Map<string, Corroboration> {
  const byBulletin = new Map<string, RetrievedChunk>();
  for (const c of pool) if (!byBulletin.has(c.bulletinId)) byBulletin.set(c.bulletinId, c);
  const reps = [...byBulletin.values()];

  const perBulletin = new Map<string, Corroboration>();
  for (const a of reps) {
    const sources = new Map<string, string>(); // group → full source name
    let differs = false;
    for (const b of reps) {
      if (a === b || groupOf(a) === groupOf(b) || !sameIncident(a, b)) continue;
      if (!sources.has(groupOf(b))) sources.set(groupOf(b), b.sourceName); // first name wins within a group
      if (figuresConflict(a, b)) differs = true;
    }
    perBulletin.set(a.bulletinId, { tier: differs ? "differs" : sources.size > 0 ? "confirmed" : "single", sources: [...sources.values()] });
  }
  const out = new Map<string, Corroboration>();
  for (const c of pool) out.set(c.chunkId, perBulletin.get(c.bulletinId)!);
  return out;
}
