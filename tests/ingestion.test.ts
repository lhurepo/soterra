// [I] Pure ingestion helpers: hashing, change detection, chunk headers, validation, scheduling, crisis rules.
import { describe, expect, it } from "vitest";
import type { NormalizedBulletinDraft } from "../src/contracts";
import { CHUNK_TARGET_CHARS, chunkBulletin, chunkHeader } from "../src/ingestion/chunk";
import { loadIngestionSettings, parseXAllowlist } from "../src/ingestion/config";
import { CRISIS_DURATION_MS, crisisExpired, enterOrExtendCrisis, triggersCrisis } from "../src/ingestion/crisis";
import { decideChange } from "../src/ingestion/dedupe";
import { areaFromSame, areaFromUgc, countyByName, stateFromPlace, statesNamedIn } from "../src/ingestion/geo";
import { finalizeBulletin } from "../src/ingestion/normalize";
import { UPSERT_BATCH_SIZE, batches, prepareItems } from "../src/ingestion/pipeline";
import { backoffMs, intervalMs, isDue } from "../src/ingestion/schedule";
import { SOURCES, effectiveMode, isFixtureRun } from "../src/ingestion/sources";
import { parsePageTime, parseTwitterTime } from "../src/ingestion/time";
import { validateBulletin } from "../src/ingestion/validate";
import { buildRunActorRequest } from "../src/providers/apify";
import initial from "../fixtures/normalized/ridgeview-initial.json";
import update from "../fixtures/normalized/ridgeview-update.json";

const evac = finalizeBulletin(initial[1] as NormalizedBulletinDraft);
const evacUpdate = finalizeBulletin(update[0] as NormalizedBulletinDraft);

describe("change detection", () => {
  it("creates, ignores identical content, updates changed content, cancels", () => {
    expect(decideChange(null, evac)).toBe("created");
    expect(decideChange({ latestVersion: 1, contentHash: evac.contentHash, status: "actual" }, evac)).toBe("unchanged");
    expect(evacUpdate.contentHash).not.toBe(evac.contentHash);
    expect(decideChange({ latestVersion: 1, contentHash: evac.contentHash, status: "actual" }, evacUpdate)).toBe("updated");
    expect(decideChange({ latestVersion: 1, contentHash: evac.contentHash, status: "actual" }, { ...evac, status: "cancelled", contentHash: "x" })).toBe("cancelled");
  });

  it("hashes meaningful fields only, never fetch or update times", () => {
    const later = finalizeBulletin({ ...(initial[1] as NormalizedBulletinDraft), updatedAt: 1792899999999, timeBasis: "observed" });
    expect(later.contentHash).toBe(evac.contentHash);
  });
});

describe("validation", () => {
  it("rejects items without a URL, source or issue time", () => {
    const { url: _u, ...noUrl } = evac;
    expect(validateBulletin(noUrl).ok).toBe(false);
    const { sourceId: _s, ...noSource } = evac;
    expect(validateBulletin(noSource).ok).toBe(false);
    const { issuedAt: _i, ...noTime } = evac;
    expect(validateBulletin(noTime).ok).toBe(false);
    expect(validateBulletin(evac).ok).toBe(true);
    expect(validateBulletin({ ...evac, timeBasis: "observed" }).ok).toBe(true);
    expect(validateBulletin({ ...evac, timeBasis: "guessed" }).ok).toBe(false);
  });
});

describe("chunking", () => {
  it("prefixes every chunk with a one-sentence header: title, issuer, area, time and basis", () => {
    const header = chunkHeader(evac);
    expect(header).toBe(
      "Evacuation Warning for the Ridgeview Fire — Sonoma County Emergency Management (Demo) — Sonoma County zones SON-3A and SON-3B — issued October 24 at 1:45 PM Pacific.",
    );
    expect(header.slice(0, -1)).not.toMatch(/[.!?]/);
    for (const c of chunkBulletin(evac)) expect(c.startsWith(header)).toBe(true);
  });

  it("labels page-updated and observed times", () => {
    expect(chunkHeader({ ...evac, timeBasis: "page_updated" })).toMatch(/page last updated October 24 at 1:45 PM Pacific\.$/);
    expect(chunkHeader({ ...evac, timeBasis: "observed" })).toMatch(/no published time, as observed when Soterra checked October 24 at 1:45 PM Pacific\.$/);
  });

  it("packs paragraphs into chunks of at most ~1,200 characters on paragraph boundaries", () => {
    const para = (n: number) => `Paragraph ${n} ${"word ".repeat(80).trim()}.`;
    const body = Array.from({ length: 9 }, (_, i) => para(i)).join("\n\n");
    const chunks = chunkBulletin({ ...evac, body, instructions: undefined });
    const header = chunkHeader(evac);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      const text = c.slice(header.length + 1);
      expect(text.length).toBeLessThanOrEqual(CHUNK_TARGET_CHARS);
      expect(text.startsWith("Paragraph")).toBe(true);
    }
    expect(chunkBulletin(evac)).toHaveLength(1); // a short bulletin stays one chunk
  });
});

