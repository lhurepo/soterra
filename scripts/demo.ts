// [S] npm run demo:start | demo:stop | demo:status — the Marina Earthquake demo switch (convex/demo.ts, demo/scenario.ts).
// start: clean slate, real sources off, calm pages for 5 s (--delay <ms>), then the earthquake pages are crawled by Apify.
// stop:  everything back to the beginning. Watch the crawls with `npm run demo:status`.
import { convexRun, flag, loadEnvLocal } from "./lib/env";

loadEnvLocal();
const command = process.argv[2];
const time = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString() : "-");

if (command === "start") {
  const delay = flag("delay");
  const r = convexRun("demo:start", delay ? { delayMs: Number(delay) } : {}) as { escalateAt?: number };
  console.log(`Demo started. Calm pages now; the earthquake pages go live at ${time(r.escalateAt)} and Apify starts crawling.`);
  console.log("Callbacks reach whoever called and asked to be called back. Stop with: npm run demo:stop");
} else if (command === "stop") {
  convexRun("demo:stop", {});
  console.log("Demo stopped and reset. Start again with: npm run demo:start");
} else if (command === "offline") {
  const r = convexRun("demo:takeOffline", {}) as { sourcesOff: number; bulletinsOff: number };
  console.log(`Offline: ${r.sourcesOff} source(s) switched off, ${r.bulletinsOff} bulletin(s) taken out of service. Only the demo is served.`);
} else if (command === "status") {
  const s = convexRun("demo:getStatus", {}) as { on: boolean; startedAt?: number; escalateAt?: number };
  console.log(`Demo ${s.on ? "ON" : "off"}; started ${time(s.startedAt)}, earthquake pages at ${time(s.escalateAt)}.`);
  const runs = convexRun("demo:recentRuns", {}) as { sourceId: string; status: string; seconds?: number; counts?: unknown; error?: string }[];
  for (const r of runs) console.log(`  ${r.sourceId.padEnd(18)} ${r.status.padEnd(15)} ${r.seconds !== undefined ? `${r.seconds}s` : ""} ${r.error ?? (r.counts ? JSON.stringify(r.counts) : "")}`);
} else {
  console.log("Usage: npm run demo:start [-- --delay 5000] | demo:stop | demo:status | demo:offline");
  process.exit(1);
}
