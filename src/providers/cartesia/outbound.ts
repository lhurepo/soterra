// [B, reviewed by V] Cartesia outbound-call adapter. NOT VERIFIED LIVE: no Cartesia credentials were
// available, so this is written from the documentation only and is selected only with PHONE_NOTIFIER=cartesia.
// Documented 2026-10-24 (docs/DECISIONS.md): POST https://api.cartesia.ai/agents/calls, headers X-API-Key and
// Cartesia-Version: 2026-08-14, body { from_number_id, agent_id, outbound_calls: [{ to_number, dynamic_variables }] },
// response { calls: [{ number, agent_call_id } | { number, error }] }. The request has no `metadata` field, so the
// notification id travels in dynamic_variables.notification_id; whether that reaches a Line SDK agent's
// CallRequest.metadata is unverified (the voice agent reads metadata.notification_id; see voice/README.md).
import { z } from "zod";
import type { Config } from "../../config/env";
import { NotConfiguredError } from "../../config/errors";

export const CARTESIA_API_URL = "https://api.cartesia.ai/agents/calls";
export const CARTESIA_API_VERSION = "2026-08-14";
const REQUEST_TIMEOUT_MS = 10_000;

export type OutboundCallResult = { agentCallId: string } | { error: string };

const OutboundResponse = z.object({
  calls: z
    .array(z.object({ number: z.string().optional(), agent_call_id: z.string().optional(), error: z.string().optional() }))
    .optional(),
});

/** The documented request body. Exported so tests can check its shape without a network call. */
export function outboundCallBody(config: Config, args: { toNumber: string; notificationId: string; language: string }) {
  return {
    from_number_id: config.CARTESIA_FROM_NUMBER_ID,
    agent_id: config.CARTESIA_AGENT_ID,
    ringing_timeout_seconds: 45,
    max_call_duration_minutes: 10,
    outbound_calls: [
      {
        to_number: args.toNumber,
        dynamic_variables: { notification_id: args.notificationId, language: args.language },
      },
    ],
  };
}

export async function placeOutboundCall(
  config: Config,
  fetchFn: typeof fetch,
  args: { toNumber: string; notificationId: string; language: string },
): Promise<OutboundCallResult> {
  const missing = (["CARTESIA_API_KEY", "CARTESIA_AGENT_ID", "CARTESIA_FROM_NUMBER_ID"] as const).filter((k) => !config[k]);
  if (missing.length > 0) throw new NotConfiguredError("Cartesia outbound calls", [...missing]);

  const res = await fetchFn(CARTESIA_API_URL, {
    method: "POST",
    headers: {
      "X-API-Key": config.CARTESIA_API_KEY!,
      "Cartesia-Version": CARTESIA_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(outboundCallBody(config, args)),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const parsed = OutboundResponse.safeParse(await res.json());
  if (!parsed.success) return { error: "unexpected response shape from Cartesia" };
  const call = parsed.data.calls?.[0];
  if (call?.agent_call_id) return { agentCallId: call.agent_call_id };
  return { error: call?.error ?? "no call returned" };
}