describe("geography", () => {
  it("decodes SAME and UGC codes", () => {
    expect(areaFromSame("006097")).toEqual({ state: "CA", county: "Sonoma", countyFips: "06097", label: "Sonoma County" });
    expect(areaFromSame("006055")?.county).toBe("Napa");
    expect(areaFromSame("012086")).toEqual({ state: "FL", countyFips: "12086", label: "County 12086" });
    expect(areaFromUgc("CAZ504", "North Bay Interior Valleys")).toEqual({ state: "CA", nwsZone: "CAZ504", label: "North Bay Interior Valleys" });
    expect(areaFromUgc("CAC097")).toMatchObject({ state: "CA", countyFips: "06097", county: "Sonoma" });
    expect(areaFromUgc("XXZ001")).toBeUndefined();
  });

  it("finds counties and states only when named", () => {
    expect(countyByName("CA", "Los Angeles County")?.countyFips).toBe("06037");
    expect(countyByName("CA", "Yuba")?.countyFips).toBe("06115");
    expect(stateFromPlace("6 km NE of Glen Ellen, CA")).toBe("CA");
    expect(stateFromPlace("20 km S of Hawthorne, Nevada")).toBe("NV");
    expect(stateFromPlace("219 km WNW of Port-Olry, Vanuatu")).toBeUndefined();
    expect(statesNamedIn("Alaska, British Columbia, Washington, Oregon, and California")).toEqual(["AK", "CA", "OR", "WA"]);
    expect(statesNamedIn("West Virginia")).toEqual(["WV"]);
  });
});

describe("time parsing", () => {
  it("parses page times only with a full date, clock time and zone", () => {
    expect(parsePageTime("Last updated: October 24, 2026, 1:45 PM PDT")).toBe(Date.parse("2026-10-24T20:45:00Z"));
    expect(parsePageTime("Checked by county staff at 2:30 PM PDT on October 24, 2026.")).toBe(Date.parse("2026-10-24T21:30:00Z"));
    expect(parsePageTime("Last updated: October 24, 2026")).toBeUndefined();
    expect(parsePageTime("Updated 1:45 PM on October 24, 2026")).toBeUndefined();
    expect(parsePageTime("February 31, 2026, 1:00 PM PST")).toBeUndefined();
  });

  it("parses X timestamps", () => {
    expect(parseTwitterTime("Sat Oct 24 20:50:00 +0000 2026")).toBe(Date.parse("2026-10-24T20:50:00Z"));
  });
});

describe("scheduling", () => {
  const settings = { apifyMinIntervalMin: 5, backoffCapMin: 60 };
  const nws = { enabled: true, fetchVia: "direct" as const, normalIntervalMin: 5, crisisIntervalMin: 1 };
  const now = 100 * 60_000;

  it("uses the crisis interval in crisis mode and skips disabled or running sources", () => {
    expect(isDue({ ...nws, lastRunAt: now - 2 * 60_000, lastOutcome: "succeeded" }, "normal", now, settings)).toBe(false);
    expect(isDue({ ...nws, lastRunAt: now - 2 * 60_000, lastOutcome: "succeeded" }, "crisis", now, settings)).toBe(true);
    expect(isDue({ ...nws, enabled: false }, "crisis", now, settings)).toBe(false);
    expect(isDue({ ...nws, lastRunAt: now - 60_000, lastOutcome: "running" }, "crisis", now, settings)).toBe(false);
    expect(isDue(nws, "normal", now, settings)).toBe(true); // never ran
  });

  it("keeps Apify sources at the minimum interval even in crisis mode", () => {
    const apify = { ...nws, fetchVia: "apify" as const };
    expect(intervalMs(apify, "crisis", settings)).toBe(5 * 60_000);
    expect(isDue({ ...apify, lastRunAt: now - 2 * 60_000, lastOutcome: "succeeded" }, "crisis", now, settings)).toBe(false);
  });

  it("backs off exponentially after failures, up to the cap", () => {
    expect(backoffMs({ ...nws, consecutiveFailures: 1 }, "normal", settings)).toBe(10 * 60_000);
    expect(backoffMs({ ...nws, consecutiveFailures: 3 }, "normal", settings)).toBe(40 * 60_000);
    expect(backoffMs({ ...nws, consecutiveFailures: 10 }, "normal", settings)).toBe(60 * 60_000);
  });
});

