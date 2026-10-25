// [B] Parses Convex deployment env vars into a typed config. Pass `process.env`; never read it at module load.
import { z } from "zod";
import { DEFAULTS } from "./defaults";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));
const positiveInt = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : Number(v)))
    .pipe(z.number().int().positive());

const EnvSchema = z.object({
  VOICE_API_SECRET: optionalString,
  LLM_PROVIDER: z.enum(["mock", "anthropic"]).default("mock"),
  ANTHROPIC_API_KEY: optionalString,
  /** More keys to fall back to when one runs out of credit: comma or newline separated (see src/providers/llm/pool.ts). */
  ANTHROPIC_API_KEYS: optionalString,
  CLAUDE_FAST_MODEL: z.string().default("claude-haiku-5-5"),
  CLAUDE_SMART_MODEL: z.string().default("claude-sonnet-5-5"),
  RETRIEVER: z.enum(["convex", "moss"]).default("convex"),
  MOSS_PROJECT_ID: optionalString,
  MOSS_PROJECT_KEY: optionalString,
  MOSS_INDEX_NAME: optionalString,
  APIFY_TOKEN: optionalString,
  APIFY_WEBHOOK_SECRET: optionalString,
  NWS_USER_AGENT: optionalString,
  INGEST_STATES: z
    .string()
    .default("CA")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  PHONE_NOTIFIER: z.enum(["mock", "cartesia"]).default("mock"),
  CARTESIA_API_KEY: optionalString,
  CARTESIA_AGENT_ID: optionalString,
  CARTESIA_FROM_NUMBER_ID: optionalString,
  /**
   * Text messages: "mock" stores them without sending (default), "twilio" sends through Twilio, "mac_relay" queues them
   * for a Mac that sends them with Messages.app (convex/smsRelay.ts, docs/mac-relay.md), "unconfigured" sends nothing.
   */
  SMS_NOTIFIER: z.enum(["mock", "twilio", "mac_relay", "unconfigured"]).default("mock"),
  /** Bearer secret the Mac relay (`npm run relay:mac`) sends to POST /relay/claim and /relay/result. */
  SMS_RELAY_SECRET: optionalString,
  /** Bearer token for the demo switch: POST /demo/start, POST /demo/stop, GET /demo/status (convex/demo.ts). */
  DEMO_SECRET: optionalString,
  TWILIO_ACCOUNT_SID: optionalString,
  TWILIO_AUTH_TOKEN: optionalString,
  /** Send from this number (E.164), or set TWILIO_MESSAGING_SERVICE_SID instead (it wins when both are set). */
  TWILIO_FROM_NUMBER: optionalString,
  TWILIO_MESSAGING_SERVICE_SID: optionalString,
  /** The hotline number printed in texts ("Questions? Call (712) 600-3362"). */
  HOTLINE_NUMBER: optionalString.transform((v) => v ?? DEFAULTS.hotlineNumber),
  SERVE_FIXTURES: bool,
  ENABLE_MOCK_SITES: bool,
  ANON_TRANSCRIPT_TTL_HOURS: positiveInt(DEFAULTS.anonTranscriptTtlMs / 3_600_000),
  ANON_MEMORY_TTL_DAYS: positiveInt(DEFAULTS.anonMemoryTtlMs / 86_400_000),
  /** Model for call summaries (defaults to CLAUDE_SMART_MODEL). */
  CLAUDE_SUMMARY_MODEL: optionalString,
  /** Dev and test only: makes MockLlm fail on purpose (see src/providers/llm/mock.ts). */
  MOCK_LLM_MODE: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["normal", "invalid_json", "uncited_answer", "unknown_chunk", "timeout", "error"]).default("normal"),
  ),
});

export type Config = z.infer<typeof EnvSchema>;

/** Unknown vars are ignored. Bad values throw, naming the offending variable. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  // Convex's process.env answers direct reads but not `in` / Object.keys: read each key explicitly.
  const parsed = EnvSchema.safeParse(Object.fromEntries(Object.keys(EnvSchema.shape).map((k) => [k, env[k]])));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid Soterra configuration: ${issues.join("; ")}`);
  }
  return parsed.data;
}
