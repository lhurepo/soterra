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

## Deployed (2026-10-24)

| What | Value |
| --- | --- |
| Code agent (this directory) | `soterra-voice` · `agent_1iwkwy7nwEfejQJzwM75hm` (linked in `cartesia.toml` / `.cartesia/config.toml`) |
| Phone number | **+1 712 600 3362** · id `ap_CWGJppviDa2Ea1jeZEYwBt`, assigned to `soterra-voice` |
| Backend | `https://brazen-perch-21.convex.site` (`BACKEND_MODE=http`) |
| Voice | Sonic 3.6 Skylar `db6b0ed5-d5d3-463d-ae85-518a07d3c2b4` (en; also used for es until `VOICE_ID_ES` is set) |
| Playground agent | `soterra-agent` · `agent_8eCub89GEcWT6SxFTNGfkB` — a *managed* (Playground-prompt) agent. Managed agents cannot run deployed code, so it no longer has the number; keep it only as the fallback described in `docs/contracts/live-call.md`. |

Agent env (set with `cartesia env set --agent-id agent_1iwkwy7nwEfejQJzwM75hm --from <file>`): `BACKEND_MODE=http`, `SOTERRA_BACKEND_URL`, `VOICE_API_SECRET`, `DEFAULT_LANGUAGE=en`, `VOICE_ID_EN`, `TTS_MODEL=sonic-3.6`, `SOTERRA_PHONE_NUMBERS=+17126003362`. Setting env creates a new deployment automatically.

## Handing the agent over (to Leia or anyone else)

The backend does not know or care which Cartesia agent calls it: it only checks `VOICE_API_SECRET`. So moving to another agent changes nothing in `convex/` or `src/`.

1. Create (or reuse) a **code** agent in the new person's Cartesia account (a Playground/managed agent cannot run deployed code).
2. `npm run setup` once, then `~/.cartesia/bin/cartesia auth login` with that account's API key.
3. Deploy: `npm run voice:deploy -- agent_xxxxxxxx` (the new agent id).
4. Set its env (see "Agent env" above): `BACKEND_MODE=http`, `SOTERRA_BACKEND_URL`, `VOICE_API_SECRET` (same value as the Convex deployment), `SOTERRA_PHONE_NUMBERS`, voice ids. Setting env redeploys.
5. Point the phone number at it: `cartesia phone-numbers assign <phone-number-id> --agent-id agent_xxxxxxxx`.
6. Update the ids in `voice/.cartesia/config.toml`, `voice/cartesia.toml` link, the table above and `CLAUDE.md` so the next person deploys to the right agent.
7. Call the number and run the Demo script in `TEAM_PLAN.md`.

Rolling back is the same steps with the old agent id.

## Redeploy

```bash
cd voice
find . -name __pycache__ -prune -exec rm -rf {} +         # keep the upload small
cartesia deploy --agent-id agent_1iwkwy7nwEfejQJzwM75hm .
cartesia deployments ls --agent-id agent_1iwkwy7nwEfejQJzwM75hm   # wait for "deployed"
```

Build facts learned the hard way: the builder runs `uv` with CPython 3.13, and it statically checks `main.py` for a `VoiceAgentApp(...)` and `app.run()` — if `main.py` only imports an app built elsewhere it fails with "Missing uvicorn.run() call", so `main.py` constructs `VoiceAgentApp` itself. Build logs: `GET https://api.cartesia.ai/agents/<agent_id>/deployments` (`build_logs`). A Playground (managed) agent rejects code deploys ("Managed agent not supported"); use a separate code agent.

**Hosting ends December 1, 2026** for code-first Line agents (new hosted deployments were still accepted on 2026-10-24). After that, self-host the same app at a public HTTPS URL and attach it:

```bash
cartesia connect --agent-id agent_1iwkwy7nwEfejQJzwM75hm --url https://<your-host>
```

Switch `BACKEND_MODE` with `cartesia env set --agent-id … BACKEND_MODE=mock` (or `http`); that redeploys.

## Outbound callbacks

The backend places callbacks with `POST /agents/calls` (agent `soterra-voice`, from number `ap_CWGJppviDa2Ea1jeZEYwBt`) when `PHONE_NOTIFIER=cartesia` (set on the dev deployment). The call arrives here `from` our number `to` the person, so the agent recognises it as outbound via `SOTERRA_PHONE_NUMBERS`, and sends Line's `agent_call_id` as `providerAgentCallId`; the backend stored the same id when it placed the call and finds the notification by it. The notification id is also sent in `dynamic_variables` and `metadata` in case either reaches `call_request.metadata`. The masked `call_request …` log line shows what actually arrived.

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
- [ ] Check the first real `call_request …` log line (masked): `agent_call_id`, `from_`, `to`, `metadata` keys on inbound and outbound, and whether pre-call metadata reaches `get_agent`

Already verified without a phone (2026-10-24, `scripts/harness_call.py` against the dev backend): the full English demo script, the Spanish dialed-number path with the danger script, and the failure cutoff (wrong secret → fallback, fallback, apology + `end_call`).
