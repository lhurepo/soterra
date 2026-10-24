# Backend build report (2026-10-24)

Branch `backend/full-module` (created from `main`; nothing committed or pushed). Reference: [backend.md](backend.md). Decisions and open questions: [DECISIONS.md](DECISIONS.md). Plan: [backend-plan.md](backend-plan.md).

## Result

- `npm test`: **237 passed**, 1 skipped (the optional live smoke test; it also passed when run with `RUN_LIVE_TESTS=1`). `npm run typecheck`: clean. No test needs the network.
- Pushed to the **dev** deployment (`brazen-perch-21`) only. `npm run sim:call -- --all` is green there with MockLlm, and the Ridgeview and Spanish calls were also run against real Claude.
- Backend work before the LLM on dev: **median 104 ms, p90 173 ms, max 247 ms** (cold) with MockLlm; **84–142 ms** with Claude. That is under the 300 ms target, so no optimization pass was needed. Claude Haiku 5.5 takes ~1.0–2.0 s per turn.

## What was built (slices A–I)

| Slice | What |
| --- | --- |
| A Voice API | `/voice/session/start`, `/voice/turn`, `/voice/session/end`, `/health` per the contract: bearer auth, zod, error envelope, idempotent start and turns, lazy start, interrupted marking, per-stage `timingsMs`, greetings (welcome, 911 line, one-sentence transcription notice, "welcome back" offer; outbound = the update + how to stop). A turn is `beginTurn` (one mutation) → retrieval (one query) → LLM → `completeTurn` (one mutation, all side effects). After validation, any internal failure → 200 + canonical fallback + `degraded: true`. |
| B Identity and memory | E.164 normalization; withheld caller = ephemeral, no memory, callbacks declined; `accountId` only via a verified phone link, at start and again at finalize; `buildCallerContext` (≤ ~300 tokens, cached on the call); caller memory updated at finalize (language, area, incident keys, `expiresAt`), summary id at save. |
| C Orchestration | Danger patterns (en + es, normalized, false-positive tests); area resolution (ZIP → place name in active area labels → call → caller context; `detectedArea` updates the call); prompt with static cacheable system prompt and delimited source blocks; JSON-schema output; grounding (unknown ids rejected, attribution with "as of", address and shelter guards); side effects (unanswered questions deduped per call, subscriptions, stop updates, known area, consent, goodbye). |
| D Retrieval | One `Retriever` interface returning `{ chunks, retriever, retrievedAt }`; Convex area-first + full text over the utterance and recent caller turns; filters (active, actual, unexpired, trust tier, fixture rule) in the query and again in ranking; per-bulletin dedupe + next chunk; ≤ 6 chunks / ≈ 1,500 tokens; explainable scoring. Moss: live adapter, `InMemoryMoss`, index sync, hydration through Convex, fallback to Convex. |
| E Completion | Idempotent finalize (session end and the 15-minute sweeper); summary with `CLAUDE_SMART_MODEL` and a deterministic fallback; summary-only deletion; batched daily purge (transcripts 7 d, anonymous memory 30 d, account data kept, callers kept while a subscription needs them); account queries with auth as a TODO. |
| F Unanswered questions | `text`, `language`, `area`, `status`; `answerUnansweredQuestion` (dashboard) notifies `answer_available` subscribers. |
| G Subscriptions | Matcher (incident key, area overlap by county / zone / state, any update / severity / evacuation triggers), en + es templates, dedupe key per subscription + bulletin version, rate limit 1 per 15 min / 4 per hour (attempts stored), expiry cron, stop updates, mock phone notifier, unconfigured SMS, Cartesia adapter. |
| H Claude | `AnthropicLlm`: general request (purpose, model, system, messages, maxTokens, structuredInput, jsonSchema, timeout), typed `LlmError`s, structured output, prompt caching, Haiku turns with thinking off + low effort. |
| I Health and debugging | `/health` statuses + flags (`serveFixtures`, `cartesiaVerifiedLive: false`, `mockLlmFailureMode`); `calls:debugCall`; `notifications:recent`; `llmCheck:verify` / `llmCheck:smoke`. |

