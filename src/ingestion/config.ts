// [I] Ingestion-only settings, parsed from Convex env vars with zod. Shared settings (INGEST_STATES,
// NWS_USER_AGENT, APIFY_TOKEN, …) come from the backend's loadConfig in src/config/env.ts.
import { z } from "zod";

const num = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? fallback : Number(v)))
    .pipe(z.number().finite().nonnegative());

/** `group` = independence group (see src/ingestion/sources.ts): accounts of the same agency share one. */
export type XAllowlistEntry = { handle: string; issuer: string; states: string[]; group?: string };

/** Demo default: fictional handles used by fixtures/social. Real handles go in X_ALLOWLIST. */
const DEFAULT_X_ALLOWLIST: XAllowlistEntry[] = [{ handle: "sonomaoes_demo", issuer: "Sonoma County OES (Demo)", states: ["CA"] }];

/** "handle:Issuer Name:CA|OR[:group],handle2:Other Issuer:CA" (group optional, e.g. "nws" for an NWS office account) */
export function parseXAllowlist(raw: string | undefined): XAllowlistEntry[] {
  if (raw === undefined || raw.trim() === "") return DEFAULT_X_ALLOWLIST;
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [handle, issuer, states, group] = entry.split(":").map((s) => s.trim());
      if (!handle || !issuer) throw new Error(`X_ALLOWLIST entry "${entry}" must be handle:Issuer Name[:CA|OR]`);
      return {
        handle: handle.replace(/^@/, "").toLowerCase(),
        issuer,
        states: (states ?? "").split("|").map((s) => s.trim().toUpperCase()).filter(Boolean),
        ...(group ? { group } : {}),
      };
    });
}

const IngestionEnv = z.object({
  APIFY_MODE: z.enum(["mock", "live"]).default("mock"),
  /** Apify-backed sources never run more often than this, even in crisis mode (cost control). */
  APIFY_MIN_INTERVAL_MIN: num(5),
  APIFY_MAX_ITEMS: num(50),
  APIFY_MAX_CHARGE_USD: num(0.5),
  /** Memory requested per Apify run. Actors default to 4-8 GB; one page needs far less, and the free plan allows 16 GB in total. */
  APIFY_MEMORY_MB: num(2048),
  USGS_MIN_MAGNITUDE: num(3),
  X_ALLOWLIST: z.string().optional(),
  SIGNAL_BURST_THRESHOLD: num(3),
  SIGNAL_BURST_WINDOW_MIN: num(30),
  BACKOFF_CAP_MIN: num(60),
  RAW_PAYLOAD_TTL_HOURS: num(24),
  EXTRACTION_TIMEOUT_MS: num(20_000),
  EXTRACTION_MAX_CHARS: num(12_000),
});

export type IngestionSettings = Omit<z.infer<typeof IngestionEnv>, "X_ALLOWLIST"> & { xAllowlist: XAllowlistEntry[] };

export function loadIngestionSettings(env: Record<string, string | undefined>): IngestionSettings {
  // Convex's process.env answers direct reads but not `in` / Object.keys, so zod would see every plain
  // optional key as missing (X_ALLOWLIST silently fell back to the demo handle). Read each key explicitly.
  const parsed = IngestionEnv.safeParse(Object.fromEntries(Object.keys(IngestionEnv.shape).map((k) => [k, env[k]])));
  if (!parsed.success) {
    throw new Error(`Invalid ingestion configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const { X_ALLOWLIST, ...rest } = parsed.data;
  return { ...rest, xAllowlist: parseXAllowlist(X_ALLOWLIST) };
}
