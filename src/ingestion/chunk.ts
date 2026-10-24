// [I] Chunking: ~800–1,200 characters on paragraph boundaries. Every chunk starts with a one-sentence
// header (title, issuer, areas, time with its basis) so a chunk read alone still says what, who, where, when.
// The header is a single sentence with no internal . ! or ? so sentence splitters treat it as one unit.
import type { NormalizedBulletin, TimeBasis } from "../contracts";
import { formatSpokenTime } from "../orchestration/time";

export const CHUNK_TARGET_CHARS = 1_200;

type ChunkInput = Pick<
  NormalizedBulletin,
  "title" | "body" | "instructions" | "sourceName" | "areas" | "issuedAt" | "updatedAt" | "timeBasis"
>;

function clean(s: string): string {
  return s.replace(/[.!?]+/g, "").replace(/\s+/g, " ").trim();
}

export function timeLabel(issuedAt: number, updatedAt: number | undefined, basis: TimeBasis | undefined, state: string | undefined): string {
  const at = (ms: number) => formatSpokenTime(ms, state, "en");
  switch (basis ?? "issued") {
    case "observed":
      return `no published time, as observed when Soterra checked ${at(issuedAt)}`;
    case "page_updated":
      return `page last updated ${at(updatedAt ?? issuedAt)}`;
    case "issued":
      return updatedAt !== undefined && updatedAt !== issuedAt
        ? `issued ${at(issuedAt)}, updated ${at(updatedAt)}`
        : `issued ${at(issuedAt)}`;
  }
}

export function chunkHeader(b: ChunkInput): string {
  const areas = b.areas.map((a) => a.label).filter(Boolean);
  const where = areas.length > 0 ? clean(areas.slice(0, 4).join(", ")) : "no specific area given";
  const when = clean(timeLabel(b.issuedAt, b.updatedAt, b.timeBasis, b.areas[0]?.state));
  return `${clean(b.title)} — ${clean(b.sourceName)} — ${where} — ${when}.`;
}

/** Splits text that is longer than the target at sentence boundaries. */
function splitLong(paragraph: string): string[] {
  if (paragraph.length <= CHUNK_TARGET_CHARS) return [paragraph];
  const sentences = paragraph.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [paragraph];
  const parts: string[] = [];
  let current = "";
  for (const s of sentences) {
    if (current && (current + s).length > CHUNK_TARGET_CHARS) {
      parts.push(current.trim());
      current = "";
    }
    // A single sentence longer than the target is hard-split (rare; keeps documents bounded).
    let rest = s;
    while (rest.length > CHUNK_TARGET_CHARS) {
      parts.push(rest.slice(0, CHUNK_TARGET_CHARS).trim());
      rest = rest.slice(CHUNK_TARGET_CHARS);
    }
    current += rest;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function chunkBulletin(b: ChunkInput): string[] {
  const header = chunkHeader(b);
  const paragraphs = [b.body, b.instructions ?? ""]
    .join("\n\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .flatMap(splitLong);
  if (paragraphs.length === 0) return [header];

  const bodies: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && current.length + 1 + p.length > CHUNK_TARGET_CHARS) {
      bodies.push(current);
      current = p;
    } else {
      current = current ? `${current} ${p}` : p;
    }
  }
  if (current) bodies.push(current);
  return bodies.map((body) => `${header} ${body}`);
}
