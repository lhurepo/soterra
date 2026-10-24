// [B] Notifier interface and implementations: mock, Cartesia phone call (placeholder), SMS (unconfigured).
// Nothing in the hotline's hot path imports this file.
import type { Config } from "../config/env";
import type { NotificationRequest, NotificationResult } from "../contracts";
import { placeOutboundCall } from "../providers/cartesia/outbound";

export interface Notifier {
  readonly name: string;
  send(request: NotificationRequest): Promise<NotificationResult>;
}

/** Records nothing itself: the caller (convex/notifications.ts) has already stored the row. */
export class MockNotifier implements Notifier {
  readonly name = "mock";
  readonly sent: NotificationRequest[] = [];
  async send(request: NotificationRequest): Promise<NotificationResult> {
    this.sent.push(request);
    return { status: "mock", providerRef: `mock:${request.dedupeKey}` };
  }
}

/** Places an outbound call to our own agent; the agent starts a session with direction "outbound". */
export class CartesiaOutboundCallNotifier implements Notifier {
  readonly name = "cartesia_call";
  constructor(
    private readonly config: Config,
    private readonly fetchFn: typeof fetch,
  ) {}
  async send(request: NotificationRequest): Promise<NotificationResult> {
    if (!request.notificationId) return { status: "failed", error: "notificationId is required for phone calls" };
    const result = await placeOutboundCall(this.config, this.fetchFn, {
      toNumber: request.recipientPhone,
      notificationId: request.notificationId,
      language: request.language,
    });
    return "agentCallId" in result
      ? { status: "queued", providerRef: result.agentCallId }
      : { status: "failed", error: result.error };
  }
}

/** No SMS provider has been chosen. Do not add one without a team decision. */
export class UnconfiguredSmsNotifier implements Notifier {
  readonly name = "sms_unconfigured";
  async send(): Promise<NotificationResult> {
    return { status: "unconfigured", error: "No SMS provider is configured" };
  }
}

export function selectNotifier(config: Config, channel: NotificationRequest["channel"], fetchFn: typeof fetch): Notifier {
  if (channel === "sms") return new UnconfiguredSmsNotifier();
  return config.PHONE_NOTIFIER === "cartesia" ? new CartesiaOutboundCallNotifier(config, fetchFn) : new MockNotifier();
}
