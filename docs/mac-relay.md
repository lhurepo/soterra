# Mac Messages relay (texts from a teammate's iPhone)

A Twilio trial account can't text US or Canadian numbers without compliance registration, so for the demo
Soterra's texts can go out from a teammate's iPhone instead: a Mac signed into the same Apple ID, with Text
Message Forwarding on, sends them with Messages.app. The Mac **pulls** the texts: `npm run relay:mac` polls the
Convex deployment over HTTPS about every 2 s. No tunnel, no local server, nothing to expose.

```
deliver (Convex) ──▶ notification "pending"
relay:mac (Mac) ──POST /relay/claim──▶ up to 5 texts + claim token
                ──osascript → Messages.app (SMS) → iPhone → recipient
                ──POST /relay/result──▶ "sent" (handed to Messages) or "failed"
```

Code: `convex/smsRelay.ts` (claim, results, expiry), `scripts/relay-mac.ts` (the loop),
`scripts/lib/relayMac.ts` (optional allowlist, pacing), `scripts/relay-mac.applescript` (the send).

## Setup (once, on the teammate's iPhone and Mac)

1. **iPhone:** Settings → Apps → Messages → **Text Message Forwarding**, and switch the Mac on. The item only
   shows when iMessage is on, the Mac is signed into Messages with the **same Apple ID**, and the phone number is
   ticked on the Mac under Messages → Settings → iMessage → "You can be reached at".
2. **Mac:** open Messages once and check that you can send an SMS (green bubble) to your own other phone by hand.
3. **`.env.local`** (on the Mac, in the repo; never commit it) add:
   ```
   SMS_RELAY_SECRET=<a long random string, e.g. from `openssl rand -hex 32`>
   ```
   Optional: `RELAY_ALLOWLIST=+17075550123,+17075550145` texts only those numbers. **Unset (the demo setting), the
   relay texts any number the backend sends**: anyone who calls the hotline and asks for texts gets them from the
   teammate's phone.
   `CONVEX_SITE_URL` is already there (written by `npx convex dev`). Optional: `RELAY_SERVICE=iMessage` (default `SMS`).
4. **Convex env** (whoever deploys; this switches every text on the deployment to the relay):
   ```
   npx convex env set SMS_RELAY_SECRET <the same string>
   npx convex env set SMS_NOTIFIER mac_relay
   ```
   `GET /health` then shows `integrations.sms: "live"`, and `flags.smsRelayOnline: true` while a relay is polling.

## Run it

From a normal terminal (Terminal or iTerm, not a sandboxed tool, since osascript must be allowed to control Messages):

```
RELAY_DRY_RUN=1 npm run relay:mac      # first: prints what it would send, sends nothing
caffeinate -dis npm run relay:mac      # for real; caffeinate keeps the Mac awake
```

On the first real send macOS asks whether your terminal may control Messages: **allow it** (Automation). If you
missed the prompt: System Settings → Privacy & Security → Automation → your terminal → Messages. Ctrl-C stops
after the current text.

A dry run reports each text as failed (`relay_dry_run`), so it is not sent later either.

## What happens to each text

| Case | Result |
| --- | --- |
| Handed to Messages | `status: "sent"`, `providerStatus: "handed_to_messages"`, `providerRef: "mac-relay:<id>"` |
| `RELAY_ALLOWLIST` set and the number not in it | failed `not_allowlisted` (never sent) |
| osascript error | failed `osascript: <message>`; the log adds a hint for -1743 (Automation) or no SMS account (forwarding off) |
| Waited more than 30 min for a relay | failed `relay_stale` (an old alert is never sent late) |
| Subscription stopped before the relay claimed it | failed `subscription_inactive` |
| Claimed, no result within 5 min (relay crashed) | failed `relay_lost`; if the relay reports "sent" later, it is corrected to sent |
| Ctrl-C with texts still claimed | failed `relay_stopped` |

Texts go out one at a time, at least 3 s apart. A failed result POST is retried; the text is never sent twice.

## Limits

- **STOP replies reach the teammate's phone, not Soterra.** Nothing reads them. Stop someone by hand:
  `npx convex run notifications:stopByText '{"phone":"+1…"}'`, or they can call the hotline and say "stop updates".
- **"sent" means handed to Messages**, not delivered. A failed delivery (red "Not Delivered" in Messages) is not reported back.
- **No landline detection:** Twilio's 21614/30006 switch to calls does not happen with the relay.
- The texts come from the teammate's own number, and the relay only works while the Mac is awake, online and running the script.
