// [I] Naive paragraph chunking (skeleton). Each chunk is prefixed with the title so it stands alone.
// TODO(I): smarter chunking (sentence windows, shelter tables one row per chunk, size limits).
import type { NormalizedBulletin } from "../contracts";

const MAX_CHUNK_CHARS = 1_200;

export function chunkBulletin(b: Pick<NormalizedBulletin, "title" | "body" | "instructions">): string[] {
  const paragraphs = [b.body, b.instructions ?? ""]
    .join("\n\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const title = b.title.trim().replace(/[.:]?$/, ".");
  if (paragraphs.length === 0) return [title];
  return paragraphs.map((p) => `${title} ${p}`.slice(0, MAX_CHUNK_CHARS));
}
