// [I] Pipeline helpers shared by every source (Convex-free). Stages: fetch → raw → normalize → validate →
// upsertBulletins → Moss sync → crisis evaluation → run outcome. The Convex action (convex/ingestion.ts)
// does the I/O; these functions do the deterministic parts.
import type { NormalizedBulletin } from "../contracts";
import type { Rejection } from "./adapters/types";
import { finalizeBulletin } from "./normalize";
import type { IngestionSource } from "./sources";
import type { NormalizeResult } from "./adapters/types";

/** Items per upsert mutation. Each item writes ≲ 10 documents, far below Convex's 16,000-write limit. */
export const UPSERT_BATCH_SIZE = 25;

/** Geometry larger than this goes to file storage instead of the bulletin document (documents ≤ 1 MiB). */
export const GEOMETRY_INLINE_MAX_CHARS = 50_000;

export function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Last line of defence before storage: trust tier and fixture flag come from the source definition and
 * the run, whatever the adapter or a model produced; fixture data is labeled "(Demo)".
 */
export function prepareItems(
  result: NormalizeResult,
  source: Pick<IngestionSource, "sourceId" | "trustTier">,
  isFixture: boolean,
): { items: NormalizedBulletin[]; rejected: Rejection[] } {
  const items = result.drafts.map((d) =>
    finalizeBulletin({
      ...d,
      sourceId: source.sourceId,
      trustTier: source.trustTier,
      isFixture,
      sourceName: isFixture && !/\(Demo\)/i.test(d.sourceName) ? `${d.sourceName} (Demo)` : d.sourceName,
    }),
  );
  return { items, rejected: result.rejected };
}

export function excerpt(raw: unknown, max = 4_000): string {
  try {
    return (typeof raw === "string" ? raw : JSON.stringify(raw) ?? "").slice(0, max);
  } catch {
    return String(raw).slice(0, max);
  }
}

export type RunCounts = {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  cancelled: number;
  rejected: number;
  skipped: number;
  signals: number;
};

export const emptyCounts = (): RunCounts => ({ fetched: 0, created: 0, updated: 0, unchanged: 0, cancelled: 0, rejected: 0, skipped: 0, signals: 0 });
