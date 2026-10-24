# Soterra backend

[B] Owner: Alonso. Convex functions in `convex/` are thin; the logic is plain TypeScript in `src/` (`config`, `orchestration`, `retrieval`, `memory`, `notifications`, `providers/{llm,moss,cartesia}`). Contracts: [live call](contracts/live-call.md), [ingestion and retrieval](contracts/ingestion-retrieval.md). Decisions and verification: [DECISIONS.md](DECISIONS.md). Build report: [backend-report.md](backend-report.md).

## What happens on a turn

```
POST /voice/turn ─▶ auth + zod ─▶ calls.beginTurn (1 mutation)
                                    resolve or lazily start the session · replay check on (session, turnIndex)
                                    mark the previous reply interrupted · persist the user turn
                                    return cached caller context, cached area labels, last 6 turns
                 ─▶ src/orchestration/pipeline.ts (pure)
                      1 danger check (en + es) ──hit──▶ canonical safety reply, no retrieval, no LLM
                      2 "stop updates" / "summary only" (deterministic)
                      3 area: ZIP → place name in active bulletin labels → call's area → caller context
                      4 retrieval (1 query): area-first + full text, filtered, ranked, ≤ 6 chunks / ≈ 1,500 tokens
                      5 prompt: static system → caller context → <source> blocks → recent turns → utterance
                      6 LLM (CLAUDE_FAST_MODEL, 6 s timeout, 300 tokens, JSON schema) → zod
                      7 grounding: citations from chunk metadata · unknown ids rejected · attribution · address/shelter guards
                      8 side-effect plan: unanswered question · subscription · cancel · known area · consent
                 ─▶ calls.completeTurn (1 mutation): apply the plan atomically, store the reply and timings
                 ◀─ 200 TurnResponse (any internal failure after validation: 200 + canonical fallback + degraded: true)
```

Session end (or the sweeper after 15 minutes of silence) → `memory.finalizeCall` (idempotent; re-checks the verified phone link; sets retention deadlines; updates caller memory) → `memory.summarizeCall` (CLAUDE_SMART_MODEL, deterministic fallback on failure) → `memory.saveSummary` (summary-only mode deletes the turns).

## Endpoints

Base URL: the deployment's `.convex.site` URL. Every `/voice/*` call needs `Authorization: Bearer <VOICE_API_SECRET>`. Bodies follow `src/contracts/voice.ts` exactly.

### `POST /voice/session/start`

```bash
curl -s -X POST "$CONVEX_SITE_URL/voice/session/start" -H "Authorization: Bearer $VOICE_API_SECRET" -H "Content-Type: application/json" \
  -d '{"contractVersion":"1","provider":"cartesia","providerCallId":"demo-1","direction":"inbound","callerPhone":"+17075550123","languageHint":"en","startedAt":1792893600000}'
```

```json
{ "contractVersion": "1", "sessionId": "k57…", "language": "en",
  "greeting": "This is Soterra, the disaster information line. If you are in immediate danger, hang up and dial 911. This call is transcribed to help answer you; say \"summary only\" if you'd rather we keep just a short summary. What would you like to know?" }
```

- Idempotent on `providerCallId` (a repeat returns the same session and the same stored greeting).
- `callerPhone` is normalized to E.164 (`(707) 555-0123` → `+17075550123`); `anonymous`, `restricted` and unparseable values count as withheld.
- A recent caller (last call within 7 days) hears "Welcome back. If you'd like, we can pick up where we left off." instead of the closing question.
- Outbound (`direction: "outbound"`, `notificationId`): greeting = intro + the stored update + "you can ask me a question" + how to stop updates + 911 line + transcription notice. `callerPhone` may be omitted: the notification knows who was called.
- Failure inside start → `500 internal` (no session exists to return); the agent speaks its fallback greeting and lazily starts on the first turn.

### `POST /voice/turn`