describe("crisis rules", () => {
  const live = { trustTier: "official" as const, status: "actual" as const, isActive: true, isFixture: false, severity: "severe" as const, title: "Fire Weather Watch", states: ["CA"] };

  it("triggers on severe official bulletins in configured states or listed event types", () => {
    expect(triggersCrisis(live, ["CA"], false)).toBe(true);
    expect(triggersCrisis({ ...live, severity: "minor" }, ["CA"], false)).toBe(false);
    expect(triggersCrisis({ ...live, severity: "minor", title: "Evacuation Order for zone SON-3A" }, ["CA"], false)).toBe(true);
    expect(triggersCrisis({ ...live, states: ["NV"] }, ["CA"], false)).toBe(false);
    expect(triggersCrisis({ ...live, trustTier: "official_social" }, ["CA"], false)).toBe(false);
    expect(triggersCrisis({ ...live, status: "test" }, ["CA"], false)).toBe(false);
    expect(triggersCrisis({ ...live, isFixture: true }, ["CA"], false)).toBe(false);
    expect(triggersCrisis({ ...live, isFixture: true }, ["CA"], true)).toBe(true);
  });

  it("enters, extends without resetting `since`, and expires", () => {
    const entered = enterOrExtendCrisis(null, "r", "b1", 1_000);
    expect(entered).toMatchObject({ mode: "crisis", since: 1_000, expiresAt: 1_000 + CRISIS_DURATION_MS });
    const extended = enterOrExtendCrisis(entered, "r2", "b2", 5_000);
    expect(extended).toMatchObject({ since: 1_000, expiresAt: 5_000 + CRISIS_DURATION_MS, triggeredBy: "b1" });
    expect(crisisExpired(extended, 5_000 + CRISIS_DURATION_MS)).toBe(true);
  });
});

describe("pipeline guards", () => {
  it("batches stay within the upsert batch size", () => {
    const parts = batches(Array.from({ length: 60 }, (_, i) => i), UPSERT_BATCH_SIZE);
    expect(parts.map((p) => p.length)).toEqual([25, 25, 10]);
  });

  it("trust tier and isFixture come from the source definition, never the item", () => {
    const draft = { ...(initial[1] as NormalizedBulletinDraft), trustTier: "official" as const, isFixture: false, sourceName: "Sonoma County" };
    const { items } = prepareItems({ drafts: [draft], rejected: [], signals: [], skipped: 0 }, { sourceId: "x_posts", trustTier: "official_social" }, true);
    expect(items[0]).toMatchObject({ sourceId: "x_posts", trustTier: "official_social", isFixture: true, sourceName: "Sonoma County (Demo)" });
  });

  it("modes: fixture by default, APIFY_MODE=live promotes Apify sources, overrides win", () => {
    const nwsSource = SOURCES.find((s) => s.sourceId === "nws_alerts")!;
    const shelters = SOURCES.find((s) => s.sourceId === "mock_shelters")!;
    expect(SOURCES.every((s) => !s.enabled && s.mode === "fixture")).toBe(true);
    expect(effectiveMode(nwsSource, undefined, "live")).toBe("fixture");
    expect(effectiveMode(shelters, undefined, "live")).toBe("live");
    expect(effectiveMode(nwsSource, "live", "mock")).toBe("live");
    expect(isFixtureRun(nwsSource, "live")).toBe(false);
    expect(isFixtureRun(shelters, "live")).toBe(true); // the mock sites are fictional even when scraped live
  });

  it("parses settings and the X allowlist", () => {
    const s = loadIngestionSettings({ X_ALLOWLIST: "@CalFire:CAL FIRE:CA,nwsbayarea:NWS Bay Area:CA|NV" });
    expect(s.APIFY_MODE).toBe("mock");
    expect(s.APIFY_MIN_INTERVAL_MIN).toBe(5);
    expect(s.xAllowlist).toEqual([
      { handle: "calfire", issuer: "CAL FIRE", states: ["CA"] },
      { handle: "nwsbayarea", issuer: "NWS Bay Area", states: ["CA", "NV"] },
    ]);
    expect(parseXAllowlist(undefined)[0].handle).toBe("sonomaoes_demo");
  });
});

describe("Apify run request", () => {
  const options = {
    webhookUrl: "https://example.convex.site/ingest/apify",
    webhookSecret: "s",
    sourceId: "mock_shelters",
    runRecordId: "run1",
    maxItems: 50,
    maxTotalChargeUsd: 0.5,
    timeoutSecs: 300,
  };

  it("asks for the configured memory so concurrent runs fit the plan limit", () => {
    const settings = loadIngestionSettings({});
    expect(settings.APIFY_MEMORY_MB).toBe(2048);
    const { url } = buildRunActorRequest("token", "apify~cheerio-scraper", {}, { ...options, memoryMbytes: settings.APIFY_MEMORY_MB });
    expect(new URL(url).searchParams.get("memory")).toBe("2048");
  });

  it("leaves memory to the actor default when not set", () => {
    const { url } = buildRunActorRequest("token", "apify~cheerio-scraper", {}, options);
    expect(new URL(url).searchParams.has("memory")).toBe(false);
  });
});
