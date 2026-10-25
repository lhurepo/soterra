// [B] Notifier interface and implementations: mock phone calls (default), Cartesia outbound calls
// (PHONE_NOTIFIER=cartesia), mock texts (default) and Twilio texts (SMS_NOTIFIER=twilio, NOT verified live). Mac relay texts
// (SMS_NOTIFIER=mac_relay) bypass the Notifier: see convex/smsRelay.ts.
// Nothing in the hotline's hot path imports this file.
import type { Config } from "../config/env";
import type { NotificationRequest, NotificationResult } from "../contracts";
import { placeOutboundCall } from "../providers/cartesia/outbound";
import { sendSms } from "../providers/twilio/sms";

export interface Notifier {
  readonly name: string;
  send(request: NotificationRequest): Promise<NotificationResult>;
}

/** Places no call. The caller (convex/notifications.ts) has already stored the row; it records status "mock". */
export class MockPhoneNotifier implements Notifier {
  readonly name = "mock_phone";
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
    // "queued": Cartesia accepted the call; whether it was answered is not reported back (TODO(B) with Leia).
    return "agentCallId" in result ? { status: "queued", providerRef: result.agentCallId } : { status: "failed", error: result.error };
  }
}

/** Sends no text. The row is stored with status "mock". */
export class MockSmsNotifier implements Notifier {
  readonly name = "mock_sms";
  readonly sent: NotificationRequest[] = [];
  async send(request: NotificationRequest): Promise<NotificationResult> {
    this.sent.push(request);
    return { status: "mock", providerRef: `mock-sms:${request.dedupeKey}` };
  }
}

/** Texts through Twilio. "queued" = Twilio accepted it; the status callback later records delivered or failed. */
export class TwilioSmsNotifier implements Notifier {
  readonly name = "twilio_sms";
  constructor(
    private readonly config: Config,
    private readonly fetchFn: typeof fetch,
    private readonly statusCallbackUrl?: string,
  ) {}
  async send(request: NotificationRequest): Promise<NotificationResult> {
    const result = await sendSms(this.config, this.fetchFn, { to: request.recipientPhone, body: request.message, statusCallback: this.statusCallbackUrl });
    return "sid" in result ? { status: "queued", providerRef: result.sid } : { status: "failed", error: result.error };
  }
}

/** SMS_NOTIFIER=unconfigured: texts are stored but never sent. */
export class UnconfiguredSmsNotifier implements Notifier {
  readonly name = "sms_unconfigured";
  async send(): Promise<NotificationResult> {
    return { status: "unconfigured", error: "No SMS provider is configured" };
  }
}

export function selectNotifier(
  config: Config,
  channel: NotificationRequest["channel"],
  fetchFn: typeof fetch,
  opts: { smsStatusCallbackUrl?: string } = {},
): Notifier {
  if (channel === "sms") {
    if (config.SMS_NOTIFIER === "twilio") return new TwilioSmsNotifier(config, fetchFn, opts.smsStatusCallbackUrl);
    // Defensive: with mac_relay, convex/notifications.ts deliver hands texts to convex/smsRelay.ts and never gets here.
    if (config.SMS_NOTIFIER === "mac_relay") return new UnconfiguredSmsNotifier();
    return config.SMS_NOTIFIER === "mock" ? new MockSmsNotifier() : new UnconfiguredSmsNotifier();
  }
  return config.PHONE_NOTIFIER === "cartesia" ? new CartesiaOutboundCallNotifier(config, fetchFn) : new MockPhoneNotifier();
}