```bash
curl -s -X POST "$CONVEX_SITE_URL/voice/turn" -H "Authorization: Bearer $VOICE_API_SECRET" -H "Content-Type: application/json" \
  -d '{"contractVersion":"1","sessionId":"k57…","turnIndex":0,"utterance":"What is going on with the Ridgeview Fire?","language":"en","receivedAt":1792893601000}'
```

```json
{ "contractVersion": "1", "sessionId": "k57…", "turnIndex": 0, "language": "en", "kind": "answer",
  "reply": "The Ridgeview Fire is burning about 1,200 acres east of Santa Rosa and is 10 percent contained. … That's from Sonoma County Fire Information (Demo), updated October 24 at 2:10 PM Pacific.",
  "citations": [{ "sourceName": "Sonoma County Fire Information (Demo)", "url": "https://example.org/soterra-demo/fire/ridgeview", "issuedAt": 1792870200000, "updatedAt": 1792876200000 }],
  "endCall": false, "timingsMs": { "context": 35, "retrieval": 73, "preLlm": 110, "llm": 1156, "total": 1270 } }
```

- `sessionId` or `providerCallId`; an unknown `providerCallId` lazily starts an inbound session; an unknown `sessionId` is `404`.
- Idempotent on `(session, turnIndex)`: a replay returns the stored response byte for byte.
- `interruptedPrevious: true` marks the previous reply `interrupted` (shown to the model as "[the caller interrupted this reply]"; never assumed heard).
- `language` in the response is the reply language: `en` or `es` (any other caller language gets English).
- `timingsMs`: `context` (beginTurn), `retrieval`, `preLlm` (all backend work before the LLM), `llm`, `total`. A danger turn has only `context` and `total`.
- `degraded: true` when a provider failed or the model's draft broke a rule and was rewritten.

### `POST /voice/session/end`

`{ contractVersion, sessionId | providerCallId, endedAt, reason }` → `{ ok: true, callId }`. Unknown session → `404`. Finalization is scheduled; repeating it is harmless.

### `GET /health`

No auth. `integrations`: `voiceAuth`, `llm`, `retriever`, `mossSync`, `apify`, `nws`, `phoneNotifier`, `sms` as `live` · `mock` · `unconfigured`. `flags`: `serveFixtures`, `mockSites`, `cartesiaVerifiedLive` (always `false` today), `mockLlmFailureMode`.

### Internal functions for operators (dashboard or `npx convex run`)

| Function | Use |
| --- | --- |
| `calls:debugCall '{"callId":"<sessionId or providerCallId>"}'` | Turns with kinds, replies, retrieved and cited chunk ids, retriever, area source, model, error codes, timings. |
| `unanswered:listOpen` / `unanswered:answerUnansweredQuestion '{"id":"…","answer":"…","sourceUrl":"https://…","sourceName":"…"}'` | Stand-in for the responder console; answering notifies `answer_available` subscribers. |
| `unanswered:dismiss` | Close a question without answering. |
| `notifications:recent '{"limit":5}'` | Latest notification attempts. |
| `callers:forgetCaller '{"phone":"+1…"}'` | Cancel a number's updates and delete its memory. |
| `accounts:createTestAccount '{"phone":"+1…","verified":true}'` | Dev/test stand-in for sign-up + phone verification. |
| `memory:purgeExpired` | Run the retention purge now (also a daily cron). |
| `llmCheck:verify` / `llmCheck:smoke` | Live Claude checks on the deployment (model ids, structured output, temperature rule, caching; three scenarios). Spend a few cents. |
| `mossNode:syncAll` / `mossNode:syncChunks` / `mossNode:query` | Moss (see limits: cannot load in Convex today). |

## Environment variables and modes

