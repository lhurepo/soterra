# Soterra on Cartesia

Soterra is a phone line you can call during a disaster. You ask what's going on, and it answers only from official bulletins, telling you who said it and when. If it doesn't know, it says so, saves your question, and calls you back when there's news.

We built it on the phone because that's what people still have when the power is out, the data network is jammed, or they don't own a smartphone. Cartesia handles everything about the call. Our backend decides what to say.

**Try it:** call **+1 (712) 600-3362**.

## How it fits together

```
caller ──phone──▶ Cartesia (number, Ink STT, Sonic TTS)
                    │
                    ▼
              voice/  our Line SDK agent (Python)
                    │  POST /voice/session/start · /voice/turn · /voice/session/end
                    ▼
              Convex backend: retrieval over official bulletins + Claude, grounding checks
                    │
                    └──▶ Cartesia outbound-call API when a bulletin changes ("call me back")
```

The agent in [`voice/`](voice/) never comes up with disaster facts itself. It speaks the backend's reply word for word. Everything else it can say on its own (fillers, the fallback, goodbyes) is in [`voice/soterra_voice/phrases.py`](voice/soterra_voice/phrases.py), and none of those lines states a fact about the emergency.

## Cartesia features we use

- **Line SDK code agent** (`cartesia-line` 0.2.19). `SoterraAgent.process()` handles `CallStarted`, `UserTurnEnded` and `CallEnded`. It answers with `AgentSendText`, `AgentUpdateCall` and `AgentEndCall`.
- **Hosted deployment.** We deploy with `cartesia deploy` and set config with `cartesia env set`. The agent is `soterra-voice`.
- **Phone number** provisioned in Cartesia and assigned to the agent. Inbound calls need no extra telephony provider.
- **Pre-call handler.** `pre_call_handler` returns a `PreCallResult` with the TTS voice, model and language plus the STT language for each call. It also starts our backend session early, so the greeting is ready when the call connects.
- **Sonic 3.6 TTS.** One voice speaks both English and Spanish, since Sonic voices can speak any language the model supports. An optional pronunciation dictionary (`PRONUNCIATION_DICT_ID`) helps with local place names.
- **Ink STT** in English and Spanish.
- **Switching language mid-call.** Pressing 2 on the keypad switches to Spanish and 1 switches back. This uses `AgentUpdateCall(language, voice_id)`, which changes STT and TTS together.
- **Barge-in.** The SDK cancels `process()` on `UserTurnStarted`. We then cancel the in-flight backend request and flag the next turn as an interruption, so the backend never assumes the caller heard a reply they talked over.
- **Uninterruptible lines.** Most of the greeting can be interrupted. The sentence telling the caller the call is transcribed can't, because they need to hear it.
- **Outbound calls** through `POST /agents/calls`. This is what "call me back" runs on. When a bulletin changes, the backend calls the person, and the greeting on that call carries the update. We match the callback to the request through Cartesia's `agent_call_id`. On outbound calls the agent waits up to 2 seconds for whoever picks up. That way an answering machine gets a short message instead of the whole greeting.
- **`LogMetric`** for backend latency, fillers and failures, so they show up next to the call transcript.
- **`cartesia chat`** for testing the agent in text on a laptop.

## Setup

You need Node 20.19+, Python 3.11 to 3.13, [uv](https://docs.astral.sh/uv/) and a Cartesia account.

```bash
npm run setup                          # Cartesia CLI (to ~/.cartesia/bin), npm ci, voice/.venv
~/.cartesia/bin/cartesia auth login    # paste your Cartesia API key
```

**Run a whole call in text, no Cartesia account needed:**

```bash
cd voice
uv run pytest
BACKEND_MODE=mock MOCK_CONVERSATION=../fixtures/conversations/ridgeview-basic.json \
  uv run python scripts/harness_call.py
```

**Talk to it locally through the Cartesia CLI:**

```bash
cd voice
PORT=8000 uv run python main.py         # terminal 1
~/.cartesia/bin/cartesia chat 8000      # terminal 2
```

**Deploy it and give it a number:**

```bash
cd voice
find . -name __pycache__ -prune -exec rm -rf {} +
cartesia deploy --agent-id <agent_id> .
cartesia env set --agent-id <agent_id> BACKEND_MODE=http SOTERRA_BACKEND_URL=https://<deployment>.convex.site \
  VOICE_API_SECRET=<same as Convex> SOTERRA_PHONE_NUMBERS=<your number in E.164>
cartesia phone-numbers assign <phone_number_id> --agent-id <agent_id>
```

To turn on callbacks, set these on the Convex deployment: `PHONE_NOTIFIER=cartesia`, `CARTESIA_API_KEY`, `CARTESIA_AGENT_ID` and `CARTESIA_FROM_NUMBER_ID`. Every variable is explained in [`voice/README.md`](voice/README.md).

## Known limitations

- **Two languages only.** Ink 2 covers English, Spanish, French, Hindi and Japanese. We wanted Mandarin and Punjabi too, but Ink 2 can't transcribe them, so we ship English and Spanish.
- **No Spanish-native voice yet.** Spanish uses the same voice as English, with an English accent. We still need to pick a calm Spanish voice by listening on a real phone line.
- **Keypad switching hasn't been tested on a real call.** We can't yet confirm that a keypad press always reaches us inside a user turn. The spoken "para español, oprima dos" prompt is off by default for that reason. A dedicated Spanish number is the reliable option.
- **We haven't measured real phone latency.** In text mode, the end of a turn to the first agent text is a median of about 360 ms, but that leaves out STT endpointing and TTS. Our target from the end of speech to the first audio is about 2.5 seconds.
- **No STT keyterms.** Keyterm boosting isn't documented for Line code agents, so unusual place names can be misheard. The pronunciation dictionary only helps the voice, not recognition.
- **We don't rely on `dynamic_variables` for callbacks.** We couldn't confirm they reach a code agent's `call_request.metadata`, so we match callbacks by `agent_call_id`.
- **Outbound calls are US numbers only**, and at most one call per second per number. That's fine for a demo, but a real alert to a whole county would need queueing.
- **Hosting deadline.** Cartesia stops hosting code-first Line agents on December 1, 2026. After that we'd run the same app ourselves and attach it with `cartesia connect --agent-id <id> --url https://<host>`.
- **The demo places real calls.** In the demo, "call me back" rings real phones. We only subscribe numbers whose owners agreed.
