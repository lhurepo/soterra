// [B] Reports each integration as live, mock or unconfigured for GET /health. Never includes secrets.
import type { IntegrationStatus } from "../contracts";
import type { Config } from "./env";

export function integrationStatus(config: Config): Record<string, IntegrationStatus> {
  const has = (...values: (string | undefined)[]) => values.every((v) => v !== undefined);
  const liveIf = (selectedLive: boolean, configured: boolean): IntegrationStatus =>
    !selectedLive ? "mock" : configured ? "live" : "unconfigured";

  return {
    voiceAuth: has(config.VOICE_API_SECRET) ? "live" : "unconfigured",
    llm: liveIf(config.LLM_PROVIDER === "anthropic", has(config.ANTHROPIC_API_KEY)),
    // Convex search needs no configuration; Moss is only "live" when selected and configured.
    retriever:
      config.RETRIEVER === "convex"
        ? "live"
        : has(config.MOSS_PROJECT_ID, config.MOSS_PROJECT_KEY, config.MOSS_INDEX_NAME)
          ? "live"
          : "unconfigured",
    mossSync: has(config.MOSS_PROJECT_ID, config.MOSS_PROJECT_KEY, config.MOSS_INDEX_NAME)
      ? "live"
      : "unconfigured",
    apify: has(config.APIFY_TOKEN, config.APIFY_WEBHOOK_SECRET) ? "live" : "unconfigured",
    nws: has(config.NWS_USER_AGENT) ? "live" : "unconfigured",
    phoneNotifier: liveIf(
      config.PHONE_NOTIFIER === "cartesia",
      has(config.CARTESIA_API_KEY, config.CARTESIA_AGENT_ID, config.CARTESIA_FROM_NUMBER_ID),
    ),
    sms: "unconfigured",
  };
}

export function healthFlags(config: Config): Record<string, boolean> {
  return { serveFixtures: config.SERVE_FIXTURES, mockSites: config.ENABLE_MOCK_SITES };
}
