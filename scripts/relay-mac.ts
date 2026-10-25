// [B] npm run relay:mac — sends Soterra's texts from this Mac with Messages.app (SMS_NOTIFIER=mac_relay;
// docs/mac-relay.md). Polls POST /relay/claim about every 2 s, sends each text with osascript, reports it to
// POST /relay/result. Env (.env.local or the shell): CONVEX_SITE_URL, SMS_RELAY_SECRET, RELAY_ALLOWLIST (optional, comma-separated
// numbers: when set, only these are texted; unset, any number the backend sends), RELAY_SERVICE=SMS|iMessage (default SMS), RELAY_DRY_RUN=1 (send nothing).
// Run it from a normal terminal (not a sandbox): `caffeinate -dis npm run relay:mac`.
import { execFile } from "node:child_process";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { ClaimResponse, RELAY_MAX_PER_CLAIM, type ResultRequest } from "../src/notifications/relay";
import { loadEnvLocal } from "./lib/env";
import { POLL_MS, maskPhone, nextBackoffMs, osascriptArgs, parseAllowlist, processBatch, type RelayService } from "./lib/relayMac";

loadEnvLocal();

const run = promisify(execFile);
const SCRIPT = resolve(import.meta.dirname, "relay-mac.applescript");
const RESULT_ATTEMPTS = 8;

const log = (line: string) => console.log(`[relay ${new Date().toLocaleTimeString("en-US", { hour12: false })}] ${line}`);
function fail(message: string): never {
  console.error(`[relay] ${message}`);
  process.exit(1);
}

const siteUrl = process.env.CONVEX_SITE_URL?.replace(/\/$/, "");
const secret = process.env.SMS_RELAY_SECRET?.trim();
const dryRun = process.env.RELAY_DRY_RUN === "1" || process.env.RELAY_DRY_RUN === "true";
const service = (process.env.RELAY_SERVICE?.trim() || "SMS") as RelayService;
const relayId = hostname().slice(0, 64);

if (!siteUrl) fail("Set CONVEX_SITE_URL (in .env.local, written by `npx convex dev`).");
if (!secret) fail("Set SMS_RELAY_SECRET in .env.local (the same value as the Convex env var).");
if (service !== "SMS" && service !== "iMessage") fail(`RELAY_SERVICE must be SMS or iMessage, got "${service}".`);
const { allowed, invalid } = parseAllowlist(process.env.RELAY_ALLOWLIST);
if (invalid.length > 0) fail(`RELAY_ALLOWLIST has entries that are not phone numbers: ${invalid.join(", ")}`);
if (!dryRun && process.platform !== "darwin") fail("Sending needs macOS (Messages.app). Use RELAY_DRY_RUN=1 elsewhere.");

const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };

let stopping = false;
let wake: (() => void) | null = null;
process.on("SIGINT", () => {
  if (stopping) process.exit(130);
  stopping = true;
  log("stopping (Ctrl-C again to quit at once)…");
  wake?.();
});

/** Sleeps, but returns early on Ctrl-C. */
const sleep = (ms: number) =>
  new Promise<void>((done) => {
    const timer = setTimeout(() => {
      wake = null;
      done();
    }, ms);
    wake = () => {
      clearTimeout(timer);
      wake = null;
      done();
    };
  });

async function reason(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    return (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
  } catch {
    return text;
  }
}

/** Reports one result, retrying network errors and 5xx. The text is never sent again. */
async function postResult(result: ResultRequest): Promise<void> {
  let delay = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${siteUrl}/relay/result`, { method: "POST", headers, body: JSON.stringify(result), signal: AbortSignal.timeout(15_000) });
      if (res.ok) return;
      if (res.status < 500) throw new Error(`HTTP ${res.status}: ${await reason(res)} (not retried)`);
      if (attempt >= RESULT_ATTEMPTS) throw new Error(`HTTP ${res.status} after ${attempt} attempts`);
    } catch (err) {
      if (err instanceof Error && err.message.endsWith("(not retried)")) throw err;
      if (attempt >= RESULT_ATTEMPTS) throw err;
    }
    delay = nextBackoffMs(delay);
    await new Promise((r) => setTimeout(r, delay)); // not interrupted by Ctrl-C: the result matters
  }
}

async function send(to: string, body: string): Promise<void> {
  await run("osascript", osascriptArgs(SCRIPT, to, body, service), { timeout: 20_000 });
}

log(
  `relay "${relayId}" → ${siteUrl}, ${dryRun ? "DRY RUN (nothing is sent)" : `sending via ${service}`}, ` +
    (allowed.size > 0 ? `allowlist ${[...allowed].map(maskPhone).join(", ")}` : "no allowlist (texts any number)"),
);

const pacing = { lastSendAt: null as number | null };
let backoff = 0;
while (!stopping) {
  let res: Response;
  try {
    res = await fetch(`${siteUrl}/relay/claim`, { method: "POST", headers, body: JSON.stringify({ relayId }), signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    backoff = nextBackoffMs(backoff);
    log(`claim failed (${err instanceof Error ? err.message : String(err)}); retrying in ${backoff / 1000} s`);
    await sleep(backoff);
    continue;
  }
  if (res.status >= 500) {
    backoff = nextBackoffMs(backoff);
    log(`claim got HTTP ${res.status}; retrying in ${backoff / 1000} s`);
    await sleep(backoff);
    continue;
  }
  if (!res.ok) {
    const why = await reason(res);
    if (res.status === 401) fail(`HTTP 401: ${why}. Check SMS_RELAY_SECRET here and in the Convex env.`);
    if (res.status === 409) fail(`HTTP 409: ${why}. Set the Convex env SMS_NOTIFIER=mac_relay.`);
    fail(`HTTP ${res.status}: ${why}${res.status === 404 ? " (is the backend with /relay/claim deployed?)" : ""}`);
  }
  const parsed = ClaimResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    backoff = nextBackoffMs(backoff);
    log(`unexpected claim response (${parsed.error.issues[0]?.message ?? "invalid"}); retrying in ${backoff / 1000} s`);
    await sleep(backoff);
    continue;
  }
  backoff = 0;
  const { items } = parsed.data;
  if (items.length > 0) log(`claimed ${items.length} text(s)`);
  await processBatch(items, { send, postResult, sleep, log, now: Date.now, dryRun, allowlist: allowed.size > 0 ? allowed : null, pacing, stopping: () => stopping });
  if (items.length < RELAY_MAX_PER_CLAIM) await sleep(POLL_MS);
}
log("stopped");
