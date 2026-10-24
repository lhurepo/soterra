# Soterra team plan

Living document. Update your own section and the status column as you go; add a changelog line for anything shared.

## Soterra in five lines

1. A caller dials a normal US number and talks with an AI assistant about a disaster near them.
2. Answers come only from official, timestamped sources, and say which source and when.
3. Missing information gets "I don't know yet", and the question is saved.
4. Danger gets "hang up and dial 911 now" before anything else.
5. It remembers callers without accounts, speaks English then Spanish, and can call back when things change.

### Rules

Enforced in code where marked ✅.

1. **Grounded or silent.** ✅ An `answer` must cite a chunk retrieved this turn (`src/orchestration/grounding.ts`); every answer ends with source and time.
2. **Say "I don't know yet."** ✅ Uncited answers become `no_info` + an unanswered question. Never guess address-in-zone or shelter status (prompt + mock today; TODO(B) harden).
3. **Danger first.** ✅ Deterministic check before any LLM call (`src/orchestration/danger.ts`). Never say or imply help was sent.
4. **Untrusted inputs are data.** ✅ Unverified content is never chunked or retrievable; scraped text is passed to models as labeled data.
5. **A phone number is not an account.** ✅ On caller ID alone the model never sees stored needs or past summaries (`src/memory/callerContext.ts`).
6. **The hotline needs nothing optional.** ✅ No account, Moss, Apify, SMS or callbacks are needed for a call.
7. **Fail safe.** ✅ Backend failures → `degraded` fallback with the 911 line; voice agent speaks a fixed fallback on any non-200 or timeout.

## Features

✅ in skeleton · 🟡 stub or mock · ⬜ not started

| Feature | Priority | Owner | Status |
| --- | --- | --- | --- |
| Inbound multi-turn call (voice ⇄ backend contract) | P0 | Leia + Alonso/Hikaru | 🟡 backend ✅; agent ✅ through the real SDK runner against the dev backend (text mode); no phone number yet |
| Grounded answers with source and time | P0 | Alonso/Hikaru | 🟡 enforcement ✅, real model ⬜ (MockLlm) |
| "I don't know yet" + unanswered questions | P0 | Alonso/Hikaru | ✅ |
| Danger path | P0 | Alonso/Hikaru | ✅ (en, es patterns; needs native-speaker review) |
| Transcript + summary (consent, summary-only) | P0 | Alonso/Hikaru | 🟡 flow ✅, real summary prompt ⬜ |
| Live NWS ingestion | P0 | Dhweya | 🟡 adapter stub with request + mapping notes |
| Fixtures (Ridgeview demo) | P0 | shared | ✅ |
| Convex search retrieval | P0 | Alonso/Hikaru | ✅ |
| Caller memory (last summary, language, area) | P1 | Alonso/Hikaru | 🟡 stored ✅, used only for verified accounts |
| Spanish | P1 | Leia + Alonso/Hikaru | 🟡 Spanish number map + keypad switch ✅ in tests and text calls; real-call STT/TTS untested; Spanish voice not chosen |
| Account association (verified phone link) | P1 | Alonso/Hikaru | 🟡 tables + rule ✅, verification flow ⬜, auth ⬜ |
| More official sources (USGS, FEMA, NHC, Tsunami, InciWeb, NIFC) | P1 | Dhweya | 🟡 registry + stubs |
| Crisis mode | P1 | Dhweya | 🟡 trigger stub + tick ✅ |
| Apify scraping of mock sites | P1 | Dhweya | 🟡 webhook route + placeholders; mock sites served ✅ |
| Moss retriever | P1 | Alonso/Hikaru | 🟡 placeholder |
| Subscriptions + outbound callbacks | P2 | Alonso/Hikaru (Leia reviews) | 🟡 matcher + mock notifier ✅, Cartesia call untested |
| X ingestion | P2 | Dhweya | ⬜ (allowlist + trust rules ✅) |
| SMS | P2 | — | ⬜ provider not chosen |
| Streaming turns (`/voice/turn/stream`) | P2 | Alonso/Hikaru + Leia | ⬜ reserved |
| Zone check (point in official polygon) | P2 | — | ⬜ geometry is stored when feeds give it |

## Architecture

Contracts: [live call](docs/contracts/live-call.md) · [ingestion and retrieval](docs/contracts/ingestion-retrieval.md) · decisions and verification: [DECISIONS.md](docs/DECISIONS.md)

```
LIVE CALL
Caller ─▶ Cartesia number ─▶ voice/ (Python Line agent)                                [Leia]
            ⇄ POST /voice/session/start · /voice/turn · /voice/session/end (Bearer secret)
          ─▶ convex/voice.ts ─▶ src/orchestration/pipeline.ts                          [Alonso, Hikaru]
               persist turn → danger check → caller context → retrieval (convex/retrieval.ts)
               → LLM (MockLlm | Anthropic) → grounding → side effects → persist reply
          ◀─ { reply, kind, citations, endCall }

INGESTION                                                                               [Dhweya]
cron tick (1 min) → due sources → adapters (direct) | Apify → /ingest/apify
  → normalize → validate → upsertBulletins (dedupe, versions, chunks, areas, events)
  → bulletinEvents → subscriptions.matchEvents → notifications → Cartesia outbound call

AFTER A CALL                                                                            [Alonso, Hikaru]
session end | sweeper → finalizeCall → summarizeCall (LLM) → saveSummary → caller memory; retention cron
```

