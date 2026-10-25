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
| Inbound multi-turn call (voice ⇄ backend contract) | P0 | Leia + Alonso/Hikaru | 🟡 backend ✅ (live on dev, `sim:call --all` green); agent ✅ through the real SDK runner against the dev backend (text mode); no phone number yet |
| Grounded answers with source and time | P0 | Alonso/Hikaru | ✅ enforcement + real Claude (Haiku 5.5, structured output) verified on dev; dev defaults to MockLlm |
| "I don't know yet" + unanswered questions | P0 | Alonso/Hikaru | ✅ |
| Danger path | P0 | Alonso/Hikaru | ✅ (en, es patterns + false-positive tests; needs native-speaker review) |
| Transcript + summary (consent, summary-only) | P0 | Alonso/Hikaru | ✅ summary prompt (CLAUDE_SMART_MODEL) + deterministic fallback, summary-only, batched retention purge |
| Live NWS ingestion | P0 | Dhweya | ✅ adapter (lineage, cancellations, test/exercise), fixture mode; live-ready, not yet run on the deployment |
| Fixtures (Ridgeview demo) | P0 | shared | ✅ |
| Convex search retrieval | P0 | Alonso/Hikaru | ✅ area-first + full text, per-bulletin dedupe, token budget, explainable ranking |
| Caller memory (last summary, language, area) | P1 | Alonso/Hikaru | ✅ context cached per call, "welcome back" offer, policy filter for the model, TTLs |
| Spanish | P1 | Leia + Alonso/Hikaru | 🟡 backend ✅ (Spanish replies with citations, verified with Claude); Spanish number map + keypad switch ✅ in tests and text calls; wording review ⬜; real-call STT/TTS untested; Spanish voice not chosen |
| Account association (verified phone link) | P1 | Alonso/Hikaru | 🟡 rule ✅ at start and finalize, account queries ✅; verification flow ⬜, auth ⬜ |
| More official sources (USGS, FEMA, NHC, Tsunami, InciWeb, NIFC) | P1 | Dhweya | ✅ adapters + fixtures; live-ready |
| Crisis mode | P1 | Dhweya | ✅ trigger, extend, auto-revert, mode log |
| Apify scraping of mock sites | P1 | Dhweya | 🟡 MockApify ✅, webhook ✅, v1→v2 escalation ✅; live actors wired, not yet run with a token |
| Moss retriever | P1 | Alonso/Hikaru | 🟡 adapter + sync + fallback ✅; blocked: SDK can't load in Convex, queries 503/401 (DECISIONS.md) |
| Subscriptions + outbound callbacks | P2 | Alonso/Hikaru (Leia reviews) | 🟡 matcher, rate limits, stop updates, answered questions, mock notifier ✅ (live on dev); Cartesia adapter **not verified live** |
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
- **Done (2026-10-24 backend session):** see [docs/backend.md](docs/backend.md) and [docs/backend-report.md](docs/backend-report.md). Real Claude behind `LLM_PROVIDER=anthropic` (verified on dev), merged two-mutation turn path (pre-LLM median ~105 ms on dev), rule-2 guards, area detection (ZIP / place / `detectedArea`), summaries with fallback, retention purge, subscriptions + stop updates + answered questions, Cartesia adapter from docs, Moss adapter behind the flag.
- **To do:**
  1. Human review of every string in `src/config/strings.ts` (Spanish by a native speaker).
  2. M1 with Leia: real phone call against fixtures (steps in `docs/backend-report.md`); rotate `VOICE_API_SECRET` on dev and share it.
  3. Phone-link verification flow and Convex Auth for the iOS app (`convex/accounts.ts` TODOs).
  4. Cartesia outbound live test with Leia once credentials exist (`PHONE_NOTIFIER=cartesia`).
  5. Moss: get the 503/401 explained, or run Moss outside Convex; until then Convex search.
  6. ZIP → county table if county-level matching from ZIPs matters for the demo.
- **Done when:** a real model answers the Ridgeview call with correct citations, refuses address-in-zone, says "I don't know yet" for Hillcrest Elementary, and the danger and fallback paths still pass. ✅ on dev via `sim:call` with Claude; pending on a real phone call.

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

## Next steps

Keep this list current: tick items off and add new ones as they come up. (Last updated 2026-10-24.)

1. ⬜ **Merge `cartesia/live`** into `main` (PR on GitHub), then everyone pulls and runs `npm run setup`
   (see `CLAUDE.md` → "Setup on a new machine").
2. ⬜ **First real phone call (M1):** set `SERVE_FIXTURES=true` and `npm run seed:fixtures` if not already,
   call **+1 712 600 3362** and walk the Demo script below. Check: greeting, grounded answers with source and
   time, the danger line, barge-in (talk over it), keypad 2 for Spanish, hang-up. Afterwards pull the logs:
   `~/.cartesia/bin/cartesia calls ls --agent-id agent_1iwkwy7nwEfejQJzwM75hm` and the Convex dashboard logs.
   Record end-of-speech → first-audio latency in `voice/README.md` (target ≈ 2.5 s).
