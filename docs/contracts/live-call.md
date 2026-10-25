# Live call contract (voice ⇄ backend)

[S] Implemented by **[B]** (`convex/voice.ts`), consumed by **[V]** (`voice/`). Source of truth: `src/contracts/voice.ts` (zod). Python mirror: `voice/soterra_voice/models.py`. Golden examples: `fixtures/contracts/voice.*.json`. Contract version: **`"1"`**.

## Transport

- Base URL: the deployment's `.convex.site` URL (`CONVEX_SITE_URL` in `.env.local`), e.g. `https://brazen-perch-21.convex.site`.
- Every `/voice/*` request: `Authorization: Bearer <VOICE_API_SECRET>` and `Content-Type: application/json`. Missing or wrong secret → `401`. If the backend has no secret configured it rejects everything (fails closed).
- Every body carries `contractVersion`. A different major version → `400 contract_version_mismatch`.
- All times are epoch milliseconds, UTC. Unknown fields are ignored on both sides.
- Errors: `{ "error": { "code": "unauthorized" | "bad_request" | "contract_version_mismatch" | "not_found" | "internal", "message": "..." } }`.

## Endpoints

### `POST /voice/session/start`

| Request field | Type | Notes |
| --- | --- | --- |
| `provider` | `"cartesia"` | |
| `providerCallId` | string | Line `CallRequest.call_id`. **Idempotency key**: repeating a start returns the same session. |
| `direction` | `"inbound" \| "outbound"` | |
| `callerPhone?` | E.164 | Absent when withheld. Never treated as identity proof. |
| `calledPhone?` | E.164 | |
| `languageHint?` | BCP-47 | |
| `notificationId?` | string | Outbound callbacks only. |
| `startedAt` | epoch ms | |

Response: `sessionId`, `language`, `greeting` (speakable; inbound greetings include the 911 line and the one-sentence transcription notice; outbound greetings deliver the stored update).

### `POST /voice/turn`

| Request field | Type | Notes |
| --- | --- | --- |
| `sessionId` *or* `providerCallId` | string | An unknown `providerCallId` lazily starts a session (inbound). |
| `turnIndex` | int ≥ 0 | 0, 1, 2… per call. **Idempotent per `(session, turnIndex)`**: a replay returns the stored reply. |
| `utterance` | string | The finished caller turn. |
| `language` | BCP-47 | |
| `interruptedPrevious?` | bool | The caller barged in over the previous reply. |
| `receivedAt` | epoch ms | |

| Response field | Notes |
| --- | --- |
| `reply` | Speakable, 1–3 short sentences. |
| `kind` | `answer` · `no_info` · `clarify` · `safety` · `smalltalk` · `followup` · `goodbye`. Treat unknown values as speakable text. |
| `citations` | `{ sourceName, url, issuedAt, updatedAt? }[]`, built from stored metadata, never from model text. Non-empty for every `answer`. |
| `endCall` | Speak `reply`, then hang up. |
| `unansweredQuestionId?`, `subscriptionId?` | Set when the turn recorded one. |
| `degraded?` | The backend fell back to a safe reply because a provider failed. |
| `timingsMs?` | `retrieval`, `llm`, `total`. |

### `POST /voice/session/end`

Request: `sessionId` or `providerCallId`, `endedAt`, `reason` (`caller_hangup` · `agent_end` · `transfer` · `error` · `timeout`). Response: `{ ok: true, callId }`. Turns are already stored; this only triggers finalization (summary, retention). A sweeper cron finalizes sessions silent for 15 minutes.

### `GET /health`

No auth. `{ contractVersion, ok, integrations: { voiceAuth, llm, retriever, mossSync, apify, nws, phoneNotifier, sms: "live" | "mock" | "unconfigured" }, flags, now }`.

### Reserved, not built

`POST /voice/turn/stream` (NDJSON text deltas) for lower latency later.

## Why it looks like this

- **Barge-in.** The Line SDK cancels in-flight agent work when the caller starts speaking (`UserTurnStarted`). So turns are indexed and idempotent, and the agent flags `interruptedPrevious` on the next turn. A cancelled HTTP request may still complete on the backend; the next turn simply uses the next index.
- **`providerCallId` everywhere** lets a turn arrive before session start finished, and lets a Cartesia Managed Agent call `/voice/turn` as a webhook tool if we ever need that fallback (Line hosting ends Dec 1, 2026).
- **The backend owns the rules.** Danger check, grounding and memory policy run in code on the backend, so swapping the voice provider or the model cannot weaken them.

## Sequences

Inbound:

```
Caller        Cartesia/Line agent (voice/)               Backend (Convex)
  │ dials ──────▶ CallStarted
  │                 POST /voice/session/start ─────────▶ create call (idempotent), caller row, greeting
  │ ◀── greeting ◀─ AgentSendText(greeting) ◀────────────
  │ speaks ──────▶ UserTurnEnded(text)
  │                 POST /voice/turn {turnIndex:0} ─────▶ persist turn → danger check → context → retrieval
  │                                                       → LLM → grounding → side effects → persist reply
  │ ◀── reply ◀──── AgentSendText(reply) ◀───────────────
  │ (barge-in) ──▶ UserTurnStarted cancels in-flight work; next turn sends interruptedPrevious: true
  │ hangs up ────▶ CallEnded
                    POST /voice/session/end ────────────▶ finalize → scheduled summary → caller memory
```

Outbound callback:

```
bulletin update → bulletinEvents → subscriptions.matchEvents → notifications row (dedupeKey)
  → notifications.deliver → Cartesia POST /agents/calls (dynamic_variables.notification_id)
  → Line agent CallStarted (metadata.notification_id — unverified, see DECISIONS.md)
  → POST /voice/session/start {direction:"outbound", notificationId} → greeting = intro + update + 911 line
  → voicemail answers → a short message + endCall; then the update by text, "We tried to call you." (missed_call_text)
  → no session within 100 s → the same text
  → answered → at session end, the update by text (call_recap; nothing said on the call)
```

Text-only subscriptions skip the call: the update goes straight to Twilio. No voice contract field changed for texts: the voice agent sees outbound calls exactly as before.

## Latency budget

| Step | Target |
| --- | --- |
| Backend work before the LLM (auth, persist, danger check, context, retrieval) | ≤ 300 ms |
| LLM (fast model, short JSON reply) | ≈ 1–1.5 s |
| End of speech → first audio (total, incl. STT endpointing and TTS) | ≈ 2.5 s |
| Reply length | 1–3 short sentences |

## Failure behaviour

| Failure | What the caller hears |
| --- | --- |
| Backend non-200, timeout (8 s), unparseable body | Voice agent speaks the fixed fallback in the session language (with the 911 line), logs, keeps the call open. After 3 failures in a row it apologizes, repeats the 911 line, suggests calling back, and ends the call (`reason: "error"`). |
| Backend slow (> 1.2 s) | Voice agent speaks one filler line ("One moment, I'm checking the latest official updates."), then the reply. |
| Session start fails | Fallback greeting with the 911 line; later turns use `providerCallId` (lazy start). |
| Retrieval or LLM fails inside the backend | `200` with `kind: "no_info"`, `degraded: true`, fallback reply with the 911 line. |
| Model answers without a valid citation | Rewritten to `no_info` ("I don't know yet…"), question recorded. |
| Immediate danger detected | `kind: "safety"`: "If you are in immediate danger, hang up and dial 911 now. I can't send help…" No LLM call. |
| Session end never arrives | Sweeper finalizes after 15 minutes of silence. |