Scripts: `sim:call` prints per-stage backend timings and a pre-LLM summary, and `--all` picks scenarios from `/health`. `inject:update` writes through `internal.ingestion.upsertBulletins` and prints the resulting notifications. `scripts/moss-check.ts` verifies Moss.

## Mocked vs live-ready

| Boundary | Status |
| --- | --- |
| Claude | **Live-ready and verified** on dev (`LLM_PROVIDER=anthropic`); dev is left on MockLlm. |
| Convex retrieval | Live (default). |
| Moss | Adapter written; **blocked**: the SDK cannot load in Convex, and queries fail for this project (503 / 401). Falls back to Convex. |
| Cartesia outbound calls | Adapter written from the docs, behind `PHONE_NOTIFIER=cartesia`. **Not verified live** (no credentials). |
| SMS | `UnconfiguredSmsNotifier` (no provider chosen). |
| Voice caller | `sim:call` / convex-test HTTP calls (Leia's agent plugs in unchanged). |
| Ingestion | Fixtures through `upsertBulletins` (Dhweya's pipeline plugs in unchanged). |
| Accounts | `accounts:createTestAccount` helper; auth and phone verification TODO. |

## Verification findings

- Model ids `claude-haiku-5-5` and `claude-sonnet-5-5` exist (live `models.retrieve`).
- `temperature` is rejected: `400 "temperature: Extra inputs are not permitted"`. The 0.2 default is documented and never sent.
- Structured output (`output_config.format` JSON schema) returns valid `AnswerDraft`s. The prompt cache serves 1,921 tokens after the first call. The first call took 4.3 s (cold), later calls ~1.0–1.3 s.
- Live smoke (real Claude, three scenarios): grounded answer with a valid citation (42 words); unknown fact → `no_info`; Spanish address question → refusal + clarify. All pass.
- Moss: index create, upsert and delete work. Cloud query → 503 and `loadIndex` → 401 (model download), twice. Inside Convex the native binding can't load (push analysis, then runtime). With `RETRIEVER=moss` the turn falls back to Convex (`moss>convex`, +120–380 ms).
- The deployed runtime formats Pacific times in English and Spanish correctly.
- Mutation check: disabling the danger check or the fixture filter makes 32 tests fail, so the safety tests are not vacuous.

## Where the build prompt and the contract docs disagreed (the contract docs won)

1. **Stale-session sweep**: 15 minutes of silence (`live-call.md`), not 10.
2. **Inbound greeting**: also carries the 911 line (`live-call.md`), alongside the transcription notice.
3. **`internal.retrieval.search`** still returns `RetrievedChunk[]` (`ingestion-retrieval.md`). `retriever` and `retrievedAt` come from the `Retriever` wrapper and are stored on each turn.
4. **Session start failure**: the contract has the agent speak its fallback greeting and lazily start later, so `/voice/session/start` returns `500` on internal failure (there is no session id to return). The "200 + degraded" rule applies to `/voice/turn`.

Also reconciled, though not contract docs: TEAM_PLAN rule 5 vs. "the second call gets the last summary in its context". The summary is in the server-side context, but on caller ID alone the model never sees it. And the 0.2 temperature default vs. the live API, which rejects it.

## Open questions (in DECISIONS.md, each with a safe default)

1. Human review of all canonical wording (Spanish by a native speaker).
2. Subscriptions: 24 h (now) vs. the old 7 days.
3. The returning-caller greeting stays generic (never names the incident on caller ID).
4. Rate-limited updates are dropped for that bulletin version (not retried).
5. Moss: drop it from the call path, or run it outside Convex once Moss explains the 503/401.

## Canonical strings that need human review (`src/config/strings.ts`, en + es)

`safety`, `fallback`, `noInfo`, `transcriptionNotice`, `stopUpdates`, `callbackDeclined`, `attribution` / `attributionStale` (+ `issued` / `updated`), `emergencyLine`, `welcome`, `returningOffer`, `askQuestion`, `outboundIntro`, `outboundInvite`, `followupCreated` and the `topic*` phrases, `updatesStopped`, `consentDeclined`, `goodbye`, `clarifyArea`, `addressRefusal`, `updateMessage`, `answerMessage`. The file header says a human must review them before the demo.

## Contract additions (all optional, additive)

For **Leia** (voice):
- No voice contract field changed; `voice/soterra_voice/models.py` needs no update.
- **Sync the fallback line** in `voice/soterra_voice/phrases.py` with `fallback` in `src/config/strings.ts` ("Sorry, I can't find that answer right now. If you are in immediate danger, hang up and dial 911.", plus the Spanish one).
- `timingsMs` keys are now `context`, `retrieval`, `preLlm`, `llm`, `total`.
- The reply `language` is `en` or `es` (any other caller language gets English).
- Outbound starts may omit `callerPhone` when `notificationId` is present.
- `/health` gains flags `cartesiaVerifiedLive` and `mockLlmFailureMode`.
- Callers stop updates by saying "stop updates" / "parar actualizaciones".

For **Dhweya** (ingestion):
- `RetrievedChunk.chunkIndex?: number` (filled from `chunks.chunkIndex`) and `CallerContext.recentIncidentKeys?: string[]`, in `src/contracts/orchestration.ts`, with golden fixtures `retrieved-chunk.json` and `caller-context.json`.
- `internal.retrieval.search` accepts an optional `contextText`.
- `upsertBulletins` and the ingestion tables are untouched; no test-only helper was added to `convex/dev.ts`.
- The Moss sync entry point is `internal.mossNode.syncChunks` (best effort), but Moss cannot load in Convex today, so don't wire it yet.

## Files changed outside the backend's own folders (shared, minimal)

`convex/schema.ts` and `convex/validators.ts` (backend sections only), `convex/crons.ts` (subscription expiry cron, comments), `convex/lib/http.ts` (optional `prepare` hook in `parseBody`), `convex/test.setup.ts` (module map skips `*.helpers.ts`), `convex.json` (new: Moss external package), `.env.example`, golden fixtures and `manifest.json`, `fixtures/conversations/ridgeview-basic.json` (one expectation), `TEAM_PLAN.md`, `docs/DECISIONS.md`. Deleted: `src/orchestration/phrases.ts` (moved into `strings.ts`) and `tests/orchestration.test.ts` (split into new test files).

## Dependencies added

- `@moss-dev/moss@^1.7.1` (pulls in `@moss-dev/moss-core@0.23.0` and its platform binary). Named in the build prompt as the Moss SDK.
- `npm install` also restored the existing lockfile dependencies; `package-lock.json` changed only for that and the new package.

## Dev deployment state

- Env vars: `VOICE_API_SECRET` (new, random: `npx convex env get VOICE_API_SECRET`), `SERVE_FIXTURES=true`, plus the existing `ANTHROPIC_API_KEY`, `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY`.
- `LLM_PROVIDER`, `RETRIEVER` and `MOSS_INDEX_NAME` were set temporarily for the checks and then removed.
- Fixtures are seeded and the escalation was applied once.
- The test calls used only 555-01xx numbers. All notifications went through the mock notifier: no real call or message was placed.

## First integration steps for M1 (a real phone call against fixtures)

1. Alonso: `npx convex env set VOICE_API_SECRET "$(openssl rand -hex 24)"` on dev and share it with Leia privately. Confirm that `SERVE_FIXTURES=true` and that `npm run seed:fixtures` has run. Optionally `npx convex env set LLM_PROVIDER anthropic` for real answers.
2. Leia: set `SOTERRA_BACKEND_URL` (the dev `.convex.site` URL), `VOICE_API_SECRET` and `BACKEND_MODE=http` on the Line agent. Hit `GET /health`, then place a call from a phone whose number is shown.
3. Walk through the demo script (TEAM_PLAN.md). After each call run `npx convex run calls:debugCall '{"callId":"<providerCallId>"}'` to see kinds, citations and timings.
4. Compare end-of-speech → first audio against the 2.5 s budget (`timingsMs.total` is the backend's share), and log `call_request.from_` / `metadata` for the outbound question.
5. Sync the fallback line in `phrases.py`. Test barge-in: the next turn must send `interruptedPrevious: true`, and `debugCall` should show `interrupted: true` on the previous turn.