Set on the deployment with `npx convex env set NAME value` (dev only from this session). Parsed by `src/config/env.ts`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `VOICE_API_SECRET` | — | Required. Without it every `/voice/*` call is `401`. |
| `LLM_PROVIDER` | `mock` | `mock` (MockLlm) or `anthropic` (needs `ANTHROPIC_API_KEY`). |
| `CLAUDE_FAST_MODEL` | `claude-haiku-5-5` | Call turns. Verified live. |
| `CLAUDE_SMART_MODEL` | `claude-sonnet-5-5` | Summaries (and ingestion extraction). Verified live. |
| `CLAUDE_SUMMARY_MODEL` | — | Optional override for summaries. |
| `MOCK_LLM_MODE` | `normal` | Dev/test: `invalid_json`, `uncited_answer`, `unknown_chunk`, `timeout`, `error`. |
| `RETRIEVER` | `convex` | `moss` tries Moss first and falls back to Convex (Moss cannot load in Convex today). |
| `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY`, `MOSS_INDEX_NAME` | — | Moss. |
| `PHONE_NOTIFIER` | `mock` | `cartesia` uses the outbound-call adapter (**not verified live**; needs `CARTESIA_API_KEY`, `CARTESIA_AGENT_ID`, `CARTESIA_FROM_NUMBER_ID`). |
| `SMS_NOTIFIER` | `unconfigured` | No SMS provider. |
| `SERVE_FIXTURES` | `false` | `true` lets callers hear the fictional demo bulletins. |
| `ANON_TRANSCRIPT_TTL_HOURS` | `168` | Turns of anonymous calls. |
| `ANON_MEMORY_TTL_DAYS` | `30` | Anonymous caller rows, call rows and summaries. |

## Defaults (`src/config/defaults.ts`)

| Default | Value | Note |
| --- | --- | --- |
| Anonymous transcript TTL | 7 days | env `ANON_TRANSCRIPT_TTL_HOURS` |
| Anonymous caller memory TTL | 30 days | env `ANON_MEMORY_TTL_DAYS`; counted from the last call; unset while linked to a verified account |
| Last-summary TTL for caller context | 7 days | |
| Subscription expiry | 24 hours (72 hours max) | `subscriptionTtl()` clamps |
| Notification rate limit | 1 per 15 minutes, 4 per hour, per subscription | rate-limited attempts are stored as `failed` / `rate_limited: …` |
| "As of" staleness threshold | 3 hours | newest cited source older than this → "as of" its time |
| Stale-session sweep | 15 minutes of silence | contract value (the build prompt said 10) |
| LLM (turns) | 6 s timeout, 300 max tokens, temperature 0.2 **not sent** | the API rejects `temperature` (verified 400) |
| Summaries | 600 max tokens, 20 s timeout | |
| Retrieval | ≤ 6 chunks, ≈ 1,500 tokens | best chunk per bulletin + the next chunk when it fits |
| Purge batch | 100 rows per mutation | self-reschedules while work remains |
| History given to the model | last 6 turns | |
| Caller context cap | ≈ 300 tokens | |
| Area-label cache per call | 10 minutes | |
| Reply length | 1–3 sentences, ≤ 60 words | prompt rule; the attribution sentence is extra |

Canonical spoken wording (safety, fallback, no_info, transcription notice, stop-updates, callback declined, attribution, greetings, follow-up confirmation) lives only in `src/config/strings.ts`, English and Spanish. **A human must review it before the demo.**

## Rules enforced in code