3. ⬜ **Real callback (M4):** on a call from a teammate's phone, say "Please call me if the evacuation changes",
   hang up, run `npm run inject:update`, and answer the callback. Confirm the greeting carries the update and
   that the `call_request` log's `agent_call_id` equals the notification's `providerRef` (or that
   `notificationId` arrived in metadata). Only use phones whose owners agreed.
4. ⬜ When 2 and 3 pass: set `cartesiaVerifiedLive` to true, move M1/M4 to ✅, and record what was verified in
   `docs/DECISIONS.md` (outbound `from_`/`to`, whether metadata arrives, real latency).
5. ⬜ Spanish on the phone: pick a Spanish-native voice, set `VOICE_ID_ES` with `cartesia env set`, test keypad 2.
6. ⬜ Then M2 (live NWS + crisis mode), M3 (memory + Spanish), M5 (Apify, X, Moss).

## Integration milestones

| | Milestone | Status |
| --- | --- | --- |
| M0 | Skeleton green in mock mode (`npm test`, `npm run test:voice`, `sim:call` against the dev deployment) | ✅ backend pushed to dev; `sim:call --all` green |
| M1 | **A real phone call reaches the backend and gets grounded answers from fixtures** (riskiest: do first) | 🟡 number live and deployed; real call not yet made |
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

