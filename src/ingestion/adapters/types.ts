// [I] Adapter interface: one per source. Adapters fetch and normalize; storage is upsertBulletins' job.
import type { Config } from "../../config/env";
import type { NormalizedBulletinDraft, SourceDefinition } from "../../contracts";

export type AdapterContext = {
  config: Config;
  source: SourceDefinition;
  fetch: typeof fetch;
  now: number;
};

export interface SourceAdapter {
  sourceId: string;
  run(ctx: AdapterContext): Promise<NormalizedBulletinDraft[]>;
}
