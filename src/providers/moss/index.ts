// [B] Moss placeholders: query-side Retriever and index sync (sync is called by [I] after upserts).
// Verified 2026-10-24: npm package is `@moss-dev/moss` (formerly `@inferedge/moss`), a native Rust core
// shipped as per-platform binaries (needs Node ≥ 20.4). In Convex it can only run in a "use node" action
// with the package listed under node.externalPackages in convex.json. Not installed in the skeleton.
// API shape: new MossClient(projectId, projectKey); createIndex(name, docs, { modelId: "moss-minilm" });
// loadIndex(name); query(name, text, { topK }). Cold-load time inside an action is unmeasured: measure first.
import type { Config } from "../../config/env";
import { NotConfiguredError, NotImplementedError } from "../../config/errors";
import type { RetrievedChunk } from "../../contracts";
import type { Retriever } from "../../retrieval/retriever";

const MOSS_ENV = ["MOSS_PROJECT_ID", "MOSS_PROJECT_KEY", "MOSS_INDEX_NAME"] as const;

function requireMoss(config: Config): { projectId: string; projectKey: string; indexName: string } {
  const missing = MOSS_ENV.filter((k) => !config[k]);
  if (missing.length > 0) throw new NotConfiguredError("Moss", [...missing]);
  return { projectId: config.MOSS_PROJECT_ID!, projectKey: config.MOSS_PROJECT_KEY!, indexName: config.MOSS_INDEX_NAME! };
}

export function createMossRetriever(config: Config): Retriever {
  requireMoss(config);
  return {
    name: "moss",
    async retrieve() {
      // TODO(B): call a "use node" action that queries Moss, then hydrate chunk ids through Convex so
      // trust, expiry and fixture filters still apply (src/retrieval/rank.ts).
      throw new NotImplementedError("Moss retrieval", "B");
    },
  };
}

/** Mirror active chunks into Moss with their metadata. Best effort: failures are logged, never thrown to callers. */
export async function syncChunksToMoss(config: Config, _chunks: RetrievedChunk[], _removedChunkIds: string[]): Promise<void> {
  requireMoss(config);
  throw new NotImplementedError("Moss index sync", "B");
}