- **Grounded or silent** (`src/orchestration/grounding.ts`): `answer` needs ≥ 1 cited chunk retrieved this turn with an answerable trust tier; citing any id that was not retrieved rejects the whole answer; otherwise canonical `no_info` + an unanswered question + `degraded`. Citations come from chunk metadata. If the reply names no cited source, the attribution sentence is appended (with "as of" when stale).
- **Danger first** (`src/orchestration/danger.ts`): English and Spanish statement patterns on every turn, before retrieval and the LLM. The model may also return `safety`; the wording is always the canonical string.
- **What may be cited** (`convex/retrieval.ts`, `src/retrieval/rank.ts`): chunk active, bulletin active and `status: "actual"`, trust `official`/`official_social`, unexpired at `now`, fixtures only when `SERVE_FIXTURES=true` — checked in the query and again in ranking.
- **Address and shelter guards**: an address-in-zone claim for an exact-address question becomes the canonical refusal; "shelter is open" needs a cited source that says "open" (its time comes with the attribution); non-answer kinds may not make either claim.
- **Untrusted text is data**: sources, recent turns and the utterance sit inside delimited blocks with delimiter look-alikes stripped; the system prompt says they are data.
- **Caller ID never unlocks personal details** (`src/memory/callerContext.ts`): on caller ID the model sees language, a county-level area, active update topics and public incident keys from a recent call. The last summary and saved needs reach the model only on a verified call. The greeting never volunteers history.
- **App sign-in and profile** (`convex/accounts.ts`, tables `phoneChallenges` and `appSessions`): the app proves a user holds a phone number with a code that Soterra reads out by phone, then uses a private session token. Public functions, in order: `requestPhoneCode({ phone, language? })` (Soterra rings the number and reads a 6-digit code, valid 10 minutes; one request a minute and five an hour per number; errors `rate_limited`, `invalid_phone`) → `verifyPhoneCode({ phone, code })` (returns `{ ok: true, token, expiresAt }`, or `{ ok: false, reason }` with reason `no_code`, `code_expired`, `invalid_code` (plus `attemptsLeft`) or `too_many_attempts`; five wrong tries burn the code; the first success creates the account and a phone link marked `verifiedBy: "app_code"`) → `getMyProfile({ token })`, `saveMyProfile({ token, displayName?, preferredLanguage?, personalContext?, homeZip?, emergencyContact? })` (omitted fields are cleared; errors `not_signed_in`, `invalid_zip`, `invalid_language`, `personal_context_too_long`) `signOut({ token })` and `requestVerifiedCall({ token })`. Sessions last 30 days. **"Call me" in the app:** `requestVerifiedCall` rings the linked number now (returns `{ ok: true }` or `{ ok: false, reason: "rate_limited" }`; error `not_signed_in`). The call is the callback check, authorized by the session token, so it is verified for that call only and unlocks the personal commands without calling in first. Only that callback verifies a call: an inbound call from a linked number, an update callback and the sign-in code call never do. Nothing reads or writes a profile from a bare phone number any more. The code call's greeting contains the code, so the stored greeting is scrubbed when the call is finalized, and the notification never holds the code.
- **A linked number on a call is still just caller ID.** The saved profile (needs, personal context, home area) may shape the answers on a call from the linked number, but history, saved needs read-back, update topics and every personal command ("what do you know about me", "forget me", "what updates do I have") need the callback check (identity `verified_phone`). A callback to a linked number gets both: the account's data and the commands.
- **Key pool** (`src/providers/llm/pool.ts`): `ANTHROPIC_API_KEY` plus `ANTHROPIC_API_KEYS` (comma separated). When a key is out of credit, unauthorized or rate limited the backend uses the next one and skips the spent key for 10 minutes (1 hour if unauthorized, 1 minute if rate limited). Other errors (timeouts, bad output) never switch keys. Add keys with `npm run key:add -- sk-ant-…`; `npm run key:list` shows only the last four characters. Keys live in Convex env, never in git.
- **Voice profile and the callback check** (`src/orchestration/pipeline.ts` step 2b, `src/memory/profile.ts`, `convex/calls.ts`): a caller can say "remember I use a wheelchair", "what do you know about me", "what did we talk about last time" or "forget me". These are matched in code, never by the model, and need a *verified* call. Caller ID is not enough (it can be spoofed), so on a plain call the reply is "I'll call you back at this number to confirm it's you" and the call ends. `queueVerificationCall` queues a phone notification with `purpose: "verification"` (delivered after `verificationDelayMs`, at most `verificationsPerHour` per number, one per minute). When that outbound call connects, `startSessionImpl` marks it `verifiedPhone` only if it is outbound, tied to a verification notification created within `verificationValidMs`, and answered at the number we dialed; identity becomes `verified_phone` for that call alone. Saved needs live on `callers.profileNeeds` (max 5, 80 characters each, never addresses, phone numbers or emails). "Forget me" asks for a "yes" on the next turn, then deletes the profile, summaries and updates and marks the call `forgotten`, so `finalizeCall` writes no memory and no summary for it. Personal-command turns are left out of call summaries.
- **Fail safe**: after validation, `/voice/turn` always answers 200; failures give the canonical fallback (with the 911 line) and `degraded: true`, and are logged with an `errorCode` on the turn.

