// [B] GET /app/state — the public, read-only feed for the iOS app: active official bulletins and the crisis flag.
// No auth and no personal data: it exposes only what the official sources already publish. Never returns
// unverified (social) items, test or exercise messages, or cancelled bulletins.
import { CONTRACT_VERSION } from "../src/contracts";
import { internal } from "./_generated/api";
import { httpAction, internalQuery } from "./_generated/server";
import { errorResponse, json } from "./lib/http";
import { getSystemState } from "./systemState";

const MAX_ALERTS = 50;

export const appState = internalQuery({
  args: {},
  handler: async (ctx) => {
    const state = await getSystemState(ctx);
    const bulletins = await ctx.db
      .query("bulletins")
      .withIndex("by_isActive_and_expiresAt", (q) => q.eq("isActive", true))
      .take(200);
    const shown = bulletins
      .filter((b) => b.status === "actual" && b.trustTier !== "unverified")
      .sort((a, b) => (b.updatedAt ?? b.issuedAt) - (a.updatedAt ?? a.issuedAt))
      .slice(0, MAX_ALERTS);
    const alerts = await Promise.all(
      shown.map(async (b) => {
        const areas = await ctx.db
          .query("bulletinAreas")
          .withIndex("by_bulletinId", (q) => q.eq("bulletinId", b._id))
          .take(10);
        return {
          id: b._id as string,
          sourceName: b.sourceName,
          url: b.url,
          title: b.title,
          body: b.body,
          hazardType: b.hazardType,
          severity: b.severity,
          issuedAt: b.issuedAt,
          updatedAt: b.updatedAt,
          expiresAt: b.expiresAt,
          incidentKey: b.incidentKey,
          version: b.latestVersion,
          areaLabels: areas.map((a) => a.label),
          isFixture: b.isFixture,
        };
      }),
    );
    return {
      mode: state?.mode ?? ("normal" as const),
      crisisReason: state?.mode === "crisis" ? state.reason : undefined,
      alerts,
    };
  },
});

export const appStateHttp = httpAction(async (ctx) => {
  try {
    const body = await ctx.runQuery(internal.app.appState, {});
    return json({ contractVersion: CONTRACT_VERSION, now: Date.now(), ...body });
  } catch (err) {
    return errorResponse(500, "internal", err instanceof Error ? err.message : "could not read app state");
  }
});
