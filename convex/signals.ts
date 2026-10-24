// [I] Unverified social signals. Stored for operators only: never bulletins, never chunked, never
// retrievable, never a crisis trigger. A burst (≥ SIGNAL_BURST_THRESHOLD signals naming a hazard and a
// configured state within SIGNAL_BURST_WINDOW_MIN) schedules one early poll of official sources.
import { v } from "convex/values";
import { loadConfig } from "../src/config/env";
import { loadIngestionSettings } from "../src/ingestion/config";
import { isRunning } from "../src/ingestion/schedule";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { getSystemState, markSignalPoll } from "./systemState";
import { hazardType } from "./validators";

const NATIONAL = "US";

export const recordSignals = internalMutation({
  args: {
    signals: v.array(
      v.object({
        sourceId: v.string(),
        platform: v.literal("x"),
        externalId: v.string(),
        url: v.string(),
        authorHandle: v.string(),
        text: v.string(),
        postedAt: v.optional(v.number()),
        observedAt: v.number(),
        hazardTypes: v.array(hazardType),
        states: v.array(v.string()),
        isFixture: v.boolean(),
      }),
    ),
  },
  returns: v.object({ inserted: v.number(), polledSources: v.array(v.string()) }),
  handler: async (ctx, { signals }) => {
    const now = Date.now();
    const cfg = loadConfig(process.env);
    const settings = loadIngestionSettings(process.env);
    let inserted = 0;
    for (const s of signals) {
      const existing = await ctx.db
        .query("signals")
        .withIndex("by_externalId", (q) => q.eq("externalId", s.externalId))
        .first();
      if (existing) continue;
      const primaryState = s.states.find((st) => cfg.INGEST_STATES.includes(st)) ?? s.states[0] ?? NATIONAL;
      await ctx.db.insert("signals", { ...s, text: s.text.slice(0, 2_000), signalAt: s.postedAt ?? s.observedAt, primaryState });
      inserted++;
    }

    const windowMs = settings.SIGNAL_BURST_WINDOW_MIN * 60_000;
    const state = await getSystemState(ctx);
    if (inserted === 0 || (state?.lastSignalPollAt !== undefined && now - state.lastSignalPollAt < windowMs)) {
      return { inserted, polledSources: [] };
    }
    const burstStates: string[] = [];
    for (const st of cfg.INGEST_STATES) {
      const recent = await ctx.db
        .query("signals")
        .withIndex("by_primaryState_and_signalAt", (q) => q.eq("primaryState", st).gte("signalAt", now - windowMs))
        .take(200);
      if (recent.filter((r) => r.hazardTypes.length > 0).length >= settings.SIGNAL_BURST_THRESHOLD) burstStates.push(st);
    }
    if (burstStates.length === 0) return { inserted, polledSources: [] };

    const sources = await ctx.db.query("sources").take(100);
    const polled = sources.filter(
      (s) =>
        s.enabled &&
        s.kind === "official_api" &&
        s.trustTier === "official" &&
        (s.regionStates.includes("*") || s.regionStates.some((r) => burstStates.includes(r))) &&
        !isRunning(s, now),
    );
    for (const s of polled) {
      await ctx.scheduler.runAfter(0, internal.ingestion.runSource, { sourceId: s.sourceId, trigger: "signal_burst" });
    }
    await markSignalPoll(ctx, now);
    console.info(`[signals] burst in ${burstStates.join(", ")}: polling ${polled.map((s) => s.sourceId).join(", ") || "no enabled official source"}`);
    return { inserted, polledSources: polled.map((s) => s.sourceId) };
  },
});

export const recent = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => await ctx.db.query("signals").order("desc").take(Math.min(limit ?? 20, 100)),
});
