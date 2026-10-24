// [I] npm run ingest:apify-mock-sites — real Apify actors scrape the Convex-served mock sites.
// Needs a pushed dev deployment with: APIFY_TOKEN, APIFY_WEBHOOK_SECRET, ENABLE_MOCK_SITES=true
// (npx convex env set ...), and the mock sites seeded (npm run seed:fixtures). Costs a few cents of
// Apify platform usage per run (Website Content Crawler + Cheerio Scraper, one page each).
import { convexRun, printRun, waitForRun } from "./lib/env";

const SOURCES = ["mock_county_emergency", "mock_shelters", "mock_disaster_assistance"];
convexRun("sources:syncRegistry", {});
const runs = SOURCES.map((sourceId) => {
  const r = convexRun("ingestion:runSource", { sourceId, trigger: "manual", modeOverride: "live" }) as { runId?: string; status: string; error?: string };
  console.log(`${sourceId}: ${r.status}${r.error ? ` — ${r.error}` : ""}`);
  return r;
});
for (const r of runs) if (r.runId && r.status === "awaiting_apify") printRun(await waitForRun(r.runId, 5 * 60_000));
if (runs.some((r) => r.status === "failed")) process.exit(1);
