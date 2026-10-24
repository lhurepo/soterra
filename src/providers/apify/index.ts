// [I] Apify placeholders: run an actor with an ad-hoc webhook, verify the webhook, read a dataset.
// Verified 2026-10-24 (docs.apify.com/api/v2): POST /v2/actors/{actorId}/runs with Authorization: Bearer;
// ad-hoc webhooks go in the `webhooks` query param as base64 JSON; dataset items at /v2/datasets/{id}/items.
// Apify webhooks have no signature: the documented approach is a secret in the webhook URL or a header
// set through the webhook's headers template. We accept either (see verifyApifyWebhook).
import type { Config } from "../../config/env";
import { timingSafeEqual } from "../../config/auth";
import { NotConfiguredError } from "../../config/errors";

const API = "https://api.apify.com/v2";

function requireToken(config: Config): string {
  if (!config.APIFY_TOKEN) throw new NotConfiguredError("Apify", ["APIFY_TOKEN"]);
  return config.APIFY_TOKEN;
}

/** Builds the run request; `webhookUrl` should be `${CONVEX_SITE_URL}/ingest/apify`. */
export function buildRunActorRequest(
  config: Config,
  actorId: string,
  input: unknown,
  webhookUrl: string,
): { url: string; init: RequestInit } {
  const token = requireToken(config);
  if (!config.APIFY_WEBHOOK_SECRET) throw new NotConfiguredError("Apify webhook", ["APIFY_WEBHOOK_SECRET"]);
  const webhooks = [
    {
      eventTypes: ["ACTOR.RUN.SUCCEEDED", "ACTOR.RUN.FAILED", "ACTOR.RUN.TIMED_OUT"],
      requestUrl: webhookUrl,
      headersTemplate: JSON.stringify({ "X-Soterra-Webhook-Secret": config.APIFY_WEBHOOK_SECRET }),
      payloadTemplate:
        '{"eventType": {{eventType}}, "actorId": {{eventData.actorId}}, "runId": {{resource.id}}, "datasetId": {{resource.defaultDatasetId}}, "status": {{resource.status}}}',
    },
  ];
  const encoded = btoa(JSON.stringify(webhooks));
  return {
    url: `${API}/actors/${encodeURIComponent(actorId)}/runs?webhooks=${encodeURIComponent(encoded)}`,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  };
}

export function verifyApifyWebhook(config: Config, headerSecret: string | null, querySecret: string | null): boolean {
  const secret = config.APIFY_WEBHOOK_SECRET;
  if (!secret) return false;
  return [headerSecret, querySecret].some((s) => s !== null && timingSafeEqual(s, secret));
}

export type ApifyWebhookPayload = {
  eventType: string;
  actorId?: string;
  runId: string;
  datasetId?: string;
  status?: string;
};

export async function readDataset(config: Config, fetchFn: typeof fetch, datasetId: string, limit = 200): Promise<unknown[]> {
  const token = requireToken(config);
  const res = await fetchFn(`${API}/datasets/${encodeURIComponent(datasetId)}/items?clean=true&limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Apify dataset ${datasetId}: HTTP ${res.status}`);
  return (await res.json()) as unknown[];
}
