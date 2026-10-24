// [S, improved by B] npm run sim:call -- --scenario ridgeview-basic [--phone +17075550199] [--all]
// Text-mode caller against the REAL HTTP endpoints (CONVEX_SITE_URL from .env.local, VOICE_API_SECRET from env).
// Prints every reply with its citations and the backend's per-stage timings, then a latency summary.
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { HealthResponse } from "../src/contracts";
import { ROOT, loadEnvLocal, readJson } from "./lib/env";
import { runConversation, type Conversation, type TurnResult } from "./lib/simCall";

loadEnvLocal();

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const available = readdirSync(resolve(ROOT, "fixtures/conversations")).map((f) => f.replace(/\.json$/, ""));

const baseUrl = process.env.CONVEX_SITE_URL;
const secret = process.env.VOICE_API_SECRET;
if (!baseUrl || !secret) {
  console.error("Set CONVEX_SITE_URL (in .env.local, written by `npx convex dev`) and VOICE_API_SECRET (same value as the deployment's).");
  process.exit(1);
}

// --all runs the scenarios that match the deployment: fixture scenarios when SERVE_FIXTURES=true, "no-fixtures" otherwise.
let scenarios = [flag("--scenario") ?? "ridgeview-basic"];
if (args.includes("--all")) {
  const health = HealthResponse.parse(await (await fetch(new URL("/health", baseUrl))).json());
  const serving = health.flags?.serveFixtures === true;
  scenarios = available.filter((name) => {
    const needs = readJson<{ requiresFixtures?: string[] }>(`fixtures/conversations/${name}.json`).requiresFixtures ?? [];
    return name === "no-fixtures" ? !serving : serving || needs.length === 0;
  });
  console.log(`SERVE_FIXTURES is ${serving}; running: ${scenarios.join(", ")}`);
}
const unknown = scenarios.filter((s) => !available.includes(s));
if (unknown.length > 0) {
  console.error(`Unknown scenario "${unknown.join(", ")}". Available: ${available.join(", ")}`);
  process.exit(1);
}

const all: TurnResult[] = [];
let failures = 0;
for (const scenario of scenarios) {
  const conversation = readJson<Conversation>(`fixtures/conversations/${scenario}.json`);
  const phone = flag("--phone");
  if (phone && conversation.session.callerPhone) conversation.session.callerPhone = phone;
  console.log(`\n▶ ${conversation.name}: ${conversation.description ?? ""}\n`);

  const result = await runConversation({
    fetchPath: (path, init) => fetch(new URL(path, baseUrl), init),
    secret,
    conversation,
    providerCallId: `sim-${scenario}-${Date.now()}`,
    onTurn: ({ turn, response, failures, elapsedMs }) => {
      const tm = response.timingsMs ?? {};
      console.log(`CALLER  ${turn.utterance}`);
      console.log(`SOTERRA [${response.kind}${response.degraded ? ", degraded" : ""}, ${response.language}] ${response.reply}`);
      for (const c of response.citations) console.log(`        ↳ ${c.sourceName} — ${c.url} (issued ${new Date(c.issuedAt).toISOString()})`);
      const stages = ["context", "retrieval", "preLlm", "llm", "total"].filter((k) => tm[k] !== undefined).map((k) => `${k} ${tm[k]}`);
      console.log(`        ⏱ round trip ${elapsedMs} ms · backend: ${stages.join(" · ") || "n/a"}`);
      for (const f of failures) console.log(`        ✗ ${f}`);
      console.log();
    },
  });
  all.push(...result.turns);
  failures += result.failures.length;
  console.log(`Greeting was: ${result.greeting.greeting}`);
  console.log(`Session ${result.end.callId} ended; a summary is written asynchronously.`);
}

const pre = all.map((r) => r.response.timingsMs?.preLlm).filter((n): n is number => n !== undefined).sort((a, b) => a - b);
if (pre.length > 0) {
  const p = (q: number) => pre[Math.min(pre.length - 1, Math.floor(q * pre.length))];
  console.log(`\nBackend work before the LLM over ${pre.length} turns: median ${p(0.5)} ms, p90 ${p(0.9)} ms, max ${pre.at(-1)} ms (target ≤ 300 ms).`);
}
if (failures > 0) {
  console.error(`\n${failures} expectation(s) failed. Is SERVE_FIXTURES=true and were fixtures seeded?`);
  process.exit(1);
}
