// [B] Retriever interface. Convex search is the default; Moss is optional and never required.
// Every result says which retriever produced it and when, so turns can be debugged.
import type { RetrievalQuery, RetrievedChunk } from "../contracts";

export type RetrievalRequest = RetrievalQuery & {
  /** Recent caller turns: widens the candidate search and adds a small relevance bonus. */
  contextText?: string;
};

export type RetrieverName = "convex" | "moss" | "moss>convex";

export type RetrievalResult = {
  chunks: RetrievedChunk[];
  retriever: RetrieverName;
  retrievedAt: number;
};

export interface Retriever {
  readonly name: "convex" | "moss";
  retrieve(request: RetrievalRequest): Promise<RetrievalResult>;
}

/**
 * Convex retriever: the reads happen in the `internal.retrieval.search` query (convex/retrieval.ts);
 * this adapter only calls it, so the pipeline stays independent of Convex.
 */
export function createConvexRetriever(runSearch: (request: RetrievalRequest) => Promise<RetrievedChunk[]>): Retriever {
  return {
    name: "convex",
    async retrieve(request) {
      return { chunks: await runSearch(request), retriever: "convex", retrievedAt: request.now };
    },
  };
}

/** Use Moss when selected, but fall back to Convex on any Moss failure: Moss is never a hard dependency. */
export function withFallback(primary: Retriever, fallback: Retriever): Retriever {
  if (primary === fallback) return primary;
  return {
    name: primary.name,
    async retrieve(request) {
      try {
        return await primary.retrieve(request);
      } catch (err) {
        console.warn(`[retrieval] ${primary.name} failed, falling back to ${fallback.name}:`, err);
        const result = await fallback.retrieve(request);
        return { ...result, retriever: "moss>convex" };
      }
    },
  };
}
