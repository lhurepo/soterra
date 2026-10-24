# voice/ — Soterra phone agent (owner: Leia)

A Cartesia **Line SDK** custom agent (`cartesia-line` 0.2.x, Python ≥ 3.11). It does no reasoning: on each finished caller turn it calls the backend's `POST /voice/turn` and speaks `reply`. Contract: [`docs/contracts/live-call.md`](../docs/contracts/live-call.md).

```
main.py                      VoiceAgentApp(get_agent=...) entry point
soterra_voice/agent.py       SoterraAgent.process(env, event): CallStarted → greet, UserTurnEnded → turn, CallEnded → end
soterra_voice/backend_client.py  HttpBackendClient (8 s timeout, bearer secret) and MockBackendClient
soterra_voice/models.py      pydantic mirror of src/contracts/voice.ts (ignores unknown fields)
soterra_voice/phrases.py     fallback lines (en, es), always with the 911 line
tests/                       pytest: golden fixtures + agent behaviour with MockBackendClient
```

## Setup

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh     # if you don't have uv
cd voice
uv sync
cp .env.example .env                                 # fill SOTERRA_BACKEND_URL and VOICE_API_SECRET
uv run pytest
```

## Run locally (text only)

```bash
# terminal 1
PORT=8000 uv run python main.py
# terminal 2 (Cartesia CLI: curl -fsSL https://cartesia.sh | sh; cartesia auth login)
cartesia chat 8000
```

`BACKEND_MODE=mock` gives canned replies with no backend at all.

## Deploy

```bash
cartesia env set --from .env
cartesia deploy
cartesia phone-numbers provision     # then assign the number to the agent
cartesia status
```

**Hosting ends December 1, 2026.** Cartesia stops hosting code-first Line agents on that date (self-hosted agents are unaffected). For the hackathon `cartesia deploy` is the fast path. If it is refused, self-host the same app anywhere with a public HTTPS URL and attach it:

```bash
cartesia connect --agent-id <agent-id> --url https://<your-host>
```

Last-resort fallback: a Cartesia **Managed Agent** with a webhook tool that calls `POST /voice/turn` with `providerCallId` (the backend accepts turns without a prior session start).

## Things to verify on the first real call (TODO(V))

- Log line `call ... from=... to=... metadata=...` (in `main.py`): confirm `from_` is the caller's E.164 number and whether outbound calls carry our `notification_id` in `metadata` (the outbound API sends it as `dynamic_variables`; the docs don't say where those land for Line agents).
- Spanish: Ink 2 transcribes `es` (and `en`, `fr`, `hi`, `ja`). Language is switched with `AgentUpdateCall(language=...)` after session start; pick a Spanish `voice_id` too. Setting it before the call needs a `pre_call_handler` returning `PreCallResult(config={"tts": {...}, "stt": {...}})` — the `stt` key is inferred from SDK types, not documented.
- Barge-in: `UserTurnStarted` cancels the in-flight turn; the agent then sends `interruptedPrevious: true` on the next turn.
- Latency: target ≈ 2.5 s from end of speech to first audio. Check `timingsMs` in backend replies.
