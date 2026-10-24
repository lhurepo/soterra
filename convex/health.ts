// [B] GET /health — each integration as live, mock or unconfigured. Public: it exposes no secrets or data.
import { healthFlags, integrationStatus } from "../src/config/health";
import { CONTRACT_VERSION, type HealthResponse } from "../src/contracts";
import { httpAction } from "./_generated/server";
import { config, errorResponse, json } from "./lib/http";

export const health = httpAction(async () => {
  try {
    const cfg = config();
    const integrations = integrationStatus(cfg);
    const body: HealthResponse = {
      contractVersion: CONTRACT_VERSION,
      ok: integrations.voiceAuth === "live",
      integrations,
      flags: healthFlags(cfg),
      now: Date.now(),
    };
    return json(body);
  } catch (err) {
    return errorResponse(500, "internal", err instanceof Error ? err.message : "invalid configuration");
  }
});
