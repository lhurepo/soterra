// [B] Text normalization shared by the deterministic checks (danger, intents, area matching).

/** Lowercase, NFC, straight apostrophes, no diacritics, single spaces: "¿Está?" → "¿esta?". */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .normalize("NFC")
    .replace(/[‘’ʼ]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
