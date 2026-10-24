// [B] Grounding enforcement: the deterministic gate between the model and the caller.
// - kind "answer" must cite at least one answerable chunk retrieved in THIS turn; citing any id that was
//   not retrieved is an error. Otherwise the reply becomes the safe no_info reply and the question is saved.
// - Citations come from chunk metadata only. If the reply never names a cited source, the backend
//   appends the attribution sentence (with "as of" when the newest cited source is stale).
// - No exact-address zone answers and no "shelter is open" without an official source and its time.
// - Safety wording is always the canonical string.
import { ANSWERABLE_TRUST_TIERS, type AnswerDraft, type Citation, type ReplyKind, type RetrievedChunk } from "../contracts";
import { DEFAULTS } from "../config/defaults";
import { t, tf } from "../config/strings";
import { asksAboutExactAddress, asksForSource } from "./intents";
import { normalizeForMatch } from "./text";
import { formatShortTime } from "./time";

export type GroundingIssue = "uncited_answer" | "unknown_chunk" | "empty_reply" | "address_claim" | "unsupported_shelter_claim";

export type GroundedReply = {
  kind: ReplyKind;
  reply: string;
  citations: Citation[];
  citedChunks: RetrievedChunk[];
  endCall: boolean;
  /** Set when the turn must be recorded as an unanswered question. */
  unansweredQuestion?: string;
  /** True when the model's draft was overridden because it broke a rule (the turn is then degraded). */
  rewritten: boolean;
  issue?: GroundingIssue;
};

/** One citation per bulletin, in the order the chunks were cited. */
export function citationsFor(chunks: RetrievedChunk[]): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const c of chunks) {
    if (seen.has(c.bulletinId)) continue;
    seen.add(c.bulletinId);
    citations.push({ sourceName: c.sourceName, url: c.url, issuedAt: c.issuedAt, ...(c.updatedAt !== undefined ? { updatedAt: c.updatedAt } : {}) });
  }
  return citations;
}

const sourceTime = (c: RetrievedChunk) => c.updatedAt ?? c.issuedAt;

export function isStale(chunk: RetrievedChunk, now: number): boolean {
  return now - sourceTime(chunk) > DEFAULTS.staleSourceMs;
}

const GENERIC_NAME_WORDS = new Set(["emergency", "management", "information", "department", "office", "services", "agency", "bureau"]);

/**
 * The short spoken name of a source: "Sonoma County Emergency Management (Demo)" becomes "Sonoma County".
 * Generic trailing words and parentheticals go; at most three words stay. The full name is for "where is that from?".
 */
export function spokenSourceName(name: string): string {
  const words = name.replace(/\s*\([^)]*\)\s*/g, " ").trim().split(/\s+/).filter(Boolean);
  const kept = words.filter((w, i) => i === 0 || !GENERIC_NAME_WORDS.has(w.toLowerCase()));
  return kept.slice(0, 3).join(" ") || name;
}

/** About five words: "Sonoma County, 2:10 PM." (checked / updated / as of when the time means something else). */
export function attributionSentence(chunk: RetrievedChunk, language: string, now?: number): string {
  const source = spokenSourceName(chunk.sourceName);
  const time = formatShortTime(sourceTime(chunk), chunk.areas[0]?.state, language, now ?? sourceTime(chunk));
  if (now !== undefined && isStale(chunk, now)) return tf("attributionStale", language, { source, time });
  // Scraped pages are not "issued" at the time we saw them: say what the time really is.
  if (chunk.timeBasis === "observed") return tf("attributionObserved", language, { source, time });
  if (chunk.timeBasis === "page_updated") return tf("attributionPageUpdated", language, { source, time });
  return tf("attribution", language, { source, time });
}

function mentionsSource(reply: string, chunk: RetrievedChunk): boolean {
  const r = normalizeForMatch(reply);
  const full = normalizeForMatch(chunk.sourceName);
  // "(Demo)" suffixes and the like are often dropped when speaking; accept the name without them.
  const bare = normalizeForMatch(chunk.sourceName.replace(/\s*\([^)]*\)\s*$/, ""));
  const short = normalizeForMatch(spokenSourceName(chunk.sourceName));
  return r.includes(full) || (bare.length >= 6 && r.includes(bare)) || (short.length >= 6 && r.includes(short));
}

