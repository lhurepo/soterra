// [B] Live Moss index backed by @moss-dev/moss (native binaries: import only from a "use node" action).
// Verified 2026-10-24 with the project's key (scripts/moss-check.ts): createIndex, addDocs (upsert) and
// deleteDocs work; cloud query returned HTTP 503 and loadIndex failed downloading the embedding model (401).
// So retrieval through Moss stays behind RETRIEVER=moss and falls back to Convex (docs/DECISIONS.md).
import { MossClient } from "@moss-dev/moss";
import type { MossConfig, MossDoc, MossHit, MossIndex } from "./index";

export const MOSS_MODEL = "moss-minilm";

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

  /** Loads the index on first use (on-device query), falling back to the cloud query if loading fails. */
  async query(text: string, topK: number): Promise<MossHit[]> {
    if (!this.loaded) {
      try {
        await this.client.loadIndex(this.config.indexName);
        this.loaded = true;
      } catch (err) {
        console.warn("[moss] loadIndex failed; using cloud query:", err instanceof Error ? err.message : err);
      }
    }
    const result = await this.client.query(this.config.indexName, text, { topK });
    return result.docs.map((d) => ({ id: d.id, score: d.score }));
  }
}
