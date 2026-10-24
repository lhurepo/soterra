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
| Inbound multi-turn call (voice ⇄ backend contract) | P0 | Leia + Alonso/Hikaru | 🟡 backend ✅, agent ✅ vs mock; no phone number yet |
| Grounded answers with source and time | P0 | Alonso/Hikaru | 🟡 enforcement ✅, real model ⬜ (MockLlm) |
| "I don't know yet" + unanswered questions | P0 | Alonso/Hikaru | ✅ |
| Danger path | P0 | Alonso/Hikaru | ✅ (en, es patterns; needs native-speaker review) |
| Transcript + summary (consent, summary-only) | P0 | Alonso/Hikaru | 🟡 flow ✅, real summary prompt ⬜ |
| Live NWS ingestion | P0 | Dhweya | ✅ adapter (lineage, cancellations, test/exercise), fixture mode; live-ready, not yet run on the deployment |
| Fixtures (Ridgeview demo) | P0 | shared | ✅ |
| Convex search retrieval | P0 | Alonso/Hikaru | ✅ |
| Caller memory (last summary, language, area) | P1 | Alonso/Hikaru | 🟡 stored ✅, used only for verified accounts |
| Spanish | P1 | Leia + Alonso/Hikaru | 🟡 phrases ✅, voice/STT switch untested |
| Account association (verified phone link) | P1 | Alonso/Hikaru | 🟡 tables + rule ✅, verification flow ⬜, auth ⬜ |
| More official sources (USGS, FEMA, NHC, Tsunami, InciWeb, NIFC) | P1 | Dhweya | ✅ adapters + fixtures; live-ready |
| Crisis mode | P1 | Dhweya | ✅ trigger, extend, auto-revert, mode log |
| Apify scraping of mock sites | P1 | Dhweya | 🟡 MockApify ✅, webhook ✅, v1→v2 escalation ✅; live actors wired, not yet run with a token |
| Moss retriever | P1 | Alonso/Hikaru | 🟡 placeholder |
| Subscriptions + outbound callbacks | P2 | Alonso/Hikaru (Leia reviews) | 🟡 matcher + mock notifier ✅, Cartesia call untested |
| X ingestion | P2 | Dhweya | 🟡 fixture mode ✅ (allowlist → official_social, others → signals, burst → early poll); live actor not enabled |
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
- **Can rely on now:** `MockBackendClient` (`BACKEND_MODE=mock`), the real backend in mock mode (`npm run sim:call` proves it), golden fixtures in `fixtures/contracts/`.
- **First hour:** deploy a hello-world Line agent on a real phone number (`cartesia deploy`; if new hosted deploys are refused, self-host and `cartesia connect`), then make it call `GET /health` and say the result.
- **To do:**
  1. Deploy `voice/` with `BACKEND_MODE=http` against the dev deployment; place a real call through the Ridgeview scenario.
  2. Log `call_request` on real inbound and outbound calls; confirm `from_`, `to`, `metadata` (see DECISIONS "still unverified").
  3. Measure end-of-speech → first audio; report against the 2.5 s budget.
  4. Spanish: voice choice, `AgentUpdateCall(language="es", voice_id=...)`, test with a Spanish speaker.
  5. Outbound callback call with Alonso/Hikaru (review `src/providers/cartesia/outbound.ts`).
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

### Dhweya — ingestion (`src/ingestion`, `src/providers/apify`, `convex/{ingestion,ingestionRuns,sources,signals,systemState,mockSites}.ts`)

- **Receives:** official feeds, Apify datasets. **Returns:** `NormalizedBulletin[]` into `upsertBulletins`; chunks, areas and events for the backend.
- **Built (branch `ingestion/pipeline`, see [docs/ingestion.md](docs/ingestion.md)):** source registry with fixture/live modes, tick with crisis intervals, Apify floor and backoff; NWS/USGS/FEMA/NHC/Tsunami/InciWeb/WFIGS adapters; Apify client + MockApify + webhook; mock sites v1/v2 with `npm run ingest:escalate`; quote-verified LLM extraction (+ deterministic mock); shelter parser; X routing and signals; crisis mode; Moss sync hook; raw payload retention; per-source status query.
- **Next:**
  1. M2 on the dev deployment: `NWS_USER_AGENT`, enable `nws_alerts` live, watch a tick ingest CA alerts.
  2. `npm run ingest:apify-mock-sites` with a real `APIFY_TOKEN`; confirm the WCC/Cheerio output matches the fixtures.
  3. Real extraction with `LLM_PROVIDER=anthropic` on the mock county page; tune the prompt.
  4. Real `X_ALLOWLIST` handles; decide whether X live is worth the actor's cost and terms.
  5. Gazetteers for states beyond CA; a real DisasterAssistance.gov page.
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

- Does `cartesia deploy` accept new hosted agents before the Dec 1, 2026 shutdown? (Leia)
- Do outbound `dynamic_variables` reach `CallRequest.metadata`? What are `from_`/`to` on outbound calls? (Leia)
- Cartesia outbound auth header (`X-API-Key` in examples vs bearer in the spec). (Alonso/Hikaru)
- Moss cold-load time in a `"use node"` action. (Alonso/Hikaru)
- A live Apify run against the mock sites (key names verified 2026-10-24). (Dhweya)
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
- 2026-10-24 — Ingestion module on branch `ingestion/pipeline` (Dhweya's scope; Claude). **Additive contract changes:** `NormalizedBulletin.timeBasis?` (`issued` | `page_updated` | `observed`) and `supersedesExternalIds?`; `timeBasis` on `bulletins` and `chunks`; new `Signal` schema and `signals` table; `ExtractionResult` deprecated (unused). New tables: `bulletinAliases`, `ingestionRuns`, `rawPayloads`, `systemModeLog`, `devSettings`; `sources` gains `mode`/run bookkeeping (`lastFetchedAt` replaced by `lastRunAt`); `mockSites` gains `variant`. Chunks now start with a one-sentence header (title — issuer — areas — time with basis). Fixture bulletins trigger crisis mode only when `SERVE_FIXTURES=true`. Mock sites moved to `fixtures/mock-sites/v1|v2`; `/mock-sites/*` handler moved to `convex/mockSites.ts`. **Backend to handle:** (1) speak `timeBasis` ("as of when we checked at 3:05 PM" for `observed`, "the page was last updated at …" for `page_updated`) — `RetrievedChunk` and `convex/retrieval.ts` don't carry it yet and grounding always says "issued"; (2) `/health` can include `internal.ingestionRuns.sourceStatus`; (3) `signals` are operator-only data, never retrieval input.
