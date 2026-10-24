# Decisions and verified facts

[S] Dated log of what we checked against official docs (or the installed packages) and what it changed. Newest entries go at the bottom of each section. "Unverified" means nobody has confirmed it yet: treat it as a risk.

## Verification log (2026-10-24)

### Cartesia Line SDK

| What we checked | Source | Finding | What it changes |
| --- | --- | --- | --- |
| Package, version, Python | Installed `cartesia-line` from PyPI and read its source; [docs/line/sdk/overview](https://docs.cartesia.ai/line/sdk/overview.md) | PyPI name `cartesia-line`, import root `line`, latest **0.2.19**. Package metadata: `Requires-Python >=3.10`. Hosted deployments support Python 3.9–3.13 ([deployments](https://docs.cartesia.ai/line/infrastructure/deployments)). | `voice/pyproject.toml` pins `cartesia-line>=0.2.19,<0.3` and `requires-python >=3.11,<3.14` (3.14 is not supported by Cartesia hosting). |
| Custom agent interface | `line/agent.py`, `line/voice_agent_app.py` (0.2.19); [agents](https://docs.cartesia.ai/line/sdk/agents.md) | An agent is a class with `process(env, event)` (an async generator of output events) or a function with that signature. `VoiceAgentApp(get_agent=..., pre_call_handler=None)`; `get_agent(env: AgentEnv, call_request: CallRequest)` returns the agent or `(agent, run_filter, cancel_filter)`. The `env` passed to `process` is a `TurnEnv`. | As specified. |
| Event names, transcript location | `line/events.py` | Input: `CallStarted`, `UserTurnStarted`, `UserTurnEnded`, `UserTextSent`, `UserDtmfSent`, `CallEnded`, … The caller's words: `UserTurnEnded.content` is a list of `UserTextSent | UserDtmfSent`; text is `UserTextSent.content`. Output: `AgentSendText(text, interruptible=True)`, `AgentEndCall(reason="agent_ended")`, `AgentUpdateCall(voice_id, language, …)`, `AgentTransferCall`, `LogMetric`, `LogMessage`. | The agent joins all `UserTextSent` items (the docs' `content[0]` example breaks on DTMF). |
| Default filters, barge-in | `ConversationRunner._prepare_agent` | Run on `CallStarted`, `UserTurnEnded`, `CallEnded`; cancel on `UserTurnStarted` (the in-flight task is cancelled). | Turns are indexed and idempotent; the agent sends `interruptedPrevious` after a cancellation. |
| `CallRequest` fields | `line/voice_agent_app.py` | `call_id`, `from_` (alias `from`), `to`, `agent_call_id`, `agent` (`id`, `system_prompt`, `introduction`), **`metadata: dict`** (not in the docs table), `agent_token`, `api_base_url`. | `call_id` → `providerCallId`. Outbound `notification_id` is read from `metadata`. |
| Setting language | `events.py`, `_harness_types.py`, agents doc | Mid-call: `AgentUpdateCall(language="es")` sets STT and TTS language. Before the call: `pre_call_handler` returning `PreCallResult(config={...})`; the docs show only `"tts"`; the harness type `ConfigOutput` has `tts`, `stt`, `language`. | Agent switches language after session start with `AgentUpdateCall`. `pre_call_handler` not used yet (its `stt` key is undocumented). |
| Hosting end date | [migrate-from-line-sdk](https://docs.cartesia.ai/agents/migrate-from-line-sdk), [changelog 2026](https://docs.cartesia.ai/changelog/2026.md) | Cartesia stops hosting code-first Line agents on **December 1, 2026**; self-hosted agents are unaffected. The deployments page still documents `cartesia deploy` with no deprecation notice. Self-host path: `cartesia connect --agent-id <id> --url https://…`. | **Unverified:** whether `cartesia deploy` accepts *new* agents today — Leia's first-hour task answers it. Fallbacks documented in `voice/README.md`. |
| CLI | [line/cli](https://docs.cartesia.ai/line/cli) | `cartesia auth login`, `cartesia deploy`, `cartesia env set --from .env`, `cartesia chat <port>` (text, local), `cartesia connect`, `cartesia phone-numbers provision/assign`. | Used in `voice/README.md`. |

### Cartesia telephony and STT

| What we checked | Source | Finding | What it changes |
| --- | --- | --- | --- |
| Outbound-call API | [create-outbound-call](https://docs.cartesia.ai/api-reference/agents/calls/create-outbound-call.md), [outbound dialing](https://docs.cartesia.ai/line/integrations/telephony/outbound-dialing.md) | `POST https://api.cartesia.ai/agents/calls`, headers `X-API-Key` and `Cartesia-Version: 2026-08-14`. Body: `from_number_id`, `agent_id`, `outbound_calls: [{ to_number, dynamic_variables }]`, optional `ringing_timeout_seconds`, `max_call_duration_minutes`. Response `{ calls: [{ number, agent_call_id } | { number, error }] }`. US numbers only; ≤ 1 call/s per number. The OpenAPI spec says bearer auth while the examples use `X-API-Key`. | Adds env var **`CARTESIA_FROM_NUMBER_ID`** (not in the prompt). Adapter sends `X-API-Key`; untested live. |
| Does call metadata reach the agent? | Same pages + SDK source | The request has **no `metadata` field**, only `dynamic_variables` ("to personalize a managed agent"). The SDK's `CallRequest.metadata` exists, but no page says `dynamic_variables` populate it. | **Unverified.** The agent reads `metadata.notification_id`; Leia confirms on the first outbound call. Fallback idea: backend looks up the latest queued notification for the dialed number. |
| STT languages | [stt-models/latest](https://docs.cartesia.ai/build-with-cartesia/stt-models/latest), changelog Sept 2026 | `ink-2` (stable, 2026-09-17): **en, fr, hi, ja, es**, auto-detected. Line agents use Ink 2 by default ("eligible" agents, May 2026). `ink-whisper` covers ~100 languages but is batch/older. | English first, Spanish second, as planned. Mandarin and Punjabi from the overview are **not** supported by Ink 2. |
| Phone numbers | provision API, CLI | Provision with `cartesia phone-numbers provision`; assign to an agent for inbound; unassigned numbers are outbound-only. | `voice/README.md`. |

### Anthropic

| What we checked | Source | Finding | What it changes |
| --- | --- | --- | --- |
| Model IDs | Anthropic model table (claude-api skill, cached 2026-10-06) | `claude-haiku-5-5` and `claude-sonnet-5-5` are current. Use exact IDs, no date suffix. | Defaults for `CLAUDE_FAST_MODEL` / `CLAUDE_SMART_MODEL`. |
| Request shape | Same | `temperature`/`top_p`/`top_k` are rejected (400) on current models as of 2026-10-21. Haiku 5.5 thinks by default (effort default `medium`); latency is tuned with `output_config.effort`. Forced `tool_choice` is rejected on Sonnet 5.5. Check `stop_reason === "refusal"`. | Adapter sends `output_config.effort: "low"` for turns, never `temperature`, and treats refusals as errors (the pipeline then speaks the fallback). |
| TS SDK in Convex's default runtime | `@anthropic-ai/sdk` 1.3.0; `convex/tests/runtime.test.ts` (edge-runtime) | The SDK uses `fetch` and constructs in an edge runtime without Node built-ins; Convex docs: `fetch` works in the default runtime for actions. | No `"use node"` needed. Not yet exercised on a deployed function with a real key. |

### Convex

| What we checked | Source | Finding | What it changes |
| --- | --- | --- | --- |
| Version, guidelines | `node_modules/convex` (1.48.0), `convex/_generated/ai/guidelines.md` | Table-name-first `ctx.db.get/patch/delete(table, id)`; crons only via `crons.interval`/`crons.cron`; no `Date.now()` in queries; bounded reads (`take`). | Followed throughout. |
| HTTP actions | Guidelines; `httpRouter` types | Routes registered on the `.convex.site` URL; `pathPrefix` routes supported. | `/voice/*`, `/health`, `/ingest/apify`, `/mock-sites/*`. |
| Search index limits | [text-search](https://docs.convex.dev/search/text-search) | 1 search field, ≤ 16 filter fields, ≤ 16 terms per query (≤ 32 chars each), ≤ 1024 results scanned, filters are equality. | `searchText()` trims to 16 terms; filters on `isActive`, `primaryState`, `isFixture`. |
| `"use node"` | [runtimes](https://docs.convex.dev/functions/runtimes) | A `"use node"` file may contain only actions; `fetch` works in the default runtime (actions only). | Everything runs in the default runtime. Moss (native binary) would need a `"use node"` action. |
| `convex-test` | [convex-test docs](https://docs.convex.dev/testing/convex-test), installed 0.0.65 | `t.fetch(path, init)` calls HTTP routes; `finishAllScheduledFunctions(vi.runAllTimers)`; text search has simplified semantics (no relevance order); limits not enforced. `import.meta.glob` must include `_generated/*.js`. | Ranking is done in our code (`src/retrieval/rank.ts`) so results are deterministic in tests. |
| Bundling of test files | `convex/dist/cjs/bundler` | Files whose names contain more than one dot are skipped as entry points. | `convex/test.setup.ts` and `*.test.ts` are never deployed. |
| Typed env (`defineApp({ env })`) | Guidelines | Supported in 1.44+. | **Not used**: `src/config/env.ts` parses `process.env` with zod so the same code runs in tests and scripts. Revisit if it causes friction. |
| Codegen without deploy | `npx convex codegen --help`, `npx convex function-spec` | Codegen regenerates `_generated/` and does not change deployed code (verified: the dev deployment still lists no functions). | The skeleton has **not** been pushed to the dev deployment. |

### Moss

| What we checked | Source | Finding | What it changes |
| --- | --- | --- | --- |
| Packages | npm registry; [moss.dev](https://www.moss.dev/) | JS: **`@moss-dev/moss`** 1.7.1 (`@inferedge/moss` stopped at 1.0.0-beta.8). Python: `moss`. JS depends on `@moss-dev/moss-core`, native per-platform binaries (incl. `linux-x64-gnu`), `node >= 20.4`. | Moss can only run in a `"use node"` action with the package in `convex.json` `node.externalPackages`. Not installed in the skeleton. |
| API | moss.dev, [Python API](https://docs.moss.dev/docs/reference/python/api.md) | `new MossClient(projectId, projectKey)`; `createIndex(name, docs, { modelId })`, `loadIndex(name)`, `query(name, text, { topK })`; models `moss-minilm` (default), `moss-mediumlm`. Python docs show metadata filters (`$eq`, `$in`, …). | Placeholder in `src/providers/moss/`. |
| Cold load in an action | Not documented | Query latency claims: ~1–10 ms after `loadIndex`; load time not stated. | **Unverified.** Measure before relying on Moss in the call path; the retriever falls back to Convex. |

### Apify

| What we checked | Source | Finding | What it changes |
| --- | --- | --- | --- |
| Run actor, dataset | [API v2](https://docs.apify.com/api/v2) | `POST /v2/actors/{actorId}/runs`, `Authorization: Bearer <token>`; `GET /v2/datasets/{id}/items`; sync variant `run-sync-get-dataset-items` (≤ 300 s). | `src/providers/apify/`. |
| Webhooks | [ad-hoc webhooks](https://docs.apify.com/platform/integrations/webhooks/ad-hoc-webhooks), [actions](https://docs.apify.com/platform/integrations/webhooks/actions) | Ad-hoc webhooks: base64 JSON array in the `webhooks` query param; events `ACTOR.RUN.SUCCEEDED/FAILED/TIMED_OUT/…`; payload template with `{{resource.*}}`; may be delivered more than once; **no signature** — the docs suggest a secret in the URL. Headers template exists, but its JSON key name (`headersTemplate`) was not shown verbatim. | `/ingest/apify` accepts the secret as `X-Soterra-Webhook-Secret` header **or** `?secret=` query param. Handler must be idempotent (TODO(I)). |
| X actor | [apidojo/tweet-scraper](https://apify.com/apidojo/tweet-scraper) | "Tweet Scraper V2": from $0.40 per 1,000 tweets, pay per event; min 50 tweets per query, max 1 concurrent run, "no monitoring" (don't repeat the same query at short intervals), free plan can't use it via API. X's own terms not addressed. | X ingestion stays P2; polling one query repeatedly conflicts with the actor's rules. Needs a paid Apify plan. |

### Official feeds

| Feed | Source | Finding |
| --- | --- | --- |
| NWS alerts | [weather.gov API docs](https://www.weather.gov/documentation/services-web-api); live request 2026-10-24 | `GET https://api.weather.gov/alerts/active?area=CA`, no key, **User-Agent required**, GeoJSON. Live response confirmed fields: `id`, `sent`, `effective`, `onset`, `expires`, `ends`, `status`, `messageType`, `severity`, `event`, `headline`, `description`, `instruction`, `areaDesc`, `geocode.UGC`, `geocode.SAME`, `references`, `parameters.VTEC`. `id` changes on each update. The `web` field is a generic homepage; use `@id` as the URL. |
| USGS | [GeoJSON feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) | `/earthquakes/feed/v1.0/summary/{2.5_hour,all_day,…}.geojson`, updated every minute; times are epoch ms. |
| OpenFEMA | [API docs](https://www.fema.gov/about/openfema/api) | `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries`, no key, OData-style `$filter`, `$top` ≤ 10000. |
| NHC | [GIS page](https://www.nhc.noaa.gov/gis/), live `CurrentStorms.json` | `https://www.nhc.noaa.gov/CurrentStorms.json` → `activeStorms[]` with product links. Not formally documented. |
| Tsunami.gov | [tsunami.gov](https://www.tsunami.gov/) | CAP and Atom: `/events/xml/PAAQCAP.xml` (NTWC), `/events/xml/PHEBCAP.xml` (PTWC). |
| InciWeb | [feeds](https://inciweb.wildfire.gov/feeds) | RSS `https://inciweb.wildfire.gov/incidents/rss.xml`. |
| NIFC / WFIGS | Catalog mirrors + live query 2026-10-24 | `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query` returns GeoJSON (`POOState` = `US-CA`). The official NIFC open-data page did not render for us, so the URL comes from catalog mirrors (it answered live). |
| DisasterAssistance.gov | Homepage | No API found; scrape (via Apify) if needed. |

### Backend build verification (2026-10-24, Alonso's session)

| What we checked | Source | Finding | What it changes |
| --- | --- | --- | --- |
| Claude model ids | `npx convex run llmCheck:verify` on the dev deployment (key stays in Convex) | `client.models.retrieve` returns `claude-haiku-5-5` and `claude-sonnet-5-5`. | Defaults confirmed. |
| `temperature` | Same | `400 invalid_request_error: "temperature: Extra inputs are not permitted"`; the installed SDK (1.3.0) no longer types the field. | The 0.2 default from the build prompt is kept in `src/config/defaults.ts` for reference and **never sent**. |
| Structured output | Same; `@anthropic-ai/sdk` 1.3.0 types (`output_config.format: { type: "json_schema", schema }`) | The real turn prompt returns a valid `AnswerDraft` citing the given chunk id. | `AnthropicLlm` sends the AnswerDraft / CallSummary JSON schema; zod still validates. |
| Prompt caching | Same | `cache_read_input_tokens: 1921` on the 2nd and 3rd call (static system prompt + schema). First call 4.3 s (cold), then ~1.0–1.3 s. | System prompt is static and marked `cache_control: ephemeral`. |
| Thinking for turns | Skill docs + live runs | Haiku 5.5 accepts `thinking: disabled` at low effort; Sonnet/Opus 5.5 reject `disabled`. Haiku turns took 1.0–2.0 s end to end on dev. | `requestTuning()`: Haiku turns = thinking off + `effort: low`; other models = adaptive + low; summaries = medium. |
| Live smoke | `RUN_LIVE_TESTS=1 npx vitest run tests/live.smoke.test.ts` (ran on dev) | Grounded answer (cited, 42 words), unknown fact → `no_info`, Spanish address question → refusal + clarify. All three pass. | — |
| Moss SDK, local | `npx tsx scripts/moss-check.ts` with the project key, run twice | `createIndex` ~4 s, `addDocs` ~3 s, `deleteDocs` ~2.5 s work. Cloud `query` → HTTP 503 every time; `loadIndex` → 401 downloading `moss-minilm` from models.moss.link. | Moss queries are unusable with this project's credentials today. |
| Moss inside Convex | `convex.json` `node.externalPackages: ["@moss-dev/moss"]`, push + `npx convex run mossNode:*` on dev | Push-time analysis fails with "Cannot find native binding" if the SDK is imported at module load; with a lazy import the push succeeds but the action fails the same way at runtime. | Moss stays behind `RETRIEVER=moss`, which falls back to Convex (verified live: `retriever: "moss>convex"`, +120–380 ms). Convex search is the default. |
| Pre-LLM latency | `npm run sim:call -- --all` on dev | Median 104 ms, p90 173 ms, max 247 ms (cold) with MockLlm; 84–142 ms with Claude. | Target (≤ 300 ms) met without an optimization pass. |
| `Intl` time zones on the deployed runtime | Live replies on dev | "October 24 at 2:10 PM Pacific" and "24 de octubre a las 2:10 p.m. hora del Pacífico" render correctly. | Removes that item from "still unverified". |
| Cartesia outbound calls | — | **Not verified live** (no credentials). Unit-tested against the documented request/response shapes only. | Behind `PHONE_NOTIFIER=cartesia`; `/health` flag `cartesiaVerifiedLive: false`. |

## Decisions

| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-24 | Repo root had only Convex setup and docs, no conflicting app: the skeleton was built in place on branch `skeleton/shared-codebase`. | §0 of the setup prompt. |
| 2026-10-24 | Orchestration lives in the backend; the voice agent only forwards turns. | Lets the backend enforce grounding, danger and memory rules deterministically. |
| 2026-10-24 | `src/` is Convex-free; `convex/` files are thin. The turn pipeline takes its dependencies as functions. | Unit-testable without Convex; owners can replace pieces independently. |
| 2026-10-24 | Danger check is regex-based, checks English and Spanish patterns on every turn, and runs before retrieval and the LLM. The model may also flag safety, but the spoken wording is always the fixed phrase. | Rule 3. |
| 2026-10-24 | Grounding: an `answer` must cite a chunk retrieved in this turn with trust `official`/`official_social`; otherwise it becomes `no_info` and the question is recorded. Every answer ends with a spoken "That's from <source>, issued/updated <time> <zone>." unless the reply already names the source. | Rules 1 and 2, enforced in code. |
| 2026-10-24 | Caller ID is `identity: "caller_id"`. On that basis the model sees only language and county-level area; stored needs and past summaries reach the model only for `verified_account`. | Rule 5. Owners may relax this deliberately. |
| 2026-10-24 | Unverified (X) content is stored as bulletins but never chunked, never indexed, never triggers events or crisis mode. | Rule 4. |
| 2026-10-24 | `upsertBulletins` returns an extra per-item change value, `"rejected"` (item quarantined), with `reason`. | Validation failures must be visible to the caller of the mutation. |
| 2026-10-24 | Content hash is a synchronous 53-bit string hash (cyrb53) over content fields, computed in `finalizeBulletin`. Fixture files omit `contentHash`. | Works in every Convex runtime and in tests; only compared within one bulletin's history. |
| 2026-10-24 | `primaryState` = first area's state, or `"US"` for national items with no area. | Search filter field; areas are never invented. |
| 2026-10-24 | The ranking step (`src/retrieval/rank.ts`) re-applies expiry, trust and fixture filters and scores by term overlap, area match, severity and freshness. | Defence in depth; deterministic under convex-test. |
| 2026-10-24 | The MockLlm only answers when a chunk contains every proper noun in the question (e.g. "Hillcrest Elementary"). | Makes "I don't know yet" testable without a real model. |
| 2026-10-24 | Follow-up subscriptions expire after 7 days; the spoken confirmation says so. | No "stop calls" flow exists yet, so the reply must not promise one. |
| 2026-10-24 | Python `TurnResponse.kind` is a plain string. | A new reply kind must not crash a live call. |
| 2026-10-24 | `package-lock.json` was regenerated (npm optional-dependency bug left out the macOS x64 rolldown binding needed by Vitest 5). | `npm install` must work on every teammate's machine. |
| 2026-10-24 | `/health` is public. | It exposes only integration status and flags, and the voice agent's first task is to reach it. |
| 2026-10-24 | A turn is two mutations and one query around the LLM: `calls.beginTurn` (resolve/lazy start, replay check, interrupted marking, persist the user turn, return cached context, area labels, history) → retrieval query → `calls.completeTurn` (all side effects + the reply, atomically). The pipeline returns a side-effect *plan* instead of calling the database. | Latency (fewer round trips) and atomic side effects. |
| 2026-10-24 | All spoken wording moved to `src/config/strings.ts` (en, es) with a "human review required" header; `src/orchestration/phrases.ts` was removed. The fallback line changed to "Sorry, I can't find that answer right now…" | Build prompt. **Leia:** sync `voice/soterra_voice/phrases.py`. |
| 2026-10-24 | Stale-session sweep stays at **15 minutes** of silence. | `live-call.md` says 15; the build prompt said 10; the contract wins. |
| 2026-10-24 | Follow-up subscriptions now last **24 hours** (max 72) instead of 7 days; the spoken confirmation says "for the next 24 hours" and how to stop. | Build prompt defaults; a "stop updates" flow now exists. TEAM_PLAN demo script updated. |
| 2026-10-24 | Anonymous transcripts are kept **7 days** (was 72 h); anonymous memory 30 days. Deadlines are stamped on the call at finalize (`transcriptExpiresAt`, `memoryExpiresAt`) and on the caller (`expiresAt`); account-linked data has none. | Build prompt; indexable, batched purge. |
| 2026-10-24 | Caller memory: the last summary (≤ 7 days) is in the server-side caller context and triggers a generic "welcome back" offer, but on caller ID alone the model sees only language, a county-level area, active update topics and public incident keys (`recentIncidentKeys`). Summary text and needs reach the model only for a verified account. | Reconciles the build prompt ("second call gets the last summary in its context") with rule 5 ("on caller ID alone the model never sees … past summaries"). |
| 2026-10-24 | Grounding is strict: citing any chunk id not retrieved this turn rejects the whole answer. Any rewrite of the model's draft (uncited, unknown id, address claim, unsupported shelter claim) sets `degraded: true` and an `errorCode` on the turn. | Build prompt; makes model drift visible. |
| 2026-10-24 | Deterministic address and shelter guards (TEAM_PLAN to-do 2): an address-in-zone claim for an exact-address question becomes the canonical refusal; "shelter is open" needs a cited chunk that says "open"; non-answer kinds may not make either claim. | Rule 2 hardened. |
| 2026-10-24 | "Stop updates" and "summary only" are deterministic intents handled before the model; "stop updates" cancels every active subscription for the caller's number (also on outbound calls, whose number comes from the notification). | Must work even if the model fails. |
| 2026-10-24 | Rate-limited notifications are stored as `status: "failed"`, `error: "rate_limited: …"` (no enum change) and are not retried for that bulletin version. | Every attempt is stored without a contract change. |
| 2026-10-24 | After validation `/voice/turn` always returns 200 (fallback + `degraded`). `/voice/session/start` and `/voice/session/end` return `500 internal` on internal failure because there is no session or call id to return; an unknown `sessionId` stays `404` per the contract. | Contract error codes + build prompt rule. |
| 2026-10-24 | ZIP codes map to a state with a 3-digit prefix table and keep the known county when it is in the same state; place names match active `bulletinAreas` labels (roads excluded), cached on the call for 10 minutes. | US only; no ZIP→county data in the repo. |
| 2026-10-24 | Withheld caller ID creates no caller row (ephemeral, `identity: "anonymous"`); its call and summary still follow the anonymous TTLs. | Build prompt. |
| 2026-10-24 | The call follows the caller's language: a turn in a supported language (en/es) updates `calls.language`; other languages get English replies and do not change it. | Build prompt scope. |
| 2026-10-24 | Incidents cited earlier in the call feed "call me if it changes" when the current turn retrieves nothing (e.g. a Spanish follow-up over English bulletins). | Found with the Spanish scenario. |
| 2026-10-24 | `MOCK_LLM_MODE` env var scripts MockLlm failures for integration tests and drills; `/health` flags it. | Failure modes must be testable through HTTP. |
| 2026-10-24 | `convex.json` added with `node.externalPackages: ["@moss-dev/moss"]`; the SDK is imported lazily in `convex/mossNode.ts`. | Required for any Node action using Moss; lazy import keeps pushes working. |
| 2026-10-24 | `npm run inject:update` now writes through `internal.ingestion.upsertBulletins` (the ingestion contract) and prints the resulting notifications. | Build prompt. |
| 2026-10-24 | Dev deployment state left by this session: `VOICE_API_SECRET` (random; read it with `npx convex env get VOICE_API_SECRET`), `SERVE_FIXTURES=true`, fixtures seeded and the escalation applied once; `LLM_PROVIDER` unset (mock). | Rotate the secret when Leia connects. |

## Still unverified (owners)

- `cartesia deploy` accepting new agents before the Dec 1, 2026 shutdown (V).
- Whether outbound `dynamic_variables` reach `CallRequest.metadata`, and `from_`/`to` on outbound calls (V).
- `pre_call_handler` `stt` config key (V).
- Live behaviour of the Cartesia outbound adapter and its auth header (B, reviewed by V). Not verified: no credentials.
- Moss: why cloud queries return 503 and model downloads 401 for this project, and whether Moss can run anywhere inside Convex (B; ask Moss).
- Apify `headersTemplate` key name and payload template `{{resource.defaultDatasetId}}` (I).

## Open questions for Alonso (backend session, 2026-10-24)

Each has a safe default already in the code; change it if you disagree.

1. **Canonical wording**: every string in `src/config/strings.ts` needs a human read, the Spanish ones by a native speaker. Default: the drafted text.
2. **Subscription lifetime**: 24 hours (build prompt) vs. 7 days (old decision and demo script). Default: 24 h; the demo script now says 24 hours.
3. **Returning-caller greeting**: generic "we can pick up where we left off" (never names the incident on caller ID). Default: generic.
4. **Rate-limited updates**: dropped for that bulletin version, not retried later. Default: dropped.
5. **Moss**: drop it from the call path for the demo, or run it outside Convex (a small Node service) once Moss fixes the 503/401? Default: Convex search; Moss behind the flag.
