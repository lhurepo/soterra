// [I] Change detection: decides what upsertBulletins does with an incoming item.
import type { BulletinChange, NormalizedBulletin } from "../contracts";

export type ExistingBulletin = { latestVersion: number; contentHash: string; status: NormalizedBulletin["status"] };

export function decideChange(existing: ExistingBulletin | null, incoming: NormalizedBulletin): BulletinChange {
  if (existing === null) return incoming.status === "cancelled" ? "cancelled" : "created";
  if (existing.contentHash === incoming.contentHash) return "unchanged";
  if (incoming.status === "cancelled") return existing.status === "cancelled" ? "unchanged" : "cancelled";
  return "updated";
}
