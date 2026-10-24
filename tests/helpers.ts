// [B] Shared builders for the unit tests (no Convex).
import type { AnswerDraft, RetrievedChunk } from "../src/contracts";
import type { TurnDeps, TurnState } from "../src/orchestration/pipeline";
import { createMockLlm } from "../src/providers/llm/mock";

/** 2026-10-24 22:00 UTC = 3:00 PM Pacific, shortly after the fixture bulletins. */
export const NOW = Date.UTC(2026, 9, 24, 22, 0);

export const chunk = (over: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
  chunkId: "c1",
  bulletinId: "b1",
  text: "Evacuation Warning for the Ridgeview Fire. An Evacuation Warning is in effect for zones SON-3A and SON-3B. Zone SON-3A covers Ridgeview Road from Highway 12 to Bennett Valley Road.",
  sourceId: "demo_county",
  sourceName: "Sonoma County Emergency Management (Demo)",
  url: "https://example.org/evac",
  trustTier: "official",
  issuedAt: 1792874700000, // October 24, 1:45 PM Pacific
  areas: [{ state: "CA", countyFips: "06097", label: "Sonoma County zones SON-3A and SON-3B" }],
  hazardType: "evacuation",
  severity: "severe",
  incidentKey: "ridgeview-fire-demo",
  isFixture: true,
  chunkIndex: 0,
  score: 1,
  ...over,
});

export const shelterChunk = (over: Partial<RetrievedChunk> = {}): RetrievedChunk =>
  chunk({
    chunkId: "c2",
    bulletinId: "b2",
    text: "Evacuation shelters for the Ridgeview Fire. Two evacuation shelters are open, as checked by county staff at 2:30 PM Pacific on October 24. Ridgeview Community Center accepts pets in crates.",
    hazardType: "shelter",
    severity: "moderate",
    url: "https://example.org/shelters",
    issuedAt: 1792875600000,
    updatedAt: 1792877400000,
    ...over,
  });

export const answer = (over: Partial<AnswerDraft> = {}): AnswerDraft => ({
  kind: "answer",
  reply: "Zones SON-3A and SON-3B are under an Evacuation Warning.",
  citedChunkIds: ["c1"],
  endCall: false,
  ...over,
});

export function state(over: Partial<TurnState> = {}): TurnState {
  return {
    hasCallerPhone: true,
    context: { identity: "caller_id", language: "en", callerId: "caller1" },
    areaCandidates: [
      { label: "Santa Rosa, Sonoma County", state: "CA", countyFips: "06097" },
      { label: "Ridgeview Road, Sonoma County", state: "CA", countyFips: "06097" },
    ],
    history: [],
    recentCallerUtterances: [],
    hasOpenQuestion: false,
    ...over,
  };
}

export function deps(over: Partial<TurnDeps> & { chunks?: RetrievedChunk[] } = {}): TurnDeps & { llm: ReturnType<typeof createMockLlm> } {
  const { chunks, ...rest } = over;
  const llm = createMockLlm();
  return {
    now: () => NOW,
    llm,
    model: "claude-haiku-5-5",
    retrieve: async (q) => ({ chunks: chunks ?? [chunk(), shelterChunk()], retriever: "convex", retrievedAt: q.now }),
    ...rest,
  } as TurnDeps & { llm: ReturnType<typeof createMockLlm> };
}
