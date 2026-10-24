// [I] Apify client: start an actor run with an ad-hoc webhook, read dataset items, verify webhooks.
// Verified 2026-10-24 (docs.apify.com/api/v2, apify-client 2.25.0 types):
// - POST /v2/actors/{actorId}/runs (the /v2/acts/ prefix is deprecated but works); body = actor input;
//   query: webhooks (base64 JSON array), maxItems, maxTotalChargeUsd, timeout. Auth: Authorization: Bearer.
// - Ad-hoc webhook keys: eventTypes, requestUrl, payloadTemplate, headersTemplate (string), idempotencyKey.
// - GET /v2/datasets/{id}/items?clean=true&format=json&limit=N.
// - Webhooks are not signed and may be delivered more than once: we send a secret header and the
//   receiver dedupes by run.
import { z } from "zod";
import { timingSafeEqual } from "../../config/auth";
import { NotConfiguredError } from "../../config/errors";

const API = "https://api.apify.com/v2";

export const WEBHOOK_SECRET_HEADER = "X-Soterra-Webhook-Secret";

export const RUN_END_EVENTS = ["ACTOR.RUN.SUCCEEDED", "ACTOR.RUN.FAILED", "ACTOR.RUN.TIMED_OUT", "ACTOR.RUN.ABORTED"] as const;

export type StartRunOptions = {
  webhookUrl: string;
  webhookSecret: string;
  /** Echoed back in the webhook payload so the receiver can find its run record without a race. */
  sourceId: string;
  runRecordId: string;
  maxItems: number;
  maxTotalChargeUsd: number;
  timeoutSecs: number;
};

export type StartedRun = { runId: string; datasetId?: string };

export interface ApifyClient {
  readonly mode: "live" | "mock";
  startRun(actorId: string, input: unknown, options: StartRunOptions): Promise<StartedRun>;
  getDatasetItems(datasetId: string, limit: number): Promise<unknown[]>;
}

/** The webhook payload we ask Apify to send (payloadTemplate below). */
export const ApifyWebhookPayload = z.object({
  eventType: z.string(),
  eventData: z.object({ actorId: z.string().optional(), actorRunId: z.string() }).partial().passthrough().optional(),
  resource: z.object({ id: z.string(), defaultDatasetId: z.string().optional(), status: z.string().optional() }).passthrough(),
  soterra: z.object({ sourceId: z.string(), runRecordId: z.string() }),
});
export type ApifyWebhookPayload = z.infer<typeof ApifyWebhookPayload>;

export function buildRunActorRequest(
  token: string | undefined,
  actorId: string,
  input: unknown,
  options: StartRunOptions,
): { url: string; init: RequestInit } {
  if (!token) throw new NotConfiguredError("Apify", ["APIFY_TOKEN"]);
  if (!options.webhookSecret) throw new NotConfiguredError("Apify webhook", ["APIFY_WEBHOOK_SECRET"]);
  const soterra = JSON.stringify({ sourceId: options.sourceId, runRecordId: options.runRecordId });
  const webhooks = [
    {
      eventTypes: [...RUN_END_EVENTS],
      requestUrl: options.webhookUrl,
      headersTemplate: JSON.stringify({ [WEBHOOK_SECRET_HEADER]: options.webhookSecret }),
      payloadTemplate: `{"eventType": {{eventType}}, "eventData": {{eventData}}, "resource": {{resource}}, "soterra": ${soterra}}`,
      idempotencyKey: `soterra-${options.runRecordId}`,
    },
  ];
  const query = new URLSearchParams({
    webhooks: btoa(JSON.stringify(webhooks)),
    maxItems: String(options.maxItems),
    maxTotalChargeUsd: String(options.maxTotalChargeUsd),
    timeout: String(options.timeoutSecs),
  });
  return {
    url: `${API}/actors/${encodeURIComponent(actorId)}/runs?${query.toString()}`,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  };
}

const RunResponse = z.object({ data: z.object({ id: z.string(), defaultDatasetId: z.string().optional() }).passthrough() });

export class LiveApifyClient implements ApifyClient {
  readonly mode = "live" as const;
  constructor(
    private readonly token: string | undefined,
    private readonly fetchFn: typeof fetch,
  ) {}

  async startRun(actorId: string, input: unknown, options: StartRunOptions): Promise<StartedRun> {
    const { url, init } = buildRunActorRequest(this.token, actorId, input, options);
    const res = await this.fetchFn(url, init);
    if (!res.ok) throw new Error(`Apify run ${actorId}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const body = RunResponse.parse(await res.json());
    return { runId: body.data.id, datasetId: body.data.defaultDatasetId };
  }

  async getDatasetItems(datasetId: string, limit: number): Promise<unknown[]> {
    if (!this.token) throw new NotConfiguredError("Apify", ["APIFY_TOKEN"]);
    const url = `${API}/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=${limit}`;
    const res = await this.fetchFn(url, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw new Error(`Apify dataset ${datasetId}: HTTP ${res.status}`);
    const items: unknown = await res.json();
    if (!Array.isArray(items)) throw new Error(`Apify dataset ${datasetId}: expected an array`);
    return items;
  }
}

/** Constant-time check of the secret sent as a header (preferred) or `?secret=` query parameter. */
export function verifyApifyWebhook(secret: string | undefined, headerSecret: string | null, querySecret: string | null): boolean {
  if (!secret) return false;
  return [headerSecret, querySecret].some((s) => s !== null && timingSafeEqual(s, secret));
}
