// [B] Parses Convex deployment env vars into a typed config. Pass `process.env`; never read it at module load.
import { z } from "zod";

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
  SMS_NOTIFIER: z.enum(["unconfigured"]).default("unconfigured"),
  SERVE_FIXTURES: bool,
  ENABLE_MOCK_SITES: bool,
  ANON_TRANSCRIPT_TTL_HOURS: positiveInt(72),
  ANON_MEMORY_TTL_DAYS: positiveInt(30),
});

export type Config = z.infer<typeof EnvSchema>;

/** Unknown vars are ignored. Bad values throw, naming the offending variable. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid Soterra configuration: ${issues.join("; ")}`);
  }
  return parsed.data;
}
