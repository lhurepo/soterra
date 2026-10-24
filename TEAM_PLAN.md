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
2. **Say "I don't know yet."** ✅ Uncited answers become `no_info` + an unanswered question. Never guess address-in-zone or shelter status (deterministic guards in `src/orchestration/grounding.ts`).
3. **Danger first.** ✅ Deterministic check before any LLM call (`src/orchestration/danger.ts`). Never say or imply help was sent.
4. **Untrusted inputs are data.** ✅ Unverified content is never chunked or retrievable; scraped text is passed to models as labeled data.
5. **A phone number is not an account.** ✅ On caller ID alone the model never sees stored needs or past-summary text, only language, a county-level area and public incidents (`src/memory/callerContext.ts`).
6. **The hotline needs nothing optional.** ✅ No account, Moss, Apify, SMS or callbacks are needed for a call.
7. **Fail safe.** ✅ Backend failures → `degraded` fallback with the 911 line; voice agent speaks a fixed fallback on any non-200 or timeout.

## Features

✅ in skeleton · 🟡 stub or mock · ⬜ not started

| Feature | Priority | Owner | Status |
| --- | --- | --- | --- |
| Inbound multi-turn call (voice ⇄ backend contract) | P0 | Leia + Alonso/Hikaru | 🟡 backend ✅ (live on dev, `sim:call --all` green), agent ✅ vs mock; no phone number yet |
| Grounded answers with source and time | P0 | Alonso/Hikaru | ✅ enforcement + real Claude (Haiku 5.5, structured output) verified on dev; dev defaults to MockLlm |
| "I don't know yet" + unanswered questions | P0 | Alonso/Hikaru | ✅ |
| Danger path | P0 | Alonso/Hikaru | ✅ (en, es patterns + false-positive tests; needs native-speaker review) |
| Transcript + summary (consent, summary-only) | P0 | Alonso/Hikaru | ✅ summary prompt (CLAUDE_SMART_MODEL) + deterministic fallback, summary-only, batched retention purge |
| Live NWS ingestion | P0 | Dhweya | 🟡 adapter stub with request + mapping notes |
| Fixtures (Ridgeview demo) | P0 | shared | ✅ |
| Convex search retrieval | P0 | Alonso/Hikaru | ✅ area-first + full text, per-bulletin dedupe, token budget, explainable ranking |
| Caller memory (last summary, language, area) | P1 | Alonso/Hikaru | ✅ context cached per call, "welcome back" offer, policy filter for the model, TTLs |
| Spanish | P1 | Leia + Alonso/Hikaru | 🟡 backend ✅ (Spanish replies with citations, verified with Claude); wording review ⬜; voice/STT switch untested |
| Account association (verified phone link) | P1 | Alonso/Hikaru | 🟡 rule ✅ at start and finalize, account queries ✅; verification flow ⬜, auth ⬜ |
| More official sources (USGS, FEMA, NHC, Tsunami, InciWeb, NIFC) | P1 | Dhweya | 🟡 registry + stubs |
| Crisis mode | P1 | Dhweya | 🟡 trigger stub + tick ✅ |
| Apify scraping of mock sites | P1 | Dhweya | 🟡 webhook route + placeholders; mock sites served ✅ |
| Moss retriever | P1 | Alonso/Hikaru | 🟡 adapter + sync + fallback ✅; blocked: SDK can't load in Convex, queries 503/401 (DECISIONS.md) |
| Subscriptions + outbound callbacks | P2 | Alonso/Hikaru (Leia reviews) | 🟡 matcher, rate limits, stop updates, answered questions, mock notifier ✅ (live on dev); Cartesia adapter **not verified live** |
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
- **Done (2026-10-24 backend session):** see [docs/backend.md](docs/backend.md) and [docs/backend-report.md](docs/backend-report.md). Real Claude behind `LLM_PROVIDER=anthropic` (verified on dev), merged two-mutation turn path (pre-LLM median ~105 ms on dev), rule-2 guards, area detection (ZIP / place / `detectedArea`), summaries with fallback, retention purge, subscriptions + stop updates + answered questions, Cartesia adapter from docs, Moss adapter behind the flag.
- **To do:**
  1. Human review of every string in `src/config/strings.ts` (Spanish by a native speaker).
  2. M1 with Leia: real phone call against fixtures (steps in `docs/backend-report.md`); rotate `VOICE_API_SECRET` on dev and share it.
  3. Phone-link verification flow and Convex Auth for the iOS app (`convex/accounts.ts` TODOs).
  4. Cartesia outbound live test with Leia once credentials exist (`PHONE_NOTIFIER=cartesia`).
  5. Moss: get the 503/401 explained, or run Moss outside Convex; until then Convex search.
  6. ZIP → county table if county-level matching from ZIPs matters for the demo.
