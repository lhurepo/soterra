// [I] Apify-backed page adapters.
// - Website Content Crawler items (free text) → LLM extraction with verified quotes (src/ingestion/extract.ts).
// - Cheerio Scraper items from our shelter page function (structured rows) → deterministic parser.
// Trust tier, issuer and jurisdiction always come from the SourceDefinition.
import { z } from "zod";
import type { AreaRef, NormalizedBulletinDraft } from "../../contracts";
import { extractPage } from "../extract";
import { parseFeedTime, parsePageTime } from "../time";
import { emptyResult, type ApifyAdapter, type NormalizeContext, type NormalizeResult } from "./types";

/** Website Content Crawler dataset item (fields we use; verified against the actor's README 2026-10-24). */
export const WccItem = z.object({
  url: z.string().url(),
  text: z.string(),
  metadata: z.object({ title: z.string().nullish() }).partial().nullish(),
  crawl: z.object({ loadedTime: z.string().nullish() }).partial().nullish(),
});

/** Output of SHELTER_PAGE_FUNCTION (src/providers/apify/actors.ts) as stored by Cheerio Scraper. */
export const ShelterPageItem = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  heading: z.string().optional(),
  checkedText: z.string().optional(),
  rows: z.array(z.record(z.string(), z.string())),
  loadedAt: z.string().optional(),
});

export const websiteContentAdapter = (sourceId: string): ApifyAdapter => ({
  sourceId,
  async normalizeItems(items, ctx, deps) {
    const out = emptyResult();
    for (const raw of items) {
      const item = WccItem.safeParse(raw);
      if (!item.success) {
        out.rejected.push({ reason: `invalid Website Content Crawler item: ${item.error.issues[0]?.message}`, raw });
        continue;
      }
      const fetchedAt = parseFeedTime(item.data.crawl?.loadedTime) ?? ctx.now;
      const extracted = await extractPage(
        deps,
        { url: item.data.url, title: item.data.metadata?.title ?? undefined, text: item.data.text, fetchedAt },
        ctx.source,
        ctx.isFixture,
        ctx.settings,
      );
      for (const e of extracted) {
        if (e.ok) out.drafts.push(e.draft);
        else out.rejected.push({ externalId: item.data.url, reason: e.reason, raw: { url: item.data.url, text: item.data.text.slice(0, 2_000) } });
      }
    }
    return out;
  },
});

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function cell(row: Record<string, string>, key: string): string | undefined {
  const v = row[key]?.replace(/\s+/g, " ").trim();
  return v ? v : undefined;
}

function shelterArea(address: string | undefined, ctx: NormalizeContext): AreaRef[] {
  const base = ctx.source.jurisdiction;
  if (!base) return [];
  const city = address?.split(",").at(-1)?.trim();
  return [city ? { ...base, city, label: `${city}, ${base.label}` } : base];
}

/** One bulletin per shelter row. Every sentence is a labeled cell value copied from the page. */
export function normalizeShelterItems(items: unknown[], ctx: NormalizeContext): NormalizeResult {
  const out = emptyResult();
  for (const raw of items) {
    const page = ShelterPageItem.safeParse(raw);
    if (!page.success) {
      out.rejected.push({ reason: `invalid shelter page item: ${page.error.issues[0]?.message}`, raw });
      continue;
    }
    const checked = page.data.checkedText?.trim() || undefined;
    const pageTime = checked ? parsePageTime(checked) : undefined;
    const observedAt = parseFeedTime(page.data.loadedAt) ?? ctx.now;
    for (const row of page.data.rows) {
      const name = cell(row, "shelter") ?? cell(row, "name");
      const status = cell(row, "status");
      if (!name || !status) {
        out.rejected.push({ externalId: name, reason: "shelter row without a name or a status", raw: row });
        continue;
      }
      const address = cell(row, "address");
      const facts = [
        `${name}${address ? `, ${address}` : ""}.`,
        `Status: ${status}.`,
        cell(row, "capacity") ? `Capacity: ${cell(row, "capacity")}.` : undefined,
        cell(row, "available") ? `Spaces available: ${cell(row, "available")}.` : undefined,
        cell(row, "pets") ? `Pets: ${cell(row, "pets")}.` : undefined,
        cell(row, "accessibility") ? `Accessibility: ${cell(row, "accessibility")}.` : undefined,
        checked,
      ].filter((s): s is string => s !== undefined);
      const draft: NormalizedBulletinDraft = {
        sourceId: ctx.source.sourceId,
        sourceName: ctx.source.name,
        externalId: `${page.data.url}#${slug(name)}`,
        url: page.data.url,
        title: `Shelter: ${name} (${status})`,
        body: facts.join(" "),
        hazardType: "shelter",
        severity: "unknown",
        status: "actual",
        issuedAt: pageTime ?? observedAt,
        areas: shelterArea(address, ctx),
        trustTier: ctx.source.trustTier,
        language: "en",
        isFixture: ctx.isFixture,
        timeBasis: pageTime !== undefined ? "page_updated" : "observed",
      };
      out.drafts.push(draft);
    }
  }
  return out;
}

export const shelterPageAdapter = (sourceId: string): ApifyAdapter => ({
  sourceId,
  normalizeItems: async (items, ctx) => normalizeShelterItems(items, ctx),
});
