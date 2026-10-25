// [B] Mac Messages relay (SMS_NOTIFIER=mac_relay): the wire format between convex/smsRelay.ts and scripts/relay-mac.ts.
// Pure (zod only), so both sides import it. Not part of the voice contract.
import { z } from "zod";
import { E164 } from "../contracts/common";

/** At most this many texts per POST /relay/claim. */
export const RELAY_MAX_PER_CLAIM = 5;
/** A text still waiting for the relay after this long is failed ("relay_stale"), never sent late. */
export const RELAY_STALE_MS = 30 * 60_000;
/** A claimed text with no result after this long is failed ("relay_lost"); a late "sent" still corrects it. */
export const RELAY_LOST_MS = 5 * 60_000;
/** /health reports smsRelayOnline when a relay claimed within this window. */
export const RELAY_ONLINE_MS = 60_000;

export const ClaimRequest = z.object({ relayId: z.string().min(1).max(64) });
export type ClaimRequest = z.infer<typeof ClaimRequest>;

export const ClaimItem = z.object({
  notificationId: z.string().min(1),
  to: E164,
  body: z.string().min(1),
  claimToken: z.string().min(1),
});
export type ClaimItem = z.infer<typeof ClaimItem>;

export const ClaimResponse = z.object({ items: z.array(ClaimItem) });
export type ClaimResponse = z.infer<typeof ClaimResponse>;

export const ResultRequest = z.object({
  notificationId: z.string().min(1),
  claimToken: z.string().min(1),
  /** "sent" = handed to Messages.app, not confirmed delivered. */
  status: z.enum(["sent", "failed"]),
  error: z.string().max(200).optional(),
});
export type ResultRequest = z.infer<typeof ResultRequest>;