const SAYS_AS_OF = /\b(as of|a partir de|informacion del|hasta las)\b/;

const ATTRIBUTION_LEAD = /^(that'?s from|this is from|this comes from|from|source|according to|esto es de|fuente|segun)\b/;

/**
 * Keeps every source line to about five words whatever the model wrote: a short sentence that names a cited source
 * ("That's from Sonoma County Emergency Management, updated October 24 at 2:10 PM Pacific.") is replaced by the
 * canonical short attribution for that source, wherever it sits in the reply. Content sentences are never touched.
 */
export function shortenAttribution(reply: string, cited: RetrievedChunk[], language: string, now: number): string {
  const sentences = reply.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 2 || cited.length === 0) return reply;
  const out: string[] = [];
  for (const [i, sentence] of sentences.entries()) {
    const words = sentence.trim().split(/\s+/).length;
    const source = cited.find((c) => mentionsSource(sentence, c));
    const leads = ATTRIBUTION_LEAD.test(normalizeForMatch(sentence));
    // A short sentence naming a source, or a long one that opens like an attribution; never the only sentence.
    const isAttribution = source !== undefined && (words <= 8 || (leads && words <= 20)) && !(i === 0 && !leads);
    out.push(isAttribution ? attributionSentence(source, language, now) : sentence);
  }
  return out.join(" ");
}

/** Appends the attribution unless a cited source is already named (and "as of" is present when stale). */
export function withAttribution(reply: string, cited: RetrievedChunk[], language: string, now: number): string {
  const trimmed = reply.trim();
  if (cited.length === 0) return trimmed;
  const freshest = [...cited].sort((a, b) => sourceTime(b) - sourceTime(a))[0];
  const named = cited.some((c) => mentionsSource(trimmed, c));
  const staleOk = !isStale(freshest, now) || SAYS_AS_OF.test(normalizeForMatch(trimmed));
  if (named && staleOk) return trimmed;
  return `${trimmed} ${attributionSentence(freshest, language, now)}`;
}

/**
 * One short sentence about corroboration, from retrieval's code-computed tier (never from the model):
 * "Sources differ on the figures." if any cited chunk conflicts with another source, otherwise
 * "Also reported by A and B." naming up to two other independent sources not already cited. Empty when single.
 */
export function corroborationSentence(cited: RetrievedChunk[], language: string): string {
  if (cited.some((c) => c.corroboration?.tier === "differs")) return t("sourcesDiffer", language);
  // A confirming source whose spoken name equals or contains a cited one ("Sonoma County" after "Sonoma County Fire")
  // would sound like the source confirming itself, so it is never read out.
  const citedSpoken = cited.map((c) => normalizeForMatch(spokenSourceName(c.sourceName)));
  const overlapsCited = (spoken: string) => {
    const n = normalizeForMatch(spoken);
    return citedSpoken.some((c) => c.includes(n) || n.includes(c));
  };
  const others = [...new Set(cited.flatMap((c) => (c.corroboration?.tier === "confirmed" ? c.corroboration.sources : [])).map(spokenSourceName))]
    .filter((spoken) => !overlapsCited(spoken))
    .slice(0, 2);
  if (others.length === 0) return "";
  return tf("corroborated", language, { sources: others.join(language.startsWith("es") ? " y " : " and ") });
}