## People

### Leia — voice (`voice/`)

- **Receives:** Cartesia call events. **Returns:** speech. Talks to the backend only through the [live-call contract](docs/contracts/live-call.md).
- **Built (branch `voice/agent`, see [voice/README.md](voice/README.md)):** config with fail-fast env; `Backend` protocol (httpx client with typed errors + `MockBackendClient` with delays and faults); pre-call session start and STT/TTS language + voice; greeting with an uninterruptible transcription notice; turns with one filler after 1.2 s; barge-in cancellation and `interruptedPrevious`; fallback with 911, call ends after 3 failures; repeat; keypad language switch; outbound callbacks; masked logs; `scripts/harness_call.py` (whole call through the real SDK app, no Cartesia). Verified in text mode against the dev backend: the demo script, Spanish, the failure cutoff.
- **Next:**
  1. `cartesia init` / `env set` / `deploy` (or self-host + `cartesia connect`), provision a number, place a real call through the Ridgeview demo script (README checklist).
  2. Log the first real `call_request` (masked) on inbound and outbound calls: `from_`, `to`, `metadata`, pre-call metadata pass-through.
  3. Measure end of speech → first audio against the 2.5 s target; record it in the README.
  4. Choose and record a Spanish voice (`VOICE_ID_ES`); test with a Spanish speaker; decide on `OFFER_SPANISH_DTMF`.
  5. Outbound callback with Alonso/Hikaru: confirm whether `notificationId` reaches the agent (Cartesia documents only `dynamic_variables`).
- **Done when:** a real phone call gets grounded answers from fixtures, a backend outage produces the fallback line, and barge-in works.

### Alonso and Hikaru — backend (`src/orchestration`, `src/retrieval`, `src/memory`, `src/notifications`, `src/providers/{llm,moss,cartesia}`, `src/config`, `convex/{voice,calls,callers,accounts,memory,retrieval,unanswered,health,subscriptions,notifications}.ts`)

- **Receives:** `/voice/*` requests; chunks from Dhweya's tables. **Returns:** turn replies, summaries, subscriptions, notifications.
- **Can rely on now:** fixtures through `upsertBulletins`, `MockLlm`, the end-to-end test in `convex/tests/e2e.test.ts`.
- **First hour:** replace `MockLlm` with real Claude behind `LLM_PROVIDER=anthropic` (`src/providers/llm/anthropic.ts`, `src/orchestration/prompt.ts`: structured `AnswerDraft` output), run `sim:call` against it, and keep the e2e test green with the mock.
- **To do:**
  1. Real turn prompt; JSON/structured output; measure Haiku 5.5 vs Sonnet 5.5 latency (`timingsMs`).
  2. Harden rule 2: deterministic checks for address-in-zone and shelter-open claims in non-answer kinds.
  3. Real summary prompt (≤ 80 words, neutral).
  4. Area detection from the utterance (`detectedArea`) → `calls.knownArea`.
  5. Caller memory policy and phone-link verification flow; account auth (`convex/auth.config.ts`) for the iOS app.
  6. Moss retriever behind `RETRIEVER=moss` with Convex fallback (measure cold load first).
  7. Cartesia outbound notifier live test with Leia; "stop calls" flow; responder answers → `answer_available`.
- **Done when:** a real model answers the Ridgeview call with correct citations, refuses address-in-zone, says "I don't know yet" for Hillcrest Elementary, and the danger and fallback paths still pass.

### Dhweya — ingestion (`src/ingestion`, `src/providers/apify`, `convex/{ingestion,sources,systemState}.ts`)

- **Receives:** official feeds, Apify datasets. **Returns:** `NormalizedBulletin[]` into `upsertBulletins`; chunks, areas and events for the backend.
- **Can rely on now:** `upsertBulletins` (naive chunking), the source registry, raw samples in `fixtures/raw/`, mock sites at `/mock-sites/*`.
- **First hour:** take live NWS alerts for CA end to end: implement `normalizeNwsAlerts` (`src/ingestion/adapters/nws.ts`, mapping notes in the file), test it on `fixtures/raw/nws-alerts.json`, set `NWS_USER_AGENT`, enable `nws_alerts`, watch bulletins appear.
- **To do:**
  1. NWS: stable `externalId` from VTEC, cancellations, test/exercise filtering, geometry to file storage when large.
  2. Better chunking (shelter rows, sentence windows).
  3. Crisis trigger tuning; use unverified spikes as a polling signal only.
  4. Apify: run an actor against `/mock-sites/*`, process the webhook dataset, LLM extraction with quoted spans, quarantine failures.
  5. USGS, InciWeb, NIFC, NHC, Tsunami, OpenFEMA adapters (priority by demo value).
  6. X via Apify (allowlist → `official_social`); best-effort Moss sync of changed chunks.
