// [I] InciWeb RSS adapter. GET https://inciweb.wildfire.gov/incidents/rss.xml (live-verified 2026-10-24).
// Items carry title, link, description (with "Last updated: YYYY-MM-DD", "The type of incident is …" and
// "State: <name>" sections), pubDate and guid. Prescribed fires are skipped. The state comes from the
// "State:" line; the item's pubDate is the published time. The date-only "Last updated" line has no
// time of day, so it is kept in the text but not turned into a timestamp.
import { z } from "zod";
import type { NormalizedBulletinDraft } from "../../contracts";
import inciwebFixture from "../../../fixtures/raw/inciweb-rss.json";
import { STATE_NAMES, countiesNamedIn, countyArea } from "../geo";
import { parseFeedTime } from "../time";
import { emptyResult, getRaw, type DirectAdapter, type NormalizeContext, type NormalizeResult, type RawResponse } from "./types";
import { elements, text } from "./xml";

export const INCIWEB_URL = "https://inciweb.wildfire.gov/incidents/rss.xml";

const Envelope = z.object({ url: z.string(), contentType: z.string(), body: z.string() });

function stateOf(description: string): string | undefined {
  const name = /State:\s*([A-Za-z .]+?)\s*(?:\n|$|---)/.exec(description)?.[1]?.trim();
  return name ? Object.entries(STATE_NAMES).find(([, n]) => n === name)?.[0] : undefined;
}

export function normalizeInciweb(raw: RawResponse[], ctx: NormalizeContext): NormalizeResult {
  const out = emptyResult();
  for (const r of raw) {
    if (r.kind !== "text") {
      out.rejected.push({ reason: "InciWeb response is not text", raw: r.url });
      continue;
    }
    for (const item of elements(r.body, "item")) {
      const title = text(item, "title");
      const link = text(item, "link");
      const description = text(item, "description") ?? "";
      const guid = text(item, "guid") ?? link;
      const issuedAt = parseFeedTime(text(item, "pubDate"));
      if (!title || !link || !guid || issuedAt === undefined) {
        out.rejected.push({ externalId: guid, reason: "InciWeb item without title, link, guid or pubDate", raw: item.slice(0, 500) });
        continue;
      }
      const type = /type of incident is ([A-Za-z ]+?)(?: and|\.|\n)/.exec(description)?.[1]?.trim() ?? "";
      if (/prescribed/i.test(type) || /prescribed/i.test(title)) {
        out.skipped++;
        continue;
      }
      const state = stateOf(description);
      if (!state || !ctx.ingestStates.includes(state)) {
        out.skipped++;
        continue;
      }
      const counties = countiesNamedIn(description).filter((c) => c.state === state);
      const body = description
        .split(/\n\s*---\s*\n/)
        .map((s) => s.replace(/\s+/g, " ").trim())
        .filter((s) => s && !/^Coordinates:/i.test(s) && !/^NOTE:/i.test(s))
        .join("\n\n");
      const draft: NormalizedBulletinDraft = {
        sourceId: ctx.source.sourceId,
        sourceName: ctx.source.name,
        externalId: guid,
        url: link,
        title,
        body,
        hazardType: /fire|burn/i.test(`${type} ${title}`) ? "wildfire" : "other",
        severity: "unknown",
        status: "actual",
        issuedAt,
        areas: counties.length > 0 ? counties.map((c) => countyArea(c)) : [{ state, label: STATE_NAMES[state] }],
        trustTier: ctx.source.trustTier,
        language: "en",
        isFixture: ctx.isFixture,
        timeBasis: "issued",
      };
      out.drafts.push(draft);
    }
  }
  return out;
}

export const inciwebAdapter: DirectAdapter = {
  sourceId: "inciweb",
  fixture: () => {
    const env = Envelope.parse(inciwebFixture);
    return [{ kind: "text", url: env.url, fetchedAt: 0, contentType: env.contentType, body: env.body }];
  },
  fetchLive: async (ctx, now) => [await getRaw(ctx, INCIWEB_URL, "application/rss+xml", "text", now)],
  normalize: normalizeInciweb,
};