## Retrieval scoring (explainable)

`score = lexical + context + area + severity + recency` (`src/retrieval/rank.ts`, unit-tested):

| Part | Value |
| --- | --- |
| lexical | 1.0 × share of the utterance's content terms found in the chunk (prefix match) |
| context | 0.3 × the same for the caller's previous two utterances |
| area | +0.25 if found through the area-first lookup; +0.15 same county, else +0.05 same state |
| severity | extreme 0.3 · severe 0.2 · moderate 0.1 · minor 0.05 |
| recency | 0.1 / (1 + age in days) |

## Running it

```bash
npm install
npm test && npm run typecheck            # 237 tests (+1 live test skipped), no network
npx convex dev --once                    # push to the dev deployment
npx convex env set VOICE_API_SECRET "$(openssl rand -hex 24)"   # once
npx convex env set SERVE_FIXTURES true
npm run seed:fixtures                    # Ridgeview demo bulletins + mock sites
VOICE_API_SECRET="$(npx convex env get VOICE_API_SECRET)" npm run sim:call -- --all
```

| Scenario | How |
| --- | --- |
| Demo call (grounded, address refusal, pets, unknown fact, follow-up, goodbye) | `sim:call -- --scenario ridgeview-basic` |
| Spanish caller | `sim:call -- --scenario spanish` |
| Danger (en + es) | `sim:call -- --scenario danger` |
| Withheld caller ID | `sim:call -- --scenario withheld` |
| Fixtures off | `npx convex env set SERVE_FIXTURES false`, then `sim:call -- --scenario no-fixtures` |
| Escalation → callback | run `ridgeview-basic`, then `npm run inject:update` (prints the notification), then start an outbound session with that `notificationId` |
| Real Claude | `npx convex env set LLM_PROVIDER anthropic` (key already on dev), run any scenario, `npx convex env remove LLM_PROVIDER` to go back to the mock |
| Answer an unanswered question | `npx convex run unanswered:listOpen`, then `unanswered:answerUnansweredQuestion` |
| LLM failure drills | `npx convex env set MOCK_LLM_MODE timeout` (or `invalid_json`, `uncited_answer`, `unknown_chunk`, `error`) |
| Live smoke test | `RUN_LIVE_TESTS=1 npx vitest run tests/live.smoke.test.ts` (local key if `ANTHROPIC_API_KEY` is exported, otherwise runs on dev) |
| Moss check (local) | `npx tsx scripts/moss-check.ts` (uses `.env.local`; throwaway index; prints timings only) |

## How the voice agent and ingestion plug in

- **Voice agent (Leia)**: nothing to change in the contract. Point `SOTERRA_BACKEND_URL` at the `.convex.site` URL and set the same `VOICE_API_SECRET`. Send `interruptedPrevious` after a barge-in. Read `language` in each reply to keep TTS in sync. For outbound calls send `direction: "outbound"` and `notificationId`; `callerPhone` may be omitted. Sync the fallback line in `voice/soterra_voice/phrases.py` with `fallback` in `src/config/strings.ts`.
- **Ingestion (Dhweya)**: keep writing through `internal.ingestion.upsertBulletins`; the backend reads `bulletins`, `chunks` (now using `chunkIndex`), `bulletinAreas` and `bulletinEvents`, and `upsertBulletins` already schedules `subscriptions.matchEvents`. `internal.retrieval.search` takes an extra optional `contextText`. The Moss sync entry point is `internal.mossNode.syncChunks({ upserts, removedChunkIds })` (best effort, returns `{ ok, error? }`, never throws) — but see the Moss limit below before wiring it.

