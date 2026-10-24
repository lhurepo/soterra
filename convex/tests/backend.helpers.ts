// [B] Helpers for the backend integration tests. Two dots in the name: never deployed, never in the module map.
import { vi } from "vitest";
import initial from "../../fixtures/normalized/ridgeview-initial.json";
import update from "../../fixtures/normalized/ridgeview-update.json";
import { CONTRACT_VERSION, SessionStartResponse, TurnResponse, type NormalizedBulletinDraft } from "../../src/contracts";
import { finalizeBulletin } from "../../src/ingestion/normalize";
import { internal } from "../_generated/api";
import { voicePost, type TestConvex } from "../test.setup";

/** 2026-10-24 15:00 Pacific: after every fixture bulletin was issued, before the Red Flag Warning expires. */
export const DEMO_NOW = new Date("2026-10-24T22:00:00Z");

/** Fake phone numbers only (555-01xx). */
export const PHONE = "+17075550123";
export const PHONE_2 = "+17075550145";

export const initialDrafts = initial as NormalizedBulletinDraft[];
export const updateDrafts = update as NormalizedBulletinDraft[];

/** Seeds through the ingestion contract: internal.ingestion.upsertBulletins. */
export async function seedBulletins(t: TestConvex, drafts: NormalizedBulletinDraft[] = initialDrafts) {
  return await t.mutation(internal.ingestion.upsertBulletins, { items: drafts.map(finalizeBulletin) });
}

export function useDemoClock() {
  vi.useFakeTimers();
  vi.setSystemTime(DEMO_NOW);
}

export async function start(t: TestConvex, over: Record<string, unknown> = {}) {
  const res = await voicePost(t, "/voice/session/start", {
    contractVersion: CONTRACT_VERSION,
    provider: "cartesia",
    providerCallId: `call-${Math.random().toString(36).slice(2)}`,
    direction: "inbound",
    callerPhone: PHONE,
    languageHint: "en",
    startedAt: Date.now(),
    ...over,
  });
  if (res.status !== 200) throw new Error(`start failed: ${res.status} ${await res.text()}`);
  return SessionStartResponse.parse(await res.json());
}

export async function say(t: TestConvex, sessionId: string, turnIndex: number, utterance: string, over: Record<string, unknown> = {}) {
  const res = await voicePost(t, "/voice/turn", {
    contractVersion: CONTRACT_VERSION,
    sessionId,
    turnIndex,
    utterance,
    language: "en",
    receivedAt: Date.now(),
    ...over,
  });
  if (res.status !== 200) throw new Error(`turn failed: ${res.status} ${await res.text()}`);
  return TurnResponse.parse(await res.json());
}

export async function end(t: TestConvex, sessionId: string, reason = "caller_hangup") {
  const res = await voicePost(t, "/voice/session/end", { contractVersion: CONTRACT_VERSION, sessionId, endedAt: Date.now(), reason });
  if (res.status !== 200) throw new Error(`end failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

/** Runs scheduled work (finalize, summaries, matching, delivery) to completion. */
export async function settle(t: TestConvex) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

/** Update notifications only (calls or texts about a bulletin change or on a schedule), oldest first. */
export async function updateNotifications(t: TestConvex) {
  const rows = await t.run(async (ctx) => await ctx.db.query("notifications").collect());
  return rows.filter((n) => n.purpose === undefined || n.purpose === "update" || n.purpose === "scheduled_update");
}

/** Texts about calls (confirmation, recap, missed call), oldest first. */
export async function callTexts(t: TestConvex) {
  const rows = await t.run(async (ctx) => await ctx.db.query("notifications").collect());
  return rows.filter((n) => n.purpose === "subscription_confirmation" || n.purpose === "call_recap" || n.purpose === "missed_call_text");
}
