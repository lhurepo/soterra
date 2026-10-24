# Backend build plan (Alonso, 2026-10-24)

One page. Slices A–I in order; `npm test && npm run typecheck` after each. Contract docs win over the build prompt; conflicts go in the final report and `docs/DECISIONS.md`.

## Shape

- `convex/` stays thin; logic lives in `src/` as plain TypeScript with injected `now`.
- A turn costs **two Convex round trips before the LLM**: `calls.beginTurn` (resolve or lazily start the session, idempotency check, persist the user turn, mark the previous reply interrupted, return the call snapshot, cached caller context, cached area labels and recent history) and one retrieval query. After the LLM, `calls.completeTurn` applies every side effect in one transaction (unanswered question, subscription create or cancel, known area, consent) and stores the reply.
- `src/orchestration/pipeline.ts` is pure: danger check → deterministic intents (consent, stop updates) → area resolution → retrieval → prompt → LLM (timeout) → parse → grounding → side-effect *plan*. Convex applies the plan.
- Canonical spoken text lives only in `src/config/strings.ts`; defaults in `src/config/defaults.ts`.

## Slices

| | Slice | Main files |
| --- | --- | --- |
| A | Voice HTTP API: merged `beginTurn`, interrupted marking, per-stage timings, greeting (welcome, notice, 911 line, returning offer), outbound greeting, 200 + degraded after validation | `convex/voice.ts`, `convex/calls.ts`, `src/config/strings.ts` |
| B | E.164 normalization, withheld = ephemeral, verified links at start and finalize, `buildCallerContext` (≤ 300 tokens, cached on the call), memory update at finalize | `convex/callers.ts`, `convex/memory.ts`, `src/memory/*` |
| C | Danger patterns (+ false-positive tests), ZIP / place-name / known-area resolution, real prompt with delimited sources, structured output, grounding (unknown ids, attribution, staleness, address and shelter guards), side effects | `src/orchestration/*` |
| D | `Retriever` returning `{ chunks, retriever, retrievedAt }`; Convex area-first + full text; per-bulletin dedupe; token budget; explainable scoring; Moss adapter + `InMemoryMoss` + `"use node"` sync/query actions behind `RETRIEVER=moss` | `src/retrieval/*`, `src/providers/moss/*`, `convex/retrieval.ts`, `convex/mossNode.ts` |
| E | Idempotent finalize, smart-model summary with deterministic fallback, summary-only deletion, batched purge (transcripts 7 d, anonymous memory 30 d, keep account and active-subscription data), account queries | `convex/memory.ts`, `convex/accounts.ts`, `src/memory/*` |
| F | `unansweredQuestions` (text, status), dedupe per call, `answerUnansweredQuestion` → `answer_available` notifications | `convex/unanswered.ts` |
| G | Matcher (incident, area overlap, triggers), en/es templates, dedupe key, rate limits, stop-updates, expiry, Cartesia adapter (not verified live) | `convex/subscriptions.ts`, `convex/notifications.ts`, `src/notifications/*`, `src/providers/cartesia/*` |
| H | `AnthropicLlm`: general request, JSON-schema output, prompt caching, typed errors, timeout; model ids verified live from a dev-deployment action (the key never leaves Convex) | `src/providers/llm/*`, `convex/llmCheck.ts` |
| I | `/health` statuses + flags, `debugCall`, docs, report | `convex/health.ts`, `convex/calls.ts`, `docs/*` |

## Mocks and tests

`MockLlm` driven by `structuredInput` with `MOCK_LLM_MODE` failure modes; `InMemoryMoss`; `MockPhoneNotifier`; `UnconfiguredSmsNotifier`; account helper; fake timers for TTL, expiry and rate limits. Integration tests go through the HTTP routes with fixtures seeded via `internal.ingestion.upsertBulletins`.

## Known conflicts to resolve in favour of the contract docs

- Stale-session sweep: contract says 15 minutes of silence (prompt says 10). Use 15.
- Inbound greetings must include the 911 line (contract). Kept alongside the notice.
- `internal.retrieval.search` keeps returning `RetrievedChunk[]` (contract); the retriever wrapper adds `retriever` and `retrievedAt`.

## Live checks (dev deployment only)

Push with `npx convex dev --once`, set `VOICE_API_SECRET` and `SERVE_FIXTURES=true` on dev, seed, run `sim:call`, measure pre-LLM time (target ≤ 300 ms, one bounded optimization pass). Verify Claude model ids, structured output and the temperature rule from an internal action. Measure Moss cold load in a `"use node"` action.
