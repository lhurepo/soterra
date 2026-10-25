// [S] Script helpers: load .env.local (written by `npx convex dev`) and run the Convex CLI.
import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..", "..");

export function loadEnvLocal(): void {
  try {
    process.loadEnvFile(resolve(ROOT, ".env.local"));
  } catch {
    // No .env.local yet: rely on the shell environment.
  }
}

export function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(ROOT, relativePath), "utf8")) as T;
}

export function readText(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

/** Runs `npx convex run <fn> <json>` against the deployment in .env.local and returns parsed output. */
export function convexRun(fn: string, args: unknown): unknown {
  const out = execFileSync("npx", ["convex", "run", fn, JSON.stringify(args)], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  try {
    return JSON.parse(out);
  } catch {
    return out.trim();
  }
}

/** convexRun without blocking (for the demo control panel): stderr is captured (and becomes the error) so it never draws over the screen. */
export function convexRunAsync(fn: string, args: unknown): Promise<unknown> {
  return new Promise((done, fail) => {
    execFile(resolve(ROOT, "node_modules", ".bin", "convex"), ["run", fn, JSON.stringify(args)], { cwd: ROOT, encoding: "utf8" }, (err, out, errOut) => {
      if (err) return fail(new Error(errOut.trim() || err.message));
      try {
        done(JSON.parse(out));
      } catch {
        done(out.trim());
      }
    });
  });
}

export const sleep =(ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function flag(name: string): string | undefined {
  const args = process.argv.slice(2);
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

type RunRow = { _id: string; sourceId: string; status: string; counts?: unknown; error?: string; apifyRunId?: string; mossSync?: string };

/** Polls ingestionRuns:getRun until the run finishes or the timeout passes. */
export async function waitForRun(runId: string, timeoutMs: number): Promise<RunRow | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = convexRun("ingestionRuns:getRun", { runId }) as RunRow | null;
    if (!row || row.status === "succeeded" || row.status === "failed" || Date.now() >= deadline) return row;
    await sleep(3_000);
  }
}

export function printRun(row: RunRow | null): void {
  if (!row) return console.log("  (no run record)");
  console.log(`  ${row.sourceId}: ${row.status}${row.error ? ` — ${row.error}` : ""}`);
  if (row.counts) console.log(`    counts ${JSON.stringify(row.counts)}  moss ${row.mossSync ?? "-"}${row.apifyRunId ? `  apify ${row.apifyRunId}` : ""}`);
}
