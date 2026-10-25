// [S] The Marina Earthquake pages parse cleanly: each "after" page, turned into what the Apify actor returns,
// goes through the same adapter and extraction checks as a live run (deterministic extractor here; Claude live).
import { describe, expect, it } from "vitest";
import { DEMO_SITES, DEMO_X_ACCOUNTS, demoTimes, type DemoSite } from "../demo/scenario";
import { loadIngestionSettings } from "../src/ingestion/config";
import { createDeterministicExtractionLlm } from "../src/ingestion/extractionMock";
import { APIFY_ADAPTERS } from "../src/ingestion/adapters";
import { sourceById } from "../src/ingestion/sources";
import { eventMatches } from "../src/notifications/match";
import { actorInput } from "../src/providers/apify/actors";

const START = Date.parse("2026-10-24T22:40:00Z"); // 3:40 PM PDT
const times = demoTimes(START, 5_000);
const URL_BASE = "https://brazen-perch-21.convex.site/mock-sites/";
const settings = loadIngestionSettings({});

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Website Content Crawler text: one line per block element, tags removed. */
function wccText(html: string): string {
  const body = /<body>([\s\S]*)<\/body>/.exec(html)![1];
  return decode(body.replace(/<\/(p|h1|h2|li|tr|article)>/g, "\n").replace(/<[^>]+>/g, "")).split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}

