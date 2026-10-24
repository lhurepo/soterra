// [B] The voice profile: short things a caller asks us to remember ("I use a wheelchair"). Stored on the caller
// row, written and read only on a verified call. Never an address, phone number or email: those are refused,
// because nothing here is meant to say where someone is.
export const MAX_PROFILE_NEEDS = 5;
export const MAX_NEED_CHARS = 80;

const STREET_WORDS = "street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|calle|avenida|camino";

/** True when the text carries an address, a phone number or an email. */
export function looksLikeContactDetail(text: string): boolean {
  return (
    /\d{4,}/.test(text.replace(/[\s-]/g, "")) || // phone numbers, ZIP+4, long ids
    /@/.test(text) ||
    new RegExp(`\\b\\d{1,5}\\s+(?:[a-z]+\\s+){0,3}(?:${STREET_WORDS})\\b`, "i").test(text)
  );
}

export type AddNeedResult = { status: "ok"; need: string; needs: string[] } | { status: "rejected" } | { status: "full" } | { status: "empty" };

/** Tidies one spoken need, then adds it to the list (case-insensitive duplicates are kept once). */
export function addNeed(existing: readonly string[] | undefined, raw: string): AddNeedResult {
  const cleaned = raw
    .replace(/\s+/g, " ")
    .replace(/^(?:that\s+)?/i, "")
    .replace(/[.?!,;:\s]+$/g, "")
    .trim();
  if (cleaned.length < 3) return { status: "empty" };
  if (looksLikeContactDetail(cleaned)) return { status: "rejected" };
  const need = (cleaned.length > MAX_NEED_CHARS ? `${cleaned.slice(0, MAX_NEED_CHARS - 1).trimEnd()}…` : cleaned).replace(/^./, (c) => c.toUpperCase());
  const list = [...(existing ?? [])];
  if (list.some((n) => n.toLowerCase() === need.toLowerCase())) return { status: "ok", need, needs: list };
  if (list.length >= MAX_PROFILE_NEEDS) return { status: "full" };
  return { status: "ok", need, needs: [...list, need] };
}
