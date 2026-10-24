// [B] Twilio SMS adapter (SMS_NOTIFIER=twilio). No SDK: one form-encoded POST with Basic auth, which runs in the
// default Convex runtime. Written from the Twilio docs, NOT verified live yet (docs/DECISIONS.md):
// POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json with To, From (or MessagingServiceSid),
// Body and StatusCallback → 201 { sid: "SM…", status: "queued" | "accepted", … }; errors → 4xx { code, message }.
// Delivery results arrive later on StatusCallback (MessageSid, MessageStatus, ErrorCode), signed with X-Twilio-Signature.
import { z } from "zod";
import type { Config } from "../../config/env";
import { NotConfiguredError } from "../../config/errors";

export const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Twilio error codes meaning "this number can't receive texts" (a landline, or not a mobile number), so updates for
 * it should go by phone call instead. 21614: "'To' number is not a valid mobile number" (at send time);
 * 30006: "Landline or unreachable carrier" (in the status callback).
 */
export const LANDLINE_ERROR_CODES = new Set(["21614", "30006"]);

export type SmsResult = { sid: string } | { error: string; code?: string };

const SendResponse = z.object({ sid: z.string().optional(), code: z.union([z.number(), z.string()]).optional(), message: z.string().optional() });

export function messagesUrl(accountSid: string): string {
  return `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
}

/** The form body. Exported so tests can check its shape without a network call. */
export function smsRequestBody(config: Config, args: { to: string; body: string; statusCallback?: string }): URLSearchParams {
  const form = new URLSearchParams({ To: args.to, Body: args.body });
  if (config.TWILIO_MESSAGING_SERVICE_SID) form.set("MessagingServiceSid", config.TWILIO_MESSAGING_SERVICE_SID);
  else if (config.TWILIO_FROM_NUMBER) form.set("From", config.TWILIO_FROM_NUMBER);
  if (args.statusCallback) form.set("StatusCallback", args.statusCallback);
  return form;
}

export async function sendSms(
  config: Config,
  fetchFn: typeof fetch,
  args: { to: string; body: string; statusCallback?: string },
): Promise<SmsResult> {
  const missing: string[] = (["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"] as const).filter((k) => !config[k]);
  if (!config.TWILIO_FROM_NUMBER && !config.TWILIO_MESSAGING_SERVICE_SID) missing.push("TWILIO_FROM_NUMBER");
  if (missing.length > 0) throw new NotConfiguredError("Twilio texts", missing);

  const res = await fetchFn(messagesUrl(config.TWILIO_ACCOUNT_SID!), {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: smsRequestBody(config, args).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let parsed: z.infer<typeof SendResponse> = {};
  try {
    parsed = SendResponse.parse(await res.json());
  } catch {
    // Not JSON: fall through to the HTTP status.
  }
  if (res.ok && parsed.sid) return { sid: parsed.sid };
  const code = parsed.code === undefined ? undefined : String(parsed.code);
  return { error: `HTTP ${res.status}${code ? ` code ${code}` : ""}: ${(parsed.message ?? "").slice(0, 200)}`, code };
}

/**
 * X-Twilio-Signature: base64(HMAC-SHA1(authToken, url + each POST param name and value, sorted by name)).
 * `url` must be the exact URL Twilio requested, including any query string.
 */
export async function twilioSignature(authToken: string, url: string, params: Record<string, string>): Promise<string> {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  let binary = "";
  for (const byte of mac) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** True when `signature` matches any of the candidate URLs (proxies may change how the URL is seen). */
export async function verifyTwilioSignature(
  authToken: string,
  signature: string | null,
  urls: string[],
  params: Record<string, string>,
): Promise<boolean> {
  if (!signature) return false;
  for (const url of new Set(urls)) {
    if (timingSafeEqual(await twilioSignature(authToken, url, params), signature)) return true;
  }
  return false;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Twilio's standard opt-out words (Twilio blocks further texts by itself) plus Spanish ones. */
export function isOptOutText(body: string): boolean {
  return /^\s*(stop|stopall|unsubscribe|cancel|end|quit|optout|revoke|parar|para|alto|cancelar|baja)\s*[.!]?\s*$/i.test(body);
}
