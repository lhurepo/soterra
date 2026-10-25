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
- ~~Apify `headersTemplate` key name~~ verified 2026-10-24 (ingestion pass below). A live Apify run against the mock sites is still pending (I).

## Open questions for Alonso (backend session, 2026-10-24)

Each has a safe default already in the code; change it if you disagree.

1. **Canonical wording**: every string in `src/config/strings.ts` needs a human read, the Spanish ones by a native speaker. Default: the drafted text.
2. **Subscription lifetime**: 24 hours (build prompt) vs. 7 days (old decision and demo script). Default: 24 h; the demo script now says 24 hours.
3. **Returning-caller greeting**: generic "we can pick up where we left off" (never names the incident on caller ID). Default: generic.
4. **Rate-limited updates**: dropped for that bulletin version, not retried later. Default: dropped.
5. **Moss**: drop it from the call path for the demo, or run it outside Convex (a small Node service) once Moss fixes the 503/401? Default: Convex search; Moss behind the flag.

## Ingestion pass (2026-10-24, branch `ingestion/pipeline`)

### Verified

| What we checked | Source | Finding | What it changes |
| --- | --- | --- | --- |
| Apify run endpoint | [Run Actor](https://docs.apify.com/api/v2/actors-runs-post), [API overview](https://docs.apify.com/api/v2) | Canonical path is `POST /v2/actors/{actorId}/runs`; "The `/v2/acts/` prefix is deprecated but still fully functional". Body = actor input. Query: `webhooks` (base64 JSON array), `maxItems`, `maxTotalChargeUsd`, `timeout`, `memory`. Actor id `username~actorName`. Response 201 `data.id`, `data.defaultDatasetId`. | We use `/v2/actors/` (the ingestion brief said `/v2/acts/`; the docs prefer `/actors/`). Every run is capped with `maxItems` and `maxTotalChargeUsd`. |
| Ad-hoc webhook keys | [ad-hoc webhooks](https://docs.apify.com/platform/integrations/webhooks/ad-hoc-webhooks), [actions](https://docs.apify.com/platform/integrations/webhooks/actions), `apify-client` 2.25.0 `webhook.d.ts` | Keys `eventTypes`, `requestUrl`, `payloadTemplate`, `idempotencyKey`, and **`headersTemplate?: string`** (confirmed in the official client types). Default payload `{userId, createdAt, eventType, eventData, resource}`; run events carry `eventData.actorRunId`; `resource` is the run object (with `defaultDatasetId`). Events include `ACTOR.RUN.SUCCEEDED/FAILED/TIMED_OUT/ABORTED`. Unsigned; retried up to 11 times; may be delivered more than once. | We send the secret in `X-Soterra-Webhook-Secret` via `headersTemplate` (query `?secret=` also accepted), and our `payloadTemplate` echoes `soterra.runRecordId` so the receiver finds its run without a race. The receiver is idempotent per run. |
| Dataset items | [Get dataset items](https://docs.apify.com/api/v2/dataset-items-get) | `GET /v2/datasets/{id}/items`, `format=json` (default), `clean=true` = skip empty and hidden (`#`) fields, `limit`. Bearer auth recommended. | `?clean=true&format=json&limit=N`. |
| Actors | [Website Content Crawler](https://apify.com/apify/website-content-crawler), [Cheerio Scraper](https://apify.com/apify/cheerio-scraper), [Tweet Scraper V2](https://apify.com/apidojo/tweet-scraper) | WCC: `startUrls`, `crawlerType` (raw-HTTP option labelled "Raw HTTP client (Cheerio)"), `maxCrawlPages`, `maxCrawlDepth` (0 = start URLs only); items `url`, `text`, `metadata.title`, `crawl.loadedTime`; ≈ $0.2/1,000 pages raw HTTP. Cheerio Scraper: `startUrls`, `pageFunction(context)` with `$`, `request`; `maxPagesPerCrawl` (0 = unlimited); one dataset item per returned object; platform usage only. Tweet Scraper V2: `twitterHandles`, `searchTerms`, `maxItems`, `sort`; items `id`, `url`, `text`, `createdAt` ("Fri Nov 24 17:49:36 +0000 2023"), `author.userName`, `isRetweet`; from $0.40/1,000 tweets; ≥ 50 tweets per query; 1 concurrent run; no repeated queries at short intervals; no API use on the free plan. | Free text → WCC + extraction; structured shelter list → Cheerio + our page function + deterministic parser; X wired but fixture-only. **Unverified:** the exact `crawlerType` value string `"cheerio"` (the page shows labels, not values). |
| Convex limits | [limits](https://docs.convex.dev/production/state/limits) | Per mutation: 16,000 documents / 16 MiB written, 32,000 documents scanned, 4,096 index ranges, 1 s of user code; documents ≤ 1 MiB; ≤ 1,000 scheduled functions per mutation; actions 30 min (Convex runtime) / 10 min (Node). | Upserts in batches of 25 items (≲ 10 writes each); geometry > 50,000 chars to file storage. |
| `CONVEX_SITE_URL` in functions | [environment variables](https://docs.convex.dev/production/environment-variables) | `CONVEX_CLOUD_URL` and `CONVEX_SITE_URL` "are always available in Convex functions". | Webhook URL `${CONVEX_SITE_URL}/ingest/apify`; mock-site URLs for live actors. |
| File storage | [store files](https://docs.convex.dev/file-storage/store-files) | `ctx.storage.store(blob)` from actions returns `Id<"_storage">`. | Raw payloads (24 h TTL, hourly purge cron) and large geometry are stored from actions; mutations only delete. |
| NWS cancellations, live | Live `api.weather.gov/alerts/active?area=AK`, 2026-10-24 | Some cancellations arrive as `messageType: "Alert"` whose VTEC actions are all `CAN` ("The Winter Storm Watch has been cancelled."). Updates carry earlier ids in `references` with their `sent` times. | NWS adapter: Cancel messages **and** all-CAN/EXP VTEC alerts are `cancelled`; Update/Cancel `issuedAt` = earliest referenced `sent`, `updatedAt` = this `sent`. |
| Live feed shapes | Live fetch of every direct feed, normalized in Node | NWS (88 alerts across 5 states), OpenFEMA (21), WFIGS (64), InciWeb (7), NHC (1), Tsunami.gov CAP (1): **0 rejections**. InciWeb `description` holds "Last updated: YYYY-MM-DD" (date only), "The type of incident is …", "State: …"; `pubDate` can be years old (incident creation). Tsunami.gov CAP is a single `<alert>`. | InciWeb: state from "State:", prescribed burns skipped, date-only "Last updated" not turned into a timestamp. |

### Decisions

| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-24 | Ingestion settings live in `src/ingestion/config.ts` (own env parsing), not in the backend's `src/config/env.ts`. | Ingestion must not edit backend files. |
| 2026-10-24 | Additive contract fields: `timeBasis`, `supersedesExternalIds` on `NormalizedBulletin`; `timeBasis` on `bulletins` and `chunks`; new `Signal` schema and `signals` table. `ExtractionResult` is deprecated (unused). | Required by the ingestion brief; additive and optional. |
| 2026-10-24 | The extraction model returns **quotes only**; code derives hazard type, severity and page time from verified quotes. | Nothing the model writes reaches callers unless it is literally in the source. |
| 2026-10-24 | Deterministic extraction mock in `src/ingestion/extractionMock.ts` (flagged). | The backend's `MockLlm` returns `{items: []}` for extraction. |
| 2026-10-24 | X routing by `X_ALLOWLIST` (configuration), one `x_posts` source with trust tier `official_social`; non-allowlisted posts → `signals`. Retweets skipped. | Trust from configuration, never content. |
| 2026-10-24 | Fixture bulletins trigger crisis mode only when `SERVE_FIXTURES=true`. | A demo deployment should behave like a real one; fictional data must not change polling on a real one. |
| 2026-10-24 | Mock-site pages get `incidentKey` from the verified title ("Ridgeview Fire: …" → `ridgeview-fire`). | Lets callback subscriptions match ingested page updates; derived only from quoted text. |
| 2026-10-24 | Shelter bulletins are one per row, built only from labeled cell values; a row without a status is rejected. | Never say a shelter is open unless the source says so. |
| 2026-10-24 | Raw-payload storage is best effort (logged, never fails a run). | It exists only for debugging. |
| 2026-10-24 | WFIGS: `FireDiscoveryDateTime` = issued; `ModifiedOnDateTime_dt` = updated (or `page_updated` basis when there is no discovery time). NHC: no units or movement restated (the file does not state units); severity from classification (HU severe, TS/STS moderate, others minor). | No invented facts. |

### Still unverified (ingestion)

- A live Apify run end to end (no `APIFY_TOKEN` here): `npm run ingest:apify-mock-sites` on the dev deployment.
- WCC `crawlerType: "cheerio"` value and Cheerio `request.loadedUrl` in the page function.
- Live fetches from inside a deployed Convex action (verified only from Node).

## Voice pass (2026-10-24, branch `voice/agent`)

### Verified

| What we checked | Source | Finding | What it changes |
| --- | --- | --- | --- |
| SDK version | PyPI, installed package | `cartesia-line` **0.2.19** is still the latest (uploaded 2026-09-30), `Requires-Python >=3.10`. | Pin unchanged. |
| Runner behaviour | `line/voice_agent_app.py` (`ConversationRunner`) | Run filter default `CallStarted`, `UserTurnEnded`, `CallEnded`; `UserTurnStarted` cancels the in-flight task. **Any new run event also cancels the previous task** (so `CallEnded` cancels a pending turn). On websocket disconnect the runner emits `CallEnded` and awaits the agent task. A cancelled task still sends `response_end`. | Barge-in and hang-up paths cancel the HTTP request; `end_session` in `CallEnded` runs to completion. |
| Caller text and keypad | `events.py`, `_turn_content` | `UserTurnEnded.content` holds every `UserTextSent` **and** `UserDtmfSent` since the turn's `UserTurnStarted`, so keypad presses arrive with the turn without changing the run filter. | Keypad 2/1 switches language inside a normal turn. Unverified on a real call: whether Cartesia wraps a keypad press in a user turn. |
| Language mid-call | `_map_output_event` | `AgentUpdateCall(language, voice_id)` is sent as a `config` message with `stt.language`, `tts.language` and `tts.voice_id` (tested through the runner). Docs: the table says STT and TTS, the prose says ASR. | Mid-call switching is supported by the SDK; real-call behaviour unverified. |
| Pre-call | `VoiceAgentApp.create_chat_session`, [agents](https://docs.cartesia.ai/line/sdk/agents.md) | `pre_call_handler(call_request)` returns `PreCallResult(metadata, config)`; returning `None` rejects the call (403). Config keys: `tts.voice_id`, `tts.model` (sonic-3.6/3.5/3), `tts.language`, `tts.pronunciation_dict_id`, `stt.language`. The SDK returns the metadata in the `/chats` response; **whether Cartesia forwards it into the websocket start message (`call_request.metadata`) is not documented.** The `/chats` body is read with key `from_`, the websocket start with `from`. | Pre-call starts the session only with a real call id and a caller number (or an outbound callback), so a placeholder id or a parsing gap can't create a wrong session; the agent re-calls the idempotent start if the metadata doesn't arrive. |
| CallRequest | SDK source | `call_id`, `from_` (alias `from`), `to` (dialed number), `agent_call_id`, `agent`, `metadata`, `agent_token`, `api_base_url`. | `to` is the dialed number for the language map. |
| Outbound metadata | [create outbound call](https://docs.cartesia.ai/api-reference/agents/calls/create-outbound-call.md), [dynamic variables](https://docs.cartesia.ai/agents/dynamic-variables.md) | `outbound_calls[]` items have only `to_number` and `dynamic_variables` — **no `metadata`** (the voice brief assumed `outbound_calls[].metadata`). Nothing says either reaches a code agent's `call_request.metadata`. | The agent reads `metadata.notificationId` / `notification_id`; confirm on the first real callback. If it doesn't arrive, the backend needs another way to tie the call to the notification (e.g. look up the latest queued notification for the dialed number). |
| Voices | [Sonic 3.6](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest.md), [multilingual voices](https://docs.cartesia.ai/build-with-cartesia/capability-guides/multilingual-voices.md), [choosing a voice](https://docs.cartesia.ai/build-with-cartesia/capability-guides/choosing-a-voice.md) | Sonic 3.6: 44 languages incl. Spanish; "Every voice can speak every language the model supports" (with the voice's accent). Stable English voices include Jacqueline `9626c31c-bec5-4cca-baa8-f8ba9e84c8bc`, Daniel `47c38ca4-5f35-497b-b1a3-415245fb35e1`, Skylar `db6b0ed5-d5d3-463d-ae85-518a07d3c2b4`. No Spanish voice IDs or "calm" tag on the pages read. | Default voice Jacqueline for both languages; `VOICE_ID_ES` configurable. |
| STT | [Ink 2](https://docs.cartesia.ai/build-with-cartesia/stt/latest.md), changelog | Ink 2: en, fr, hi, ja, es. Keyterms exist for the STT WebSocket (`keyterm`) and managed agents; **no keyterm option for Line code agents** is documented. Pronunciation dictionaries are passed as `tts.pronunciation_dict_id`. | `PRONUNCIATION_DICT_ID` setting; no STT keyterms. |
| Observability | [observability](https://docs.cartesia.ai/line/infrastructure/observability.md) | `LogMetric(name, value)` and `LogMessage` appear in the Playground call transcript. | Metrics: `backend_start_ms`, `backend_turn_ms`, `filler_used`, `backend_turn_failed`, `backend_start_failed`. |
| CLI and hosting | [CLI](https://docs.cartesia.ai/line/cli.md), [migration](https://docs.cartesia.ai/agents/migrate-from-line-sdk.md), changelog | `cartesia init`, `deploy`, `env set [--from .env]`, `chat <port>`, `connect --agent-id --url`, `phone-numbers provision "<label>" --agent-id`, `phone-numbers assign <id> --agent-id`. No `cartesia call` command is documented. Hosting ends Dec 1, 2026; "existing agents keep running until that date"; **whether new hosted deployments are accepted is not stated.** | README documents deploy and the `cartesia connect` fallback. The CLI is not installed here and no Cartesia credentials were available, so nothing was deployed. |

### Decisions

| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-24 | Language priority: saved language (backend returns it when no hint is sent) → dialed-number map (sent as `languageHint`, which the backend treats as explicit) → keypad 2/1 mid-call. The spoken keypad offer is off by default (`OFFER_SPANISH_DTMF`). | A dedicated Spanish number is the most reliable option; keypad behaviour on real calls is unverified. |
| 2026-10-24 | Only the transcription-notice sentence of the greeting is uninterruptible. | The brief; the SDK supports per-message `interruptible`. |
| 2026-10-24 | One filler per turn after 1.2 s; total turn budget 8 s; 3 consecutive failures end the call (reason `error`). | The brief; keeps silence short and failure bounded. |
| 2026-10-24 | The httpx client is bound to the event loop it was created in and is recreated on a different loop. | Found in testing: pre-call and the call websocket can run on different loops (they do in TestClient), and a pooled connection from a closed loop breaks the call. |
| 2026-10-24 | Barge-in is reported from task cancellation, plus a history heuristic (caller started while an agent turn was open). | The SDK does not say how much of a reply was heard. |
| 2026-10-24 | No contract changes. | The existing contract covers everything the agent needs. |

### Still unverified (voice)

- A real phone call: end-of-speech → first-audio latency, barge-in, keypad presses, Spanish STT/TTS quality, the chosen voice on a phone line.
- Whether pre-call metadata and outbound `dynamic_variables` reach `call_request.metadata`; `from_`/`to` on outbound calls.
- Whether `cartesia deploy` still accepts new agents.

## Cartesia go-live (2026-10-24, branch `cartesia/live`)

| What we checked | How | Finding | What it changes |
| --- | --- | --- | --- |
| Outbound-call API | Live calls to `POST /agents/calls` | `X-API-Key` and `Authorization: Bearer` both authenticate; `Cartesia-Version: 2026-08-14`. Empty `outbound_calls` → 400 "outbound_calls must contain at least one call". A valid body → 200 `{ calls: [{ number, agent_call_id }] }`. Unknown keys in `outbound_calls[]` (`metadata`) are accepted. | Adapter verified; it also sends the notification id in `metadata`. |
| Outbound from/to | `cartesia calls ls` after an outbound call | An outbound call is **from our Cartesia number to the person**. | Voice agent detects outbound by `from` ∈ `SOTERRA_PHONE_NUMBERS`. |
| Tying a callback to its notification | Design | The outbound API returns `agent_call_id` (stored as the notification's `providerRef`); a Line agent receives `CallRequest.agent_call_id`. | Additive contract field `SessionStartRequest.providerAgentCallId`; backend looks the notification up by `providerRef` (index `notifications.by_providerRef`). Unverified until a real callback: that both ids are equal. |
| Managed vs code agents | `cartesia deploy` | A Playground (managed) agent rejects code: "Managed agent not supported … create a separate agent to deploy your own code." | New code agent `soterra-voice` (`agent_1iwkwy7nwEfejQJzwM75hm`); the number moved to it. |
| Hosted build | Build logs | uv + CPython 3.13; `main.py` must itself contain `VoiceAgentApp(...)` and `app.run()`; readiness check hits `/status`. New hosted deployments still accepted on 2026-10-24. | `main.py` builds the app; README documents redeploys. |

Incident: while checking request validation, one real outbound call was placed to the fictional number +1 707 555 0123 (the 555-01xx range is reserved for fiction); Cartesia recorded it as failed after 1 s. No real person was called.

Still unverified: a real inbound call end to end (latency, barge-in, keypad), a real callback end to end (`agent_call_id` equality, metadata pass-through), Spanish speech on the phone line. `cartesiaVerifiedLive` in `/health` stays false until a real callback has worked.

## Corroboration (2026-10-24, branch `dhweya/ingestion`)

| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-24 | Confidence is computed in code from independent corroboration, not from an LLM's self-reported certainty. | Models are poorly calibrated about their own confidence; "two independent sources agree" is checkable. |
| 2026-10-24 | Independence is by publisher group, not by source id: InciWeb and WFIGS share NIFC/IRWIN upstream (`nifc-irwin`); an agency's X account shares its feed's group. | Agreement between two views of the same data is not confirmation. |
| 2026-10-24 | A match needs a compatible hazard, overlapping area, ≤ 72 h apart, and the incident's name (title words, minus generic words and place names) in the other chunk. Fixture and real data never match. | Errs toward "single": a missed match drops a sentence, a false match overstates confidence. |
| 2026-10-24 | Tiers annotate and never gate: a single official source (NWS alone) is still spoken. Only `unverified` content is blocked, as before. | An authoritative source needs no second one to be useful. |
| 2026-10-24 | Grounding code appends the sentence; the model is not told the tier and cannot invent one. | Keeps confidence deterministic and testable. |
| 2026-10-24 | Only candidates retrieved for the caller's question are compared. | No extra database reads on the call path; a corroborating bulletin that does not match the question's words is missed. |


## Text alerts (2026-10-24, branch `Leia/text-alerts`)

### From the Twilio docs (not verified live yet: `twilioVerifiedLive` stays false)

| Topic | Source | Fact | Consequence |
| --- | --- | --- | --- |
| Send a text | Twilio Messages API | `POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json`, Basic auth (Account SID : Auth Token), form-encoded `To`, `From` (or `MessagingServiceSid`), `Body`, optional `StatusCallback` → 201 `{ sid: "SM…", status: "queued" }`; errors are 4xx `{ code, message }`. | `src/providers/twilio/sms.ts` uses `fetch` with no SDK, so it runs in the default Convex runtime and needs no `npm install`. |
| Delivery status | StatusCallback | Twilio POSTs `MessageSid`, `MessageStatus` (`queued`, `sent`, `delivered`, `undelivered`, `failed`) and `ErrorCode` to the callback URL. | `POST /twilio/status` stores `providerStatus`; a failure sets `status: "failed"`, `error: "code <ErrorCode>: <status>"`. |
| Request signature | Webhook security | `X-Twilio-Signature` = base64 HMAC-SHA1 with the Auth Token over the full URL followed by each POST parameter name and value, sorted by name. | Both webhooks check it (Web Crypto, constant-time compare) against `req.url` and `${CONVEX_SITE_URL}${path}`, and return 403 without `TWILIO_AUTH_TOKEN`. |
| Landlines | Error codes | 21614 "'To' number is not a valid mobile number" (when sending); 30006 "Landline or unreachable carrier" (status callback). | Either one switches the subscription to calls and calls that update instead. |
| Opt-out by topic | Not verified | Our reading: Twilio's opt-out keywords are matched against the whole message, so "STOP COOLEY FIRE" reaches `/twilio/inbound` as an ordinary text and does not block the number. **Check on a live trial before the demo:** reply STOP COOLEY FIRE, then `npm run inject:update` for another topic; if that text fails with 21610, Twilio treated it as STOP (reply START to undo) and the keyword must change. | `/twilio/inbound` cancels only the subscription it names and replies; a bare STOP still cancels everything. |
| Opt-out | Advanced Opt-Out | STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT: Twilio confirms and blocks later texts to that number itself (error 21610). | `POST /twilio/inbound` also cancels that number's subscriptions (and the Spanish PARAR, ALTO, BAJA). |
| Trial accounts | Trial limits | Texts go only to verified numbers and start with "Sent from your Twilio trial account". | Demo: verify each teammate's number. A judge's number can be verified on the spot (Console → Phone Numbers → Verified Caller IDs). |
| Paid US texting | A2P 10DLC / toll-free verification | Upgrading lifts the verified-numbers limit, but texts from a US local number need A2P 10DLC registration, and from a toll-free number need toll-free verification. Both take days to weeks. | Paying does not make texting to anyone work in time for the demo. Re-check Twilio's current rules before relying on this. |

### Decisions

| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-24 | Twilio for texts, via one `fetch` call; `SMS_NOTIFIER` is `mock` (default), `twilio` or `unconfigured`. | Team choice. Mock by default, the same as `PHONE_NOTIFIER`. |
| 2026-10-24 | The caller chooses calls or texts by voice ("text me", "call me"; English and Spanish, matched in code first, then the model's `channel`). Otherwise the saved `callers.preferredChannel` applies, else a call. Asking for both means a call. | Every update call is followed by a text anyway, so "both" adds nothing. |
| 2026-10-24 | A call is missed when there is still no session for it 100 s after it is placed (Cartesia rings for 45 s), or when every caller turn looks like an answering machine ("leave a message after the tone"), or when the call could not be placed. A missed call gets the update by text. | Does not depend on a Cartesia call-status API we have not verified. Voicemail greetings are transcribed as turns, so they need their own check. |
| 2026-10-24 | When an answered update call ends: the update by text, the same text a text subscriber gets. Nothing said on the call is texted (no answers, no transcript, no LLM summary). | User decision (revised the same day; the first version added up to two answers from the call). |
| 2026-10-24 | Text format, fixed templates from bulletin fields only: "Update on Cooley Fire (4:40 PM PT):", a blank line, "As of 2:22 PM PT: Cooley Fire, Mendocino County: about 1,365 acres, 90% contained.", a blank line, "Reply STOP COOLEY FIRE to stop receiving updates on Cooley Fire. Questions? Call (712) 600-3362. In danger? Call 911." The header time is when the update went out; "As of" is the official time. Time-based texts add "This is an update every 2 hours." before the STOP line; a missed call puts "We tried to call you." before "As of". No source names. At most 450 characters (`smsMaxChars`); only the middle part is ever cut. | User decision. "PT" (not "PST") is right all year. |
| 2026-10-24 | "STOP <topic>" by text stops one subscription and gets a reply ("you won't get more updates on Cooley Fire"); the topic is stored on the subscription (`topicLabel`, the incident's name from its bulletin, or the area's label), so the keyword never changes. A bare STOP stops everything. | User decision: a caller may follow several topics. |
| 2026-10-24 | An update call that reaches voicemail leaves a short message ("…with the update you asked for on Cooley Fire. We'll text you the details. If you are in danger, call 911. Goodbye.") and hangs up; the missed-call text follows. On outbound calls the voice agent waits up to 2 s (`OUTBOUND_GREETING_WAIT_S`) for whoever answers before greeting, so an answering machine's prompt is heard first and the greeting is not recorded. | User decision, after a real callback left the whole greeting (and an LLM answer to the voicemail prompt) on a voicemail. |
| 2026-10-24 | The hotline printed in texts defaults to +1 712 600 3362 (`HOTLINE_NUMBER` overrides it). | The Soterra line. |
| 2026-10-24 | When any call that set up updates ends: one confirmation text (topics, call or text, schedule, until when, STOP, 911). | User decision (both callbacks and inbound calls). It also catches landlines early. |
| 2026-10-24 | A text the number cannot receive (21614, 30006) switches the subscription and `preferredChannel` to calls, and that update is called. Texts about a call (recap, missed call, confirmation) are never called. | User decision. Avoids loops. |
| 2026-10-24 | Time-based updates: "every 2 hours", "hourly", "daily", "cada hora"… The interval is clamped to 1–24 hours. A subscription lasts at least three updates (24 h by default, 72 h at most). A cron sends due updates every minute, even when nothing changed ("No new official updates since…"). Scheduled subscriptions never fire on bulletin events. No quiet hours. | User decision: an emergency line should not hold back updates at night. |
| 2026-10-24 | Rate limits and the per-number burst rule count only update notifications (on change or scheduled), not the verification call or texts about a call. | Found in testing: a confirmation text was blocking the first real update for 15 minutes. |

## Mac Messages relay (2026-10-24, branch `Leia/text-alerts`)

Setup and limits: [mac-relay.md](mac-relay.md).

### Decisions

| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-24 | New `SMS_NOTIFIER=mac_relay`: texts go out from a teammate's iPhone through a Mac (same Apple ID, Text Message Forwarding) with Messages.app via `osascript`. Twilio stays as it is. | A Twilio trial can't text US/Canada numbers without compliance registration (A2P 10DLC / toll-free verification), which takes longer than the demo allows. |
| 2026-10-24 | Pull, not push: `npm run relay:mac` polls `POST /relay/claim` about every 2 s over HTTPS (Bearer `SMS_RELAY_SECRET`) and reports to `POST /relay/result`. No tunnel, no local server. | Nothing on the Mac is exposed; it works on any network. |
| 2026-10-24 | `deliver` marks the text `relayState: "pending"` and calls no Notifier; the result goes through the same `applyResult` as every other notifier. Claims hand out at most 5 texts with a claim token; the Mac sends one at a time, at least 3 s apart. | One code path for what follows a result; a result with the wrong token is rejected (409). |
| 2026-10-24 | Expiry: pending over 30 min → failed `relay_stale`; claimed with no result over 5 min → failed `relay_lost` (a late "sent" corrects it); a subscription stopped in the meantime → failed `subscription_inactive`. | An old alert must never go out late; a crashed relay must not leave texts hanging. |
| 2026-10-24 | The relay texts any number the backend sends. `RELAY_ALLOWLIST` is optional: when set, other numbers fail `not_allowlisted`. | User decision for the demo: anyone who calls the hotline and asks for texts gets them (judges included), with no list to keep up to date. Texts come from the teammate's personal number. |
| 2026-10-24 | No inbound handling: no `chat.db`, no Full Disk Access. STOP replies land on the teammate's phone and are handled by hand (`notifications:stopByText`) or by calling the hotline. | Keeps the relay small and the Mac's permissions minimal. |
| 2026-10-24 | `/health`: `sms` is `live` when `SMS_NOTIFIER=mac_relay` and `SMS_RELAY_SECRET` is set; new flag `smsRelayOnline` (a relay claimed in the last 60 s, from `smsRelayHeartbeats`). | Shows at a glance whether the Mac is polling. |

### Verified (2026-10-24, dev deployment `brazen-perch-21`)

- End to end with `npx convex run smsRelay:queueTest '{"phone":"+1…"}'`: queued in Convex, claimed by `npm run relay:mac` on Leia's Mac, sent by Messages over SMS (Text Message Forwarding from the iPhone), result `sent` / `handed_to_messages`, and received on a teammate's phone. The AppleScript (`1st account whose service type = SMS`, `send … to participant …`) works as written.
- A dry run (`RELAY_DRY_RUN=1`) claims texts and reports them `relay_dry_run`; nothing is sent.

### Still unverified (relay)

- A real hotline call → confirmation text, and `inject:update` → update text, through the relay (covered by `convex/tests/smsRelay.test.ts`; same `deliver` path as `queueTest`).
- The exact AppleScript errors for a missing SMS account (we match -1728/-1719 and "service type = SMS") and a denied Automation prompt (-1743).
- How Messages splits a 450-character text over SMS, and whether the recipient sees one message.
- "sent" only means handed to Messages; delivery failures are not reported back.
