// [B] npx tsx scripts/moss-check.ts — verifies the Moss SDK against the real service with MOSS_PROJECT_ID and
// MOSS_PROJECT_KEY from .env.local (never printed). Creates a throwaway index of three fictional documents,
// times create, cold query, loadIndex and warm query, then deletes the index. Prints timings only.
import { MossClient } from "@moss-js/moss";
import { loadEnvLocal } from "./lib/env";

loadEnvLocal();
const projectId = process.env.MOSS_PROJECT_ID;
const projectKey = process.env.MOSS_PROJECT_KEY;
if (!projectId || !projectKey) {
  console.error("MOSS_PROJECT_ID and MOSS_PROJECT_KEY must be set in .env.local");
  process.exit(1);
}

const indexName = `soterra-check-${Date.now()}`;
const docs = [
  { id: "c1", text: "Ridgeview Fire incident update. The Ridgeview Fire is burning about 1,200 acres and is 10 percent contained.", metadata: { trustTier: "official" } },
  { id: "c2", text: "Evacuation shelters for the Ridgeview Fire. Ridgeview Community Center accepts pets in crates.", metadata: { trustTier: "official" } },
  { id: "c3", text: "Road closure on Ridgeview Road between Highway 12 and Bennett Valley Road.", metadata: { trustTier: "official" } },
];

const time = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const t0 = performance.now();
  try {
    const out = await fn();
    console.log(`${label}: ${Math.round(performance.now() - t0)} ms`);
    return out;
  } catch (err) {
    console.log(`${label}: FAILED after ${Math.round(performance.now() - t0)} ms — ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
};

const client = await time("construct client", async () => new MossClient(projectId, projectKey));
try {
  const created = await time("createIndex (3 docs)", () => client.createIndex(indexName, docs, { modelId: "moss-minilm" }));
  await time("wait for index job", async () => {
    for (let i = 0; i < 60; i++) {
      const job = await client.getJobStatus(created.jobId);
      if (String(job.status) === "completed") return;
      if (String(job.status) === "failed") throw new Error("index job failed");
      await new Promise((r) => setTimeout(r, 1_000));
    }
    throw new Error("index job did not finish in 60 s");
  }).catch(() => undefined);
  const cold = await time("query before loadIndex", () => client.query(indexName, "shelters that take pets", { topK: 2 })).catch(() => null);
  if (cold) console.log(`  top hit: ${cold.docs[0]?.id} (${cold.docs.length} docs)`);
  await time("loadIndex", () => client.loadIndex(indexName)).catch(() => undefined);
  const warm = await time("query after loadIndex", () => client.query(indexName, "shelters that take pets", { topK: 2 })).catch(() => null);
  if (warm) console.log(`  top hit: ${warm.docs[0]?.id}`);
  await time("query (2nd)", () => client.query(indexName, "is the fire contained", { topK: 2 })).catch(() => undefined);
  await time("addDocs upsert", () => client.addDocs(indexName, [{ id: "c4", text: "Hillcrest test document." }], { upsert: true }));
  await time("deleteDocs", () => client.deleteDocs(indexName, ["c4"]));
} finally {
  await time("deleteIndex", () => client.deleteIndex(indexName)).catch(() => undefined);
  await client.close().catch(() => undefined);
}
