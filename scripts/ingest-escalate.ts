// [I] npm run ingest:escalate [-- --mode fixture|live]
// Demo escalation: switches the mock sites to v2 (zone SON-3A warning → order, shelter capacity changes) and
// scrapes them now through the real pipeline, so the backend's callback flow fires from ingested data.
// Run `npm run ingest:run -- --source mock_county_emergency` first (on v1) so there is something to update.
import { convexRun, flag, printRun, sleep } from "./lib/env";

const mode = flag("mode");
const sources = convexRun("mockSites:escalate", mode ? { mode } : {}) as string[];
console.log(`Mock sites now on v2. Scraping: ${sources.join(", ")}`);
const deadline = Date.now() + 5 * 60_000;
const started = Date.now() - 60_000;
let pending = [...sources];
while (pending.length > 0 && Date.now() < deadline) {
  await sleep(3_000);
  for (const sourceId of [...pending]) {
    const [latest] = convexRun("ingestionRuns:recentRuns", { sourceId, limit: 1 }) as { _creationTime: number; trigger: string; status: string }[];
    if (latest && latest.trigger === "escalation" && latest._creationTime >= started && (latest.status === "succeeded" || latest.status === "failed")) {
      printRun(latest as never);
      pending = pending.filter((s) => s !== sourceId);
    }
  }
}
if (pending.length > 0) console.log(`Still running: ${pending.join(", ")} (check the ingestionRuns table)`);
console.log("Reset with: npx convex run mockSites:setVariant '{\"variant\":\"v1\"}'");
