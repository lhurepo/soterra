// [B] Mac Messages relay helpers (scripts/lib/relayMac.ts): allowlist, backoff, osascript argv, batch processing.
// Nothing here runs osascript or reaches the network.
import { describe, expect, it } from "vitest";
import type { ClaimItem, ResultRequest } from "../src/notifications/relay";
import {
  BACKOFF_MAX_MS,
  SEND_SPACING_MS,
  describeSendError,
  isAllowed,
  maskPhone,
  nextBackoffMs,
  osascriptArgs,
  parseAllowlist,
  processBatch,
  type BatchDeps,
} from "../scripts/lib/relayMac";

const item = (n: number, to = "+17075550123"): ClaimItem => ({ notificationId: `n${n}`, to, body: `Update ${n}\n\nReply STOP`, claimToken: "tok" });

/** Fake deps with a fake clock: sleep advances it, send takes 500 ms. */
function fakeDeps(over: Partial<BatchDeps> = {}) {
  let clock = 1_000_000;
  const sent: { to: string; body: string; at: number }[] = [];
  const results: ResultRequest[] = [];
  const sleeps: number[] = [];
  const lines: string[] = [];
  const deps: BatchDeps = {
    send: async (to, body) => {
      sent.push({ to, body, at: clock });
      clock += 500;
    },
    postResult: async (r) => void results.push(r),
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    log: (l) => void lines.push(l),
    now: () => clock,
    dryRun: false,
    allowlist: new Set(["+17075550123", "+17075550145"]),
    pacing: { lastSendAt: null },
    ...over,
  };
  return { deps, sent, results, sleeps, lines };
}

describe("allowlist", () => {
  it("normalizes numbers to E.164 and reports entries that are not numbers", () => {
    const { allowed, invalid } = parseAllowlist(" +1 707 555 0123, (707) 555-0145;17075550199\nnope ,, ");
    expect([...allowed]).toEqual(["+17075550123", "+17075550145", "+17075550199"]);
    expect(invalid).toEqual(["nope"]);
    expect(parseAllowlist(undefined).allowed.size).toBe(0);
    expect(parseAllowlist("").invalid).toEqual([]);
  });

  it("matches any spelling of an allowed number, and nothing else", () => {
    const { allowed } = parseAllowlist("+17075550123");
    expect(isAllowed(allowed, "+17075550123")).toBe(true);
    expect(isAllowed(allowed, "707-555-0123")).toBe(true);
    expect(isAllowed(allowed, "+17075550124")).toBe(false);
    expect(isAllowed(allowed, "anonymous")).toBe(false);
  });
});

describe("helpers", () => {
  it("backs off 2 s, doubling, capped at 30 s", () => {
    const seen: number[] = [];
    let d = 0;
    for (let i = 0; i < 6; i++) seen.push((d = nextBackoffMs(d)));
    expect(seen).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    expect(nextBackoffMs(BACKOFF_MAX_MS)).toBe(BACKOFF_MAX_MS);
    expect(nextBackoffMs(0)).toBe(2_000);
  });

  it("passes the number and text as separate argv entries, untouched", () => {
    const body = `He said "run"; rm -rf / & \\ $(x) 'quoted'\n\nline`;
    expect(osascriptArgs("/x/relay-mac.applescript", "+17075550123", body, "SMS")).toEqual(["/x/relay-mac.applescript", "+17075550123", body, "SMS"]);
  });

  it("masks numbers in logs", () => {
    expect(maskPhone("+17075550123")).toBe("+1•••0123");
  });

  it("explains osascript failures, with hints for Automation and for a missing SMS account", () => {
    const automation = describeSendError({ stderr: "execution error: Not authorized to send Apple events to Messages. (-1743)\n" });
    expect(automation.error).toBe("osascript: execution error: Not authorized to send Apple events to Messages. (-1743)");
    expect(automation.hint).toMatch(/Automation/);
    const noSms = describeSendError({ stderr: "execution error: Messages got an error: Can’t get account 1 whose service type = SMS. Invalid index. (-1719)" });
    expect(noSms.hint).toMatch(/Text Message Forwarding/);
    const long = describeSendError({ stderr: "x".repeat(500) });
    expect(long.error.length).toBe("osascript: ".length + 160);
    expect(long.hint).toBeUndefined();
    expect(describeSendError({ killed: true, stderr: "" }).error).toBe("osascript: timed out");
  });
});

