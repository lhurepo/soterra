// [B, reviewed by V] Cartesia outbound-call adapter (placeholder, untested against the live API).
// Verified 2026-10-24: POST https://api.cartesia.ai/agents/calls, headers X-API-Key + Cartesia-Version: 2026-08-14,
// body { from_number_id, agent_id, outbound_calls: [{ to_number, dynamic_variables }] }; response
// { calls: [{ number, agent_call_id } | { number, error }] }. The docs do not say whether dynamic_variables
// reach a Line SDK agent's CallRequest.metadata; the voice agent checks both (see voice/README.md).
import type { Config } from "../../config/env";
import { NotConfiguredError } from "../../config/errors";

export const CARTESIA_API_VERSION = "2026-08-14";

export type OutboundCallResult = { agentCallId: string } | { error: string };

export async function placeOutboundCall(
  config: Config,
  fetchFn: typeof fetch,
  args: { toNumber: string; notificationId: string; language: string },
): Promise<OutboundCallResult> {
  const missing = (["CARTESIA_API_KEY", "CARTESIA_AGENT_ID", "CARTESIA_FROM_NUMBER_ID"] as const).filter((k) => !config[k]);
  if (missing.length > 0) throw new NotConfiguredError("Cartesia outbound calls", [...missing]);

  const res = await fetchFn("https://api.cartesia.ai/agents/calls", {
    method: "POST",
    headers: {
      "X-API-Key": config.CARTESIA_API_KEY!,
      "Cartesia-Version": CARTESIA_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
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
    }),
  });
  if (!res.ok) return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const body = (await res.json()) as { calls?: { agent_call_id?: string; error?: string }[] };
  const call = body.calls?.[0];
  if (call?.agent_call_id) return { agentCallId: call.agent_call_id };
  return { error: call?.error ?? "no call returned" };
}
