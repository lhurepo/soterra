// [I] Normalization helpers shared by every adapter: content hashing and finalizing drafts.
import type { NormalizedBulletin, NormalizedBulletinDraft } from "../contracts";

/**
 * Synchronous 53-bit string hash (cyrb53). Works in queries, mutations, actions and Python-free tests.
 * Only compared against the same bulletin's previous version, so collisions are not a practical concern.
 */
export function hashString(input: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** The fields whose change means "the bulletin says something different". Fetch-time noise is excluded. */
export function contentHashOf(draft: NormalizedBulletinDraft): string {
  const material = {
    title: draft.title,
    body: draft.body,
    instructions: draft.instructions ?? null,
    hazardType: draft.hazardType,
    severity: draft.severity,
    status: draft.status,
    expiresAt: draft.expiresAt ?? null,
    areas: draft.areas.map((a) => [a.state, a.countyFips ?? null, a.nwsZone ?? null, a.label]),
  };
  return hashString(JSON.stringify(material));
}

export function finalizeBulletin(draft: NormalizedBulletinDraft): NormalizedBulletin {
  return { ...draft, contentHash: contentHashOf(draft) };
}

/** Parses an ISO-8601 time from a feed. Returns undefined instead of inventing a time. */
export function parseFeedTime(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}