- **Done when:** live NWS CA alerts are searchable within one tick of publication, updates create versions and events, and nothing unverified is ever retrievable.

## Integration milestones

| | Milestone | Status |
| --- | --- | --- |
| M0 | Skeleton green in mock mode (`npm test`, `npm run test:voice`, `sim:call` against the dev deployment) | ✅ tests green; `sim:call` needs one `npx convex dev` push |
| M1 | **A real phone call reaches the backend and gets grounded answers from fixtures** (riskiest: do first) | ⬜ |
| M2 | Live NWS data + crisis mode | ⬜ |
| M3 | Memory + Spanish | ⬜ |
| M4 | Subscriptions + an outbound callback | ⬜ |
| M5 | Apify, X, Moss | ⬜ |
| — | Demo freeze | time TBD |

## Contract change protocol

- **Additive, optional fields:** fine. Update the zod schema in `src/contracts/`, the Convex validator if stored (`convex/validators.ts`, `convex/schema.ts`), add or update a golden fixture in `fixtures/contracts/` (+ `manifest.json`), add a changelog line below, and tell the affected owners. Leia mirrors voice changes in `voice/soterra_voice/models.py` (which ignores unknown fields until then).
- **Breaking changes** (rename, remove, type change, new required field): every owner agrees first, then bump `CONTRACT_VERSION` in `src/contracts/version.ts` and `voice/soterra_voice/models.py`.
- Never edit another owner's internals; ask, or leave a `TODO(<owner>)`.
- `npm test && npm run typecheck && npm run test:voice` before pushing anything shared.

## Open questions and verification

See [DECISIONS.md](docs/DECISIONS.md). Still unverified:

- Does `cartesia deploy` accept new hosted agents before the Dec 1, 2026 shutdown? (Leia — not tested yet: no Cartesia credentials in this environment)
- Do outbound `dynamic_variables` reach `CallRequest.metadata`? What are `from_`/`to` on outbound calls? (Leia)
- Cartesia outbound auth header (`X-API-Key` in examples vs bearer in the spec). (Alonso/Hikaru)
- Moss cold-load time in a `"use node"` action. (Alonso/Hikaru)
- Apify `headersTemplate` key and dataset id in the payload template. (Dhweya)
- Anthropic latency with Haiku 5.5 on a real call. (Alonso/Hikaru)
- Ink 2 STT covers en/fr/hi/ja/es only: Mandarin and Punjabi from the overview are out.

## Demo script

Setup: `SERVE_FIXTURES=true`, `npm run seed:fixtures`, call from a phone whose number is shown.

| # | Caller says | Expected |
| --- | --- | --- |
| 1 | "What's going on with the Ridgeview Fire?" | Grounded answer (1,200 acres, 10% contained) ending "That's from Sonoma County Fire Information (Demo), updated October 24 at 2:10 PM Pacific." |
| 2 | "Is 412 Oak Lane inside the evacuation zone?" | "I can't confirm whether a specific address is inside a zone," then the listed zones SON-3A and SON-3B, with source and time. |
| 3 | "Are there shelters that take pets?" | Ridgeview Community Center takes pets in crates; numbers and "checked at 2:30 PM" with source. |
| 4 | "Is Hillcrest Elementary open as a shelter?" | "I don't know yet… I've saved your question." (unanswered question recorded) |
| 5 | "Please call me if the evacuation changes." | Confirms a callback to this number for up to seven days (subscription created). |
| 6 | "Thanks, goodbye." | Goodbye with the 911 line; call ends; summary written. |
| — | Presenter runs `npm run inject:update` | Zone SON-3A becomes an Evacuation **Order**; bulletin event → notification. |
| 7 | Soterra calls back (with `PHONE_NOTIFIER=cartesia`) | "This is Soterra calling with the update you asked for. Update from Sonoma County Emergency Management (Demo)…: Evacuation Order for zone SON-3A…" |
| — | Separately: "I'm trapped, the fire is at my house" | First words: "If you are in immediate danger, hang up and dial 911 now." |

## Changelog

- 2026-10-24 — Skeleton created on branch `skeleton/shared-codebase`: contracts v1, schema, mock end-to-end path, voice agent, fixtures, docs, 77 Vitest + 22 pytest tests. (Claude, for Hikaru)
- 2026-10-24 — Voice agent on branch `voice/agent` (Leia's scope; Claude). No contract changes. Behaviour the backend team should know: one filler line after 1.2 s of backend silence; 8 s turn budget; 3 consecutive failures end the call with reason `error`; repeat requests are answered locally (no `/voice/turn`, so they are not in the transcript); `languageHint` is sent only for numbers in `LANGUAGE_BY_DIALED_NUMBER`, so the caller's saved language decides otherwise; keypad 2/1 changes the language sent on later turns without a new session start. Cartesia documents outbound `dynamic_variables`, not `metadata`, so `notificationId` reaching the agent is unconfirmed.