## Latency (dev deployment, 2026-10-24)

Measured with `sim:call` against `brazen-perch-21` (`timingsMs` from the backend; round trip from a laptop).

| Run | Backend before the LLM (`preLlm`) | LLM | Backend total |
| --- | --- | --- | --- |
| MockLlm, 14 turns, 5 scenarios | median 104 ms, p90 173 ms, max 247 ms (first request, cold) | 1–8 ms | 36–256 ms |
| Claude Haiku 5.5, `ridgeview-basic`, 6 turns | median 114 ms, max 142 ms | 1,150–1,863 ms | 1,266–1,977 ms |
| Claude Haiku 5.5, `spanish`, 4 turns | median 106 ms, max 112 ms | 1,028–2,049 ms | 1,083–2,155 ms |
| `RETRIEVER=moss` (falls back to Convex), 3 turns | 218–478 ms | — | — |

- **Target met**: ≤ 300 ms before the LLM without an optimization pass. The turn already uses two mutations and one query (`beginTurn` merges session resolve, replay check, interrupted marking, persistence, cached context, area labels and history; `completeTurn` applies every side effect).
- **Known causes**: each Convex call from the HTTP action is a round trip (~25–50 ms for `beginTurn`); retrieval (~20–90 ms warm, 200 ms cold) runs a full-text search, the area-first lookup and per-bulletin hydration (bulletin row + areas) inside one query; the first request after a deploy is cold. Danger turns finish in ~35–45 ms.
- **LLM**: Haiku 5.5 with thinking disabled and `effort: low`, JSON-schema output. The static system prompt is cached (1,921 cached input tokens on later calls); the first structured-output call after a while took 4.3 s (schema + cache write), later ones ~1.0–1.3 s. The 6 s timeout covers the cold case.
- **Moss hop**: the `"use node"` action hop plus the failed Moss load add ~120–380 ms, so Convex search stays the default.

## Known limits

- **Cartesia outbound calls are not verified live** (no credentials). The adapter follows the documented API (`X-API-Key`, `Cartesia-Version: 2026-08-14`, `notification_id` in `dynamic_variables`). Whether `dynamic_variables` reach the Line agent's `CallRequest.metadata` is unverified.
- **Moss does not work from Convex today**: the SDK's native binding cannot load in Convex's Node runtime ("Cannot find native binding", at push-time analysis and at runtime), and with this project's key the cloud query returns HTTP 503 and `loadIndex` gets 401 downloading the embedding model (index create/upsert/delete work). The import is lazy so pushes succeed; `RETRIEVER=moss` falls back to Convex.
- **ZIP codes** resolve to a state (3-digit prefix table) and the ZIP itself, not a county; county-level matching needs a ZIP→county table.
- **Spanish replies with MockLlm** are the English source text with a Spanish prefix; real Claude translates. Spanish wording in `strings.ts` needs a native-speaker review.
- **Rate-limited updates are not retried**: the attempt is stored as `failed` (`rate_limited`) and that bulletin version's dedupe key is used up; the next update notifies normally.
- **Account auth and phone-link verification are TODO**: account queries return nothing until Convex Auth is configured; `accounts:createTestAccount` stands in.
- **Area subscriptions** are matched by scanning up to 200 active area subscriptions per event (fine for the demo; index by county if it grows).
- **The update message is a template** from bulletin fields (no LLM rewrite).
- `/voice/session/start` and `/voice/session/end` return `500` on internal failure (no session or call id exists to return); only `/voice/turn` has a reply to degrade to.
