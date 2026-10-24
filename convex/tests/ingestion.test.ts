// [I] upsertBulletins: dedupe, versioning, chunk rewrite, events, quarantine, trust tiers, crisis, expiry,
// plus the escalation → subscription → notification path.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import update from "../../fixtures/normalized/ridgeview-update.json";
import { CONTRACT_VERSION, type NormalizedBulletinDraft } from "../../src/contracts";
import { finalizeBulletin } from "../../src/ingestion/normalize";
import { internal } from "../_generated/api";
import { newTest, seed, setupEnv, voicePost } from "../test.setup";

beforeEach(() => {
  vi.useFakeTimers();
  setupEnv();
});
afterEach(() => vi.useRealTimers());

const evacUpdate = update[0] as NormalizedBulletinDraft;

describe("upsertBulletins", () => {
  it("creates, dedupes unchanged content, versions updates and emits bulletin events", async () => {
    const t = newTest();
    const first = await seed(t);
    expect(first.map((r) => r.change)).toEqual(["created", "created", "created", "created", "created"]);
    const again = await seed(t);
    expect(again.map((r) => r.change)).toEqual(["unchanged", "unchanged", "unchanged", "unchanged", "unchanged"]);

    const [updated] = await t.mutation(internal.ingestion.upsertBulletins, { items: [finalizeBulletin(evacUpdate)] });
    expect(updated.change).toBe("updated");
    expect(updated.versionNumber).toBe(2);

    await t.run(async (ctx) => {
      const id = updated.bulletinId!;
      const versions = await ctx.db.query("bulletinVersions").withIndex("by_bulletinId_and_versionNumber", (q) => q.eq("bulletinId", id)).collect();
      expect(versions.map((v) => v.versionNumber)).toEqual([1, 2]);
      const chunks = await ctx.db.query("chunks").withIndex("by_bulletinId", (q) => q.eq("bulletinId", id)).collect();
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.every((c) => c.versionNumber === 2 && c.severity === "extreme")).toBe(true);
      const events = await ctx.db.query("bulletinEvents").withIndex("by_bulletinId", (q) => q.eq("bulletinId", id)).collect();
      expect(events.map((e) => [e.change, e.severityBefore, e.severityAfter])).toEqual([
        ["created", undefined, "severe"],
        ["updated", "severe", "extreme"],
      ]);
    });
  });

  it("quarantines invalid items instead of storing them", async () => {
    const t = newTest();
    const bad = { ...finalizeBulletin(evacUpdate), url: "not a url" };
    const [result] = await t.mutation(internal.ingestion.upsertBulletins, { items: [bad] });
    expect(result.change).toBe("rejected");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("bulletins").collect()).toHaveLength(0);
      expect((await ctx.db.query("quarantine").collect())[0].reason).toMatch(/url/i);
    });
  });

  it("stores unverified content as a signal only: no chunks, no events", async () => {
    const t = newTest();
    const rumor = finalizeBulletin({ ...evacUpdate, sourceId: "x_unverified", externalId: "rumor-1", trustTier: "unverified", isFixture: false });
    await t.mutation(internal.ingestion.upsertBulletins, { items: [rumor] });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("bulletins").collect()).toHaveLength(1);
      expect(await ctx.db.query("chunks").collect()).toHaveLength(0);
      expect(await ctx.db.query("bulletinEvents").collect()).toHaveLength(0);
    });
  });

  it("enters crisis mode on a severe official live bulletin, but never for fixtures", async () => {
    const t = newTest();
    await seed(t);
    expect(await t.query(internal.systemState.get, {})).toBeNull();
    const live = finalizeBulletin({ ...evacUpdate, sourceId: "nws_alerts", externalId: "live-1", isFixture: false });
    await t.mutation(internal.ingestion.upsertBulletins, { items: [live] });
    expect((await t.query(internal.systemState.get, {}))?.mode).toBe("crisis");
  });

  it("deactivates expired bulletins and their chunks", async () => {
    const t = newTest();
    vi.setSystemTime(new Date("2026-10-24T20:00:00Z"));
    await seed(t);
    vi.setSystemTime(new Date("2026-11-17T00:00:00Z")); // after the Red Flag Warning expires (Nov 15, 8 PM PST)
    expect(await t.mutation(internal.ingestion.expireBulletins, {})).toBe(1);
    await t.run(async (ctx) => {
      const rfw = (await ctx.db.query("bulletins").collect()).find((b) => b.externalId === "demo-rfw-ridgeview-1");
      expect(rfw?.isActive).toBe(false);
      expect(await ctx.db.query("chunks").withIndex("by_bulletinId", (q) => q.eq("bulletinId", rfw!._id)).collect()).toHaveLength(0);
    });
  });

  it("tick is harmless when every source is disabled", async () => {
    const t = newTest();
    expect(await t.mutation(internal.sources.syncRegistry, {})).toBeGreaterThan(0);
    expect(await t.mutation(internal.ingestion.tick, {})).toEqual([]);
  });
});

describe("escalation callback", () => {
  it("notifies a caller who asked to be called if the evacuation changes", async () => {
    const t = newTest();
    await seed(t);
    const start = await (
      await voicePost(t, "/voice/session/start", {
        contractVersion: CONTRACT_VERSION,
        provider: "cartesia",
        providerCallId: "follow",
        direction: "inbound",
        callerPhone: "+17075550123",
        startedAt: 1,
      })
    ).json();
    for (const [turnIndex, utterance] of ["What's going on with the Ridgeview Fire?", "Call me if the evacuation changes."].entries()) {
      await voicePost(t, "/voice/turn", { contractVersion: CONTRACT_VERSION, sessionId: start.sessionId, turnIndex, utterance, language: "en", receivedAt: 2 });
    }

    await seed(t, "update");
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const notifications = await t.run(async (ctx) => await ctx.db.query("notifications").collect());
    expect(notifications).toHaveLength(1);
    expect(notifications[0].status).toBe("mock");
    expect(notifications[0].recipientPhone).toBe("+17075550123");
    expect(notifications[0].message).toMatch(/Evacuation Order for zone SON-3A/);

    // The outbound call's greeting delivers the update.
    const outbound = await (
      await voicePost(t, "/voice/session/start", {
        contractVersion: CONTRACT_VERSION,
        provider: "cartesia",
        providerCallId: "callback-1",
        direction: "outbound",
        callerPhone: "+17075550123",
        notificationId: notifications[0]._id,
        startedAt: 3,
      })
    ).json();
    expect(outbound.greeting).toMatch(/Evacuation Order for zone SON-3A/);
    expect(outbound.greeting).toMatch(/911/);
  });
});
