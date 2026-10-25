// [S] npm run demo:start | demo:control | demo:stop | demo:status — the Marina Earthquake demo switch (convex/demo.ts, demo/scenario.ts).
// start:   clean slate, real sources off, wave 1's calm pages crawled by Apify, then a control panel: the first Enter
//          switches every page to the earthquake and crawls wave 1 again; each later Enter crawls one wave-2 site.
//          `--auto` keeps the old flow: calm pages for 5 s (--delay <ms>), then every earthquake page is crawled.
// control: reopen the panel for the run that is on. stop: everything back to the beginning.
import { convexRun, convexRunAsync, flag, loadEnvLocal, sleep } from "./lib/env";

loadEnvLocal();
const command = process.argv[2];
const time = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString() : "-");

type SiteState = { sourceId: string; label: string; state: "queued" | "starting" | "running" | "done" | "failed"; startedAt?: number; error?: string };
type Tally = { calm: number; escalation: number };
type Progress = {
  on: boolean;
  runId?: string;
  manual: boolean;
  stage: "off" | "calm" | "calm_ready" | "quake";
  calm: SiteState[];
  quake: SiteState[];
  done: Tally;
  inProgress: Tally;
  remaining: Tally;
};

const finished = (s: SiteState) => s.state === "done" || s.state === "failed";
const total = (t: Tally) => t.calm + t.escalation;
/** "(5 calm, 1 escalation)"; kinds at zero are left out. */
const kinds = (t: Tally, extra = "") => {
  const parts = [t.calm > 0 ? `${t.calm} calm` : "", t.escalation > 0 ? `${t.escalation} escalation` : ""].filter(Boolean).join(", ");
  return parts || extra ? ` (${[parts, extra].filter(Boolean).join("; ")})` : "";
};

/**
 * The panel's lines: done / in progress / remaining over the 13 sources (manual: wave 1 calm, wave 2 escalation), wave 1's
 * earthquake crawls on their own line once released, then the keys.
 */
function frame(p: Progress | undefined, note: string): string[] {
  if (!p) return ["Connecting to Convex…"];
  if (!p.on) return ["The demo is off. Start it with: npm run demo:start", "", "[q] close"];
  const skip = p.manual ? p.calm.length : 0;
  const counted = [...p.calm, ...p.quake.slice(skip)];
  const failed = counted.filter((s) => s.state === "failed");
  const next = p.quake[p.quake.length - p.remaining.escalation];
  const lines = [
    `Marina Earthquake demo (${p.runId}${p.manual ? "" : ", auto"})`,
    "",
    `${total(p.done)} done${kinds(p.done, failed.length > 0 ? `${failed.length} failed: ${failed.map((s) => s.label).join(", ")}` : "")}`,
    `${total(p.inProgress)} in progress${kinds(p.inProgress)}`,
    `${total(p.remaining)} sources remaining${kinds(p.remaining)}`,
    "",
  ];
  if (p.manual && p.stage === "quake") {
    const wave1 = p.quake.slice(0, skip);
    const wave1Failed = wave1.filter((s) => s.state === "failed");
    lines.push(`Earthquake wave 1: ${wave1.filter(finished).length}/${skip} done${wave1Failed.length > 0 ? ` (failed: ${wave1Failed.map((s) => s.label).join(", ")})` : ""}`, "");
  }
  if (!p.manual) lines.push("Auto mode: every site is crawled on its own.   [q] close (the demo keeps running)");
  else if (p.stage === "calm") lines.push("Calm crawls running: take the call when they are done.   [q] close (the demo keeps running)");
  else if (p.stage === "calm_ready") lines.push(`Calm ready: take the call.   [Enter] the earthquake (wave 1: ${p.calm.map((s) => s.label).join(", ")})   [q] close`);
  else if (!next) lines.push("Every source is released.   [q] close (the demo keeps running)");
  else lines.push(`[Enter] next crawl: ${next.label}   [q] close (the demo keeps running)`);
  if (note) lines.push(note);
  return lines;
}

/** Lines cut to the terminal width, so the panel knows how many rows it drew and nothing is cut off. */
function wrap(lines: string[], width: number): string[] {
  return lines.flatMap((line) => {
    if (line.length <= width) return [line];
    const rows: string[] = [];
    let rest = line;
    while (rest.length > width) {
      const cut = rest.lastIndexOf(" ", width);
      const at = cut > width / 2 ? cut : width;
      rows.push(rest.slice(0, at));
      rest = rest.slice(at).trimStart();
    }
    return rest ? [...rows, rest] : rows;
  });
}

/** The useful line of a `convex run` failure (the CLI ends it with the list of every deployed function). */
function convexError(err: unknown): string {
  const lines = (err as Error).message.split("\n").map((l) => l.trim()).filter((l) => l && !/ExperimentalWarning|trace-warnings/.test(l));
  const missing = lines.find((l) => l.startsWith("Could not find function"))?.match(/'([^']+)'/)?.[1];
  if (missing) return `${missing} is not on the deployment (was other code pushed?). Push this branch: npx convex dev --once`;
  return lines.find((l) => /error/i.test(l) && !l.startsWith("✖")) ?? lines[0] ?? "unknown error";
}

