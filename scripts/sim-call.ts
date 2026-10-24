// [S] npm run sim:call -- --scenario ridgeview-basic
// Text-mode caller against the REAL HTTP endpoints (CONVEX_SITE_URL from .env.local, VOICE_API_SECRET from env).
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, loadEnvLocal, readJson } from "./lib/env";
import { runConversation, type Conversation } from "./lib/simCall";

loadEnvLocal();

const args = process.argv.slice(2);
const flag = args.indexOf("--scenario");
const scenario = flag >= 0 ? (args[flag + 1] ?? "") : "ridgeview-basic";
const available = readdirSync(resolve(ROOT, "fixtures/conversations")).map((f) => f.replace(/\.json$/, ""));
if (!available.includes(scenario)) {
  console.error(`Unknown scenario "${scenario}". Available: ${available.join(", ")}`);
  process.exit(1);
}

const baseUrl = process.env.CONVEX_SITE_URL;
const secret = process.env.VOICE_API_SECRET;
if (!baseUrl || !secret) {
  console.error("Set CONVEX_SITE_URL (in .env.local, written by `npx convex dev`) and VOICE_API_SECRET (same value as the deployment's).");
  process.exit(1);
}

const conversation = readJson<Conversation>(`fixtures/conversations/${scenario}.json`);
console.log(`\n▶ ${conversation.name}: ${conversation.description ?? ""}\n`);

const result = await runConversation({
  fetchPath: (path, init) => fetch(new URL(path, baseUrl), init),
  secret,
  conversation,
  providerCallId: `sim-${Date.now()}`,
  onTurn: ({ turn, response, failures, elapsedMs }) => {
    console.log(`CALLER  ${turn.utterance}`);
    console.log(`SOTERRA [${response.kind}${response.degraded ? ", degraded" : ""}] ${response.reply}`);
    for (const c of response.citations) console.log(`        ↳ ${c.sourceName} — ${c.url} (issued ${new Date(c.issuedAt).toISOString()})`);
    console.log(`        ⏱ round trip ${elapsedMs} ms; backend ${JSON.stringify(response.timingsMs ?? {})}`);
    for (const f of failures) console.log(`        ✗ ${f}`);
    console.log();
  },
});

console.log(`Greeting was: ${result.greeting.greeting}`);
console.log(`Session ${result.end.callId} ended; a summary is written asynchronously.`);
if (result.failures.length > 0) {
  console.error(`\n${result.failures.length} expectation(s) failed. Is SERVE_FIXTURES=true and were fixtures seeded?`);
  process.exit(1);
}