/** What SHELTER_PAGE_FUNCTION returns for the page. */
function shelterItem(html: string, url: string) {
  const headers = [...html.matchAll(/<th>(.*?)<\/th>/g)].map((m) => m[1].toLowerCase());
  const body = /<tbody>([\s\S]*)<\/tbody>/.exec(html)![1];
  const rows = [...body.matchAll(/<tr>(.*?)<\/tr>/g)].map((tr) => {
    const cells = [...tr[1].matchAll(/<td>(.*?)<\/td>/g)].map((m) => decode(m[1]));
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
  return { url, title: /<title>(.*?)<\/title>/.exec(html)![1], heading: /<h1>(.*?)<\/h1>/.exec(html)![1], checkedText: /class="checked">(.*?)<\/p>/.exec(html)![1], rows };
}

/** What X_FEED_PAGE_FUNCTION returns for the page. */
function feedItem(html: string, url: string) {
  const posts = [...html.matchAll(/<article class="post" data-id="([^"]+)" data-handle="([^"]+)"><span class="name">(.*?)<\/span>.*?<time datetime="([^"]+)">.*?<p class="text">(.*?)<\/p><\/article>/g)].map(
    ([, id, handle, name, createdAt, text]) => ({ id, url: `${url}#${id}`, text: decode(text), createdAt, author: { userName: handle, name: decode(name) } }),
  );
  return { url, posts };
}

async function crawl(site: DemoSite, html: string) {
  const source = sourceById(site.sourceId)!;
  const url = URL_BASE + site.path;
  const items =
    site.pageFunction === "shelters"
      ? [shelterItem(html, url)]
      : site.pageFunction === "x-feed"
        ? [feedItem(html, url)]
        : [{ url, text: wccText(html), metadata: { title: /<title>(.*?)<\/title>/.exec(html)![1] } }];
  const ctx = { source, now: times.updatedAt + 20_000, ingestStates: ["CA"], isFixture: true, settings };
  return APIFY_ADAPTERS[site.sourceId].normalizeItems(items, ctx, { llm: createDeterministicExtractionLlm(), model: "test" });
}

describe("Marina Earthquake demo pages", () => {
  it("has 13 registered sites, all fictional, in San Francisco, crawled by Apify", () => {
    expect(DEMO_SITES).toHaveLength(13);
    for (const site of DEMO_SITES) {
      const source = sourceById(site.sourceId)!;
      expect(source.fetchVia).toBe("apify");
      expect(source.contentIsFixture).toBe(true);
      expect(source.enabled).toBe(false);
      expect(source.jurisdiction?.countyFips).toBe("06075");
      expect(APIFY_ADAPTERS[site.sourceId]).toBeDefined();
      const { input } = actorInput(source, URL_BASE + site.path, { maxItems: 1, xAllowlist: [], ingestStates: ["CA"] });
      expect(JSON.stringify(input)).toContain(site.path);
    }
    expect(new Set(DEMO_SITES.map((s) => s.path)).size).toBe(13);
  });

  for (const site of DEMO_SITES.filter((s) => s.actor === "website-content-crawler")) {
    it(`${site.sourceId}: one bulletin titled with the earthquake, timed by the page, nothing rejected`, async () => {
      const r = await crawl(site, site.after(times));
      expect(r.rejected).toEqual([]);
      expect(r.drafts).toHaveLength(1);
      const d = r.drafts[0];
      expect(d.title).toMatch(/Marina Earthquake/);
      expect(d.incidentKey).toBe("marina-earthquake");
      expect(d.timeBasis).toBe("page_updated");
      expect(d.issuedAt).toBeLessThanOrEqual(times.updatedAt);
      expect(d.issuedAt).toBeGreaterThan(times.quakeAt - 60_000);
      expect(d.body).not.toMatch(/fictional demo/i);
      expect(d.areas[0].countyFips).toBe("06075");
    });
  }

  it("the evacuation page is the extreme, evacuation-type bulletin that drives the callback", async () => {
    const d = (await crawl(DEMO_SITES.find((s) => s.sourceId === "sfdemo_alerts")!, DEMO_SITES[0].after(times))).drafts[0];
    expect(d.hazardType).toBe("evacuation");
    expect(d.severity).toBe("extreme");
    expect(d.body.split(/(?<=\.)\s/)[0]).toMatch(/Evacuation Order is in effect for the Marina District after the magnitude 6\.4 Marina Earthquake/);
    expect(d.instructions).toMatch(/Hamilton Recreation Center/);
  });

  it("no other page claims a warning or an order (only the evacuation pages are severe)", async () => {
    for (const site of DEMO_SITES.filter((s) => s.actor === "website-content-crawler" && !["sfdemo_alerts", "sfdemo_situation"].includes(s.sourceId))) {
      const d = (await crawl(site, site.after(times))).drafts[0];
      expect([site.sourceId, d.severity]).not.toEqual([site.sourceId, "extreme"]);
    }
  });

  it("shelters: one bulletin per row with status and address in San Francisco", async () => {
    const r = await crawl(DEMO_SITES.find((s) => s.pageFunction === "shelters")!, DEMO_SITES.find((s) => s.pageFunction === "shelters")!.after(times));
    expect(r.rejected).toEqual([]);
    expect(r.drafts.map((d) => d.title)).toEqual([
      "Shelter: Hamilton Recreation Center (Open)",
      "Shelter: Kezar Pavilion (Open)",
      "Shelter: Moscone Center West (Opening at 6:00 PM)",
      "Shelter: Marina Middle School (Closed (inside the evacuation zone))",
    ]);
    expect(r.drafts[0].body).toContain("1900 Geary Boulevard, San Francisco");
    expect(r.drafts[0].timeBasis).toBe("page_updated");
    expect(r.drafts[0].areas[0]).toMatchObject({ countyFips: "06075", city: "San Francisco" });
  });

  it("X feed: 30+ hacker posts stay signals, the official accounts become San Francisco bulletins", async () => {
    const site = DEMO_SITES.find((s) => s.pageFunction === "x-feed")!;
    const r = await crawl(site, site.after(times));
    expect(r.rejected).toEqual([]);
    expect(r.signals.length).toBeGreaterThanOrEqual(30);
    expect(r.signals.filter((s) => s.hazardTypes.includes("earthquake")).length).toBeGreaterThanOrEqual(25);
    expect(r.drafts).toHaveLength(5);
    expect(new Set(r.drafts.map((d) => d.sourceName))).toEqual(new Set(DEMO_X_ACCOUNTS.map((a) => a.issuer)));
    for (const d of r.drafts) {
      expect(d.trustTier).toBe("official_social");
      expect(d.areas).toEqual([expect.objectContaining({ countyFips: "06075" })]);
      expect(d.issuedAt).toBeLessThanOrEqual(times.updatedAt);
    }
    expect(r.drafts.some((d) => /All Cal Hacks attendees and staff are accounted for/.test(d.body))).toBe(true);
    // The calm feed has only the three pre-quake posts.
    expect((await crawl(site, site.before(times))).signals).toHaveLength(3);
  });

  it("a 'call me back' question asked from San Francisco is answered by the first official update there", () => {
    const sub = {
      target: { kind: "question" as const, unansweredQuestionId: "q1", area: { state: "CA", countyFips: "06075", label: "San Francisco" } },
      trigger: "answer_available" as const,
      status: "active" as const,
      expiresAt: START + 86_400_000,
    };
    const event = { change: "created" as const, severityAfter: "extreme" as const, hazardType: "evacuation" as const, areas: [{ state: "CA", countyFips: "06075" }] };
    expect(eventMatches(sub, event, START)).toBe(true);
    expect(eventMatches(sub, { ...event, areas: [{ state: "CA", countyFips: "06001" }] }, START)).toBe(false);
    expect(eventMatches({ ...sub, target: { kind: "question" as const, unansweredQuestionId: "q1" } }, event, START)).toBe(false);
  });
});
