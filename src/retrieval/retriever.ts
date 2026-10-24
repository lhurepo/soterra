// [B] Retriever interface. Convex search is the default; Moss is optional and never required.
import type { RetrievalQuery, RetrievedChunk } from "../contracts";

export interface Retriever {
  readonly name: "convex" | "moss";
  retrieve(query: RetrievalQuery): Promise<RetrievedChunk[]>;
}

/**
 * Convex retriever: the actual reads happen in the `internal.retrieval.search` query (convex/retrieval.ts);
 * this adapter just calls it, so the pipeline stays independent of Convex.
 */
export function createConvexRetriever(runSearch: (q: RetrievalQuery) => Promise<RetrievedChunk[]>): Retriever {
  return { name: "convex", retrieve: runSearch };
}

/** Use Moss when selected, but fall back to Convex on any Moss failure: Moss is never a hard dependency. */
export function withFallback(primary: Retriever, fallback: Retriever): Retriever {
  if (primary === fallback) return primary;
  return {
    name: primary.name,
    async retrieve(query) {
      try {
        return await primary.retrieve(query);
      } catch (err) {
        console.warn(`[retrieval] ${primary.name} failed, falling back to ${fallback.name}:`, err);
        return fallback.retrieve(query);
      }
    },
  };
}
