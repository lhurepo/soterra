// [I] X posts (Apify Tweet Scraper V2 items). Routing is decided by configuration, never by content:
// posts from X_ALLOWLIST handles become official_social bulletins (the source's trust tier); every other
// post becomes a Signal (never a bulletin, never chunked, never retrievable). Retweets are skipped because
// their content is someone else's. Post text is stored as ordinary text; nothing in it is ever executed.
import { z } from "zod";
import type { AreaRef, HazardType, NormalizedBulletinDraft, Signal } from "../../contracts";
import { hazardFromText } from "../extract";
import { STATE_NAMES, countiesNamedIn, countyArea, statesNamedIn } from "../geo";
import { parseTwitterTime } from "../time";
import { emptyResult, type ApifyAdapter, type NormalizeContext, type NormalizeResult } from "./types";

export const TweetItem = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  text: z.string(),
  createdAt: z.string().optional(),
  isRetweet: z.boolean().optional(),
  author: z.object({ userName: z.string().min(1), name: z.string().optional() }),
});

const HAZARD_WORDS: [HazardType, RegExp][] = [
  ["wildfire", /wildfire|\bfire\b|smoke|blaze/i],
  ["evacuation", /evacuat/i],
  ["flood", /flood/i],
  ["earthquake", /earthquake|quake/i],
  ["tsunami", /tsunami/i],
  ["hurricane", /hurricane|tropical storm/i],
  ["tornado", /tornado/i],
];

export function hazardsNamedIn(text: string): HazardType[] {
  return HAZARD_WORDS.filter(([, re]) => re.test(text)).map(([h]) => h);
}

/** Areas only when the post names them: "<County> County" or a full state name, limited to `allowedStates`. */
export function areasNamedIn(text: string, allowedStates: string[]): AreaRef[] {
  const counties = countiesNamedIn(text).filter((c) => allowedStates.includes(c.state));
  if (counties.length > 0) return counties.map((c) => countyArea(c));
  return statesNamedIn(text)
    .filter((s) => allowedStates.includes(s))
    .map((state) => ({ state, label: STATE_NAMES[state] }));
}

export function normalizeTweets(items: unknown[], ctx: NormalizeContext): NormalizeResult {
  const out = emptyResult();
  const allow = new Map(ctx.settings.xAllowlist.map((e) => [e.handle, e]));
  for (const raw of items) {
    const parsed = TweetItem.safeParse(raw);
    if (!parsed.success) {
      out.rejected.push({ reason: `invalid tweet item: ${parsed.error.issues[0]?.message}`, raw });
      continue;
    }
    const t = parsed.data;
    if (t.isRetweet) {
      out.skipped++;
      continue;
    }
    const handle = t.author.userName.toLowerCase();
    const postedAt = t.createdAt ? parseTwitterTime(t.createdAt) : undefined;
    const entry = allow.get(handle);

    if (!entry) {
      const signal: Signal = {
        sourceId: ctx.source.sourceId,
        platform: "x",
        externalId: t.id,
        url: t.url,
        authorHandle: handle,
        text: t.text,
        postedAt,
        observedAt: ctx.now,
        hazardTypes: hazardsNamedIn(t.text),
        states: [...new Set(areasNamedIn(t.text, ctx.ingestStates).map((a) => a.state))],
        isFixture: ctx.isFixture,
      };
      out.signals.push(signal);
      continue;
    }

    if (postedAt === undefined) {
      out.rejected.push({ externalId: t.id, reason: "allowlisted post without a post time", raw });
      continue;
    }
    const areas = areasNamedIn(t.text, entry.states.length > 0 ? entry.states : ctx.ingestStates);
    const draft: NormalizedBulletinDraft = {
      sourceId: ctx.source.sourceId,
      sourceName: entry.issuer,
      externalId: t.id,
      url: t.url,
      title: `Post by ${entry.issuer} on X`,
      body: t.text,
      hazardType: hazardFromText(t.text) ?? "other",
      severity: "unknown",
      status: "actual",
      issuedAt: postedAt,
      areas,
      trustTier: ctx.source.trustTier,
      language: "en",
      isFixture: ctx.isFixture,
      timeBasis: "issued",
    };
    out.drafts.push(draft);
  }
  return out;
}

export const xAdapter: ApifyAdapter = {
  sourceId: "x_posts",
  normalizeItems: async (items, ctx) => normalizeTweets(items, ctx),
};
