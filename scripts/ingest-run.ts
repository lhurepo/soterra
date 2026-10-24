// [I] npm run ingest:run -- --source <id> [--mode fixture|live]
// Runs one source now through the full pipeline and prints the outcome. Apify sources are awaited until
// their webhook has been processed (MockApify finishes immediately).
import { convexRun, flag, printRun, waitForRun } from "./lib/env";

const sourceId = flag("source");
const mode = flag("mode");
if (!sourceId || (mode !== undefined && mode !== "fixture" && mode !== "live")) {
  console.error("Usage: npm run ingest:run -- --source <sourceId> [--mode fixture|live]");
  process.exit(1);
}

convexRun("sources:syncRegistry", {});
const result = convexRun("ingestion:runSource", { sourceId, trigger: "manual", ...(mode ? { modeOverride: mode } : {}) }) as {
  runId?: string;
  status: string;
  error?: string;
};
console.log(`${sourceId}: ${result.status}${result.error ? ` — ${result.error}` : ""}`);
if (result.runId) printRun(await waitForRun(result.runId, result.status === "awaiting_apify" ? 5 * 60_000 : 0));
process.exit(result.status === "failed" ? 1 : 0);
