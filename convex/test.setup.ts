/// <reference types="vite/client" />
// [S] Shared convex-test setup. The two dots in this file name keep Convex from deploying it.
import { convexTest } from "convex-test";
import { vi } from "vitest";
import schema from "./schema";
import initial from "../fixtures/normalized/ridgeview-initial.json";
import update from "../fixtures/normalized/ridgeview-update.json";
import countyHtml from "../fixtures/mock-sites/v1/county-emergency.html?raw";
import { internal } from "./_generated/api";

export const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.d.ts", "!./**/*.test.ts", "!./test.setup.ts"]);

export const SECRET = "test-voice-secret";

export function setupEnv(overrides: Record<string, string> = {}) {
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries({ VOICE_API_SECRET: SECRET, SERVE_FIXTURES: "true", ...overrides })) vi.stubEnv(k, v);
}

export function newTest() {
  return convexTest({ schema, modules });
}

export type TestConvex = ReturnType<typeof newTest>;

export async function seed(t: TestConvex, set: "initial" | "update" = "initial") {
  return await t.mutation(internal.dev.seedFixtures, {
    bulletins: (set === "initial" ? initial : update) as never,
    mockSites: set === "initial" ? [{ path: "county-emergency.html", contentType: "text/html; charset=utf-8", body: countyHtml }] : undefined,
  });
}

/** Adapts convex-test's HTTP router to the fetch shape scripts/lib/simCall.ts expects. */
export function fetchPath(t: TestConvex) {
  return (path: string, init: RequestInit) => t.fetch(path, init);
}

export function voicePost(t: TestConvex, path: string, body: unknown, secret: string | null = SECRET) {
  return t.fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify(body),
  });
}
