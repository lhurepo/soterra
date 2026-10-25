// [B] Pure parts of the Mac Messages relay (scripts/relay-mac.ts), unit-tested in tests/relayMac.test.ts.
import { normalizeE164 } from "../../src/memory/phone";
import type { ClaimItem, ResultRequest } from "../../src/notifications/relay";

export const POLL_MS = 2_000;
export const BACKOFF_MIN_MS = 2_000;
export const BACKOFF_MAX_MS = 30_000;
/** At least this long between two texts handed to Messages. */
export const SEND_SPACING_MS = 3_000;

export type RelayService = "SMS" | "iMessage";

/** "+1 707 555 0123, (707) 555-0145" → the E.164 numbers, plus the entries that are not phone numbers. */
export function parseAllowlist(raw: string | undefined): { allowed: Set<string>; invalid: string[] } {
  const allowed = new Set<string>();
  const invalid: string[] = [];
  for (const entry of (raw ?? "").split(/[,;\n]/)) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    const e164 = normalizeE164(trimmed);
    if (e164) allowed.add(e164);
    else invalid.push(trimmed);
  }
  return { allowed, invalid };
}

export function isAllowed(allowlist: ReadonlySet<string>, to: string): boolean {
  const e164 = normalizeE164(to);
  return e164 !== undefined && allowlist.has(e164);
}

/** 2 s, then doubling, at most 30 s. Pass the previous delay (or 0 after a success). */
export function nextBackoffMs(previousMs: number): number {
  return previousMs <= 0 ? BACKOFF_MIN_MS : Math.min(previousMs * 2, BACKOFF_MAX_MS);
}

/** argv for `osascript`: the number and text are arguments, never part of the script source. */
export function osascriptArgs(scriptPath: string, to: string, body: string, service: RelayService): string[] {
  return [scriptPath, to, body, service];
}

/** "+17075550123" → "+1•••0123" for logs. */
export function maskPhone(phone: string): string {
  return phone.length <= 6 ? "•••" : `${phone.slice(0, 2)}•••${phone.slice(-4)}`;
}

/** The error to report for a failed osascript run (≤200 chars, what /relay/result accepts) and a hint for the log. */
export function describeSendError(err: unknown): { error: string; hint?: string } {
  const e = err as { stderr?: unknown; message?: unknown; killed?: boolean; signal?: unknown } | null;
  const stderr = typeof e?.stderr === "string" && e.stderr.trim() !== "" ? e.stderr : typeof e?.message === "string" ? e.message : String(err);
  const detail = e?.killed ? "timed out" : stderr.replace(/\s+/g, " ").trim().slice(0, 160);
  let hint: string | undefined;
  if (/-1743/.test(stderr)) hint = "Automation permission: System Settings → Privacy & Security → Automation → allow your terminal to control Messages";
  else if (/service type = SMS|\(-1728\)|\(-1719\)/.test(stderr))
    hint = "no SMS account in Messages: turn on Text Message Forwarding for this Mac on the iPhone (docs/mac-relay.md)";
  return { error: `osascript: ${detail}`, hint };
}

export interface BatchDeps {
  send(to: string, body: string): Promise<void>;
  /** Reports one result. Retries are its job; it never sends the text again. */
  postResult(result: ResultRequest): Promise<void>;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
  now(): number;
  dryRun: boolean;
  /** null: no allowlist, any number is texted. */
  allowlist: ReadonlySet<string> | null;
  /** Shared across batches, so the spacing holds when the next claim comes straight back. */
  pacing: { lastSendAt: number | null };
  /** True once Ctrl-C was pressed: the rest of the batch is reported failed instead of sent. */
  stopping?: () => boolean;
}

/** Sends the claimed texts one at a time, at least SEND_SPACING_MS apart, and reports each result. */
export async function processBatch(items: ClaimItem[], deps: BatchDeps): Promise<void> {
  for (const item of items) {
    const who = maskPhone(item.to);
    const report = async (result: Omit<ResultRequest, "notificationId" | "claimToken">) => {
      try {
        await deps.postResult({ notificationId: item.notificationId, claimToken: item.claimToken, ...result });
      } catch (err) {
        deps.log(`could not report ${result.status} for ${who}: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    if (deps.stopping?.()) {
      deps.log(`stopping: not sending to ${who}`);
      await report({ status: "failed", error: "relay_stopped" });
      continue;
    }
    if (deps.allowlist && !isAllowed(deps.allowlist, item.to)) {
      deps.log(`skipped ${who}: not in RELAY_ALLOWLIST`);
      await report({ status: "failed", error: "not_allowlisted" });
      continue;
    }
    if (deps.dryRun) {
      deps.log(`dry run, would text ${who}:\n${item.body}`);
      await report({ status: "failed", error: "relay_dry_run" });
      continue;
    }

    const last = deps.pacing.lastSendAt;
    if (last !== null) {
      const wait = last + SEND_SPACING_MS - deps.now();
      if (wait > 0) await deps.sleep(wait);
    }
    if (deps.stopping?.()) {
      deps.log(`stopping: not sending to ${who}`);
      await report({ status: "failed", error: "relay_stopped" });
      continue;
    }
    try {
      await deps.send(item.to, item.body);
    } catch (err) {
      deps.pacing.lastSendAt = deps.now();
      const { error, hint } = describeSendError(err);
      deps.log(`failed ${who}: ${error}${hint ? `\n  hint: ${hint}` : ""}`);
      await report({ status: "failed", error });
      continue;
    }
    deps.pacing.lastSendAt = deps.now();
    deps.log(`handed to Messages: ${who}`);
    await report({ status: "sent" });
  }
}
