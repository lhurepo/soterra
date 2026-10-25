// [B] GET /health — each integration as live, mock or unconfigured. Public: it exposes no secrets or data.
import { healthFlags, integrationStatus } from "../src/config/health";
import { CONTRACT_VERSION, type HealthResponse } from "../src/contracts";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { config, errorResponse, json } from "./lib/http";
import { relayOnline } from "./smsRelay";

export const health = httpAction(async (ctx) => {
  try {
    const cfg = config();
    let smsRelayOnline = false;
    try {
      smsRelayOnline = relayOnline(await ctx.runQuery(internal.smsRelay.lastSeen, {}), Date.now());
    } catch {
      // Health must answer even if the relay table can't be read.
    }
    const integrations = integrationStatus(cfg);
    const body: HealthResponse = {
      contractVersion: CONTRACT_VERSION,
      ok: integrations.voiceAuth === "live",
      integrations,
      // smsRelayOnline: a Mac relay (npm run relay:mac) claimed texts in the last minute.
      flags: { ...healthFlags(cfg), smsRelayOnline },
      now: Date.now(),
    };
    return json(body);
  } catch (err) {
    return errorResponse(500, "internal", err instanceof Error ? err.message : "invalid configuration");
  }
});
