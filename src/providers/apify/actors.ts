// [I] Apify actors we use and how we call them. Verified 2026-10-24 against the actors' Store pages.
//  - apify/website-content-crawler: free; platform usage ≈ $0.2 per 1,000 pages with the raw-HTTP
//    (Cheerio) crawler. maxCrawlDepth 0 = start URLs only. Output: url, text, metadata.title, crawl.loadedTime.
//  - apify/cheerio-scraper: free; platform usage only. Our pageFunction's return value is the dataset item.
//    maxPagesPerCrawl caps pages (0 would mean "no limit").
//  - apidojo/tweet-scraper (Tweet Scraper V2): paid per event, from $0.40 per 1,000 tweets; each query must
//    return ≥ 50 tweets; max 1 concurrent run; no repeating the same query at short intervals; not usable via
//    API on the free plan.
import type { ApifyActorKind, IngestionSource } from "../../ingestion/sources";
import { STATE_NAMES } from "../../ingestion/geo";
import type { XAllowlistEntry } from "../../ingestion/config";

export const ACTOR_IDS: Record<ApifyActorKind, string> = {
  "website-content-crawler": "apify~website-content-crawler",
  "cheerio-scraper": "apify~cheerio-scraper",
  "tweet-scraper": "apidojo~tweet-scraper",
};

/**
 * Runs inside the Cheerio Scraper actor (Node.js, with Cheerio's `$`). Reads the shelter table by its
 * header names, so column order can change. Keep in sync with ShelterPageItem in
 * src/ingestion/adapters/scraped.ts and with fixtures/apify/<variant>/mock_shelters.json.
 */
export const SHELTER_PAGE_FUNCTION = `async function pageFunction(context) {
  const { $, request } = context;
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const headers = $('table thead th').map((i, el) => clean($(el).text()).toLowerCase()).get();
  const rows = [];
  $('table tbody tr').each((i, tr) => {
    const cells = $(tr).find('td').map((j, td) => clean($(td).text())).get();
    const row = {};
    headers.forEach((h, j) => { row[h] = cells[j] || ''; });
    rows.push(row);
  });
  return {
    url: request.loadedUrl || request.url,
    title: clean($('title').text()),
    heading: clean($('h1').first().text()),
    checkedText: clean($('.checked').first().text()),
    rows,
    loadedAt: new Date().toISOString(),
  };
}`;

export function actorInput(
  source: Pick<IngestionSource, "apify">,
  pageUrl: string | undefined,
  options: { maxItems: number; xAllowlist: XAllowlistEntry[]; ingestStates: string[] },
): { actorId: string; input: Record<string, unknown> } {
  const kind = source.apify?.actor;
  if (!kind) throw new Error("source has no Apify actor configured");
  switch (kind) {
    case "website-content-crawler":
      if (!pageUrl) throw new Error("website-content-crawler needs a page URL");
      return {
        actorId: ACTOR_IDS[kind],
        input: { startUrls: [{ url: pageUrl }], crawlerType: "cheerio", maxCrawlPages: 1, maxCrawlDepth: 0 },
      };
    case "cheerio-scraper":
      if (!pageUrl) throw new Error("cheerio-scraper needs a page URL");
      return {
        actorId: ACTOR_IDS[kind],
        input: { startUrls: [{ url: pageUrl }], pageFunction: SHELTER_PAGE_FUNCTION, maxPagesPerCrawl: 1 },
      };
    case "tweet-scraper": {
      const hazards = "(evacuation OR wildfire OR fire OR flood OR earthquake OR tsunami)";
      return {
        actorId: ACTOR_IDS[kind],
        input: {
          twitterHandles: options.xAllowlist.map((e) => e.handle),
          searchTerms: options.ingestStates.map((s) => `${hazards} "${STATE_NAMES[s] ?? s}"`),
          sort: "Latest",
          maxItems: Math.max(options.maxItems, 50),
        },
      };
    }
  }
}
