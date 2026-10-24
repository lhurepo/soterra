// [I] Pure ingestion helpers: hashing, change detection, chunking, validation, quote checks, scheduling.
import { describe, expect, it } from "vitest";
import type { NormalizedBulletinDraft } from "../src/contracts";
import { chunkBulletin } from "../src/ingestion/chunk";
import { decideChange } from "../src/ingestion/dedupe";
import { verifyQuotes } from "../src/ingestion/extract";
import { finalizeBulletin } from "../src/ingestion/normalize";
import { dueSources } from "../src/ingestion/schedule";
import { validateBulletin } from "../src/ingestion/validate";
import initial from "../fixtures/normalized/ridgeview-initial.json";
import update from "../fixtures/normalized/ridgeview-update.json";

const evac = finalizeBulletin(initial[1] as NormalizedBulletinDraft);
const evacUpdate = finalizeBulletin(update[0] as NormalizedBulletinDraft);

describe("change detection", () => {
  it("creates, ignores identical content, and updates changed content", () => {
    expect(decideChange(null, evac)).toBe("created");
    expect(decideChange({ latestVersion: 1, contentHash: evac.contentHash, status: "actual" }, evac)).toBe("unchanged");
    expect(evacUpdate.contentHash).not.toBe(evac.contentHash);
    expect(decideChange({ latestVersion: 1, contentHash: evac.contentHash, status: "actual" }, evacUpdate)).toBe("updated");
    expect(decideChange({ latestVersion: 1, contentHash: evac.contentHash, status: "actual" }, { ...evac, status: "cancelled", contentHash: "x" })).toBe("cancelled");
  });
});

describe("validation", () => {
  it("rejects items without a URL or issue time", () => {
    const { url: _u, ...noUrl } = evac;
    expect(validateBulletin(noUrl).ok).toBe(false);
    const { issuedAt: _i, ...noTime } = evac;
    expect(validateBulletin(noTime).ok).toBe(false);
    expect(validateBulletin(evac).ok).toBe(true);
  });
});

describe("chunking", () => {
  it("makes one title-prefixed chunk per paragraph", () => {
    const chunks = chunkBulletin(evac);
    expect(chunks.length).toBe(4);
    for (const c of chunks) expect(c.startsWith("Evacuation Warning for the Ridgeview Fire.")).toBe(true);
  });
});

describe("extraction quote check", () => {
  const source = "Ridgeview Community Center at 500 Elm Street has room for 200 people.";
  const item = (quote: string) => ({
    items: [
      {
        title: { value: "Shelter", quote: "Ridgeview Community Center" },
        body: { value: "Capacity 200", quote },
        hazardType: "shelter" as const,
        severity: "moderate" as const,
        areas: [],
      },
    ],
  });
  it("accepts quotes present in the source", () => expect(verifyQuotes(item("room for 200 people"), source)).toBeNull());
  it("rejects invented quotes", () => expect(verifyQuotes(item("room for 900 people"), source)).toMatch(/quote not found/));
});

describe("tick scheduling", () => {
  const src = { sourceId: "nws_alerts", enabled: true, normalIntervalMin: 5, crisisIntervalMin: 1 };
  it("uses the crisis interval in crisis mode and skips disabled sources", () => {
    const now = 10 * 60_000;
    expect(dueSources([{ ...src, lastFetchedAt: now - 2 * 60_000 }], "normal", now)).toEqual([]);
    expect(dueSources([{ ...src, lastFetchedAt: now - 2 * 60_000 }], "crisis", now)).toEqual(["nws_alerts"]);
    expect(dueSources([{ ...src, enabled: false }], "crisis", now)).toEqual([]);
  });
});
