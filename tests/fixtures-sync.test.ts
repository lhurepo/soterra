// [I] Mock Apify datasets must say exactly what the served mock-site HTML says (same text, both variants),
// so MockApify and a live actor scraping /mock-sites/* produce the same facts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ShelterPageItem, WccItem } from "../src/ingestion/adapters/scraped";
import { TweetItem } from "../src/ingestion/adapters/x";
import { MOCK_APIFY_DATASETS } from "../src/ingestion/apifyFixtures";

const html = (variant: string, file: string) => readFileSync(resolve(import.meta.dirname, "../fixtures/mock-sites", variant, file), "utf8");
const visibleText = (doc: string) =>
  doc
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

describe.each(["v1", "v2"])("mock datasets %s", (variant) => {
  it.each([
    ["mock_county_emergency", "county-emergency.html"],
    ["mock_disaster_assistance", "disaster-assistance.html"],
  ])("%s text lines all appear in %s", (sourceId, file) => {
    const [item] = MOCK_APIFY_DATASETS[sourceId][variant].map((i) => WccItem.parse(i));
    const page = visibleText(html(variant, file));
    for (const line of item.text.split("\n")) expect(page).toContain(line);
    expect(html(variant, file)).toContain(`<title>${item.metadata?.title}</title>`);
  });

  it("shelter rows all appear in shelters.html", () => {
    const [item] = MOCK_APIFY_DATASETS.mock_shelters[variant].map((i) => ShelterPageItem.parse(i));
    const doc = html(variant, "shelters.html");
    expect(visibleText(doc)).toContain(item.checkedText);
    for (const row of item.rows) for (const value of Object.values(row)) expect(doc).toContain(`<td>${value}</td>`);
  });
});

it("v2 escalates zone SON-3A from warning to order and changes shelter capacity", () => {
  expect(visibleText(html("v1", "county-emergency.html"))).toContain("An Evacuation Warning is in effect for zones SON-3A and SON-3B");
  expect(visibleText(html("v2", "county-emergency.html"))).toContain("An Evacuation Order is now in effect for zone SON-3A");
  expect(html("v1", "shelters.html")).toContain("<td>120</td>");
  expect(html("v2", "shelters.html")).toContain("<td>35</td>");
});

it("social fixture items are shaped like Tweet Scraper output", () => {
  for (const item of MOCK_APIFY_DATASETS.x_posts.v1) expect(TweetItem.safeParse(item).success).toBe(true);
});