- **Done when:** a real model answers the Ridgeview call with correct citations, refuses address-in-zone, says "I don't know yet" for Hillcrest Elementary, and the danger and fallback paths still pass. ✅ on dev via `sim:call` with Claude; pending on a real phone call.

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
| M0 | Skeleton green in mock mode (`npm test`, `npm run test:voice`, `sim:call` against the dev deployment) | ✅ backend pushed to dev; `sim:call --all` green |
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
- Moss inside Convex: answered — the SDK's native binding does not load in a `"use node"` action, and queries return 503/401 for this project (DECISIONS.md). (Alonso/Hikaru)
- Apify `headersTemplate` key and dataset id in the payload template. (Dhweya)
- Anthropic latency with Haiku 5.5: ~1.0–2.0 s per turn on dev via `sim:call`; still to measure on a real phone call. (Alonso/Hikaru)
- Ink 2 STT covers en/fr/hi/ja/es only: Mandarin and Punjabi from the overview are out.

## Demo script

Setup: `SERVE_FIXTURES=true`, `npm run seed:fixtures`, call from a phone whose number is shown.

| # | Caller says | Expected |
| --- | --- | --- |
| 1 | "What's going on with the Ridgeview Fire?" | Grounded answer (1,200 acres, 10% contained) ending "That's from Sonoma County Fire Information (Demo), updated October 24 at 2:10 PM Pacific." |
| 2 | "Is 412 Oak Lane inside the evacuation zone?" | "I can't confirm whether a specific address is inside a zone," then the listed zones SON-3A and SON-3B, with source and time. |
| 3 | "Are there shelters that take pets?" | Ridgeview Community Center takes pets in crates; numbers and "checked at 2:30 PM" with source. |
| 4 | "Is Hillcrest Elementary open as a shelter?" | "I don't know yet… I've saved your question." (unanswered question recorded) |
| 5 | "Please call me if the evacuation changes." | Confirms a callback to this number for the next 24 hours and how to stop ("say stop updates") (subscription created). |
| 6 | "Thanks, goodbye." | Goodbye with the 911 line; call ends; summary written. |
| — | Presenter runs `npm run inject:update` | Zone SON-3A becomes an Evacuation **Order**; bulletin event → notification. |
| 7 | Soterra calls back (with `PHONE_NOTIFIER=cartesia`, not verified live) | "This is Soterra calling with the update you asked for. Update from Sonoma County Emergency Management (Demo)…: Evacuation Order for zone SON-3A…", then how to stop updates and the 911 line |
| — | Separately: "I'm trapped, the fire is at my house" | First words: "If you are in immediate danger, hang up and dial 911 now." |

## Changelog

- 2026-10-24 — Skeleton created on branch `skeleton/shared-codebase`: contracts v1, schema, mock end-to-end path, voice agent, fixtures, docs, 77 Vitest + 22 pytest tests. (Claude, for Hikaru)
- 2026-10-24 — Backend module built on branch `backend/full-module` (docs/backend.md, docs/backend-report.md). Contract additions, all optional: `CallerContext.recentIncidentKeys?: string[]` and `RetrievedChunk.chunkIndex?: number` (`src/contracts/orchestration.ts`, golden fixtures `caller-context.json`, `retrieved-chunk.json`); `internal.retrieval.search` accepts an optional `contextText`; `/health` gains flags `cartesiaVerifiedLive` and `mockLlmFailureMode`; `timingsMs` now reports `context`, `retrieval`, `preLlm`, `llm`, `total`. No voice contract fields changed (Python mirror untouched). Behaviour changes: canonical wording in `src/config/strings.ts` (fallback line changed: sync `voice/soterra_voice/phrases.py`), subscriptions last 24 h, anonymous transcripts 7 days. (Claude, for Alonso)
