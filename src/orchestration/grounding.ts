// [B] Grounding enforcement: the deterministic gate between the model and the caller.
// Rule: a kind "answer" must cite at least one answerable chunk retrieved in THIS turn, or it is
// rewritten to a safe "no_info" reply and the question is recorded. Citations come from chunk
// metadata only, and every answer ends with a spoken source-and-time attribution.
import {
  ANSWERABLE_TRUST_TIERS,
  type AnswerDraft,
  type Citation,
  type ReplyKind,
  type RetrievedChunk,
} from "../contracts";
import { phrase } from "./phrases";
import { formatSpokenTime } from "./time";

export type GroundedReply = {
  kind: ReplyKind;
  reply: string;
  citations: Citation[];
  citedChunks: RetrievedChunk[];
  endCall: boolean;
  /** Set when the turn must be recorded as an unanswered question. */
  unansweredQuestion?: string;
  /** True when the model's draft was overridden. */
  rewritten: boolean;
};

export function citationsFor(chunks: RetrievedChunk[]): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const c of chunks) {
    if (seen.has(c.bulletinId)) continue;
    seen.add(c.bulletinId);
    citations.push({ sourceName: c.sourceName, url: c.url, issuedAt: c.issuedAt, updatedAt: c.updatedAt });
  }
  return citations;
}

/** "That's from Sonoma County Emergency Management (Demo), updated October 24 at 2:30 PM Pacific." */
export function attributionSentence(chunk: RetrievedChunk, language: string): string {
  const when = chunk.updatedAt ?? chunk.issuedAt;
  const verb = chunk.updatedAt ? phrase("updated", language) : phrase("issued", language);
  const state = chunk.areas[0]?.state;
  return `${phrase("sourcePrefix", language)} ${chunk.sourceName}, ${verb} ${formatSpokenTime(when, state, language)}.`;
}

export function noInfoReply(utterance: string, language: string, endCall = false): GroundedReply {
  return {
    kind: "no_info",
    reply: phrase("noInfo", language),
    citations: [],
    citedChunks: [],
    endCall,
    unansweredQuestion: utterance,
    rewritten: true,
  };
}

export function enforceGrounding(args: {
  draft: AnswerDraft;
  retrieved: RetrievedChunk[];
  utterance: string;
  language: string;
}): GroundedReply {
  const { draft, retrieved, utterance, language } = args;

  // The model may flag danger the deterministic check missed, but the wording is always the fixed phrase.
  if (draft.kind === "safety") {
    return {
      kind: "safety",
      reply: phrase("safety", language),
      citations: [],
      citedChunks: [],
      endCall: false,
      rewritten: draft.reply !== phrase("safety", language),
    };
  }

  if (draft.kind === "no_info") {
    return { ...noInfoReply(draft.unansweredQuestion ?? utterance, language, draft.endCall), rewritten: false };
  }

  if (draft.kind !== "answer") {
    // TODO(B): non-answer kinds (clarify, smalltalk, followup, goodbye) must not state safety-critical
    // facts. Today that is only a prompt rule; add a deterministic check if the model drifts.
    return {
      kind: draft.kind,
      reply: draft.reply.trim() || phrase("fallback", language),
      citations: [],
      citedChunks: [],
      endCall: draft.endCall,
      rewritten: false,
    };
  }

  const byId = new Map(retrieved.map((c) => [c.chunkId, c]));
  const cited = [...new Set(draft.citedChunkIds)]
    .map((id) => byId.get(id))
    .filter((c): c is RetrievedChunk => c !== undefined && ANSWERABLE_TRUST_TIERS.includes(c.trustTier));

  if (cited.length === 0 || draft.reply.trim() === "") {
    return noInfoReply(draft.unansweredQuestion ?? utterance, language, draft.endCall);
  }

  // Always end with the source and time of the freshest cited chunk, unless the model already named it.
  const freshest = [...cited].sort((a, b) => (b.updatedAt ?? b.issuedAt) - (a.updatedAt ?? a.issuedAt))[0];
  const reply = draft.reply.includes(freshest.sourceName)
    ? draft.reply.trim()
    : `${draft.reply.trim()} ${attributionSentence(freshest, language)}`;

  return {
    kind: "answer",
    reply,
    citations: citationsFor(cited),
    citedChunks: cited,
    endCall: draft.endCall,
    rewritten: false,
  };
}
