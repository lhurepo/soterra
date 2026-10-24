// [B] Live Moss index backed by @moss-js/moss (native binaries: import only from a "use node" action).
// History (2026-10-24): with the old package @moss-dev/moss 1.7.1, createIndex/addDocs/deleteDocs worked but
// loadIndex failed downloading the embedding model (401) and the cloud query returned 503. The docs say that
// package is frozen (moved to @moss-js/moss in 1.8.0), that versions below 1.9.0 lose their model download path,
// and that the cloud query service is retired: queries run in memory after loadIndex. See docs/DECISIONS.md.
import { MossClient } from "@moss-js/moss";
import type { MossConfig, MossDoc, MossHit, MossIndex } from "./index";

export const MOSS_MODEL = "moss-minilm";
/** Convex actions can write to /tmp; a warm container then skips the index download. */
const MOSS_CACHE_PATH = "/tmp/soterra-moss";

export class LiveMossIndex implements MossIndex {
  private readonly client: MossClient;
  private loaded = false;

  constructor(private readonly config: MossConfig) {
    this.client = new MossClient(config.projectId, config.projectKey);
  }

  private async exists(): Promise<boolean> {
    try {
      await this.client.getIndex(this.config.indexName);
      return true;
    } catch {
      return false;
    }
  }

  async upsert(docs: MossDoc[]): Promise<void> {
    if (docs.length === 0) return;
    if (await this.exists()) await this.client.addDocs(this.config.indexName, docs, { upsert: true });
    else await this.client.createIndex(this.config.indexName, docs, { modelId: MOSS_MODEL });
  }

  async remove(ids: string[]): Promise<void> {
    if (ids.length === 0 || !(await this.exists())) return;
    await this.client.deleteDocs(this.config.indexName, ids);
  }

  /**
   * Loads the index into memory on first use, then queries it locally (the docs retired the cloud query).
   * A failed load throws, so the retriever falls back to Convex search.
   */
  async query(text: string, topK: number): Promise<MossHit[]> {
    if (!this.loaded) {
      await this.client.loadIndex(this.config.indexName, { cachePath: MOSS_CACHE_PATH });
      this.loaded = true;
    }
    const result = await this.client.query(this.config.indexName, text, { topK });
    return result.docs.map((d) => ({ id: d.id, score: d.score }));
  }
}
