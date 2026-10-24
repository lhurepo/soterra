// [S] Follow-up contracts (optional feature): subscriptions and the Notifier interface payloads.
import { z } from "zod";
import { AreaRef, E164, EpochMs, Language } from "./common";

export const SubscriptionTrigger = z.enum([
  "any_update",
  "severity_change",
  "evacuation_change",
  "answer_available",
]);
export type SubscriptionTrigger = z.infer<typeof SubscriptionTrigger>;

export const NotificationChannel = z.enum(["phone_call", "sms"]);
export type NotificationChannel = z.infer<typeof NotificationChannel>;

export const Subscription = z.object({
  recipient: z.object({
    callerId: z.string().optional(),
    accountId: z.string().optional(),
    phone: E164,
  }),
  target: z.object({
    kind: z.enum(["incident", "area", "question"]),
    incidentKey: z.string().optional(),
    area: AreaRef.optional(),
    unansweredQuestionId: z.string().optional(),
  }),
  trigger: SubscriptionTrigger,
  channels: z.array(NotificationChannel).min(1),
  language: Language,
  status: z.enum(["active", "paused", "cancelled", "expired"]),
  consentAt: EpochMs,
  createdVia: z.enum(["call", "app"]),
  expiresAt: EpochMs,
  lastNotifiedAt: EpochMs.optional(),
  /**
   * Additive (2026-10-24): "on_change" (default when absent) fires on matching bulletin events; "scheduled" fires every
   * intervalMs with the latest official information, whether or not anything changed, and never on events.
   */
  mode: z.enum(["on_change", "scheduled"]).optional(),
  /** Scheduled subscriptions only: how often (≥ 1 hour) and when the next update is due. */
  intervalMs: z.number().int().positive().optional(),
  nextRunAt: EpochMs.optional(),
  lastRunAt: EpochMs.optional(),
});
export type Subscription = z.infer<typeof Subscription>;

export const NotificationRequest = z.object({
  recipientPhone: E164,
  channel: NotificationChannel,
  language: Language,
  /** Speakable text, built only from official bulletins. */
  message: z.string().min(1),
  bulletinRefs: z.array(z.string()),
  /** Idempotency key: the same key is never sent twice. */
  dedupeKey: z.string().min(1),
  subscriptionId: z.string().optional(),
  /** Set by the caller of the notifier once the notification row exists (outbound calls carry it). */
  notificationId: z.string().optional(),
});
export type NotificationRequest = z.infer<typeof NotificationRequest>;

/**
 * Why a notification exists. "update": a bulletin change; "scheduled_update": a time-based update; "verification": the
 * callback check; "missed_call_text": an update call nobody answered, sent by text; "call_recap": a text after an
 * answered update call; "subscription_confirmation": a text after a call that set up updates.
 */
export const NotificationPurpose = z.enum([
  "update",
  "scheduled_update",
  "verification",
  "missed_call_text",
  "call_recap",
  "subscription_confirmation",
]);
export type NotificationPurpose = z.infer<typeof NotificationPurpose>;

export const NotificationStatus = z.enum(["sent", "queued", "failed", "unconfigured", "mock"]);
export type NotificationStatus = z.infer<typeof NotificationStatus>;

export const NotificationResult = z.object({
  status: NotificationStatus,
  providerRef: z.string().optional(),
  error: z.string().optional(),
});
export type NotificationResult = z.infer<typeof NotificationResult>;
