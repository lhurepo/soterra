# voice/ — Soterra phone agent (owner: Leia)

A Cartesia **Line SDK** agent (`cartesia-line` 0.2.19, Python 3.11–3.13, uv). It owns the phone call — lifecycle, language, turn-taking, interruptions, speech, latency, safe failure — and relays every caller utterance to the backend over the [live-call contract](../docs/contracts/live-call.md). **It never decides what to say about a disaster:** backend replies are spoken verbatim, and every locally spoken line is in `soterra_voice/phrases.py` (none states a disaster fact).

```
main.py                         entry point: Settings.from_env() → build_app() → VoiceAgentApp
soterra_voice/app.py            pre_call_handler (session start, STT/TTS language + voice) and get_agent
soterra_voice/agent.py          SoterraAgent.process(env, event): greeting, turns, filler, barge-in, failures, end
soterra_voice/backend_client.py Backend protocol: HttpBackendClient (httpx, keep-alive) and MockBackendClient
soterra_voice/models.py         pydantic mirror of src/contracts/voice.ts (ignores unknown fields)
soterra_voice/config.py         env settings (fail fast), voice IDs, dialed-number → language map, phone masking
soterra_voice/phrases.py        every local phrase, English and Spanish
scripts/harness_call.py         text-mode call through the real SDK app, no Cartesia needed
tests/                          pytest (no network): contract fixtures, client, agent, scripted calls, SDK runner
```

## How a call works

1. **Pre-call** (`POST /chats` from Cartesia → `pre_call_handler`): picks the language (dialed-number map, else `DEFAULT_LANGUAGE`), and — when the request carries a real call id and caller number, or is an outbound callback — starts the backend session (3 s budget) and uses the session's language. Returns `PreCallResult(config={"tts": {voice_id, model, language}, "stt": {language}})`. It never rejects a call.
2. **CallStarted:** reuses the pre-call session if its metadata reached the agent, otherwise calls `/voice/session/start` (idempotent on `providerCallId`). Speaks the backend greeting; only the transcription-notice sentence is uninterruptible. If start fails, speaks a local greeting with the 911 line and the first turn starts the session lazily via `providerCallId`.
3. **UserTurnEnded:** joins the `UserTextSent` parts, skips empty turns, sends `/voice/turn` with an incrementing `turnIndex` and the active language. If no reply after `FILLER_AFTER_S` (1.2 s), speaks one filler ("One moment, I'm checking the latest official updates."). Speaks `reply` exactly; on `endCall`, ends the session and hangs up.
4. **Barge-in:** the SDK cancels `process()` on `UserTurnStarted`; the agent cancels the in-flight HTTP request and sends `interruptedPrevious: true` on the next turn. It also flags a barge-in when history shows the caller started talking while the agent was speaking (`AgentTurnStarted` without `AgentTurnEnded`). The SDK reports spoken text as `AgentTextSent` but not how much of a cut-off reply was heard.
5. **Failures** (timeout `TURN_TIMEOUT_S`=8 s, network, non-200, invalid body): speaks the fallback ("…trouble reaching the information service. If you are in danger, hang up and dial 911 now."), keeps the call open and the turn numbering intact. After 3 in a row: apology, 911 line, "call back in a few minutes", hang up (reason `error`). A success resets the count. `degraded: true` replies are spoken normally.
6. **CallEnded:** `/voice/session/end` once per call (`caller_hangup`, `agent_end` or `error`), 2 s timeout; the backend's sweeper covers anything missed.
7. **Repeat:** "repeat that", "say that again", "¿puede repetir?", "repítelo"… replays the last reply without a backend call (tight whole-utterance match).
8. **Outbound callbacks:** `call_request.metadata.notificationId` (or `notification_id`) ⇒ `direction: "outbound"` + `notificationId`; the backend's greeting carries the update and the conversation then continues normally.

## Languages

Priority: (1) the caller's saved language (the backend returns it from session start when no hint is sent); (2) `LANGUAGE_BY_DIALED_NUMBER` — a dedicated Spanish number is the simplest reliable option (the backend treats the hint as the caller's explicit choice); (3) keypad: **2** switches to Spanish, **1** to English (`AgentUpdateCall(language, voice_id)` changes STT and TTS). `OFFER_SPANISH_DTMF=true` adds "Para español, oprima dos." after the English greeting; it is off by default until a real call confirms keypad presses arrive with the turn. The active language is sent on every turn.

