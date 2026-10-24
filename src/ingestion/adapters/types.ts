// [I] Adapter interfaces. Direct adapters fetch raw responses and normalize them deterministically;
// Apify adapters build an actor input and normalize the actor's dataset items. Storage is
// upsertBulletins' job, never the adapter's.
import type { NormalizedBulletinDraft, Signal } from "../../contracts";
import type { LlmClient } from "../../providers/llm/types";
import type { IngestionSettings } from "../config";
import type { IngestionSource } from "../sources";

/** One raw HTTP response (or a fixture standing in for it). */
export type RawResponse =
  | { kind: "json"; url: string; fetchedAt: number; body: unknown }
  | { kind: "text"; url: string; fetchedAt: number; contentType: string; body: string };

export type NormalizeContext = {
  source: IngestionSource;
  /** Fetch time; the only time an adapter may use when a source publishes none ("observed"). */
  now: number;
  ingestStates: string[];
  isFixture: boolean;
  settings: IngestionSettings;
};

export type Rejection = { externalId?: string; reason: string; raw: unknown };

export type NormalizeResult = {
  drafts: NormalizedBulletinDraft[];
  rejected: Rejection[];
  signals: Signal[];
  /** Items intentionally skipped (out of area, below threshold, prescribed burns…). */
  skipped: number;
};

export const emptyResult = (): NormalizeResult => ({ drafts: [], rejected: [], signals: [], skipped: 0 });

export type FetchContext = {
  fetch: typeof fetch;
  ingestStates: string[];
  /** Sent on every request (NWS requires one that identifies the app and a contact). */
  userAgent: string;
};

export interface DirectAdapter {
  sourceId: string;
  /** Raw responses for fixture mode (no network). */
  fixture(): RawResponse[];
  fetchLive(ctx: FetchContext, now: number): Promise<RawResponse[]>;
  normalize(raw: RawResponse[], ctx: NormalizeContext): NormalizeResult;
}

export type ExtractionDeps = { llm: LlmClient; model: string };

export interface ApifyAdapter {
  sourceId: string;
  normalizeItems(items: unknown[], ctx: NormalizeContext, deps: ExtractionDeps): Promise<NormalizeResult>;
}

/** Shared polite HTTP GET for direct adapters. */
export async function getRaw(
  ctx: FetchContext,
  url: string,
  accept: string,
  kind: "json" | "text",
  now: number,
): Promise<RawResponse> {
  const headers: Record<string, string> = { Accept: accept };
  headers["User-Agent"] = ctx.userAgent;
  const res = await ctx.fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  if (kind === "json") return { kind, url, fetchedAt: now, body: (await res.json()) as unknown };
  return { kind, url, fetchedAt: now, contentType: res.headers.get("Content-Type") ?? "text/plain", body: await res.text() };
}
