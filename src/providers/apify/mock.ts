// [I] MockApify: "runs" return dataset items from fixtures shaped exactly like each actor's output.
// The dataset id encodes the source and mock-site variant, so a later action can read it back without
// shared memory. The caller simulates the webhook by calling the same handler path as a real one.
import type { ApifyClient, StartedRun, StartRunOptions } from "./index";

export type MockDatasets = Record<string, Record<string, unknown[]>>;

export class MockApifyClient implements ApifyClient {
  readonly mode = "mock" as const;
  constructor(
    private readonly datasets: MockDatasets,
    private readonly variant: string,
  ) {}

  async startRun(_actorId: string, _input: unknown, options: StartRunOptions): Promise<StartedRun> {
    if (!this.datasets[options.sourceId]) throw new Error(`no mock Apify dataset for source ${options.sourceId}`);
    return { runId: `mock-run:${options.runRecordId}`, datasetId: `mock:${options.sourceId}:${this.variant}` };
  }

  async getDatasetItems(datasetId: string, limit: number): Promise<unknown[]> {
    const m = /^mock:([^:]+):([^:]+)$/.exec(datasetId);
    if (!m) throw new Error(`not a mock dataset id: ${datasetId}`);
    const bySource = this.datasets[m[1]];
    const items = bySource?.[m[2]] ?? bySource?.v1;
    if (!items) throw new Error(`no mock Apify dataset for ${datasetId}`);
    return items.slice(0, limit);
  }
}