- ~~Does `cartesia deploy` accept new hosted agents?~~ Answered 2026-10-24: yes, `soterra-voice` is deployed (hosting ends Dec 1, 2026).
- Do outbound `dynamic_variables` reach `CallRequest.metadata`? What are `from_`/`to` on outbound calls? (Leia)
- ~~Cartesia outbound auth header~~ Answered 2026-10-24: `X-API-Key` works (bearer too).
- Moss inside Convex: answered — the SDK's native binding does not load in a `"use node"` action, and queries return 503/401 for this project (DECISIONS.md). (Alonso/Hikaru)
- A live Apify run against the mock sites (key names verified 2026-10-24). (Dhweya)
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
- 2026-10-24 — Ingestion module on branch `ingestion/pipeline` (Dhweya's scope; Claude). **Additive contract changes:** `NormalizedBulletin.timeBasis?` (`issued` | `page_updated` | `observed`) and `supersedesExternalIds?`; `timeBasis` on `bulletins` and `chunks`; new `Signal` schema and `signals` table; `ExtractionResult` deprecated (unused). New tables: `bulletinAliases`, `ingestionRuns`, `rawPayloads`, `systemModeLog`, `devSettings`; `sources` gains `mode`/run bookkeeping (`lastFetchedAt` replaced by `lastRunAt`); `mockSites` gains `variant`. Chunks now start with a one-sentence header (title — issuer — areas — time with basis). Fixture bulletins trigger crisis mode only when `SERVE_FIXTURES=true`. Mock sites moved to `fixtures/mock-sites/v1|v2`; `/mock-sites/*` handler moved to `convex/mockSites.ts`. **Backend to handle:** (1) speak `timeBasis` ("as of when we checked at 3:05 PM" for `observed`, "the page was last updated at …" for `page_updated`) — `RetrievedChunk` and `convex/retrieval.ts` don't carry it yet and grounding always says "issued"; (2) `/health` can include `internal.ingestionRuns.sourceStatus`; (3) `signals` are operator-only data, never retrieval input.
- 2026-10-24 — Voice agent on branch `voice/agent` (Leia's scope; Claude). No contract changes. Behaviour the backend team should know: one filler line after 1.2 s of backend silence; 8 s turn budget; 3 consecutive failures end the call with reason `error`; repeat requests are answered locally (no `/voice/turn`, so they are not in the transcript); `languageHint` is sent only for numbers in `LANGUAGE_BY_DIALED_NUMBER`, so the caller's saved language decides otherwise; keypad 2/1 changes the language sent on later turns without a new session start. Cartesia documents outbound `dynamic_variables`, not `metadata`, so `notificationId` reaching the agent is unconfirmed.
- 2026-10-24 — Cartesia live (branch `cartesia/live`; Claude for Hikaru). Code agent `soterra-voice` (`agent_1iwkwy7nwEfejQJzwM75hm`) deployed and live on **+1 712 600 3362**; the Playground agent `soterra-agent` keeps its prompt but no number. Dev deployment: `PHONE_NOTIFIER=cartesia` + `CARTESIA_*` set, so `inject:update` now places **real** callbacks to subscribers. **Additive contract change:** `SessionStartRequest.providerAgentCallId` (zod, golden fixture, Python mirror); backend ties outbound calls to notifications by it (`notifications.by_providerRef`). Voice: outbound detected by `SOTERRA_PHONE_NUMBERS`; masked `call_request` log; `main.py` builds `VoiceAgentApp` (hosted build requirement). Backend pushed to the dev deployment from this branch.
- 2026-10-24 — Voice profile and callback check (Alonso's scope; Claude). Additive: `CallerContext.identity` gains `verified_phone` (a callback we placed to the caller's own number; that call only); storage `callers.profileNeeds`/`profileUpdatedAt`, `calls.verifiedPhone`/`pendingAction`/`forgotten`, `notifications.purpose` and index `by_recipientPhone_and_createdAt`. New spoken strings (Spanish needs native review): `verify*`, `profile*`, `recap*`, `forget*`. The greeting no longer says "welcome back": history is only given when asked for. Personal commands ("remember I use a wheelchair", "what do you know about me", "what did we talk about last time", "forget me") need a verified call; on a plain call the agent ends the call and rings the number back. **The callback itself is not verified live** (Cartesia outbound is untested); the logic is covered by `convex/tests/profile.test.ts`. No voice contract fields changed. (Claude, for Alonso)
- 2026-10-24 — Team workflow: `npm run setup` / `npm run check` (`scripts/setup.sh`, `scripts/dev-check.sh`), a Claude Code SessionStart hook that runs the check, `CLAUDE.md` "Soterra — team workflow" (live ids, what to run after changing code), and "Next steps" above. (Claude, for Hikaru)
- 2026-10-24 — Time basis spoken. Additive, optional: `RetrievedChunk.timeBasis?` (`issued` | `page_updated` | `observed`; golden fixture `retrieved-chunk.json`). Scraped pages are now attributed "as of our last check on …" (`observed`) or "the page was last updated on …" (`page_updated`) instead of "issued" (`attributionObserved`, `attributionPageUpdated` in `src/config/strings.ts`; Spanish needs native review); the model prompt carries `timeBasis` on each source. Also: Apify runs request `APIFY_MEMORY_MB` (default 2048) so concurrent runs fit the free plan's 16 GB. No voice contract fields changed (the Python mirror ignores the new field). (Claude, for Alonso)
- 2026-10-24 — Corroboration tiers (branch `dhweya/ingestion`; Claude for Dhweya). **Additive contract change:** `RetrievedChunk.corroboration?: { tier: "confirmed" | "single" | "differs", sources: string[] }` (`src/contracts/orchestration.ts`, golden fixture `retrieved-chunk.json`; the voice agent never sees chunks, so no Python mirror). Retrieval compares candidates in code (`src/retrieval/corroboration.ts`, no model): a chunk is confirmed when a source in a *different independence group* reports the same incident (compatible hazard, overlapping area, within 72 h, incident name in both); "differs" when both state acres or containment and disagree (>25 % and >50 acres, or ≥15 points). Groups live in `src/ingestion/sources.ts` (`INDEPENDENCE_GROUPS`: InciWeb + WFIGS share `nifc-irwin`; NWS alerts and NWS X accounts share `nws`); `X_ALLOWLIST` takes an optional 4th segment, `handle:Issuer:CA:group`. Grounding appends "Also reported by {sources}." or "Sources differ on the figures." after the attribution (`src/config/strings.ts`, en + es, **Spanish needs native review**); a single source says nothing extra, and confidence never suppresses an answer. **Backend to know:** the sentence is added by `enforceGrounding`, never by the model. Limit: only candidates retrieved for this question are compared.

- 2026-10-24 — App sign-in by code call (Alonso's scope; Claude, replacing the unauthenticated demo below). `accounts:saveProfile` and `accounts:getProfileByPhone` are **removed**: they took a bare phone number, let anyone read or replace a profile and marked the link verified. The app now calls `requestPhoneCode` (Soterra phones the number and reads a 6-digit code), `verifyPhoneCode` (returns a session token), then `getMyProfile` / `saveMyProfile` with the token, and `signOut`. Details and error values in docs/backend.md. **iOS team:** nothing in the app called the old functions yet; build the sign-in screen on these. A call from a linked number can use the profile to tailor answers but still needs the callback check for anything read back (`verified_account` is now tailoring only; `verified_phone` unlocks commands). Additive schema: `phoneChallenges`, `appSessions`, `phoneLinks.verifiedBy`, `notifications.purpose: "app_code"`. Also `requestVerifiedCall({ token })`: the app's "Call me" button rings the linked number and that call is the callback check (verified once); Also `armAppCall({ token })` for "Call Soterra" (the next inbound call from the linked number within 2 minutes is verified, once). Update callbacks now count as verified (a call to the real number); an ordinary inbound call and the sign-in code call do not.
- 2026-10-24 — App profile by phone (demo, no auth, since replaced; Claude for Hikaru). **Additive contract change:** `CallerContext.personalContext?` (free text, clipped to 1,000 chars, `verified_account` only; the voice agent never sees CallerContext, so no Python mirror; golden fixture unchanged since it is `caller_id`). `accounts` gains `personalContext`, `homeZip`, `emergencyContact`. Public `accounts.saveProfile({ phone, displayName?, preferredLanguage?, personalContext?, homeZip?, emergencyContact? })` creates or replaces the profile and a **verified** phone link; `accounts.getProfileByPhone({ phone })` reads it. Calls from that number get `verified_account`, the profile in the prompt, and the home ZIP as the area when none is remembered. **Insecure by design for the demo:** anyone with a number can read or replace its profile; replace with auth + phone verification before real users.