describe("processBatch", () => {
  it("sends one at a time, at least 3 s apart, and reports each as sent", async () => {
    const f = fakeDeps();
    await processBatch([item(1), item(2), item(3, "+17075550145")], f.deps);
    expect(f.sent.map((s) => s.to)).toEqual(["+17075550123", "+17075550123", "+17075550145"]);
    for (let i = 1; i < f.sent.length; i++) expect(f.sent[i].at - f.sent[i - 1].at).toBeGreaterThanOrEqual(SEND_SPACING_MS);
    expect(f.results).toEqual([
      { notificationId: "n1", claimToken: "tok", status: "sent" },
      { notificationId: "n2", claimToken: "tok", status: "sent" },
      { notificationId: "n3", claimToken: "tok", status: "sent" },
    ]);
    expect(f.lines.join("\n")).not.toContain("5550123");
  });

  it("keeps the spacing across batches", async () => {
    const f = fakeDeps();
    await processBatch([item(1)], f.deps);
    await processBatch([item(2)], f.deps);
    expect(f.sent[1].at - f.sent[0].at).toBeGreaterThanOrEqual(SEND_SPACING_MS);
  });

  it("never texts a number outside the allowlist", async () => {
    const f = fakeDeps();
    await processBatch([item(1, "+17075550199"), item(2)], f.deps);
    expect(f.sent.map((s) => s.to)).toEqual(["+17075550123"]);
    expect(f.results[0]).toEqual({ notificationId: "n1", claimToken: "tok", status: "failed", error: "not_allowlisted" });
  });

  it("with no allowlist, any number is texted", async () => {
    const f = fakeDeps({ allowlist: null });
    await processBatch([item(1, "+19495550100")], f.deps);
    expect(f.sent.map((s) => s.to)).toEqual(["+19495550100"]);
    expect(f.results[0]).toMatchObject({ status: "sent" });
  });

  it("dry run prints the text and reports relay_dry_run, sending nothing", async () => {
    const f = fakeDeps({ dryRun: true, allowlist: null });
    await processBatch([item(1, "+17075550199")], f.deps);
    expect(f.sent).toEqual([]);
    expect(f.sleeps).toEqual([]);
    expect(f.results).toEqual([{ notificationId: "n1", claimToken: "tok", status: "failed", error: "relay_dry_run" }]);
    expect(f.lines[0]).toContain("Update 1");
    expect(f.lines[0]).toContain("+1•••0199");
  });

  it("a send error is reported failed with osascript's message, and the batch goes on", async () => {
    let calls = 0;
    const f = fakeDeps();
    f.deps.send = async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error("Command failed"), { stderr: "execution error: Not authorized to send Apple events to Messages. (-1743)" });
    };
    await processBatch([item(1), item(2)], f.deps);
    expect(f.results[0]).toMatchObject({ notificationId: "n1", status: "failed", error: expect.stringMatching(/^osascript: .*-1743/) });
    expect(f.results[1]).toMatchObject({ notificationId: "n2", status: "sent" });
    expect(f.lines.join("\n")).toMatch(/hint: Automation/);
  });

  it("a result that can't be reported is logged, never sent again", async () => {
    const f = fakeDeps();
    f.deps.postResult = async () => {
      throw new Error("HTTP 409: already_done (not retried)");
    };
    await processBatch([item(1)], f.deps);
    expect(f.sent).toHaveLength(1);
    expect(f.lines.join("\n")).toMatch(/could not report sent/);
  });

  it("after Ctrl-C the rest of the batch is reported relay_stopped", async () => {
    let stop = false;
    const f = fakeDeps({ stopping: () => stop });
    const send = f.deps.send;
    f.deps.send = async (to, body) => {
      await send(to, body);
      stop = true;
    };
    await processBatch([item(1), item(2)], f.deps);
    expect(f.sent).toHaveLength(1);
    expect(f.results[1]).toEqual({ notificationId: "n2", claimToken: "tok", status: "failed", error: "relay_stopped" });
  });
});