/** Live panel: redraws in place, Enter calls demo:release, q closes it (the demo itself keeps running). */
async function control(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.log("Open the control panel in a terminal: npm run demo:control");
    return;
  }
  let progress: Progress | undefined;
  let note = "";
  let problem = "";
  let updatedAt = 0;
  let drawn = 0;
  let busy = false;
  let closed = false;
  let rang = false;

  const draw = () => {
    if (closed) return;
    const lines = frame(progress, note);
    // The counts stay on screen when Convex cannot be reached, marked as old so nobody reads them as live.
    if (problem) lines.push(`Not updating${updatedAt ? ` (counts from ${Math.round((Date.now() - updatedAt) / 1000)}s ago)` : ""}: ${problem}`);
    const rows = wrap(lines, Math.max(20, (process.stdout.columns ?? 120) - 1));
    process.stdout.write(`${drawn > 0 ? `\x1b[${drawn}F\x1b[0J` : ""}${rows.join("\n")}\n`);
    drawn = rows.length;
  };
  const refresh = async () => {
    try {
      progress = (await convexRunAsync("demo:progress", {})) as Progress;
      updatedAt = Date.now();
      problem = "";
      if (progress.stage === "calm_ready" && !rang) {
        rang = true;
        process.stdout.write("\x07");
      }
    } catch (err) {
      problem = convexError(err);
    }
    draw();
  };
  const release = async () => {
    if (busy || !progress?.manual || progress.remaining.escalation === 0) return;
    busy = true;
    note = "Starting…";
    draw();
    try {
      note = ((await convexRunAsync("demo:release", {})) as { message: string }).message;
    } catch (err) {
      note = `Not started: ${convexError(err)}`;
    }
    await refresh();
    busy = false;
  };
  const close = () => {
    closed = true;
    process.stdin.setRawMode(false);
    console.log("\nPanel closed. The demo keeps running: npm run demo:control reopens it, npm run demo:stop resets.");
    process.exit(0);
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (key: Buffer) => {
    const k = key.toString();
    if (k === "\r" || k === "\n") void release();
    else if (k === "q" || k === "\u0003" || k === "\u0004") close();
  });
  process.stdout.on("resize", draw);
  const ticker = setInterval(draw, 1_000); // the age of the counts while Convex is unreachable
  ticker.unref();
  draw();
  for (;;) {
    await refresh();
    await sleep(1_500);
  }
}

if (command === "start") {
  if (process.argv.includes("--auto")) {
    const delay = flag("delay");
    const r = convexRun("demo:start", delay ? { delayMs: Number(delay) } : {}) as { escalateAt?: number };
    console.log(`Demo started (auto). Calm pages now; the earthquake pages go live at ${time(r.escalateAt)} and Apify starts crawling.`);
    console.log("Callbacks reach whoever called and asked to be called back. Stop with: npm run demo:stop");
  } else {
    convexRun("demo:start", { manual: true });
    console.log("Demo started. Apify is crawling wave 1's calm pages; the earthquake waits for you.");
    console.log("Callbacks reach whoever called and asked to be called back. Stop with: npm run demo:stop\n");
    await control();
  }
} else if (command === "control") {
  await control();
} else if (command === "stop") {
  convexRun("demo:stop", {});
  console.log("Demo stopped and reset. Start again with: npm run demo:start");
} else if (command === "offline") {
  const r = convexRun("demo:takeOffline", {}) as { sourcesOff: number; bulletinsOff: number };
  console.log(`Offline: ${r.sourcesOff} source(s) switched off, ${r.bulletinsOff} bulletin(s) taken out of service. Only the demo is served.`);
} else if (command === "status") {
  const s = convexRun("demo:getStatus", {}) as { on: boolean; startedAt?: number; escalateAt?: number };
  console.log(`Demo ${s.on ? "ON" : "off"}; started ${time(s.startedAt)}, earthquake pages at ${time(s.escalateAt)}.`);
  const p = convexRun("demo:progress", {}) as Progress;
  if (p.on) {
    for (const line of frame(p, "").slice(2, 5)) console.log(`  ${line}`);
  }
  const runs = convexRun("demo:recentRuns", {}) as { sourceId: string; status: string; seconds?: number; counts?: unknown; error?: string }[];
  for (const r of runs) console.log(`  ${r.sourceId.padEnd(18)} ${r.status.padEnd(15)} ${r.seconds !== undefined ? `${r.seconds}s` : ""} ${r.error ?? (r.counts ? JSON.stringify(r.counts) : "")}`);
} else {
  console.log("Usage: npm run demo:start [-- --auto [--delay 5000]] | demo:control | demo:stop | demo:status | demo:offline");
  process.exit(1);
}
