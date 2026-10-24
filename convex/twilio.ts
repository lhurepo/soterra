// [B] Twilio webhooks. Both check X-Twilio-Signature with TWILIO_AUTH_TOKEN and fail closed without it.
// POST /twilio/status: per-message StatusCallback (set on every text we send) → delivered / failed (+ landline fallback).
// POST /twilio/inbound: the Twilio number's "A message comes in" webhook (set in the Twilio console) → STOP cancels
// every update for that number. Twilio also blocks further texts to it by itself (Advanced Opt-Out).
import { loadConfig } from "../src/config/env";
import { isOptOutText, verifyTwilioSignature } from "../src/providers/twilio/sms";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/** Parses the form body and checks the signature. Returns the params, or a Response to send back. */
async function verifiedForm(req: Request): Promise<{ ok: true; params: Record<string, string> } | { ok: false; response: Response }> {
  const token = loadConfig(process.env).TWILIO_AUTH_TOKEN;
  if (!token) return { ok: false, response: new Response("TWILIO_AUTH_TOKEN is not configured", { status: 403 }) };
  let params: Record<string, string>;
  try {
    params = Object.fromEntries(new URLSearchParams(await req.text()));
  } catch {
    return { ok: false, response: new Response("bad form body", { status: 400 }) };
  }
  // Twilio signs the URL it requested; behind a proxy that can differ from req.url, so the public site URL is tried too.
  const url = new URL(req.url);
  const site = process.env.CONVEX_SITE_URL?.replace(/\/$/, "");
  const candidates = [req.url, ...(site ? [`${site}${url.pathname}${url.search}`] : [])];
  if (!(await verifyTwilioSignature(token, req.headers.get("X-Twilio-Signature"), candidates, params))) {
    return { ok: false, response: new Response("invalid signature", { status: 403 }) };
  }
  return { ok: true, params };
}

export const twilioStatus = httpAction(async (ctx, req) => {
  const form = await verifiedForm(req);
  if (!form.ok) return form.response;
  const { MessageSid: sid, MessageStatus: status, ErrorCode: errorCode } = form.params;
  if (!sid || !status) return new Response("MessageSid and MessageStatus are required", { status: 400 });
  await ctx.runMutation(internal.notifications.recordTextStatus, { sid, status, errorCode: errorCode || undefined });
  return new Response(null, { status: 204 });
});

export const twilioInbound = httpAction(async (ctx, req) => {
  const form = await verifiedForm(req);
  if (!form.ok) return form.response;
  const { From: from, Body: body } = form.params;
  if (from && body !== undefined && isOptOutText(body)) {
    const cancelled = await ctx.runMutation(internal.notifications.stopByText, { phone: from });
    console.log(`[twilio] STOP by text: ${cancelled} subscription(s) cancelled`);
  }
  // No reply of our own: Twilio answers STOP/HELP itself, and texts are not a way to ask questions (call the line).
  return new Response(EMPTY_TWIML, { status: 200, headers: { "Content-Type": "text/xml" } });
});