Ink 2 STT: en, es, fr, hi, ja. Sonic 3.6 TTS: 44 languages, and "every voice can speak every language the model supports", so one voice can serve both. Default voice: Sonic 3.6 **Jacqueline** (`9626c31c-bec5-4cca-baa8-f8ba9e84c8bc`, en-US, listed among Cartesia's stable voices). Pick a calm Spanish-native voice from <https://play.cartesia.ai/voices> and set `VOICE_ID_ES` after listening to it on a phone.

## Configuration (`.env`, or `cartesia env set` when deployed)

| Variable | Default | Notes |
| --- | --- | --- |
| `BACKEND_MODE` | `http` | `http` or `mock` |
| `SOTERRA_BACKEND_URL` | — | `https://<deployment>.convex.site`; required in `http` mode |
| `VOICE_API_SECRET` | — | same value as the Convex deployment's; required in `http` mode |
| `DEFAULT_LANGUAGE` | `en` | `en` or `es` |
| `TURN_TIMEOUT_S` / `FILLER_AFTER_S` / `END_SESSION_TIMEOUT_S` | `8` / `1.2` / `2` | seconds |
| `MAX_CONSECUTIVE_FAILURES` | `3` | then the call ends |
| `VOICE_ID_EN`, `VOICE_ID_ES` | Jacqueline | `VOICE_ID_ES` defaults to `VOICE_ID_EN` |
| `TTS_MODEL` | `sonic-3.6` | |
| `PRONUNCIATION_DICT_ID` | — | optional Cartesia pronunciation dictionary (e.g. Ridgeview, Sonoma, CAL FIRE) |
| `LANGUAGE_BY_DIALED_NUMBER` | — | `+14155550100:es,+14155550101:en` |
| `OFFER_SPANISH_DTMF` | `false` | |
| `MOCK_CONVERSATION` | — | mock mode: replay `fixtures/conversations/<name>.json` |

Missing or malformed values fail at startup with a message naming the variable. Logs never contain the secret or a full phone number (`+1415***9876`).

## Run and test locally

```bash
cd voice
uv sync
uv run pytest                                                       # no network

# A whole call in text, through the real SDK app, no Cartesia account needed:
BACKEND_MODE=mock MOCK_CONVERSATION=../fixtures/conversations/ridgeview-basic.json uv run python scripts/harness_call.py
# …against the dev backend (VOICE_API_SECRET from `npx convex env get VOICE_API_SECRET`):
BACKEND_MODE=http SOTERRA_BACKEND_URL=https://<deployment>.convex.site VOICE_API_SECRET=… uv run python scripts/harness_call.py

# With the Cartesia CLI (curl -fsSL https://cartesia.sh | sh; cartesia auth login):
PORT=8000 uv run python main.py        # terminal 1
cartesia chat 8000                      # terminal 2: talk to it in text
```

## Deploy to a phone number

```bash
cd voice
cartesia init                                   # link this directory to a Cartesia agent
cartesia env set --from .env                    # BACKEND_MODE=http, SOTERRA_BACKEND_URL, VOICE_API_SECRET, voices…
cartesia deploy
cartesia phone-numbers provision "Soterra" --agent-id <agent-id>
# or: cartesia phone-numbers assign <phone-number-id> --agent-id <agent-id>
cartesia status
```

**Hosting ends December 1, 2026** for code-first Line agents (self-hosted agents are unaffected). The docs don't say whether new hosted deployments are still accepted. If `cartesia deploy` refuses, run the same app anywhere with a public HTTPS URL (`uv run python main.py` behind any HTTPS host) and attach it:

```bash
cartesia connect --agent-id <agent-id> --url https://<your-host>
```

Switch `BACKEND_MODE` with `cartesia env set BACKEND_MODE=mock` (or `http`) and redeploy.

## Measured latency

Text-mode calls through the real SDK app against the dev backend (`brazen-perch-21`, mock LLM, fixtures served), from a laptop, 2026-10-24 — end of caller turn to first agent text: **median 356 ms, max 457 ms** (6 turns; backend `/voice/turn` 232–454 ms). Danger turns: 206–270 ms. This excludes speech recognition endpointing and TTS. **End of speech to first audio on a real call is not measured yet** (target ≈ 2.5 s); measure it on the first real call and with the real Claude model, then record it here.

## Real-call checklist (dev backend, fixtures)

- [ ] Inbound English call through the full demo script in `TEAM_PLAN.md`
- [ ] Spanish call (Spanish number or keypad 2): Spanish greeting, phrases and voice
- [ ] Barge-in mid-reply: the agent stops, the next turn is answered (`interruptedPrevious` in the backend turn row)
- [ ] Silence: nothing breaks; the call stays open
- [ ] Backend stopped (or wrong secret): fallback with 911 twice, then the apology and hang-up on the third turn
- [ ] Caller ID withheld: the call works, no callback offered
- [ ] Outbound callback from the backend: greeting carries the update, follow-up questions work
- [ ] Log the first real `call_request` (masked): confirm `from_`, `to`, `metadata` on inbound and outbound, and whether pre-call metadata reaches `get_agent`

Already verified without a phone (2026-10-24, `scripts/harness_call.py` against the dev backend): the full English demo script, the Spanish dialed-number path with the danger script, and the failure cutoff (wrong secret → fallback, fallback, apology + `end_call`).
