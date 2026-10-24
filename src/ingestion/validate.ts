// [I] Validation gate before storage. Anything rejected goes to the quarantine table with the reason.
import { NormalizedBulletin } from "../contracts";

export type ValidationResult = { ok: true; bulletin: NormalizedBulletin } | { ok: false; reason: string };

export function validateBulletin(item: unknown): ValidationResult {
  const parsed = NormalizedBulletin.safeParse(item);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues.map((i) => `${i.path.join(".") || "item"}: ${i.message}`).join("; ") };
  }
  const b = parsed.data;
  if (b.updatedAt !== undefined && b.updatedAt < b.issuedAt) {
    return { ok: false, reason: "updatedAt is before issuedAt" };
  }
  if (b.expiresAt !== undefined && b.expiresAt <= b.issuedAt) {
    return { ok: false, reason: "expiresAt is not after issuedAt" };
  }
  if (b.geometry !== undefined && b.geometry.length > 500_000) {
    return { ok: false, reason: "geometry too large for a document; store it in file storage (TODO(I))" };
  }
  return { ok: true, bulletin: b };
}

/** Test and exercise messages are stored for audit but never served. Cancelled ones deactivate the bulletin. */
export function isServableStatus(status: NormalizedBulletin["status"]): boolean {
  return status === "actual";
}