/** "412 Oak Lane is inside zone SON-3A" — affirmative zone membership for an address. */
export function claimsAddressInZone(reply: string): boolean {
  const r = normalizeForMatch(reply);
  if (/\b(can'?t|cannot|can not|unable to) confirm\b|\bno puedo confirmar\b/.test(r)) return false;
  return /\b(is|are|it'?s|you'?re|esta|estan)\b[^.?!]{0,40}\b(in|inside|within|outside|dentro de|fuera de|en)\b[^.?!]{0,20}\b(zone|zona)\b/.test(r);
}

/** "The shelter is open", "refugio abierto". */
export function claimsShelterOpen(text: string): boolean {
  const r = normalizeForMatch(text);
  return /\bshelters?\b[^.?!]{0,60}\bopen\b|\bopen\b[^.?!]{0,30}\bshelters?\b|\brefugios?\b[^.?!]{0,60}\babiert[oa]s?\b|\babiert[oa]s?\b[^.?!]{0,30}\brefugios?\b/.test(r);
}

const sourceSaysOpen = (chunk: RetrievedChunk) => /\bopen\b|\babiert[oa]s?\b/i.test(chunk.text);

export function noInfoReply(utterance: string, language: string, opts: { endCall?: boolean; rewritten: boolean; issue?: GroundingIssue }): GroundedReply {
  return {
    kind: "no_info",
    reply: t("noInfo", language),
    citations: [],
    citedChunks: [],
    endCall: opts.endCall ?? false,
    unansweredQuestion: utterance,
    rewritten: opts.rewritten,
    issue: opts.issue,
  };
}

export function enforceGrounding(args: {
  draft: AnswerDraft;
  retrieved: RetrievedChunk[];
  utterance: string;
  language: string;
  now: number;
}): GroundedReply {
  const { draft, retrieved, utterance, language, now } = args;

  // The model may flag danger the deterministic check missed, but the wording is always the canonical string.
  if (draft.kind === "safety") {
    return { kind: "safety", reply: t("safety", language), citations: [], citedChunks: [], endCall: false, rewritten: false };
  }

  if (draft.kind === "no_info") {
    return noInfoReply(draft.unansweredQuestion?.trim() || utterance, language, { endCall: draft.endCall, rewritten: false });
  }

  if (draft.kind !== "answer") {
    // Non-answer kinds carry no citations, so they may not state safety-critical facts.
    if (claimsShelterOpen(draft.reply) || claimsAddressInZone(draft.reply)) {
      return noInfoReply(utterance, language, {
        rewritten: true,
        issue: claimsShelterOpen(draft.reply) ? "unsupported_shelter_claim" : "address_claim",
      });
    }
    const reply = draft.reply.trim();
    if (reply === "" && draft.kind !== "followup" && draft.kind !== "goodbye") {
      return { kind: "no_info", reply: t("fallback", language), citations: [], citedChunks: [], endCall: false, rewritten: true, issue: "empty_reply" };
    }
    return { kind: draft.kind, reply, citations: [], citedChunks: [], endCall: draft.endCall, rewritten: false };
  }

  const byId = new Map(retrieved.map((c) => [c.chunkId, c]));
  const ids = [...new Set(draft.citedChunkIds)];
  if (ids.some((id) => !byId.has(id))) {
    return noInfoReply(utterance, language, { endCall: draft.endCall, rewritten: true, issue: "unknown_chunk" });
  }
  const cited = ids.map((id) => byId.get(id)!).filter((c) => ANSWERABLE_TRUST_TIERS.includes(c.trustTier));
  if (cited.length === 0) {
    return noInfoReply(utterance, language, { endCall: draft.endCall, rewritten: true, issue: "uncited_answer" });
  }
  if (draft.reply.trim() === "") {
    return noInfoReply(utterance, language, { endCall: draft.endCall, rewritten: true, issue: "empty_reply" });
  }

  let reply = draft.reply.trim();
  let issue: GroundingIssue | undefined;
  // Never confirm or deny that an address is inside a zone, whatever the model wrote.
  if (asksAboutExactAddress(utterance) && claimsAddressInZone(reply)) {
    reply = t("addressRefusal", language);
    issue = "address_claim";
  }
  // "Shelter is open" needs a cited source that says so (its time is added by the attribution).
  if (claimsShelterOpen(reply) && !cited.some(sourceSaysOpen)) {
    return noInfoReply(utterance, language, { endCall: draft.endCall, rewritten: true, issue: "unsupported_shelter_claim" });
  }

  const attributed = withAttribution(asksForSource(utterance) ? reply : shortenAttribution(reply, cited, language, now), cited, language, now);
  const corroboration = corroborationSentence(cited, language);
  return {
    kind: "answer",
    // Full source name and time only when the caller asked where it came from; otherwise the bare minimum.
    reply: corroboration ? `${attributed} ${corroboration}` : attributed,
    citations: citationsFor(cited),
    citedChunks: cited,
    endCall: draft.endCall,
    rewritten: issue !== undefined,
    issue,
  };
}
